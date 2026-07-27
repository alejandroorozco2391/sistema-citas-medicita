-- ═══════════════════════════════════════════════════════════════════════
-- 0005 — Conversaciones, mensajes, documentos y posts
--
-- Las reglas que en el navegador sostenía el store por buena voluntad,
-- aquí las sostiene la base:
--
--   · La identidad de una conversación (clave externa del proveedor, o
--     canal + teléfono) es un índice único, no una búsqueda esperanzada.
--   · La idempotencia de mensajes es una restricción única sobre el id
--     que da el proveedor. Reingerir el mismo webhook no puede duplicar
--     nada aunque el cliente insista.
--   · El resumen desnormalizado de la conversación lo mantiene un
--     disparador, no quien escribe. Importa porque los webhooks van a
--     insertar mensajes sin pasar por el frontend.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Conversaciones ────────────────────────────────────────────────────
create table public.conversaciones (
  id            uuid primary key default gen_random_uuid(),
  clinica_id    uuid not null references public.clinicas(id) on delete cascade,
  paciente_id   uuid references public.pacientes(id) on delete set null,

  -- Identidad que da el proveedor: conversation_id de ElevenLabs, id de
  -- sesión de MediBot. WhatsApp no tiene una, porque su hilo es continuo.
  clave_externa text,

  telefono      text not null default '',
  telefono_clave text generated always as
                   (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10)) stored,
  nombre_contacto text not null default '',

  canal   text not null check (canal in ('medibot', 'whatsapp', 'voz', 'chat_web')),
  canal_meta jsonb not null default '{}'::jsonb,

  estado  text not null default 'abierta'
            check (estado in ('abierta', 'requiere_atencion_humana', 'resuelta')),
  asunto  text default '',

  -- Espejo del último mensaje, para dibujar la lista sin leer el corpus.
  ultimo_mensaje jsonb,
  no_leidos      integer not null default 0,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  cerrado_en     timestamptz
);

-- Identidad por clave del proveedor…
create unique index conversaciones_clave_externa_unica
  on public.conversaciones (clinica_id, clave_externa)
  where clave_externa is not null;

-- …o por canal + teléfono cuando el canal no da una (caso WhatsApp).
create unique index conversaciones_canal_telefono_unico
  on public.conversaciones (clinica_id, canal, telefono_clave)
  where clave_externa is null and telefono_clave <> '';

create index conversaciones_orden_idx  on public.conversaciones (clinica_id, actualizado_en desc);
create index conversaciones_estado_idx on public.conversaciones (clinica_id, estado);
create index conversaciones_paciente_idx on public.conversaciones (paciente_id);

create trigger conversaciones_actualizado_en
  before update on public.conversaciones
  for each row execute function public.tocar_actualizado_en();

-- ─── Mensajes ──────────────────────────────────────────────────────────
create table public.mensajes (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,

  -- Id determinista del proveedor (MSG-wa-<wamid>, MSG-11l-<conv>-<i>,
  -- MSG-mb-<sesion>-<i>). Es lo que hace idempotente la reingesta.
  clave_externa  text,

  remitente text not null check (remitente in ('paciente', 'agente', 'staff', 'sistema')),
  autor_nombre text default '',
  autor_id   uuid references public.perfiles_staff(id) on delete set null,

  tipo      text not null default 'texto'
              check (tipo in ('texto', 'audio', 'transcripcion', 'nota_interna', 'sistema')),
  contenido text not null default '',

  audio_url    text,
  duracion_seg integer,

  estado_envio text not null default 'enviado'
                 check (estado_envio in ('recibido', 'enviado', 'pendiente', 'fallido')),

  metadata jsonb not null default '{}'::jsonb,
  fecha    timestamptz not null default now(),

  creado_en timestamptz not null default now()
);

create unique index mensajes_clave_externa_unica
  on public.mensajes (clinica_id, clave_externa)
  where clave_externa is not null;

create index mensajes_hilo_idx on public.mensajes (conversacion_id, fecha);

-- ─── Espejo del último mensaje ─────────────────────────────────────────
-- Mismas reglas que js/conversaciones-store.js: una nota interna no es
-- "el último mensaje" del hilo con el paciente, y un audio necesita un
-- texto legible en la lista.
create or replace function public.sincronizar_resumen_conversacion()
returns trigger
language plpgsql
as $$
begin
  if new.tipo <> 'nota_interna' then
    update public.conversaciones
       set ultimo_mensaje = jsonb_build_object(
             'texto', case when new.tipo = 'audio'
                           then '🎧 Mensaje de voz'
                           else new.contenido end,
             'remitente', new.remitente,
             'fecha', new.fecha
           ),
           actualizado_en = greatest(actualizado_en, new.fecha),
           no_leidos = no_leidos + case when new.remitente = 'paciente' then 1 else 0 end
     where id = new.conversacion_id;
  end if;
  return new;
end;
$$;

create trigger mensajes_sincronizan_resumen
  after insert on public.mensajes
  for each row execute function public.sincronizar_resumen_conversacion();

-- ─── Documentos clínicos (MediDocs) ────────────────────────────────────
-- Se guardan metadatos + inputs, no el HTML: el documento se regenera.
create table public.documentos (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references public.clinicas(id) on delete cascade,
  cita_id     uuid references public.citas(id) on delete set null,
  paciente_id uuid references public.pacientes(id) on delete set null,

  codigo   text,
  tipo_doc text not null,
  inputs   jsonb not null default '{}'::jsonb,

  creado_por uuid references public.perfiles_staff(id) on delete set null,
  creado_en  timestamptz not null default now()
);

create index documentos_clinica_idx  on public.documentos (clinica_id, creado_en desc);
create index documentos_paciente_idx on public.documentos (paciente_id);

-- ─── Posts de redes sociales (MediPost) ────────────────────────────────
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  clinica_id   uuid not null references public.clinicas(id) on delete cascade,

  tipo         text default '',
  especialidad text default '',
  red          text default '',
  tono         text default '',
  caption      text default '',
  hashtags     text default '',

  fecha_programada date,
  publicado    boolean not null default false,
  borrador     boolean not null default true,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index posts_clinica_idx     on public.posts (clinica_id, creado_en desc);
create index posts_calendario_idx  on public.posts (clinica_id, fecha_programada);

create trigger posts_actualizado_en
  before update on public.posts
  for each row execute function public.tocar_actualizado_en();

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.conversaciones enable row level security;
alter table public.mensajes       enable row level security;
alter table public.documentos     enable row level security;
alter table public.posts          enable row level security;

create policy conversaciones_todo on public.conversaciones
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy mensajes_todo on public.mensajes
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy documentos_todo on public.documentos
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

create policy posts_todo on public.posts
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());
