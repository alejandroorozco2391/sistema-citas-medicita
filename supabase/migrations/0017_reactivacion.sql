-- ═══════════════════════════════════════════════════════════════════════
-- 0017 — Contacto proactivo: pacientes por reactivar
--
-- Es lo último que quedaba de la lista original, y es distinto de todo lo
-- anterior. Los recordatorios y los seguimientos de 0014 cuelgan de una
-- cita que el paciente pidió: son parte del servicio. Esto no. Esto es
-- escribirle a alguien que no pidió nada, porque hace medio año que no
-- viene.
--
-- Analytics ya sabía decirlo desde el Módulo 3 —"15 pacientes no han
-- regresado en más de 90 días"— y no había forma de hacer nada al respecto.
-- Esta migración da esa forma.
--
-- ── Tres decisiones que cambian lo que es ──────────────────────────────
--
-- 1. **El consentimiento nace en `false`.** Al revés que en 0014, y a
--    propósito. Ahí se argumentó que recordarte tu propia cita es parte del
--    servicio; aquí no hay ese argumento. La LFPDPPP trata los datos de
--    salud como sensibles, y "hace seis meses que no vienes" es una
--    comunicación comercial hecha con un dato de salud.
--
-- 2. **Encontrar es automático; mandar es una decisión.** La función
--    devuelve candidatos con su motivo, y `invitar_a_volver` es del
--    personal con sesión — nunca del reloj. No hay productor en pg_cron y
--    no es un olvido: un correo de "vuelve" que sale solo, en lote, a gente
--    que no lo pidió, es exactamente lo que hace que el dominio de una
--    clínica termine marcado como spam. Y eso se lleva también los correos
--    que sus pacientes sí querían recibir.
--
-- 3. **Una invitación por paciente cada 90 días.** Sostenido por un índice
--    único parcial, no por la buena voluntad de quien le dé al botón.
--
-- Quien quiera automatizarlo después ya tiene todo: bastaría un productor
-- que llame a `invitar_a_volver`. Que hoy no exista es la postura, no una
-- pieza faltante.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── El consentimiento que no se da por hecho ──────────────────────────
alter table public.pacientes
  add column if not exists acepta_promociones boolean not null default false,
  add column if not exists promociones_en timestamptz;

comment on column public.pacientes.acepta_promociones is
  'Opt-in EXPLÍCITO para contacto que no cuelga de una cita suya. Nace en false: recordarle su cita es servicio, invitarlo a volver es publicidad.';
comment on column public.pacientes.promociones_en is
  'Cuándo lo aceptó. Es el registro que la LFPDPPP pide poder mostrar.';

-- ─── La bandeja acepta el tipo nuevo ───────────────────────────────────
alter table public.avisos_pendientes
  drop constraint if exists avisos_pendientes_tipo_valido;

alter table public.avisos_pendientes
  add constraint avisos_pendientes_tipo_valido check (tipo in (
    'escalacion', 'recordatorio_cita', 'seguimiento_3d', 'seguimiento_30d',
    'reactivacion'
  ));

-- Una invitación por paciente cada 90 días. El índice no puede expresar
-- "cada 90 días" por sí solo, así que se guarda el trimestre calculado y se
-- hace único sobre él: dos invitaciones en el mismo trimestre no entran.
alter table public.avisos_pendientes
  add column if not exists periodo_reactivacion text;

create unique index if not exists avisos_reactivacion_unica
  on public.avisos_pendientes (clinica_id, paciente_id, periodo_reactivacion)
  where tipo = 'reactivacion';

-- ═══ A quién tendría sentido invitar ═══════════════════════════════════
-- Devuelve candidatos con su motivo. NO manda nada: esa es la mitad
-- deliberada de este diseño.
create or replace function public.pacientes_por_reactivar(
  p_dias int default 180
)
returns table (
  paciente_id      uuid,
  nombre           text,
  apellidos        text,
  email            text,
  telefono         text,
  ultima_visita    date,
  dias_sin_venir   int,
  total_visitas    bigint,
  ya_invitado      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with visitas as (
    select c.paciente_id,
           max(c.fecha) filter (where c.estado = 'atendida') as ultima,
           count(*) filter (where c.estado = 'atendida')      as cuantas
    from public.citas c
    where c.clinica_id = public.clinica_actual()
      and c.paciente_id is not null
    group by c.paciente_id
  )
  select p.id, p.nombre, p.apellidos, p.email, p.telefono,
         v.ultima,
         (current_date - v.ultima)::int,
         v.cuantas,
         exists (
           select 1 from public.avisos_pendientes a
           where a.paciente_id = p.id
             and a.tipo = 'reactivacion'
             and a.creado_en > now() - interval '90 days'
         )
  from public.pacientes p
  join visitas v on v.paciente_id = p.id
  where p.clinica_id = public.clinica_actual()
    -- Vino alguna vez, y hace más de p_dias que no.
    and v.ultima is not null
    and v.ultima < current_date - p_dias
    -- Sin cita futura: quien ya está agendado no hace falta reactivarlo.
    and not exists (
      select 1 from public.citas f
      where f.paciente_id = p.id
        and f.fecha >= current_date
        and f.estado in ('pendiente', 'confirmada')
    )
    -- Lo dijo por escrito, y no se ha dado de baja.
    and p.acepta_promociones
    and p.baja_en is null
    and coalesce(p.email, '') <> ''
  order by v.ultima;
$$;

comment on function public.pacientes_por_reactivar is
  'Candidatos a una invitación de regreso, con su motivo. No manda nada: el envío lo decide una persona.';

-- ═══ Invitar a uno ═════════════════════════════════════════════════════
create or replace function public.invitar_a_volver(
  p_paciente uuid,
  p_mensaje  text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinica uuid;
  v_p       record;
  v_cl      record;
  v_pie     text;
  v_periodo text;
begin
  /* Aquí sí se exige sesión, aunque la función sea DEFINER: es del personal
     de la clínica y de nadie más. `clinica_actual()` devuelve null sin
     sesión, y eso corta todo lo de abajo. */
  v_clinica := public.clinica_actual();
  if v_clinica is null then
    raise exception 'Hay que iniciar sesión para invitar a un paciente';
  end if;

  select * into v_p
  from public.pacientes
  where id = p_paciente and clinica_id = v_clinica;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Ese paciente no existe en esta clínica.');
  end if;

  if not v_p.acepta_promociones or v_p.baja_en is not null then
    /* La comprobación va aquí y no solo en la interfaz: un botón se puede
       quedar pintado con datos viejos, y este es el consentimiento. */
    return jsonb_build_object(
      'ok', false,
      'error', 'Ese paciente no aceptó recibir invitaciones. No se le puede escribir.'
    );
  end if;

  if coalesce(v_p.email, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Ese paciente no tiene correo registrado.');
  end if;

  select * into v_cl from public.clinicas where id = v_clinica;

  v_pie := public.pie_de_aviso(v_clinica, p_paciente);
  if v_pie is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Falta configurar la URL del sitio (clinicas.sitio_url). Sin ella el correo no llevaría enlace de baja.'
    );
  end if;

  v_periodo := to_char(now(), 'YYYY') || '-T' || to_char(now(), 'Q');

  begin
    insert into public.avisos_pendientes (
      clinica_id, tipo, paciente_id, periodo_reactivacion,
      canal, destinatario, asunto, cuerpo
    ) values (
      v_clinica, 'reactivacion', p_paciente, v_periodo,
      'email', v_p.email,
      'Nos dio gusto atenderte, ' || coalesce(nullif(v_p.nombre, ''), 'qué tal'),
      'Hola ' || coalesce(nullif(v_p.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
      case when coalesce(trim(p_mensaje), '') <> ''
           then trim(p_mensaje)
           else 'Ha pasado un tiempo desde tu última consulta y queremos saber cómo estás. ' ||
                'Si te gustaría una revisión o quedó algo pendiente, con gusto te agendamos.'
      end || E'\n\n' ||
      case when coalesce(v_cl.sitio_url, '') <> ''
           then 'Puedes agendar aquí: ' || v_cl.sitio_url || E'\n'
           else '' end ||
      case when coalesce(v_cl.telefono, '') <> ''
           then 'O llámanos al ' || v_cl.telefono || '.' else '' end ||
      v_pie
    );
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error', 'Ya se le invitó este trimestre. Insistir más seguido es lo que hace que la gente marque el correo como spam.'
    );
  end;

  return jsonb_build_object('ok', true, 'paciente', v_p.nombre, 'destinatario', v_p.email);
end;
$$;

comment on function public.invitar_a_volver is
  'Encola UNA invitación de regreso. Del personal con sesión, nunca del reloj: un lote automático de "vuelve" es lo que marca un dominio como spam.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
revoke all on function public.pacientes_por_reactivar(int)     from public, anon, authenticated;
revoke all on function public.invitar_a_volver(uuid, text)     from public, anon, authenticated;

-- Solo el personal con sesión. Nada de esto lo alcanza un visitante.
grant execute on function public.pacientes_por_reactivar(int) to authenticated;
grant execute on function public.invitar_a_volver(uuid, text) to authenticated;
