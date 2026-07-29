-- ═══════════════════════════════════════════════════════════════════════
-- 0010 — Escalación a humano
--
-- Un paciente pide hablar con una persona, o el agente no puede resolver
-- lo que le están pidiendo. Lo que NO puede pasar es que eso se pierda:
-- una escalación sin acuse deja al paciente peor que si nunca hubiera
-- pedido un humano. Pidió ayuda, le dijeron que sí, y nadie llegó.
--
-- Por eso el centro de esta migración no es la tabla, es el ciclo:
--
--   pendiente ──(alguien la toma)──> reconocida ──> resuelta
--       │
--       └──(nadie la toma a tiempo)──> sube de nivel ──> vencida
--
-- Y `vencida` NO se cierra sola. Nunca. Se queda visible hasta que un
-- humano la cierre a mano. Es la única garantía de que nada se traspapela.
--
-- El reloj que hace subir la escalera es pg_cron, y se programa aparte:
-- ver supabase/cron.sql. Esta migración no depende de esa extensión, para
-- que el esquema se pueda probar contra un Postgres pelón.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── La escalación ─────────────────────────────────────────────────────
create table public.escalaciones (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,

  -- De dónde viene. Todo opcional: un paciente sin expediente que escribe
  -- por WhatsApp a las 11 de la noche también tiene derecho a un humano.
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  paciente_id     uuid references public.pacientes(id) on delete set null,
  cita_id         uuid references public.citas(id) on delete set null,
  canal_origen    text not null default 'medibot',

  -- Con quién hay que hablar. Se copian aquí y no solo por referencia:
  -- son el registro de con qué datos se pidió el contacto.
  contacto_nombre   text not null default '',
  contacto_telefono text not null default '',
  contacto_email    text not null default '',
  telefono_clave    text generated always as
                      (right(regexp_replace(coalesce(contacto_telefono, ''), '\D', '', 'g'), 10)) stored,

  motivo   text not null check (motivo in (
             'urgencia_medica',    -- posible emergencia
             'duda_clinica',       -- pregunta que exige criterio médico
             'queja',              -- inconformidad
             'agenda',             -- cambio complicado de cita
             'administrativo',     -- costos, seguros, facturación
             'peticion_explicita', -- "quiero hablar con una persona"
             'bot_no_pudo'         -- el agente se rindió
           )),
  urgencia text not null default 'normal' check (urgencia in ('alta', 'normal', 'baja')),
  resumen  text not null default '',

  destino_rol text not null check (destino_rol in ('doctor', 'recepcionista', 'admin')),
  asignado_a  uuid references public.perfiles_staff(id) on delete set null,

  estado text not null default 'pendiente'
           check (estado in ('pendiente', 'reconocida', 'resuelta', 'vencida')),
  nivel  smallint not null default 0 check (nivel between 0 and 3),

  vence_en       timestamptz not null,
  reconocida_en  timestamptz,
  reconocida_por uuid references public.perfiles_staff(id) on delete set null,
  resuelta_en    timestamptz,
  resuelta_por   uuid references public.perfiles_staff(id) on delete set null,
  nota_cierre    text default '',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.escalaciones is
  'Petición de atención humana con acuse obligatorio. El estado `vencida` nunca se cierra solo: esa es la garantía de que nada se traspapela.';
comment on column public.escalaciones.nivel is
  '0 al rol destino · 1 a todo el personal · 2 además por correo · 3 vencida.';

create index escalaciones_abiertas_idx
  on public.escalaciones (clinica_id, estado, vence_en)
  where estado in ('pendiente', 'vencida');

-- Para el freno de abuso: contar cuántas pidió este teléfono hoy.
create index escalaciones_telefono_idx
  on public.escalaciones (clinica_id, telefono_clave, creado_en);

create index escalaciones_conversacion_idx on public.escalaciones (conversacion_id);

create trigger escalaciones_actualizado_en
  before update on public.escalaciones
  for each row execute function public.tocar_actualizado_en();

-- ─── Bandeja de salida ─────────────────────────────────────────────────
-- Separar "subir la escalera" de "entregar el aviso" es lo que permite
-- reintentar un correo sin volver a disparar la escalera, y deja el hueco
-- para que WhatsApp sea después solo otro remitente.
create table public.avisos_pendientes (
  id            uuid primary key default gen_random_uuid(),
  clinica_id    uuid not null references public.clinicas(id) on delete cascade,
  escalacion_id uuid not null references public.escalaciones(id) on delete cascade,

  canal        text not null default 'email' check (canal in ('email')),
  destinatario text not null,
  asunto       text not null default '',
  cuerpo       text not null default '',

  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'enviado', 'fallido')),
  intentos     integer not null default 0,
  ultimo_error text default '',

  creado_en    timestamptz not null default now(),
  enviado_en   timestamptz
);

comment on table public.avisos_pendientes is
  'Cola de avisos por entregar. La drena una función de Vercel; los reintentos no vuelven a mover la escalación.';

create index avisos_pendientes_cola_idx
  on public.avisos_pendientes (estado, creado_en)
  where estado = 'pendiente';

-- ═══ Ruteo ═════════════════════════════════════════════════════════════
-- A quién le toca y para cuándo. Depende del motivo Y del horario, que
-- por eso hubo que construir MediHorario primero.
create or replace function public.rutear_escalacion(
  p_clinica  uuid,
  p_motivo   text,
  p_urgencia text,
  p_momento  timestamptz default now()
)
returns table (destino_rol text, vence_en timestamptz)
language plpgsql
stable
as $$
declare
  v_abierto boolean;
  v_prox    timestamptz;
  v_rol     text;
  v_margen  interval;
begin
  v_rol := case p_motivo
    when 'urgencia_medica' then 'doctor'
    when 'duda_clinica'    then 'doctor'
    when 'queja'           then 'admin'
    else                        'recepcionista'
  end;

  -- Si no hay nadie con ese rol, se cae al que siempre existe. Enrutar a
  -- un rol vacío es enrutar a nadie, que es el hoyo negro otra vez.
  if not exists (
    select 1 from public.perfiles_staff
    where clinica_id = p_clinica and activo and rol = v_rol
  ) then
    v_rol := 'admin';
    if not exists (
      select 1 from public.perfiles_staff
      where clinica_id = p_clinica and activo and rol = 'admin'
    ) then
      v_rol := 'recepcionista';
    end if;
  end if;

  v_margen := case p_urgencia
    when 'alta' then interval '5 minutes'
    when 'baja' then interval '60 minutes'
    else             interval '15 minutes'
  end;

  v_abierto := public.en_horario(p_clinica, p_momento);

  -- Una posible urgencia médica NO espera a que abran. Va al doctor con
  -- el reloj corriendo aunque sea domingo de madrugada.
  if p_motivo = 'urgencia_medica' then
    return query select v_rol, p_momento + interval '15 minutes';
    return;
  end if;

  if v_abierto then
    return query select v_rol, p_momento + v_margen;
    return;
  end if;

  -- Cerrado: el reloj empieza a correr cuando abran, no antes. Vencer una
  -- escalación a las 3 de la mañana solo produce alertas que nadie puede
  -- atender, y enseña al personal a ignorarlas.
  v_prox := public.proxima_apertura(p_clinica, p_momento);
  return query select v_rol, coalesce(v_prox, p_momento + interval '12 hours') + v_margen;
end;
$$;

comment on function public.rutear_escalacion is
  'Decide destino y plazo según motivo, urgencia y horario. urgencia_medica nunca espera a que abran.';

-- ═══ Avisos ════════════════════════════════════════════════════════════
create or replace function public.encolar_aviso_escalacion(
  p_escalacion uuid,
  p_tipo       text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e       record;
  v_roles   text[];
  v_asunto  text;
  v_cuerpo  text;
  v_n       int := 0;
  v_dest    record;
begin
  select * into v_e from public.escalaciones where id = p_escalacion;
  if not found then return 0; end if;

  -- Nivel 2 avisa a quien decide; vencida, a todo el mundo.
  v_roles := case when p_tipo = 'vencida'
                  then array['doctor', 'recepcionista', 'admin']
                  else array['doctor', 'admin'] end;

  v_asunto := case when p_tipo = 'vencida'
    then '⚠ Escalación SIN ATENDER: ' || v_e.motivo
    else 'Escalación sin acuse: ' || v_e.motivo end;

  v_cuerpo :=
    'Paciente: '  || coalesce(nullif(v_e.contacto_nombre, ''), 'sin nombre') || E'\n' ||
    'Teléfono: '  || coalesce(nullif(v_e.contacto_telefono, ''), 'no proporcionado') || E'\n' ||
    'Motivo: '    || v_e.motivo || ' (urgencia ' || v_e.urgencia || ')' || E'\n' ||
    'Canal: '     || v_e.canal_origen || E'\n' ||
    'Pedida: '    || to_char(v_e.creado_en, 'YYYY-MM-DD HH24:MI') || E'\n\n' ||
    'Lo que pidió:' || E'\n' || coalesce(nullif(v_e.resumen, ''), '(sin detalle)') || E'\n\n' ||
    case when p_tipo = 'vencida'
      then 'NADIE LA HA TOMADO. Sigue abierta en el panel y no se va a cerrar sola.'
      else 'Sigue sin acuse. Ábrela en el panel y dale "La tomo".' end;

  -- El correo del personal vive en auth.users, no en perfiles_staff. Se
  -- puede leer desde aquí porque la función es security definer.
  for v_dest in
    select distinct u.email
    from public.perfiles_staff p
    join auth.users u on u.id = p.usuario_id
    where p.clinica_id = v_e.clinica_id
      and p.activo
      and p.rol = any(v_roles)
      and coalesce(u.email, '') <> ''
  loop
    insert into public.avisos_pendientes
      (clinica_id, escalacion_id, destinatario, asunto, cuerpo)
    values
      (v_e.clinica_id, v_e.id, v_dest.email, v_asunto, v_cuerpo);
    v_n := v_n + 1;
  end loop;

  -- Nadie con correo: al menos que quede el de la clínica, o el aviso se
  -- evapora sin dejar rastro de que se intentó.
  if v_n = 0 then
    insert into public.avisos_pendientes
      (clinica_id, escalacion_id, destinatario, asunto, cuerpo)
    select v_e.clinica_id, v_e.id, c.email, v_asunto, v_cuerpo
    from public.clinicas c
    where c.id = v_e.clinica_id and coalesce(c.email, '') <> '';
    get diagnostics v_n = row_count;
  end if;

  return v_n;
end;
$$;

-- ═══ La escalera ═══════════════════════════════════════════════════════
-- La corre pg_cron cada minuto. Es la única pieza del sistema que trabaja
-- sin que haya un navegador abierto — y es exactamente para lo que se
-- construyó el backend.
create or replace function public.promover_escalaciones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e record;
  v_n int := 0;
begin
  for v_e in
    select id, nivel, conversacion_id
    from public.escalaciones
    where estado = 'pendiente'
      and vence_en <= now()
    for update skip locked
  loop
    v_n := v_n + 1;

    if v_e.nivel = 0 then
      -- Deja de ser "de recepción" y pasa a ser de todos.
      update public.escalaciones
         set nivel = 1, vence_en = now() + interval '5 minutes'
       where id = v_e.id;

    elsif v_e.nivel = 1 then
      update public.escalaciones
         set nivel = 2, vence_en = now() + interval '10 minutes'
       where id = v_e.id;
      perform public.encolar_aviso_escalacion(v_e.id, 'nivel2');

    else
      -- Fin de la escalera. No hay nivel 4 ni cierre automático: se queda
      -- en rojo hasta que alguien la atienda.
      update public.escalaciones
         set estado = 'vencida', nivel = 3
       where id = v_e.id;

      update public.conversaciones
         set estado = 'requiere_atencion_humana'
       where id = v_e.conversacion_id
         and estado <> 'resuelta';

      perform public.encolar_aviso_escalacion(v_e.id, 'vencida');
    end if;
  end loop;

  return v_n;
end;
$$;

comment on function public.promover_escalaciones is
  'Sube de nivel las escalaciones sin acuse. La programa pg_cron cada minuto (ver supabase/cron.sql).';

-- ═══ Acuse y cierre ════════════════════════════════════════════════════
-- Tomar una escalación detiene la escalera EN SECO. Es lo que hace que el
-- ciclo signifique algo: quien la toma se está haciendo responsable.
create or replace function public.escalacion_reconocer(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_yo uuid;
begin
  select id into v_yo from public.perfiles_staff
   where usuario_id = auth.uid() and activo;

  update public.escalaciones
     set estado = 'reconocida',
         reconocida_en = now(),
         reconocida_por = v_yo,
         asignado_a = coalesce(asignado_a, v_yo)
   where id = p_id
     and clinica_id = public.clinica_actual()
     and estado in ('pendiente', 'vencida');

  if not found then
    raise exception 'Esa escalación ya no está abierta';
  end if;
end;
$$;

-- Cerrar exige decir qué pasó. Un cierre sin nota es indistinguible de
-- alguien limpiando la lista para que deje de parpadear.
create or replace function public.escalacion_resolver(p_id uuid, p_nota text)
returns void
language plpgsql
as $$
declare
  v_yo uuid;
begin
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Hay que anotar qué se hizo antes de cerrarla';
  end if;

  select id into v_yo from public.perfiles_staff
   where usuario_id = auth.uid() and activo;

  update public.escalaciones
     set estado = 'resuelta',
         resuelta_en = now(),
         resuelta_por = v_yo,
         nota_cierre = trim(p_nota),
         reconocida_en = coalesce(reconocida_en, now()),
         reconocida_por = coalesce(reconocida_por, v_yo)
   where id = p_id
     and clinica_id = public.clinica_actual()
     and estado <> 'resuelta';

  if not found then
    raise exception 'Esa escalación ya estaba cerrada';
  end if;
end;
$$;

-- ═══ Pedir un humano sin tener cuenta ══════════════════════════════════
-- Es la puerta del paciente. Misma forma que solicitar_cita: el rol
-- anónimo no tiene política sobre ninguna tabla, y esta función valida
-- por dentro.
create or replace function public.escalar_a_humano(
  p_motivo          text,
  p_resumen         text,
  p_urgencia        text default 'normal',
  p_nombre          text default '',
  p_telefono        text default '',
  p_email           text default '',
  p_canal           text default 'medibot',
  p_conversacion_id uuid default null,
  p_clinica_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinica   uuid := coalesce(p_clinica_id, public.clinica_unica());
  v_tel_clave text := public.clave_telefono(p_telefono);
  v_recientes int;
  v_ruta      record;
  v_id        uuid;
  v_abierto   boolean;
  v_prox      timestamptz;
  v_paciente  uuid;
begin
  if p_motivo is null or p_motivo = '' then
    raise exception 'Falta el motivo de la escalación';
  end if;

  -- Freno de abuso, igual que en solicitar_cita: la anon key es pública.
  -- El tope es más bajo que el de citas (3 contra 5) porque cada
  -- escalación le suena el teléfono a una persona de verdad.
  if v_tel_clave <> '' then
    select count(*) into v_recientes
    from public.escalaciones
    where clinica_id = v_clinica
      and telefono_clave = v_tel_clave
      and creado_en > now() - interval '24 hours';

    if v_recientes >= 3 then
      raise exception 'Ya hay varias solicitudes de contacto desde este teléfono. Alguien de la clínica te va a llamar.';
    end if;

    select id into v_paciente
    from public.pacientes
    where clinica_id = v_clinica and telefono_clave = v_tel_clave
    limit 1;
  end if;

  select r.destino_rol, r.vence_en into v_ruta
  from public.rutear_escalacion(v_clinica, p_motivo, coalesce(p_urgencia, 'normal')) r;

  insert into public.escalaciones (
    clinica_id, conversacion_id, paciente_id, canal_origen,
    contacto_nombre, contacto_telefono, contacto_email,
    motivo, urgencia, resumen, destino_rol, vence_en
  ) values (
    v_clinica, p_conversacion_id, v_paciente, coalesce(p_canal, 'medibot'),
    coalesce(p_nombre, ''), coalesce(p_telefono, ''), coalesce(p_email, ''),
    p_motivo, coalesce(p_urgencia, 'normal'), coalesce(p_resumen, ''),
    v_ruta.destino_rol, v_ruta.vence_en
  )
  returning id into v_id;

  -- La conversación queda marcada para que salte en el inbox.
  if p_conversacion_id is not null then
    update public.conversaciones
       set estado = 'requiere_atencion_humana'
     where id = p_conversacion_id and clinica_id = v_clinica;
  end if;

  v_abierto := public.en_horario(v_clinica);
  v_prox    := public.proxima_apertura(v_clinica);

  -- Se devuelve el estado del mundo, no una frase hecha: quien llama
  -- redacta, pero solo puede prometer lo que estos datos sostienen.
  return jsonb_build_object(
    'id',            v_id,
    'destino',       v_ruta.destino_rol,
    'urgencia',      coalesce(p_urgencia, 'normal'),
    'abiertoAhora',  v_abierto,
    'atencionEn',    case when v_abierto then null else v_prox end,
    'esEmergencia',  p_motivo = 'urgencia_medica',
    'instruccion',
      case
        when p_motivo = 'urgencia_medica' then
          'ANTES QUE NADA dile que si es una emergencia llame al 911 o vaya a urgencias AHORA, sin esperar respuesta. Después confirma que ya avisaste a la clínica.'
        when v_abierto then
          'Confirma que ya avisaste y que en unos minutos lo contactan.'
        when v_prox is not null then
          'Confirma que ya avisaste y di que lo contactan cuando abra el consultorio, en la fecha y hora de atencionEn. No prometas antes.'
        else
          'Confirma que ya avisaste. NO prometas una hora: el consultorio no tiene horario cargado y sería inventarla.'
      end
  );
end;
$$;

comment on function public.escalar_a_humano is
  'Puerta sin sesión para pedir atención humana. Devuelve el estado real del horario para que nadie prometa una hora que no se sostiene.';

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.escalaciones      enable row level security;
alter table public.avisos_pendientes enable row level security;

-- Todo el personal las ve, sin distinción de rol: recepción tiene que
-- poder darse cuenta de que la escalación del doctor lleva veinte minutos
-- sin que nadie la toque. Ocultársela sería reconstruir el hoyo negro
-- dentro del propio equipo.
create policy escalaciones_todo on public.escalaciones
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

-- La bandeja de salida es solo de lectura para el personal: quien la
-- escribe es la escalera, y quien la vacía es la función de Vercel con la
-- service role key.
create policy avisos_lectura on public.avisos_pendientes
  for select to authenticated
  using (clinica_id = public.clinica_actual());

-- ─── Permisos ──────────────────────────────────────────────────────────
revoke all on function public.escalar_a_humano          from public;
revoke all on function public.rutear_escalacion         from public;
revoke all on function public.promover_escalaciones     from public;
revoke all on function public.encolar_aviso_escalacion  from public;
revoke all on function public.escalacion_reconocer      from public;
revoke all on function public.escalacion_resolver       from public;

-- Lo único que alcanza un paciente sin cuenta.
grant execute on function public.escalar_a_humano to anon, authenticated;

grant execute on function public.escalacion_reconocer to authenticated;
grant execute on function public.escalacion_resolver  to authenticated;
grant execute on function public.rutear_escalacion    to authenticated;

-- promover_escalaciones() y encolar_aviso_escalacion() NO se conceden a
-- nadie: las corre pg_cron como dueño de la base. Si un usuario pudiera
-- llamarlas, podría acelerar la escalera de otra clínica.
