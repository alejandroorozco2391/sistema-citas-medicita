-- ═══════════════════════════════════════════════════════════════════════
-- 0014 — El reloj puesto a trabajar
--
-- 0004 dejó escrito esto sobre la tabla `seguimientos`:
--
--     "Hoy los envíos de día 3 y 30 son manuales porque no había dónde
--      correr un cron; esta tabla es lo que el trabajo programado va a
--      leer cuando exista."
--
-- Ya existe. La Fase E trajo pg_cron, la bandeja de salida y la función
-- que la vacía. Esta migración le pone un PRODUCTOR: nadie más tiene que
-- acordarse de mandar nada.
--
--   · recordatorio_cita   la víspera de la cita
--   · seguimiento_3d      tres días después de la consulta
--   · seguimiento_30d     al mes
--
-- Lo que NO es esto: contacto proactivo de mercadotecnia. Todo lo que sale
-- de aquí cuelga de una cita que ese paciente pidió. La diferencia importa
-- legalmente —la LFPDPPP trata los datos de salud como sensibles— y es la
-- razón por la que el consentimiento nace en `true`: un recordatorio de la
-- cita que acabas de agendar es parte del servicio, no publicidad. Lo que
-- lo vuelve defendible en la práctica es que la baja sea de un clic, y de
-- eso se encarga `darse_de_baja`.
--
-- Y sigue siendo solo correo. SMS y WhatsApp entran después cambiando el
-- CHECK de `avisos_pendientes.canal` y agregando un remitente en
-- api/avisar.js — para eso se separó la escalera del envío.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── A dónde apunta el enlace ──────────────────────────────────────────
-- El correo de seguimiento lleva el enlace a la encuesta, y el de baja
-- lleva el de la baja. Sin esto habría que incrustar el dominio en la
-- función, y cada clínica vive en su propio despliegue.
alter table public.clinicas
  add column if not exists sitio_url text not null default '';

comment on column public.clinicas.sitio_url is
  'https://… del despliegue de ESTA clínica, sin diagonal final. Sin él no se encolan avisos con enlace.';

-- ─── Consentimiento y salida ───────────────────────────────────────────
-- Dos interruptores y no uno: alguien puede querer que le recuerden su
-- cita —le sirve— y no querer el correo de "¿cómo te fue?". Meterlos en la
-- misma casilla obliga a elegir entre las dos cosas, y casi todos elegirían
-- apagarlo todo.
alter table public.pacientes
  add column if not exists avisa_recordatorios boolean not null default true,
  add column if not exists avisa_seguimientos  boolean not null default true,
  add column if not exists baja_en             timestamptz,
  -- 122 bits al azar, del generador que trae Postgres de fábrica. Se evita
  -- gen_random_bytes() a propósito: es de pgcrypto, y aunque Supabase la
  -- tenga, el esquema tiene que aplicarse contra un Postgres pelón — así
  -- corren las pruebas.
  add column if not exists baja_token          text not null
                             default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists pacientes_baja_token_unico
  on public.pacientes (baja_token);

comment on column public.pacientes.baja_token is
  'Credencial del enlace de baja. Va en cada correo; con ella se puede dar de baja sin iniciar sesión y sin poder ver nada más.';

-- ═══ La bandeja de salida deja de ser solo de escalaciones ═════════════
alter table public.avisos_pendientes
  alter column escalacion_id drop not null;

alter table public.avisos_pendientes
  add column if not exists tipo text not null default 'escalacion',
  add column if not exists cita_id     uuid references public.citas(id)     on delete cascade,
  add column if not exists paciente_id uuid references public.pacientes(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'avisos_pendientes_tipo_valido') then
    alter table public.avisos_pendientes
      add constraint avisos_pendientes_tipo_valido check (tipo in (
        'escalacion', 'recordatorio_cita', 'seguimiento_3d', 'seguimiento_30d'
      ));
  end if;
end $$;

-- ─── Idempotencia, y de aquí cuelga todo el diseño ─────────────────────
-- El productor corre cada hora. Que no duplique NO depende de que el
-- horario sea exacto ni de que nadie lo llame dos veces: depende de este
-- índice. Es lo que permite que el trabajo sea "recórrelo otra vez, por si
-- la vez pasada falló" en lugar de "córrelo exactamente una vez o el
-- paciente recibe el mismo correo cinco veces".
create unique index if not exists avisos_unico_por_cita
  on public.avisos_pendientes (clinica_id, tipo, cita_id)
  where cita_id is not null;

create index if not exists avisos_paciente_idx
  on public.avisos_pendientes (clinica_id, paciente_id, creado_en);

-- ═══ Tope de frecuencia ════════════════════════════════════════════════
-- Aunque cada aviso por separado sea legítimo, tres en una semana ya es
-- ruido y la siguiente acción del paciente es marcar el correo como spam
-- — y eso se lo lleva el dominio entero de la clínica, incluidos los
-- correos que sí quiere.
create or replace function public.puede_recibir_aviso(p_paciente uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_paciente is null or (
    coalesce((select baja_en is null from public.pacientes where id = p_paciente), false)
    and (
      select count(*) < 3
      from public.avisos_pendientes
      where paciente_id = p_paciente
        and tipo <> 'escalacion'
        and creado_en > now() - interval '7 days'
    )
  );
$$;

comment on function public.puede_recibir_aviso is
  'Tope de 3 avisos automáticos por paciente cada 7 días, y respeta la baja. No aplica a escalaciones: esas van al personal.';

-- ═══ Pie de todos los correos automáticos ══════════════════════════════
create or replace function public.pie_de_aviso(p_clinica uuid, p_paciente uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_url   text;
  v_token text;
  v_nom   text;
begin
  select sitio_url, nombre_clinica into v_url, v_nom
  from public.clinicas where id = p_clinica;

  select baja_token into v_token from public.pacientes where id = p_paciente;

  if coalesce(v_url, '') = '' or v_token is null then
    /* Sin enlace de baja no se manda un correo automático. Es la línea que
       separa "seguimiento del servicio" de "correo del que no te puedes
       bajar", y sin ella lo segundo es lo que sale. */
    return null;
  end if;

  return E'\n\n—\n' || coalesce(v_nom, 'Tu clínica') ||
         E'\nSi no quieres recibir estos correos, cancélalos aquí: ' ||
         v_url || '/baja.html?t=' || v_token;
end;
$$;

-- ═══ Productor 1: recordatorio de la cita ══════════════════════════════
create or replace function public.encolar_recordatorios(p_clinica uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_manana date;
  v_c     record;
  v_pie   text;
  v_n     int := 0;
begin
  select zona_horaria into v_tz from public.clinicas where id = p_clinica and activa;
  if v_tz is null then return 0; end if;

  v_manana := ((now() at time zone v_tz)::date) + 1;

  for v_c in
    select c.*, cl.nombre_clinica, cl.telefono as tel_clinica
    from public.citas c
    join public.clinicas cl on cl.id = c.clinica_id
    where c.clinica_id = p_clinica
      and c.fecha = v_manana
      and c.estado in ('pendiente', 'confirmada')
      and coalesce(c.email, '') <> ''
      and c.paciente_id is not null
      -- El interruptor del paciente, no una preferencia global.
      and exists (select 1 from public.pacientes p
                  where p.id = c.paciente_id and p.avisa_recordatorios and p.baja_en is null)
      and public.puede_recibir_aviso(c.paciente_id)
  loop
    v_pie := public.pie_de_aviso(p_clinica, v_c.paciente_id);
    continue when v_pie is null;

    begin
      insert into public.avisos_pendientes (
        clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
      ) values (
        p_clinica, 'recordatorio_cita', v_c.id, v_c.paciente_id, 'email', v_c.email,
        'Recordatorio: tu cita es mañana',
        'Hola ' || coalesce(nullif(v_c.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
        'Te recordamos tu cita de mañana:' || E'\n\n' ||
        '  Fecha: '  || to_char(v_c.fecha, 'DD/MM/YYYY') ||
          case when coalesce(v_c.hora, '') <> '' then ' a las ' || v_c.hora else '' end || E'\n' ||
        '  Médico: ' || coalesce(nullif(v_c.doctor, ''), 'por asignar') || E'\n' ||
        '  Folio: '  || v_c.folio || E'\n\n' ||
        'Si no puedes asistir, avísanos' ||
          case when coalesce(v_c.tel_clinica, '') <> ''
               then ' al ' || v_c.tel_clinica else '' end ||
        ' para dársela a alguien más.' || v_pie
      );
      v_n := v_n + 1;
    exception when unique_violation then
      -- Ya se encoló en una corrida anterior de hoy. Es lo esperado.
      null;
    end;
  end loop;

  return v_n;
end;
$$;

-- ═══ Productor 2: seguimiento post-consulta ════════════════════════════
create or replace function public.encolar_seguimientos(p_clinica uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz   text;
  v_url  text;
  v_hoy  date;
  v_s    record;
  v_pie  text;
  v_tipo text;
  v_n    int := 0;
begin
  select zona_horaria, sitio_url into v_tz, v_url
  from public.clinicas where id = p_clinica and activa;
  if v_tz is null then return 0; end if;

  v_hoy := (now() at time zone v_tz)::date;

  for v_s in
    select s.id as seg_id, s.email_enviado_3d, s.email_enviado_30d, s.fecha_atendida,
           c.id as cita_id, c.paciente_id, c.email, c.nombre, c.folio, c.doctor
    from public.seguimientos s
    join public.citas c on c.id = s.cita_id
    where s.clinica_id = p_clinica
      and coalesce(c.email, '') <> ''
      and c.paciente_id is not null
      and (
        (s.fecha_atendida = v_hoy - 3  and not s.email_enviado_3d) or
        (s.fecha_atendida = v_hoy - 30 and not s.email_enviado_30d)
      )
      and exists (select 1 from public.pacientes p
                  where p.id = c.paciente_id and p.avisa_seguimientos and p.baja_en is null)
      and public.puede_recibir_aviso(c.paciente_id)
  loop
    v_tipo := case when v_s.fecha_atendida = v_hoy - 3
                   then 'seguimiento_3d' else 'seguimiento_30d' end;

    v_pie := public.pie_de_aviso(p_clinica, v_s.paciente_id);
    continue when v_pie is null;

    begin
      insert into public.avisos_pendientes (
        clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
      ) values (
        p_clinica, v_tipo, v_s.cita_id, v_s.paciente_id, 'email', v_s.email,
        case when v_tipo = 'seguimiento_3d'
             then '¿Cómo te has sentido?'
             else 'Ya pasó un mes de tu consulta' end,
        'Hola ' || coalesce(nullif(v_s.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
        case when v_tipo = 'seguimiento_3d' then
          'Han pasado unos días desde tu consulta' ||
          case when coalesce(v_s.doctor, '') <> '' then ' con ' || v_s.doctor else '' end ||
          '. Queremos saber cómo te has sentido.' || E'\n\n' ||
          'Si sigues con molestias o tienes dudas sobre tu tratamiento, responde este ' ||
          'correo o llámanos: no esperes a la siguiente cita.'
        else
          'Ya pasó un mes de tu consulta. Si tu tratamiento terminó y todo va bien, ' ||
          'nos alegra saberlo.' || E'\n\n' ||
          'Si quedó algo pendiente o quieres una revisión de control, con gusto te agendamos.'
        end || E'\n\n' ||
        'Cuéntanos cómo te fue en un minuto: ' || v_url || '/encuesta.html?folio=' || v_s.folio ||
        v_pie
      );

      /* Se marca al ENCOLAR, no al entregar. Si el correo falla,
         avisos_pendientes tiene sus propios cinco reintentos; volver a
         encolarlo cada hora desde aquí sería una segunda cola, sin tope. */
      if v_tipo = 'seguimiento_3d'
        then update public.seguimientos set email_enviado_3d = true, enviado_3d_en = now()
             where id = v_s.seg_id;
        else update public.seguimientos set email_enviado_30d = true, enviado_30d_en = now()
             where id = v_s.seg_id;
      end if;

      v_n := v_n + 1;
    exception when unique_violation then
      null;
    end;
  end loop;

  return v_n;
end;
$$;

-- ═══ El barrido, que es lo que llama pg_cron ═══════════════════════════
create or replace function public.encolar_avisos_del_dia()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cl  record;
  v_hora int;
  v_n   int := 0;
begin
  for v_cl in select id, zona_horaria from public.clinicas where activa loop
    /* La hora LOCAL de esa clínica, no la del servidor. Supabase corre en
       UTC: sin convertir, a un consultorio de Tijuana le saldrían los
       correos a las 2 de la mañana. */
    v_hora := extract(hour from (now() at time zone v_cl.zona_horaria))::int;

    -- Ventana amplia a propósito. Lo que evita duplicados es el índice
    -- único, no la puntualidad, así que el barrido puede correr muchas
    -- veces: si a las 8 la base estaba caída, a las 9 se recupera solo.
    continue when v_hora < 8 or v_hora > 20;

    v_n := v_n
         + public.encolar_recordatorios(v_cl.id)
         + public.encolar_seguimientos(v_cl.id);
  end loop;

  return v_n;
end;
$$;

comment on function public.encolar_avisos_del_dia is
  'Productor de avisos automáticos. Lo llama pg_cron cada hora; es idempotente por el índice avisos_unico_por_cita.';

-- ═══ La salida fácil ═══════════════════════════════════════════════════
-- Sin sesión, con el token del correo como única credencial. No devuelve
-- nada que sirva para identificar a nadie más allá del nombre de pila —
-- suficiente para que la página diga a quién está dando de baja, y nada
-- más. El token es el mismo criterio que el folio en la encuesta: quien lo
-- tiene es porque recibió el correo.
create or replace function public.consultar_baja(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p record;
begin
  select p.nombre, p.avisa_recordatorios, p.avisa_seguimientos, p.baja_en,
         cl.nombre_clinica
  into v_p
  from public.pacientes p
  join public.clinicas cl on cl.id = p.clinica_id
  where p.baja_token = trim(p_token);

  if not found then
    return jsonb_build_object('valido', false);
  end if;

  return jsonb_build_object(
    'valido', true,
    'nombre', v_p.nombre,
    'clinica', v_p.nombre_clinica,
    'recordatorios', v_p.avisa_recordatorios and v_p.baja_en is null,
    'seguimientos',  v_p.avisa_seguimientos  and v_p.baja_en is null,
    'dadoDeBaja', v_p.baja_en is not null
  );
end;
$$;

create or replace function public.darse_de_baja(
  p_token   text,
  p_alcance text default 'todo'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_alcance not in ('todo', 'seguimientos', 'reactivar') then
    raise exception 'Alcance no válido';
  end if;

  select id into v_id from public.pacientes where baja_token = trim(p_token);
  if v_id is null then
    raise exception 'Ese enlace ya no es válido. Escríbenos y lo resolvemos.';
  end if;

  if p_alcance = 'todo' then
    update public.pacientes
      set baja_en = now(), avisa_recordatorios = false, avisa_seguimientos = false
      where id = v_id;

  elsif p_alcance = 'seguimientos' then
    -- Solo el "¿cómo te fue?". Conserva el recordatorio de la cita, que es
    -- lo que la mayoría quiere seguir recibiendo.
    update public.pacientes
      set baja_en = null, avisa_seguimientos = false, avisa_recordatorios = true
      where id = v_id;

  else
    update public.pacientes
      set baja_en = null, avisa_seguimientos = true, avisa_recordatorios = true
      where id = v_id;
  end if;

  /* Lo que ya estaba encolado y no ha salido, se cancela. Dar de baja y
     que al minuto llegue un correo más es exactamente lo que hace que la
     gente deje de creerle al enlace. */
  update public.avisos_pendientes
    set estado = 'fallido', ultimo_error = 'cancelado por baja del paciente'
    where paciente_id = v_id and estado = 'pendiente' and tipo <> 'escalacion';

  return public.consultar_baja(p_token);
end;
$$;

comment on function public.darse_de_baja is
  'Baja sin sesión con el token del correo. Cancela además lo que ya estuviera encolado.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
-- Convención de 0013: revocar de los tres y conceder a quien la necesita.
revoke all on function public.encolar_avisos_del_dia()      from public, anon, authenticated;
revoke all on function public.encolar_recordatorios(uuid)   from public, anon, authenticated;
revoke all on function public.encolar_seguimientos(uuid)    from public, anon, authenticated;
revoke all on function public.pie_de_aviso(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.puede_recibir_aviso(uuid)     from public, anon;

revoke all on function public.consultar_baja(text)       from public, anon, authenticated;
revoke all on function public.darse_de_baja(text, text)  from public, anon, authenticated;

-- Las dos puertas nuevas del visitante sin cuenta. La baja tiene que
-- funcionar sin sesión: exigirle una cuenta a alguien para dejar de
-- escribirle es no dejar que se vaya.
grant execute on function public.consultar_baja(text)      to anon, authenticated;
grant execute on function public.darse_de_baja(text, text) to anon, authenticated;

grant execute on function public.puede_recibir_aviso(uuid) to authenticated;
