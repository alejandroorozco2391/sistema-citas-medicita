-- ═══════════════════════════════════════════════════════════════════════
-- 0012 — Una hora, un paciente
--
-- Hasta aquí nada impedía agendar dos pacientes con el mismo médico a la
-- misma hora. Cuatro puertas de entrada —la landing, "+ Nueva cita" del
-- panel, MediBot y la RPC pública— y ninguna revisaba. El síntoma no
-- aparece en el sistema: aparece en la sala de espera, con dos personas
-- citadas a las 10 y una recepcionista enterándose ahí.
--
-- Por eso la pieza central es un ÍNDICE ÚNICO y no una validación en el
-- JavaScript. Una validación hay que acordarse de escribirla en cada
-- puerta, y la quinta puerta —un webhook de WhatsApp, Doctoralia— la va a
-- olvidar. Un índice lo vuelve imposible desde cualquier lado, incluido un
-- INSERT a mano en el editor de Supabase.
--
-- Las funciones que vienen abajo existen para dar un error *legible* antes
-- de chocar con el índice. El índice es la garantía; ellas son la cortesía.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Normalización de la hora ──────────────────────────────────────────
-- `citas.hora` es texto (formato heredado, y sigue siéndolo: 0009 ya lo
-- documentó). Eso significa que '9:00' y '09:00' son dos cadenas distintas
-- para Postgres, y sin normalizar, el índice único las dejaría pasar como
-- si fueran horas diferentes. El mismo error que ya cometimos con los
-- teléfonos y que arregló clave_telefono().
create or replace function public.clave_hora(h text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(h), '') = '' then ''
    when position(':' in h) = 0 then lower(btrim(h))
    else lpad(btrim(split_part(h, ':', 1)), 2, '0') || ':' ||
         lpad(coalesce(nullif(btrim(split_part(h, ':', 2)), ''), '00'), 2, '0')
  end;
$$;

comment on function public.clave_hora is
  'Hora normalizada a HH:MM. Hermana de clave_telefono(): existe porque citas.hora es texto libre.';

alter table public.citas
  add column if not exists hora_clave text
    generated always as (public.clave_hora(hora)) stored;

-- ─── Antes de poner la cerradura, revisar que no haya nadie encerrado ───
-- Si esta clínica YA tiene dos citas en el mismo hueco, el `create unique
-- index` de abajo falla con un mensaje que no dice cuáles son. Se prefiere
-- abortar aquí, diciendo exactamente qué folios hay que arreglar primero.
do $$
declare
  v_lista text;
begin
  select string_agg(d.detalle, e'\n           ') into v_lista
  from (
    select format('%s · %s · %s — folios: %s',
                  fecha, min(doctor), hora_clave, string_agg(folio, ', ')) as detalle
    from public.citas
    where estado in ('pendiente', 'confirmada') and hora_clave <> ''
    group by clinica_id, lower(btrim(doctor)), fecha, hora_clave
    having count(*) > 1
  ) d;

  if v_lista is not null then
    raise exception e'Hay citas duplicadas y hay que resolverlas antes de poner el índice:\n           %\n\nCancela o mueve una de cada par y vuelve a correr esta migración.', v_lista;
  end if;
end $$;

-- ─── La cerradura ──────────────────────────────────────────────────────
-- Se excluyen `cancelada` y `atendida` a propósito:
--   · cancelada libera el hueco, que es justo para lo que se cancela;
--   · atendida ya pasó, y el pasado no se reserva.
-- Y se excluye la hora vacía: una cita sin hora es una solicitud sin
-- horario asignado, y varias pueden convivir.
create unique index if not exists citas_slot_unico
  on public.citas (clinica_id, lower(btrim(doctor)), fecha, hora_clave)
  where estado in ('pendiente', 'confirmada') and hora_clave <> '';

comment on index public.citas_slot_unico is
  'Un médico, una fecha, una hora, un paciente. Aplica a las cuatro puertas de entrada y a cualquiera que venga después.';

-- ─── ¿Está tomado este hueco? ──────────────────────────────────────────
-- `p_excluir` es la propia cita cuando se está reagendando: moverla de las
-- 10 a las 10 no debe decir que las 10 están ocupadas por ella misma.
create or replace function public.slot_ocupado(
  p_clinica uuid,
  p_doctor  text,
  p_fecha   date,
  p_hora    text,
  p_excluir uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.citas
    where clinica_id = p_clinica
      and lower(btrim(doctor)) = lower(btrim(coalesce(p_doctor, '')))
      and fecha = p_fecha
      and hora_clave = public.clave_hora(p_hora)
      and hora_clave <> ''
      and estado in ('pendiente', 'confirmada')
      and (p_excluir is null or id <> p_excluir)
  );
$$;

-- ─── Qué horas están tomadas ───────────────────────────────────────────
-- Para el personal: el panel las marca en el selector de "+ Nueva cita".
create or replace function public.horas_ocupadas(
  p_doctor text,
  p_fecha  date
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct hora_clave order by hora_clave), array[]::text[])
  from public.citas
  where clinica_id = public.clinica_actual()
    and lower(btrim(doctor)) = lower(btrim(coalesce(p_doctor, '')))
    and fecha = p_fecha
    and hora_clave <> ''
    and estado in ('pendiente', 'confirmada');
$$;

-- Para el visitante sin cuenta: el formulario de la landing tiene que
-- poder tachar las horas tomadas.
--
-- Sí, esto revela qué huecos están ocupados. Es información que cualquier
-- sistema de citas revela por necesidad —si no, el formulario ofrece horas
-- que no existen— y no dice de QUIÉN es la cita: solo devuelve las horas.
-- Se sigue el mismo criterio que `horario_disponible` con el motivo del
-- cierre: que esté cerrado es público, por qué no lo es.
create or replace function public.horas_ocupadas_publico(
  p_doctor     text,
  p_fecha      date,
  p_clinica_id uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinica uuid;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());

  -- Mismo rango que ofrece el formulario. Sin esto, alguien podría barrer
  -- la agenda de un año consultando día por día.
  if p_fecha is null or p_fecha < current_date - 1 or p_fecha > current_date + 60 then
    return array[]::text[];
  end if;

  return (
    select coalesce(array_agg(distinct hora_clave order by hora_clave), array[]::text[])
    from public.citas
    where clinica_id = v_clinica
      and lower(btrim(doctor)) = lower(btrim(coalesce(p_doctor, '')))
      and fecha = p_fecha
      and hora_clave <> ''
      and estado in ('pendiente', 'confirmada')
  );
end;
$$;

comment on function public.horas_ocupadas_publico is
  'Horas ya tomadas de un médico en una fecha. Devuelve horas, nunca de quién son.';

-- ═══ solicitar_cita: el mismo hueco, error legible ═════════════════════
-- Se reemplaza completa (no se puede parchear el cuerpo de una función) y
-- el único cambio es el manejo del hueco ocupado. Lo demás queda idéntico
-- a 0006, incluido el reintento de folio.
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
  p_clinica_id    uuid default null
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

  -- ── Validación de entrada ──
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

  -- Mismo rango que ofrece el formulario: de mañana a 60 días.
  if p_fecha < current_date or p_fecha > current_date + 60 then
    raise exception 'La fecha debe estar dentro de los próximos 60 días';
  end if;

  -- ── Freno de abuso ──
  -- La anon key es pública; sin esto, un script podría llenar la agenda.
  --
  -- Va ANTES de revisar el hueco, y el orden importa: a quien lleva veinte
  -- solicitudes en una hora hay que decirle que se pase de la raya, no
  -- ponerle a elegir otro horario. Con el orden contrario, un script que
  -- fuera variando la hora recibiría siempre el mensaje amable.
  select count(*) into v_recientes
  from public.citas
  where clinica_id = v_clinica
    and telefono_clave = v_tel_clave
    and creado_en > now() - interval '24 hours';

  if v_recientes >= 5 then
    raise exception 'Demasiadas solicitudes desde este teléfono. Llámanos por favor.';
  end if;

  -- ── El hueco ──
  -- Se revisa aquí para poder decirle al paciente qué pasó. El índice de
  -- abajo lo frenaría igual, pero con un mensaje de Postgres en inglés
  -- hablando de restricciones, en la cara de alguien que solo quería una
  -- cita. La carrera entre dos solicitudes simultáneas la resuelve el
  -- índice, no esta comprobación.
  if public.slot_ocupado(v_clinica, p_doctor, p_fecha, p_hora) then
    raise exception 'Esa hora ya está ocupada. Elige otra, por favor.';
  end if;

  -- ── Expediente: se reutiliza si existe, se crea si no ──
  select id into v_paciente
  from public.pacientes
  where clinica_id = v_clinica and telefono_clave = v_tel_clave;

  if v_paciente is null then
    -- El código del paciente lleva 4 dígitos aleatorios y es único. Y aquí
    -- hay una segunda carrera posible: dos personas pidiendo cita con el
    -- mismo teléfono al mismo tiempo. Ambas se resuelven igual —
    -- reintentar, y si resultó que el expediente ya existía, quedarse con
    -- ese.
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
        -- ¿Chocó el teléfono? Entonces el expediente ya existe: se usa.
        select id into v_paciente
        from public.pacientes
        where clinica_id = v_clinica and telefono_clave = v_tel_clave;

        if v_paciente is not null then exit; end if;
        -- Si no, fue el código: se sortea otro en la siguiente vuelta.
      end;
    end loop;

    if v_paciente is null then
      raise exception 'No se pudo crear el expediente. Intenta de nuevo.';
    end if;
  end if;

  -- ── La cita ──
  -- El estado y el origen los fija la función, nunca quien llama.
  --
  -- El folio lleva solo 4 dígitos aleatorios (formato heredado, y visible
  -- para el paciente, así que no se cambia): 10 000 combinaciones por día.
  -- Ahora que es único en la base, una colisión sería un error en la cara
  -- del paciente, así que se reintenta.
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
      -- CUÁL índice chocó importa. Antes solo podía ser el folio, así que
      -- reintentar era siempre lo correcto. Ahora también puede ser el
      -- hueco —dos personas pidiendo la misma hora en el mismo segundo— y
      -- ahí reintentar doce veces solo termina en "no se pudo generar un
      -- folio", que no tiene nada que ver con lo que pasó.
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'citas_slot_unico' then
        raise exception 'Esa hora se acaba de ocupar. Elige otra, por favor.';
      end if;
      -- Fue el folio: se sortea otro.
    end;
  end loop;

  raise exception 'No se pudo generar un folio disponible. Intenta de nuevo.';
end;
$$;

comment on function public.solicitar_cita is
  'Única vía por la que un visitante sin sesión crea una cita. Valida, limita abuso, respeta el hueco ocupado y fija estado y origen por su cuenta.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
revoke all on function public.clave_hora             from public;
revoke all on function public.slot_ocupado           from public;
revoke all on function public.horas_ocupadas         from public;
revoke all on function public.horas_ocupadas_publico from public;

grant execute on function public.clave_hora             to anon, authenticated;
grant execute on function public.horas_ocupadas_publico to anon, authenticated;
grant execute on function public.slot_ocupado           to authenticated;
grant execute on function public.horas_ocupadas         to authenticated;
