-- ═══════════════════════════════════════════════════════════════════════
-- Alta de una clínica nueva
--
-- Se pega en el editor SQL del panel de Supabase, que corre como
-- superusuario y por tanto NO pasa por RLS. Es el único momento en toda
-- la vida del sistema en que algo se salta las políticas: hay que poner
-- la primera piedra, y sin clínica ni perfil, clinica_actual() devuelve
-- NULL y nadie podría insertar nada.
--
-- ANTES de correr esto: crea a las personas en Authentication → Users
-- del panel, para que existan sus renglones en auth.users.
--
-- SOLO SE EDITA EL BLOQUE "DATOS A LLENAR" de abajo. Todo lo demás usa
-- esos valores; así no hay forma de cambiar el nombre en un lugar y
-- olvidarlo en otro.
--
-- Correrlo dos veces es inocuo: no duplica la clínica ni el personal.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  DATOS A LLENAR — cambia solo estas líneas                        ║
  -- ╚═══════════════════════════════════════════════════════════════════╝

  -- ── La clínica ──
  v_nombre_clinica  text := 'Consultorio Dr. Ejemplo';
  v_nombre_medico   text := 'Dr. Nombre Apellido';
  v_especialidad    text := 'Medicina General';
  v_ciudad          text := 'Ciudad de México';
  v_telefono        text := '55 1234 5678';
  v_email           text := 'contacto@ejemplo.mx';
  v_plan            text := 'profesional';   -- esencial | profesional | premium

  -- ── Persona 1 (correo TAL CUAL está en Authentication → Users) ──
  v1_email          text := 'doctor@ejemplo.mx';
  v1_nombre         text := 'Nombre del Doctor';
  v1_rol            text := 'admin';         -- doctor | recepcionista | admin
  v1_telefono       text := '55 1234 5678';

  -- ── Persona 2 — déjala en '' si por ahora solo eres tú ──
  v2_email          text := '';
  v2_nombre         text := 'Nombre de Recepción';
  v2_rol            text := 'recepcionista';
  v2_telefono       text := '';

  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  De aquí para abajo no se toca                                    ║
  -- ╚═══════════════════════════════════════════════════════════════════╝
  v_clinica_id  uuid;
  v_usuario_id  uuid;
begin

  -- ─── 1. La clínica ───────────────────────────────────────────────────
  select id into v_clinica_id
  from public.clinicas
  where nombre_clinica = v_nombre_clinica;

  if v_clinica_id is null then
    insert into public.clinicas (
      nombre_clinica, nombre_medico, especialidad_principal,
      ciudad, telefono, email, plan
    ) values (
      v_nombre_clinica, v_nombre_medico, v_especialidad,
      v_ciudad, v_telefono, v_email, v_plan
    )
    returning id into v_clinica_id;

    raise notice 'Clínica creada: % (%)', v_nombre_clinica, v_clinica_id;
  else
    raise notice 'La clínica % ya existía, se reutiliza (%)', v_nombre_clinica, v_clinica_id;
  end if;

  -- ─── 2. El personal ──────────────────────────────────────────────────
  -- Se busca por correo para no copiar UUID a mano. Si el correo no
  -- existe en Authentication, se avisa en vez de fallar en silencio:
  -- un perfil que no se creó es un usuario que no va a poder entrar.

  if v1_email <> '' then
    select id into v_usuario_id from auth.users where email = lower(v1_email);
    if v_usuario_id is null then
      raise warning 'No existe ninguna cuenta con el correo %. Créala en Authentication → Users y vuelve a correr esto.', v1_email;
    else
      insert into public.perfiles_staff (usuario_id, clinica_id, nombre, rol, telefono)
      values (v_usuario_id, v_clinica_id, v1_nombre, v1_rol, v1_telefono)
      on conflict (usuario_id) do nothing;
      raise notice 'Personal vinculado: % (%)', v1_nombre, v1_email;
    end if;
  end if;

  if v2_email <> '' then
    select id into v_usuario_id from auth.users where email = lower(v2_email);
    if v_usuario_id is null then
      raise warning 'No existe ninguna cuenta con el correo %. Créala en Authentication → Users y vuelve a correr esto.', v2_email;
    else
      insert into public.perfiles_staff (usuario_id, clinica_id, nombre, rol, telefono)
      values (v_usuario_id, v_clinica_id, v2_nombre, v2_rol, v2_telefono)
      on conflict (usuario_id) do nothing;
      raise notice 'Personal vinculado: % (%)', v2_nombre, v2_email;
    end if;
  end if;

end $$;


-- ─── 3. Comprobación ───────────────────────────────────────────────────
-- Debe devolver una fila por persona, con su rol y su clínica.
-- Si sale vacío, es que el correo no coincide con el de Authentication.
select p.nombre, p.rol, p.activo, c.nombre_clinica, u.email
from public.perfiles_staff p
join public.clinicas c on c.id = p.clinica_id
join auth.users u on u.id = p.usuario_id;


-- ─── 4. Verificación de seguridad ──────────────────────────────────────
-- Toda tabla de `public` DEBE tener RLS activo. Si alguna sale en false,
-- la anon key —que va escrita en el HTML— alcanza para leerla completa.
-- No pongas la clínica en producción hasta que esta consulta salga vacía.
select tablename
from pg_tables
where schemaname = 'public'
  and rowsecurity = false;
