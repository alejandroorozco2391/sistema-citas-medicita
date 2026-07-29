-- ═══════════════════════════════════════════════════════════════════════
-- 0009 — Horario de atención (MediHorario)
--
-- Hasta aquí el horario era `clinicas.horario_atencion`: una cadena de
-- texto como 'Lun–Vie 9:00–14:00'. Sirve para imprimirla en el membrete
-- y para nada más. Ninguna máquina puede responder con ella si el
-- consultorio está abierto ahora, ni cuándo vuelve a abrir.
--
-- Esas dos preguntas son el cimiento de la escalación a humano (0010):
-- el ruteo depende del horario, y la promesa que el agente le hace al
-- paciente —"mañana a partir de las 9 te contestan"— tiene que salir de
-- un dato real o es una mentira.
--
-- El otro requisito es que la agenda de un consultorio es volátil: el
-- médico opera un jueves, se va a un congreso una semana. Por eso son
-- dos tablas y no una: `horarios_base` es la semana normal y
-- `horarios_excepciones` es lo que pasa de verdad ese día.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Zona horaria ──────────────────────────────────────────────────────
-- Supabase corre en UTC. Sin esto, las 3 de la tarde en Guadalajara se
-- evalúan como las 21:00 y el consultorio sale cerrado seis horas antes
-- de estarlo. No es un detalle de presentación: de esta conversión
-- dependen en_horario() y proxima_apertura(), y de ellas el ruteo.
alter table public.clinicas
  add column if not exists zona_horaria text not null default 'America/Mexico_City';

comment on column public.clinicas.zona_horaria is
  'Zona IANA de la clínica. Toda comparación de horas convierte con ella; el servidor está en UTC.';

-- ─── La semana normal ──────────────────────────────────────────────────
-- Un renglón por bloque, no una columna por día: así "9–14 y 16–19" son
-- dos renglones y no un campo de texto que alguien tenga que interpretar.
create table public.horarios_base (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,

  -- Nulo = horario de la clínica entera. Queda listo para cuando cada
  -- médico tenga el suyo, sin volver a migrar la tabla.
  staff_id       uuid references public.perfiles_staff(id) on delete cascade,

  dia_semana     smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo, igual que extract(dow)
  hora_inicio    time not null,
  hora_fin       time not null,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint horarios_base_orden check (hora_fin > hora_inicio)
);

comment on table public.horarios_base is
  'Bloques recurrentes por día de la semana. Varias filas por día cubren mañana y tarde.';

create index horarios_base_clinica_idx
  on public.horarios_base (clinica_id, dia_semana);

create trigger horarios_base_actualizado_en
  before update on public.horarios_base
  for each row execute function public.tocar_actualizado_en();

-- ─── Lo que pasa de verdad ese día ─────────────────────────────────────
-- Una excepción PISA a la base para esa fecha. Con `cerrado` cierra el
-- día completo; con horas, lo reemplaza.
create table public.horarios_excepciones (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,
  staff_id       uuid references public.perfiles_staff(id) on delete cascade,

  fecha          date not null,
  cerrado        boolean not null default false,
  hora_inicio    time,
  hora_fin       time,
  motivo         text default '',

  creado_en      timestamptz not null default now(),

  -- O cierra el día y no lleva horas, o las lleva y están en orden.
  -- Un renglón "cerrado de 9 a 2" no significa nada y no debe existir.
  constraint horarios_excepciones_coherente check (
    (cerrado     and hora_inicio is null and hora_fin is null)
    or
    (not cerrado and hora_inicio is not null and hora_fin is not null
                 and hora_fin > hora_inicio)
  )
);

comment on table public.horarios_excepciones is
  'Cambios puntuales por fecha: cierres, vacaciones, un día con horario distinto. Pisan a horarios_base.';
comment on column public.horarios_excepciones.motivo is
  'Uso interno. NO sale por horario_disponible(): que el consultorio esté cerrado es público, la razón no.';

create index horarios_excepciones_fecha_idx
  on public.horarios_excepciones (clinica_id, fecha);

-- Un día se cierra una vez. Sin esto, dos clics en "Cerrar" dejan dos
-- renglones y la interfaz muestra el cierre duplicado.
create unique index horarios_excepciones_cierre_unico
  on public.horarios_excepciones (clinica_id, fecha)
  where cerrado and staff_id is null;

-- ═══ Las tres preguntas ════════════════════════════════════════════════

-- ¿Qué bloques aplican este día? Excepción encima de base.
create or replace function public.horario_del_dia(
  p_clinica uuid,
  p_fecha   date,
  p_staff   uuid default null
)
returns table (hora_inicio time, hora_fin time)
language sql
stable
as $$
  with exc as (
    select e.cerrado, e.hora_inicio, e.hora_fin
    from public.horarios_excepciones e
    where e.clinica_id = p_clinica
      and e.fecha = p_fecha
      and e.staff_id is not distinct from p_staff
  )
  -- Hay excepción y no cierra el día: manda la excepción.
  select e.hora_inicio, e.hora_fin
  from exc e
  where not e.cerrado
    and not exists (select 1 from exc where exc.cerrado)

  union all

  -- No hay ninguna excepción para esa fecha: manda la semana normal.
  select b.hora_inicio, b.hora_fin
  from public.horarios_base b
  where b.clinica_id = p_clinica
    and b.staff_id is not distinct from p_staff
    and b.dia_semana = extract(dow from p_fecha)::smallint
    and not exists (select 1 from exc)

  order by 1;
$$;

comment on function public.horario_del_dia is
  'Bloques de atención ya resueltos para una fecha: la excepción pisa a la base, y un cierre no devuelve nada.';

-- ¿Está abierto en este instante?
create or replace function public.en_horario(
  p_clinica uuid,
  p_momento timestamptz default now()
)
returns boolean
language plpgsql
stable
as $$
declare
  v_tz    text;
  v_local timestamp;
begin
  select zona_horaria into v_tz from public.clinicas where id = p_clinica;
  if v_tz is null then
    return false;   -- clínica inexistente o invisible para quien pregunta
  end if;

  v_local := p_momento at time zone v_tz;

  return exists (
    select 1
    from public.horario_del_dia(p_clinica, v_local::date) h
    where v_local::time >= h.hora_inicio
      and v_local::time <  h.hora_fin
  );
end;
$$;

comment on function public.en_horario is
  'Si la clínica está abierta en ese instante, evaluado en SU zona horaria.';

-- ¿Cuándo vuelve a haber alguien? Si ya está abierto, es ahora mismo.
create or replace function public.proxima_apertura(
  p_clinica uuid,
  p_desde   timestamptz default now()
)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_tz     text;
  v_local  timestamp;
  v_fecha  date;
  v_inicio timestamp;
  v_fin    timestamp;
  v_dia    int;
  v_bloque record;
begin
  select zona_horaria into v_tz from public.clinicas where id = p_clinica;
  if v_tz is null then return null; end if;

  v_local := p_desde at time zone v_tz;

  -- Dos semanas de búsqueda. Más allá, o la clínica no tiene horario
  -- cargado o está de vacaciones largas; en ambos casos la respuesta
  -- honesta es "no sé", y devolver NULL obliga a quien llama a decirlo.
  for v_dia in 0..14 loop
    v_fecha := (v_local + (v_dia || ' days')::interval)::date;

    for v_bloque in
      select h.hora_inicio, h.hora_fin
      from public.horario_del_dia(p_clinica, v_fecha) h
      order by h.hora_inicio
    loop
      v_inicio := v_fecha + v_bloque.hora_inicio;
      v_fin    := v_fecha + v_bloque.hora_fin;

      if v_local < v_inicio then
        return v_inicio at time zone v_tz;   -- abre más tarde
      elsif v_local < v_fin then
        return p_desde;                      -- ya está abierto
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

comment on function public.proxima_apertura is
  'Siguiente instante con alguien en el consultorio, o NULL si no hay horario en 14 días. Si ya está abierto devuelve p_desde.';

-- ─── El texto del membrete ─────────────────────────────────────────────
-- clinicas.horario_atencion se conserva porque lo imprime el membrete de
-- MediDocs y lo muestra la landing. Pero deja de escribirse a mano: se
-- regenera desde los bloques, para que no puedan decir cosas distintas.
create or replace function public.horario_texto(p_clinica uuid)
returns text
language plpgsql
stable
as $$
declare
  DIAS constant text[] := array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  v_firma  text[] := array_fill(''::text, array[7]);
  v_partes text[] := '{}';
  v_una    text;
  v_d int; v_ini int; v_fin int;
begin
  for v_d in 0..6 loop
    -- A una variable escalar y luego al arreglo: SELECT INTO no acepta
    -- un elemento de arreglo como destino.
    select string_agg(
             to_char(hora_inicio, 'HH24:MI') || '–' || to_char(hora_fin, 'HH24:MI'),
             ', ' order by hora_inicio)
      into v_una
    from public.horarios_base
    where clinica_id = p_clinica and staff_id is null and dia_semana = v_d;

    v_firma[v_d + 1] := coalesce(v_una, '');
  end loop;

  -- Agrupa días consecutivos con el mismo horario: "Lun–Vie 9:00–14:00"
  -- en vez de repetir la misma línea cinco veces.
  v_d := 0;
  while v_d <= 6 loop
    if v_firma[v_d + 1] = '' then
      v_d := v_d + 1;
      continue;
    end if;

    v_ini := v_d;
    while v_d < 6 and v_firma[v_d + 2] = v_firma[v_ini + 1] loop
      v_d := v_d + 1;
    end loop;
    v_fin := v_d;

    v_partes := v_partes || (
      case when v_ini = v_fin then DIAS[v_ini + 1]
           else DIAS[v_ini + 1] || '–' || DIAS[v_fin + 1] end
      || ' ' || v_firma[v_ini + 1]
    );

    v_d := v_d + 1;
  end loop;

  return array_to_string(v_partes, ' · ');
end;
$$;

comment on function public.horario_texto is
  'Resumen legible del horario semanal, agrupando días consecutivos iguales. Alimenta clinicas.horario_atencion.';

-- ─── Guardar la semana ─────────────────────────────────────────────────
-- Se reemplaza completa en vez de editar bloque por bloque: la rejilla
-- del panel es la fuente, y un guardado parcial dejaría huérfanos los
-- bloques que el usuario quitó de la pantalla.
create or replace function public.guardar_horario_base(p_bloques jsonb)
returns text
language plpgsql
as $$
declare
  v_clinica uuid := public.clinica_actual();
  v_b       jsonb;
begin
  if v_clinica is null then
    raise exception 'Tu usuario no tiene una clínica asignada';
  end if;

  if jsonb_typeof(p_bloques) <> 'array' then
    raise exception 'Se esperaba un arreglo de bloques';
  end if;

  delete from public.horarios_base
  where clinica_id = v_clinica and staff_id is null;

  for v_b in select * from jsonb_array_elements(p_bloques) loop
    insert into public.horarios_base (clinica_id, dia_semana, hora_inicio, hora_fin)
    values (
      v_clinica,
      (v_b ->> 'diaSemana')::smallint,
      (v_b ->> 'horaInicio')::time,
      (v_b ->> 'horaFin')::time
    );
  end loop;

  -- Se valida después de insertar, no antes: la función corre dentro de
  -- una transacción, así que la excepción deshace todo y no hace falta
  -- comparar el arreglo contra sí mismo en JSON.
  if exists (
    select 1
    from public.horarios_base a
    join public.horarios_base b
      on  a.clinica_id = b.clinica_id
      and a.dia_semana = b.dia_semana
      and a.staff_id is not distinct from b.staff_id
      and a.id <> b.id
    where a.clinica_id = v_clinica
      and a.hora_inicio < b.hora_fin
      and b.hora_inicio < a.hora_fin
  ) then
    raise exception 'Hay bloques que se enciman en el mismo día';
  end if;

  update public.clinicas
     set horario_atencion = public.horario_texto(v_clinica)
   where id = v_clinica;

  return public.horario_texto(v_clinica);
end;
$$;

comment on function public.guardar_horario_base is
  'Reemplaza el horario semanal completo de la clínica y regenera el texto del membrete. Rechaza bloques encimados.';

-- ─── A quién le cae encima un cierre ───────────────────────────────────
-- Cerrar el jueves y dejar tres pacientes citados es exactamente el tipo
-- de silencio que este sistema tiene que evitar. Quien cierra el día ve
-- primero a quién va a dejar plantado.
create or replace function public.citas_afectadas_por_cierre(
  p_fecha date,
  p_hora_inicio time default null,
  p_hora_fin    time default null
)
returns table (
  id uuid, folio text, nombre text, apellidos text,
  telefono text, email text, hora text, doctor text
)
language sql
stable
as $$
  -- citas.hora es texto 'HH:MM' y admite cadena vacía, así que hay que
  -- convertirla para compararla. Una cita sin hora se considera afectada:
  -- ante la duda, que aparezca en la lista y decida un humano.
  select c.id, c.folio, c.nombre, c.apellidos,
         c.telefono, c.email, c.hora, c.doctor
  from public.citas c
  where c.clinica_id = public.clinica_actual()
    and c.fecha = p_fecha
    and c.estado in ('pendiente', 'confirmada')
    -- Sin horas = se cierra el día entero. Con horas, solo lo que cae
    -- fuera del nuevo horario queda afectado.
    and (
      p_hora_inicio is null
      or nullif(c.hora, '') is null
      or nullif(c.hora, '')::time <  p_hora_inicio
      or nullif(c.hora, '')::time >= p_hora_fin
    )
  order by c.hora;
$$;

comment on function public.citas_afectadas_por_cierre is
  'Citas vivas que quedarían fuera de horario si se cierra o se recorta esa fecha.';

-- ═══ Lo que la landing puede ver sin sesión ════════════════════════════
-- El formulario de citas no debe ofrecer un día en que el consultorio
-- está cerrado. Necesita el horario resuelto, sin sesión, y sin enterarse
-- de POR QUÉ está cerrado.
create or replace function public.horario_disponible(
  p_desde      date,
  p_hasta      date,
  p_clinica_id uuid default null
)
returns table (fecha date, hora_inicio time, hora_fin time)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinica uuid := coalesce(p_clinica_id, public.clinica_unica());
  v_dia     date;
begin
  if p_desde is null or p_hasta is null then
    raise exception 'Hay que indicar el rango de fechas';
  end if;

  -- Tope de 90 días: la anon key es pública y sin límite alguien podría
  -- pedir diez años de golpe.
  if p_hasta < p_desde or p_hasta > p_desde + 90 then
    raise exception 'El rango de fechas no puede pasar de 90 días';
  end if;

  v_dia := p_desde;
  while v_dia <= p_hasta loop
    return query
      select v_dia, h.hora_inicio, h.hora_fin
      from public.horario_del_dia(v_clinica, v_dia) h;
    v_dia := v_dia + 1;
  end loop;
end;
$$;

comment on function public.horario_disponible is
  'Horario resuelto por fecha para la landing, sin sesión. No expone el motivo de un cierre.';

-- La landing necesita la zona horaria para saber si "ahora" cae dentro.
-- Se agrega al final: create or replace view solo admite columnas nuevas
-- después de las que ya existen.
create or replace view public.clinica_publica
with (security_invoker = false)
as
  select
    id, nombre_clinica, nombre_medico, especialidad_principal, ciudad,
    telefono, email, whatsapp, cedula_profesional, horario_atencion,
    direccion_consultorio, logo_url, frase_hero, foto_hero, foto_medico,
    bio_medico, formacion_medico, servicios_clinica, total_pacientes,
    anos_experiencia, calificacion_promedio, facebook, instagram,
    color_primario, color_acento, tipografia,
    zona_horaria
  from public.clinicas
  where activa;

grant select on public.clinica_publica to anon;

-- ─── Folios en la hora local de la clínica ─────────────────────────────
-- Estaban con 'America/Mexico_City' incrustado. Se reemplazan sin tocar
-- su firma, para no tener que reescribir solicitar_cita() —la función de
-- la que dependen los pacientes— por un prefijo de fecha.
create or replace function public.generar_folio_cita()
returns text
language sql
volatile
as $$
  select 'CIT-' || to_char(
           now() at time zone coalesce(
             (select zona_horaria from public.clinicas where activa order by creado_en limit 1),
             'America/Mexico_City'),
           'YYMMDD')
       || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

create or replace function public.generar_codigo_paciente()
returns text
language sql
volatile
as $$
  select 'PAC-' || to_char(
           now() at time zone coalesce(
             (select zona_horaria from public.clinicas where activa order by creado_en limit 1),
             'America/Mexico_City'),
           'YYYYMMDD')
       || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.horarios_base        enable row level security;
alter table public.horarios_excepciones enable row level security;

-- Sin distinción de rol a propósito: la asistente que contesta el
-- teléfono es quien más veces va a mover el horario del día.
create policy horarios_base_todo on public.horarios_base
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy horarios_excepciones_todo on public.horarios_excepciones
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

-- ─── Permisos ──────────────────────────────────────────────────────────
revoke all on function public.horario_disponible        from public;
revoke all on function public.guardar_horario_base      from public;
revoke all on function public.citas_afectadas_por_cierre from public;
revoke all on function public.horario_del_dia           from public;
revoke all on function public.en_horario                from public;
revoke all on function public.proxima_apertura          from public;
revoke all on function public.horario_texto             from public;

-- Lo único que alcanza el visitante sin cuenta.
grant execute on function public.horario_disponible to anon, authenticated;

-- El resto es del personal. horario_del_dia, en_horario y proxima_apertura
-- reciben la clínica como parámetro y NO son security definer: quien las
-- llama solo ve lo que RLS le deja ver.
grant execute on function public.guardar_horario_base       to authenticated;
grant execute on function public.citas_afectadas_por_cierre to authenticated;
grant execute on function public.horario_del_dia            to authenticated;
grant execute on function public.en_horario                 to authenticated;
grant execute on function public.proxima_apertura           to authenticated;
grant execute on function public.horario_texto              to authenticated;
