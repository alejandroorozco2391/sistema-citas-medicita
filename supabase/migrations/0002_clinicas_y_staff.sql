-- ═══════════════════════════════════════════════════════════════════════
-- 0002 — Clínicas y personal
--
-- `clinicas` reemplaza la clave medicita_config_clinica.
-- `perfiles_staff` reemplaza el gate falso de medicita_sesion: extiende
-- auth.users con el rol y la clínica a la que pertenece cada persona.
--
-- Nota sobre el arranque: clinica_actual() devuelve NULL mientras el
-- usuario no tenga perfil, así que la primera clínica y su primer usuario
-- los crea el script de aprovisionamiento con la service role key, que
-- no pasa por RLS. Es el único momento en que se usa esa llave.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Clínicas ──────────────────────────────────────────────────────────
create table public.clinicas (
  id                    uuid primary key default gen_random_uuid(),

  -- Identidad
  nombre_clinica        text not null,
  nombre_medico         text default '',
  especialidad_principal text default '',
  ciudad                text default '',
  telefono              text default '',
  email                 text default '',
  whatsapp              text default '',

  -- Datos profesionales (aparecen en el membrete de MediDocs)
  cedula_profesional    text default '',
  horario_atencion      text default '',
  direccion_consultorio text default '',

  -- Personalización de la landing
  logo_url              text default '',
  frase_hero            text default '',
  foto_hero             text default '',
  foto_medico           text default '',
  bio_medico            text default '',
  formacion_medico      text default '',
  servicios_clinica     text default '',
  total_pacientes       text default '',
  anos_experiencia      text default '',
  calificacion_promedio text default '',
  facebook              text default '',
  instagram             text default '',

  -- Apariencia
  color_primario        text default '#1a6eb5',
  color_acento          text default '#f59e0b',
  tipografia            text default 'Inter',

  -- Comercial (NO se expone públicamente)
  plan                  text not null default 'esencial'
                          check (plan in ('esencial', 'profesional', 'premium')),
  activa                boolean not null default true,

  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);

comment on table public.clinicas is
  'Configuración de la clínica. En el despliegue normal hay exactamente una fila por proyecto.';
comment on column public.clinicas.total_pacientes is
  'Texto, no número: es copy de la landing ("+3,500 pacientes atendidos").';

create trigger clinicas_actualizado_en
  before update on public.clinicas
  for each row execute function public.tocar_actualizado_en();

-- ─── Personal ──────────────────────────────────────────────────────────
create table public.perfiles_staff (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null unique references auth.users(id) on delete cascade,
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,

  nombre         text not null,
  rol            text not null check (rol in ('doctor', 'recepcionista', 'admin')),
  telefono       text default '',
  activo         boolean not null default true,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.perfiles_staff is
  'Un renglón por persona, no por clínica: la escalación a humano necesita saber a quién enrutar, y NOM-004-SSA3 exige poder rastrear quién tocó cada expediente.';

create index perfiles_staff_clinica_idx on public.perfiles_staff (clinica_id);

create trigger perfiles_staff_actualizado_en
  before update on public.perfiles_staff
  for each row execute function public.tocar_actualizado_en();

-- ─── Quién es el usuario autenticado ───────────────────────────────────
-- SECURITY DEFINER a propósito: a estas funciones las invocan las
-- políticas de RLS, incluidas las de perfiles_staff. Si respetaran RLS al
-- leer esa tabla, se llamarían a sí mismas en un ciclo infinito.
--
-- Son seguras porque no reciben parámetros: solo pueden devolver los
-- datos del usuario que ya está autenticado, jamás los de otro.
create or replace function public.clinica_actual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinica_id
  from public.perfiles_staff
  where usuario_id = auth.uid()
    and activo
  limit 1;
$$;

comment on function public.clinica_actual is
  'Clínica del usuario autenticado. SECURITY DEFINER para evitar recursión en las políticas de RLS.';

create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol
  from public.perfiles_staff
  where usuario_id = auth.uid()
    and activo
  limit 1;
$$;

comment on function public.rol_actual is
  'Rol (doctor | recepcionista | admin) del usuario autenticado.';

-- ─── Vista pública de la clínica ───────────────────────────────────────
-- index.html es una landing abierta: muestra nombre, médico, biografía,
-- fotos, horarios y contacto sin que nadie inicie sesión. Todo eso es
-- información que la clínica publica de todos modos.
--
-- Lo que NO sale por aquí: el plan contratado y el estado de la cuenta.
-- Eso es de la relación comercial, no del paciente.
-- security_invoker = false a propósito: la vista se ejecuta con los
-- privilegios de su dueño y por tanto no pasa por RLS. La frontera de
-- seguridad aquí es la propia definición de la vista (qué columnas y qué
-- filas expone), no una política.
--
-- La alternativa —dar a anon una política SELECT sobre `clinicas`— sería
-- peor: RLS filtra renglones, no columnas, así que anon podría leer
-- también el plan contratado.
create view public.clinica_publica
with (security_invoker = false)
as
  select
    id, nombre_clinica, nombre_medico, especialidad_principal, ciudad,
    telefono, email, whatsapp, cedula_profesional, horario_atencion,
    direccion_consultorio, logo_url, frase_hero, foto_hero, foto_medico,
    bio_medico, formacion_medico, servicios_clinica, total_pacientes,
    anos_experiencia, calificacion_promedio, facebook, instagram,
    color_primario, color_acento, tipografia
  from public.clinicas
  where activa;

comment on view public.clinica_publica is
  'Subconjunto de clinicas legible sin autenticación, para la landing. Excluye plan y estado de cuenta.';

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.clinicas       enable row level security;
alter table public.perfiles_staff enable row level security;

-- Clínicas: el staff ve la suya; solo admin la edita.
create policy clinicas_lectura on public.clinicas
  for select to authenticated
  using (id = public.clinica_actual());

create policy clinicas_edicion on public.clinicas
  for update to authenticated
  using (id = public.clinica_actual() and public.rol_actual() = 'admin')
  with check (id = public.clinica_actual());

-- La landing lee la vista sin sesión.
grant select on public.clinica_publica to anon;

-- Personal: todos ven a sus compañeros (hace falta para asignar y enrutar);
-- solo admin da de alta, edita o desactiva.
create policy perfiles_lectura on public.perfiles_staff
  for select to authenticated
  using (clinica_id = public.clinica_actual());

create policy perfiles_alta on public.perfiles_staff
  for insert to authenticated
  with check (clinica_id = public.clinica_actual() and public.rol_actual() = 'admin');

create policy perfiles_edicion on public.perfiles_staff
  for update to authenticated
  using (clinica_id = public.clinica_actual() and public.rol_actual() = 'admin')
  with check (clinica_id = public.clinica_actual());

create policy perfiles_baja on public.perfiles_staff
  for delete to authenticated
  using (clinica_id = public.clinica_actual() and public.rol_actual() = 'admin');
