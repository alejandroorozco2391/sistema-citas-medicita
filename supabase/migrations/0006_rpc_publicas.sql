-- ═══════════════════════════════════════════════════════════════════════
-- 0006 — Funciones para los dos flujos sin sesión
--
-- index.html (pedir cita) y encuesta.html (responder NPS) los usa gente
-- sin cuenta. La anon key de Supabase es pública por diseño: va escrita
-- en el HTML y cualquiera puede leerla.
--
-- Por eso el rol anónimo NO tiene política sobre ninguna tabla. Estas dos
-- funciones son su única puerta, y validan por dentro. Un atacante con la
-- anon key puede, cuando mucho, pedir una cita — que es exactamente lo
-- que la página ya ofrece a cualquiera que la visite.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Generadores de código legible ─────────────────────────────────────
create or replace function public.generar_folio_cita()
returns text
language sql
volatile
as $$
  select 'CIT-' || to_char(now() at time zone 'America/Mexico_City', 'YYMMDD')
       || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

create or replace function public.generar_codigo_paciente()
returns text
language sql
volatile
as $$
  select 'PAC-' || to_char(now() at time zone 'America/Mexico_City', 'YYYYMMDD')
       || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

-- ─── La clínica de este despliegue ─────────────────────────────────────
-- El modelo de venta es un proyecto por clínica, así que normalmente hay
-- una sola fila activa. Si hubiera varias, hay que decir cuál.
create or replace function public.clinica_unica()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
  cid uuid;
begin
  -- Dos consultas y no un min(id): Postgres no tiene agregado min() para
  -- uuid, así que agrupar por ahí no compila.
  select count(*) into n from public.clinicas where activa;
  select id into cid from public.clinicas where activa limit 1;

  if n = 0 then
    raise exception 'No hay ninguna clínica activa configurada';
  elsif n > 1 then
    raise exception 'Hay varias clínicas activas: hay que indicar cuál';
  end if;
  return cid;
end;
$$;

-- ═══ Solicitar cita desde la landing ═══════════════════════════════════
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
  v_clinica   uuid;
  v_tel_clave text;
  v_paciente  uuid;
  v_folio     text;
  v_recientes int;
  v_intento   int;
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
  select count(*) into v_recientes
  from public.citas
  where clinica_id = v_clinica
    and telefono_clave = v_tel_clave
    and creado_en > now() - interval '24 hours';

  if v_recientes >= 5 then
    raise exception 'Demasiadas solicitudes desde este teléfono. Llámanos por favor.';
  end if;

  -- ── Expediente: se reutiliza si existe, se crea si no ──
  select id into v_paciente
  from public.pacientes
  where clinica_id = v_clinica and telefono_clave = v_tel_clave;

  if v_paciente is null then
    -- Mismo problema que el folio: el código del paciente lleva 4 dígitos
    -- aleatorios y es único. Y aquí hay una segunda carrera posible: dos
    -- personas pidiendo cita con el mismo teléfono al mismo tiempo. Ambas
    -- se resuelven igual — reintentar, y si resultó que el expediente ya
    -- existía, quedarse con ese.
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
  -- para el paciente, así que no se cambia). Eso son 10 000 combinaciones
  -- por día: con un centenar de citas diarias la probabilidad de que dos
  -- coincidan ronda el 40%. Ahora que el folio es único en la base, una
  -- colisión sería un error en la cara del paciente — así que se reintenta.
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
      -- Folio ya usado hoy: se sortea otro.
      null;
    end;
  end loop;

  raise exception 'No se pudo generar un folio disponible. Intenta de nuevo.';
end;
$$;

comment on function public.solicitar_cita is
  'Única vía por la que un visitante sin sesión crea una cita. Valida, limita abuso y fija estado y origen por su cuenta.';

-- ═══ Responder la encuesta de satisfacción ═════════════════════════════
create or replace function public.responder_encuesta(
  p_folio      text,
  p_puntuacion smallint,
  p_comentario text default ''
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cita    uuid;
  v_clinica uuid;
begin
  if p_puntuacion is null or p_puntuacion < 1 or p_puntuacion > 10 then
    raise exception 'La puntuación debe estar entre 1 y 10';
  end if;

  -- El folio es la credencial: quien lo tiene es porque recibió el correo.
  select c.id, c.clinica_id into v_cita, v_clinica
  from public.citas c
  join public.clinicas cl on cl.id = c.clinica_id and cl.activa
  where c.folio = trim(p_folio);

  if v_cita is null then
    raise exception 'Folio no encontrado';
  end if;

  if exists (select 1 from public.nps_respuestas where cita_id = v_cita) then
    raise exception 'Esta encuesta ya fue respondida';
  end if;

  insert into public.nps_respuestas (clinica_id, cita_id, puntuacion, comentario)
  values (v_clinica, v_cita, p_puntuacion, coalesce(trim(p_comentario), ''));

  return true;
end;
$$;

comment on function public.responder_encuesta is
  'Registra una respuesta NPS. El folio actúa como credencial; una cita solo admite una respuesta.';

-- ─── Consultar si un folio ya respondió (para la pantalla previa) ──────
create or replace function public.encuesta_ya_respondida(p_folio text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cita uuid;
begin
  select id into v_cita from public.citas where folio = trim(p_folio);
  if v_cita is null then
    return false;
  end if;
  return exists (select 1 from public.nps_respuestas where cita_id = v_cita);
end;
$$;

-- ═══ Permisos ══════════════════════════════════════════════════════════
-- Se revoca de PUBLIC y se concede explícitamente. Nada de heredar
-- permisos sin querer.
revoke all on function public.solicitar_cita        from public;
revoke all on function public.responder_encuesta    from public;
revoke all on function public.encuesta_ya_respondida from public;
revoke all on function public.clinica_unica         from public;

grant execute on function public.solicitar_cita         to anon, authenticated;
grant execute on function public.responder_encuesta     to anon, authenticated;
grant execute on function public.encuesta_ya_respondida to anon, authenticated;

-- clinica_actual() y rol_actual() son solo para usuarios con sesión.
revoke all on function public.clinica_actual from public;
revoke all on function public.rol_actual     from public;
grant execute on function public.clinica_actual to authenticated;
grant execute on function public.rol_actual     to authenticated;
