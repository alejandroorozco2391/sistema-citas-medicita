-- ═══════════════════════════════════════════════════════════════════════
-- 0018 — El consultorio cancela, y el paciente se entera
--
-- Hasta aquí, cerrar un día con citas agendadas enseñaba quiénes eran y
-- **no hacía nada**. La interfaz lo decía con esas palabras, que era lo
-- honesto, pero deja el problema entero en manos de quien tenga tiempo de
-- llamar por teléfono uno por uno. Y una operación de emergencia es
-- justamente cuando nadie tiene ese tiempo.
--
-- Esta migración cierra ese hueco, y de paso es el aviso más limpio del
-- sistema desde el punto de vista legal: no es publicidad, es informarle a
-- alguien que la cita QUE ÉL PIDIÓ ya no va. No solo está permitido —
-- callarlo sería lo indefendible.
--
-- ── Y el consentimiento, hecho como se debe ────────────────────────────
-- 0017 dejó un defecto que se ve al mirarlo con la ley en la mano: la
-- casilla de "acepta invitaciones" la marcaba el PERSONAL en el perfil.
-- Eso no es consentimiento del titular; es la clínica afirmando que el
-- paciente dijo que sí, y no hay forma de demostrarlo.
--
-- La LFPDPPP trata los datos de salud como sensibles (art. 3) y exige
-- consentimiento **expreso y por escrito** (art. 9). Invitar a volver es
-- una finalidad secundaria —no hace falta para dar la cita—, así que
-- necesita su propia casilla, separada, desmarcada, y hay que poder
-- mostrar QUÉ aceptó y CUÁNDO.
--
-- De ahí las tres columnas de evidencia. No son adorno: son lo único que
-- convierte "creemos que dijo que sí" en algo que se puede sostener.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Canales de salida ─────────────────────────────────────────────────
-- SMS y WhatsApp entran en el CHECK desde ya. Que estén permitidos no
-- significa que se usen: `api/avisar.js` solo manda por un canal si ese
-- canal tiene credenciales, y sin ellas el aviso se queda en la cola en vez
-- de perderse. Fue el punto de separar la escalera del envío.
alter table public.avisos_pendientes
  drop constraint if exists avisos_pendientes_canal_check;

alter table public.avisos_pendientes
  add constraint avisos_pendientes_canal_check
    check (canal in ('email', 'sms', 'whatsapp'));

alter table public.avisos_pendientes
  drop constraint if exists avisos_pendientes_tipo_valido;

alter table public.avisos_pendientes
  add constraint avisos_pendientes_tipo_valido check (tipo in (
    'escalacion', 'recordatorio_cita', 'seguimiento_3d', 'seguimiento_30d',
    'reactivacion', 'cita_cancelada'
  ));

-- Un mismo aviso puede salir por dos canales a la vez —correo y SMS— y eso
-- son dos renglones, no uno. El índice de 0014 lo impedía.
drop index if exists public.avisos_unico_por_cita;

create unique index if not exists avisos_unico_por_cita_canal
  on public.avisos_pendientes (clinica_id, tipo, cita_id, canal)
  where cita_id is not null;

-- ─── Qué canales tiene encendidos esta clínica ─────────────────────────
alter table public.clinicas
  add column if not exists sms_activo boolean not null default false;

comment on column public.clinicas.sms_activo is
  'Enciende la salida por SMS. Requiere además las credenciales del proveedor en el entorno de Vercel; sin ellas el aviso se queda en la cola.';

-- ═══ Evidencia del consentimiento ══════════════════════════════════════
alter table public.pacientes
  add column if not exists consentimiento_texto  text not null default '',
  add column if not exists consentimiento_origen text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pacientes_consentimiento_origen_valido') then
    alter table public.pacientes
      add constraint pacientes_consentimiento_origen_valido
        check (consentimiento_origen is null
               or consentimiento_origen in ('paciente_web', 'personal'));
  end if;
end $$;

comment on column public.pacientes.consentimiento_texto is
  'El texto EXACTO que el paciente aceptó. Sin esto no se puede demostrar a qué dijo que sí, y "consentimiento expreso" deja de significar nada.';
comment on column public.pacientes.consentimiento_origen is
  'paciente_web = lo marcó él en el formulario. personal = lo capturó la clínica por él, que es evidencia mucho más débil y la interfaz lo dice.';

-- ═══ Cancelar un bloque de citas ═══════════════════════════════════════
-- El caso que la motivó: "cancela mis citas del jueves de 3 a 6, tengo una
-- cirugía de emergencia".
--
-- Hace las dos mitades de una vez —cancelar y avisar— porque separarlas es
-- lo que hoy deja a los pacientes sin enterarse: quien cancela a las 7 de
-- la mañana camino al quirófano no vuelve a entrar al panel a mandar
-- correos.
create or replace function public.cancelar_bloque(
  p_fecha       date,
  p_hora_inicio time    default null,
  p_hora_fin    time    default null,
  p_motivo      text    default '',
  p_doctor      text    default null,
  p_avisar      boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinica  uuid;
  v_cl       record;
  v_c        record;
  v_pie      text;
  v_canceladas int := 0;
  v_avisados   int := 0;
  v_sin_correo jsonb := '[]'::jsonb;
  v_cuerpo   text;
begin
  v_clinica := public.clinica_actual();
  if v_clinica is null then
    raise exception 'Hay que iniciar sesión para cancelar citas';
  end if;

  select * into v_cl from public.clinicas where id = v_clinica;

  for v_c in
    select * from public.citas c
    where c.clinica_id = v_clinica
      and c.fecha = p_fecha
      and c.estado in ('pendiente', 'confirmada')
      and (p_doctor is null or lower(btrim(c.doctor)) = lower(btrim(p_doctor)))
      and (
        p_hora_inicio is null                       -- el día entero
        or nullif(c.hora, '') is null               -- sin hora: ante la duda, entra
        or (nullif(c.hora, '')::time >= p_hora_inicio
            and nullif(c.hora, '')::time <  coalesce(p_hora_fin, time '23:59'))
      )
    order by c.hora
  loop
    update public.citas
      set estado = 'cancelada',
          cancelada_por = 'clinica',
          motivo_cancelacion = left(coalesce(trim(p_motivo), ''), 300)
      where id = v_c.id;
    v_canceladas := v_canceladas + 1;

    /* Quien no tiene correo hay que llamarlo, y el sistema tiene que
       decirlo en voz alta: si solo contara los avisados, esa persona se
       presentaría a un consultorio cerrado y nadie sabría que faltó
       avisarle. */
    if coalesce(v_c.email, '') = '' then
      v_sin_correo := v_sin_correo || jsonb_build_object(
        'nombre',   trim(coalesce(v_c.nombre, '') || ' ' || coalesce(v_c.apellidos, '')),
        'telefono', v_c.telefono,
        'hora',     v_c.hora
      );
      continue;
    end if;

    continue when not p_avisar;

    v_pie := public.pie_de_aviso(v_clinica, v_c.paciente_id);
    if v_pie is null then v_pie := ''; end if;   -- un aviso de cancelación sale igual

    v_cuerpo :=
      'Hola ' || coalesce(nullif(v_c.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
      'Lamentamos avisarte que tuvimos que cancelar tu cita:' || E'\n\n' ||
      '  Fecha: ' || to_char(v_c.fecha, 'DD/MM/YYYY') ||
        case when coalesce(v_c.hora, '') <> '' then ' a las ' || v_c.hora else '' end || E'\n' ||
      '  Médico: ' || coalesce(nullif(v_c.doctor, ''), 'por asignar') || E'\n' ||
      '  Folio: ' || v_c.folio || E'\n\n' ||
      case when coalesce(trim(p_motivo), '') <> ''
           then 'Motivo: ' || trim(p_motivo) || E'\n\n' else '' end ||
      'Queremos reagendarte cuanto antes.' || E'\n' ||
      case when coalesce(v_cl.sitio_url, '') <> ''
           then 'Elige un nuevo horario aquí: ' || v_cl.sitio_url || E'\n' else '' end ||
      case when coalesce(v_cl.telefono, '') <> ''
           then 'O llámanos al ' || v_cl.telefono || ' y lo vemos contigo.' else '' end ||
      E'\n\nUna disculpa por el cambio.' || v_pie;

    insert into public.avisos_pendientes (
      clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
    ) values (
      v_clinica, 'cita_cancelada', v_c.id, v_c.paciente_id, 'email', v_c.email,
      'Tuvimos que cancelar tu cita del ' || to_char(v_c.fecha, 'DD/MM'),
      v_cuerpo
    )
    on conflict do nothing;

    /* Por SMS además del correo, no en vez de él. Una cancelación de hoy
       para mañana no puede depender de que alguien abra el correo. */
    if v_cl.sms_activo and coalesce(v_c.telefono, '') <> '' then
      insert into public.avisos_pendientes (
        clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
      ) values (
        v_clinica, 'cita_cancelada', v_c.id, v_c.paciente_id, 'sms', v_c.telefono,
        '',
        coalesce(v_cl.nombre_clinica, 'Tu clínica') || ': cancelamos tu cita del ' ||
        to_char(v_c.fecha, 'DD/MM') ||
        case when coalesce(v_c.hora, '') <> '' then ' a las ' || v_c.hora else '' end ||
        '. Te reagendamos: ' ||
        coalesce(nullif(v_cl.telefono, ''), nullif(v_cl.sitio_url, ''), 'contáctanos') || '.'
      )
      on conflict do nothing;
    end if;

    v_avisados := v_avisados + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'canceladas', v_canceladas,
    'avisados', v_avisados,
    'sinCorreo', v_sin_correo,
    'porSms', v_cl.sms_activo
  );
end;
$$;

comment on function public.cancelar_bloque is
  'Cancela las citas de un rango y avisa a cada paciente ofreciéndole reagendar. Devuelve a quién NO se pudo avisar por falta de correo: esa gente hay que llamarla.';

-- ═══ Consentimiento con evidencia ══════════════════════════════════════
-- Reemplaza a `solicitar_cita` para que la casilla del formulario viaje
-- junto con la solicitud. Se hace con DROP y CREATE explícitos: agregar
-- parámetros con valor por omisión crearía una sobrecarga, y una llamada
-- con argumentos nombrados podría volverse ambigua entre las dos versiones.
drop function if exists public.solicitar_cita(
  text, text, text, text, text, text, date, text, text, text, boolean, text, text, uuid
);

create or replace function public.solicitar_cita(
  p_nombre        text,
  p_apellidos     text,
  p_telefono      text,
  p_email         text default '',
  p_especialidad  text default '',
  p_doctor        text default '',
  p_fecha         date default null,
  p_hora          text default '',
  p_tipo          text default '',
  p_notas         text default '',
  p_tiene_seguro  boolean default false,
  p_nombre_seguro text default '',
  p_numero_poliza text default '',
  p_clinica_id    uuid default null,
  -- Nuevos: la casilla y el texto exacto que decía cuando la marcó.
  p_acepta_promociones boolean default false,
  p_texto_consentimiento text default ''
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinica    uuid;
  v_tel_clave  text;
  v_paciente   uuid;
  v_folio      text;
  v_recientes  int;
  v_intento    int;
  v_restriccion text;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());

  if not exists (select 1 from public.clinicas where id = v_clinica and activa) then
    raise exception 'Clínica no válida';
  end if;

  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  v_tel_clave := public.clave_telefono(p_telefono);
  if length(v_tel_clave) < 10 then
    raise exception 'El teléfono debe tener 10 dígitos';
  end if;

  if p_fecha is null then
    raise exception 'La fecha es obligatoria';
  end if;

  if p_fecha < current_date or p_fecha > current_date + 60 then
    raise exception 'La fecha debe estar dentro de los próximos 60 días';
  end if;

  -- ── Freno de abuso, antes que el hueco ──
  select count(*) into v_recientes
  from public.citas
  where clinica_id = v_clinica
    and telefono_clave = v_tel_clave
    and creado_en > now() - interval '24 hours';

  if v_recientes >= 5 then
    raise exception 'Demasiadas solicitudes desde este teléfono. Llámanos por favor.';
  end if;

  if public.slot_ocupado(v_clinica, p_doctor, p_fecha, p_hora) then
    raise exception 'Esa hora ya está ocupada. Elige otra, por favor.';
  end if;

  -- ── Expediente ──
  select id into v_paciente
  from public.pacientes
  where clinica_id = v_clinica and telefono_clave = v_tel_clave;

  if v_paciente is null then
    for v_intento in 1..12 loop
      begin
        insert into public.pacientes (
          clinica_id, codigo, nombre, apellidos, telefono, email,
          tiene_seguro, nombre_seguro, numero_poliza
        ) values (
          v_clinica, public.generar_codigo_paciente(), trim(p_nombre), trim(p_apellidos),
          trim(p_telefono), trim(p_email), p_tiene_seguro, p_nombre_seguro, p_numero_poliza
        )
        returning id into v_paciente;
        exit;
      exception when unique_violation then
        select id into v_paciente
        from public.pacientes
        where clinica_id = v_clinica and telefono_clave = v_tel_clave;
        if v_paciente is not null then exit; end if;
      end;
    end loop;

    if v_paciente is null then
      raise exception 'No se pudo crear el expediente. Intenta de nuevo.';
    end if;
  end if;

  /* ── El consentimiento, si lo dio ──
     Solo se ENCIENDE desde aquí, nunca se apaga: que alguien no marque la
     casilla en su segunda cita no revoca lo que aceptó en la primera. Para
     revocar está el enlace de baja, que es un acto explícito.

     Y se guarda el texto que estaba leyendo cuando la marcó. Sin eso,
     "consentimiento expreso" no se puede demostrar y por lo tanto no
     existe. */
  if p_acepta_promociones then
    update public.pacientes
      set acepta_promociones   = true,
          promociones_en       = coalesce(promociones_en, now()),
          consentimiento_texto = coalesce(nullif(trim(p_texto_consentimiento), ''), consentimiento_texto),
          consentimiento_origen = 'paciente_web'
      where id = v_paciente;
  end if;

  -- ── La cita ──
  for v_intento in 1..12 loop
    v_folio := public.generar_folio_cita();
    begin
      insert into public.citas (
        clinica_id, paciente_id, folio, nombre, apellidos, telefono, email,
        especialidad, doctor, fecha, hora, tipo, notas,
        tiene_seguro, nombre_seguro, numero_poliza, estado, origen
      ) values (
        v_clinica, v_paciente, v_folio, trim(p_nombre), trim(p_apellidos),
        trim(p_telefono), trim(p_email), p_especialidad, p_doctor, p_fecha, p_hora,
        p_tipo, p_notas, p_tiene_seguro, p_nombre_seguro, p_numero_poliza,
        'pendiente', 'web'
      );
      return v_folio;
    exception when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'citas_slot_unico' then
        raise exception 'Esa hora se acaba de ocupar. Elige otra, por favor.';
      end if;
    end;
  end loop;

  raise exception 'No se pudo generar un folio disponible. Intenta de nuevo.';
end;
$$;

comment on function public.solicitar_cita is
  'Única vía por la que un visitante sin sesión crea una cita. Valida, limita abuso, respeta el hueco ocupado y registra el consentimiento con su texto.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
revoke all on function public.cancelar_bloque(date, time, time, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.cancelar_bloque(date, time, time, text, text, boolean)
  to authenticated;

-- La firma de solicitar_cita cambió, así que su concesión hay que rehacerla.
revoke all on function public.solicitar_cita(
  text, text, text, text, text, text, date, text, text, text, boolean, text, text, uuid,
  boolean, text
) from public, anon, authenticated;

grant execute on function public.solicitar_cita(
  text, text, text, text, text, text, date, text, text, text, boolean, text, text, uuid,
  boolean, text
) to anon, authenticated;
