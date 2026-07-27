-- ═══════════════════════════════════════════════════════════════════════
-- 0003 — Pacientes y sus notas
--
-- Reemplaza medicita_pacientes. Dos cambios de fondo respecto al modelo
-- que vivía en localStorage:
--
-- 1. `telefono_clave` es columna generada e indexada. En el frontend, el
--    cruce por los últimos 10 dígitos vivía copiado en cuatro archivos.
--    Aquí lo calcula y garantiza la base de datos, una sola vez.
--
-- 2. `historialNotas[]`, que era un arreglo embebido, sale a tabla propia:
--    así se consulta, se pagina y queda registro de quién escribió cada
--    nota — que es lo que pide la trazabilidad de un expediente.
-- ═══════════════════════════════════════════════════════════════════════

create table public.pacientes (
  id            uuid primary key default gen_random_uuid(),
  clinica_id    uuid not null references public.clinicas(id) on delete cascade,

  -- Código legible heredado (PAC-YYYYMMDD-XXXX). Se conserva porque
  -- aparece en pantalla y en documentos ya emitidos.
  codigo        text,

  -- Identificación
  nombre        text not null default '',
  apellidos     text not null default '',
  telefono      text not null default '',
  telefono_clave text generated always as
                  (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10)) stored,
  email         text default '',

  -- Datos médicos
  fecha_nacimiento date,
  sexo             text default '',
  estatura         text default '',
  peso             text default '',
  tipo_sangre      text default '',
  alergias              text default '',
  enfermedades_cronicas text default '',
  medicamentos_actuales text default '',

  -- Seguro médico
  tiene_seguro   boolean not null default false,
  nombre_seguro  text default '',
  numero_poliza  text default '',

  -- Información adicional
  ciudad           text default '',
  como_nos_encontro text default '',
  ocupacion        text default '',

  -- 1 = Regular · 2 = VIP Plata · 3 = VIP Oro
  calificacion   smallint not null default 1 check (calificacion between 1 and 3),

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on column public.pacientes.telefono_clave is
  'Últimos 10 dígitos, calculados por la base. Es la llave real de identidad del paciente: permite cruzar el formato internacional de WhatsApp con el que teclea la asistente.';

-- Un mismo teléfono no puede pertenecer a dos expedientes de la misma
-- clínica. Es la regla que el frontend intentaba sostener a mano.
create unique index pacientes_telefono_unico
  on public.pacientes (clinica_id, telefono_clave)
  where telefono_clave <> '';

create unique index pacientes_codigo_unico
  on public.pacientes (clinica_id, codigo)
  where codigo is not null;

create index pacientes_clinica_idx on public.pacientes (clinica_id);
create index pacientes_nombre_idx  on public.pacientes (clinica_id, apellidos, nombre);

create trigger pacientes_actualizado_en
  before update on public.pacientes
  for each row execute function public.tocar_actualizado_en();

-- ─── Notas internas del expediente ─────────────────────────────────────
create table public.notas_paciente (
  id           uuid primary key default gen_random_uuid(),
  clinica_id   uuid not null references public.clinicas(id) on delete cascade,
  paciente_id  uuid not null references public.pacientes(id) on delete cascade,

  texto        text not null,
  -- Se conserva aunque el autor se dé de baja: un expediente no puede
  -- perder el rastro de quién escribió una nota.
  autor_id     uuid references public.perfiles_staff(id) on delete set null,
  autor_nombre text not null default '',

  creado_en    timestamptz not null default now()
);

create index notas_paciente_idx on public.notas_paciente (paciente_id, creado_en desc);

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.pacientes      enable row level security;
alter table public.notas_paciente enable row level security;

create policy pacientes_todo on public.pacientes
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy notas_todo on public.notas_paciente
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());
