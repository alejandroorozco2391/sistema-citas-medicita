-- ═══════════════════════════════════════════════════════════════════════
-- 0004 — Citas
--
-- Reemplaza medicita_citas. El folio (CIT-AAMMDD-XXXX) se conserva y se
-- vuelve único: es el identificador que el paciente recibe por correo y
-- el que viaja en la URL de encuesta.html, así que no puede repetirse.
--
-- `paciente_id` es nullable a propósito: una solicitud desde la landing
-- puede llegar de alguien que todavía no tiene expediente. El vínculo se
-- completa después.
-- ═══════════════════════════════════════════════════════════════════════

create table public.citas (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references public.clinicas(id) on delete cascade,
  paciente_id uuid references public.pacientes(id) on delete set null,

  folio       text not null,

  -- Datos capturados en el momento de agendar. Se guardan aunque exista
  -- paciente_id: son el registro de lo que se dijo entonces, y el
  -- expediente puede cambiar después.
  nombre      text not null default '',
  apellidos   text not null default '',
  telefono    text not null default '',
  telefono_clave text generated always as
                   (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10)) stored,
  email       text default '',

  especialidad text not null default '',
  doctor       text not null default '',
  fecha        date not null,
  hora         text not null default '',
  tipo         text not null default '',
  notas        text default '',

  estado      text not null default 'pendiente'
                check (estado in ('pendiente', 'confirmada', 'atendida', 'cancelada')),

  -- Seguro declarado al agendar
  tiene_seguro  boolean not null default false,
  nombre_seguro text default '',
  numero_poliza text default '',

  -- De dónde vino: landing, panel, MediBot, WhatsApp…
  origen      text not null default 'web',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index citas_folio_unico on public.citas (clinica_id, folio);
create index citas_clinica_fecha_idx on public.citas (clinica_id, fecha desc);
create index citas_paciente_idx      on public.citas (paciente_id);
create index citas_estado_idx        on public.citas (clinica_id, estado);
create index citas_telefono_idx      on public.citas (clinica_id, telefono_clave);

create trigger citas_actualizado_en
  before update on public.citas
  for each row execute function public.tocar_actualizado_en();

-- ─── Seguimientos post-consulta ────────────────────────────────────────
-- Reemplaza medicita_followup_pendientes. Hoy los envíos de día 3 y 30
-- son manuales porque no había dónde correr un cron; esta tabla es lo que
-- el trabajo programado va a leer cuando exista.
create table public.seguimientos (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,
  cita_id        uuid not null references public.citas(id) on delete cascade,

  fecha_atendida     date not null,
  email_enviado_3d   boolean not null default false,
  email_enviado_30d  boolean not null default false,
  enviado_3d_en      timestamptz,
  enviado_30d_en     timestamptz,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index seguimientos_cita_unico on public.seguimientos (cita_id);
create index seguimientos_clinica_idx on public.seguimientos (clinica_id, fecha_atendida);

create trigger seguimientos_actualizado_en
  before update on public.seguimientos
  for each row execute function public.tocar_actualizado_en();

-- ─── Respuestas de la encuesta NPS ─────────────────────────────────────
create table public.nps_respuestas (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references public.clinicas(id) on delete cascade,
  cita_id     uuid not null references public.citas(id) on delete cascade,

  puntuacion  smallint not null check (puntuacion between 1 and 10),
  comentario  text default '',

  creado_en   timestamptz not null default now()
);

-- Una respuesta por cita: la encuesta ya detectaba el duplicado en el
-- navegador, pero ahí era una cortesía; aquí es una garantía.
create unique index nps_cita_unico on public.nps_respuestas (cita_id);
create index nps_clinica_idx on public.nps_respuestas (clinica_id, creado_en desc);

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.citas          enable row level security;
alter table public.seguimientos   enable row level security;
alter table public.nps_respuestas enable row level security;

create policy citas_todo on public.citas
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy seguimientos_todo on public.seguimientos
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy nps_todo on public.nps_respuestas
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

-- Nadie sin sesión toca estas tablas directamente. Los dos flujos
-- públicos (pedir cita y responder encuesta) van por las funciones de
-- la migración 0006.
