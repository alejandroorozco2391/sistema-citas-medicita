-- ═══════════════════════════════════════════════════════════════════════
-- ARCHIVO GENERADO — no lo edites.
--
-- Es la concatenación de supabase/migrations/*.sql, en orden, para poder
-- aplicar el esquema completo de un solo pegado en el editor SQL del
-- panel de Supabase.
--
-- Para cambiar el esquema, edita los archivos numerados y vuelve a correr:
--     npm run db:bundle
--
-- Generado desde: 0001_utilidades.sql · 0002_clinicas_y_staff.sql · 0003_pacientes.sql · 0004_citas.sql · 0005_conversaciones_y_modulos.sql · 0006_rpc_publicas.sql · 0007_testimonios_publicos.sql · 0008_posts_campos_faltantes.sql
-- ═══════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0001_utilidades.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0001 — Extensiones y utilidades compartidas
--
-- Todo lo que las demás migraciones dan por hecho: generación de UUID,
-- el disparador de `actualizado_en`, la normalización de teléfonos y la
-- función que resuelve a qué clínica pertenece el usuario autenticado.
-- ═══════════════════════════════════════════════════════════════════════

-- Sin extensiones: gen_random_uuid() es parte del núcleo de Postgres
-- desde la versión 13, así que no hace falta pgcrypto.

-- ─── Marca de actualización ────────────────────────────────────────────
create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

comment on function public.tocar_actualizado_en is
  'Disparador BEFORE UPDATE: mantiene actualizado_en al día sin que la app tenga que acordarse.';

-- ─── Normalización de teléfonos ────────────────────────────────────────
-- Los últimos 10 dígitos son el número nacional mexicano completo. Sirve
-- para cruzar el "525588112233" que entrega WhatsApp con el
-- "55 8811 2233" que teclea la asistente. Es la versión en SQL de
-- claveTel() en js/conversaciones-store.js — si una cambia, cambia la otra.
create or replace function public.clave_telefono(tel text)
returns text
language sql
immutable
as $$
  select right(regexp_replace(coalesce(tel, ''), '\D', '', 'g'), 10);
$$;

comment on function public.clave_telefono is
  'Últimos 10 dígitos de un teléfono. Espejo de claveTel() en el frontend.';

-- clinica_actual() y rol_actual() viven en 0002, junto a la tabla
-- perfiles_staff que consultan: Postgres valida el cuerpo de la función
-- al crearla, así que no pueden nacer antes que su tabla.


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0002_clinicas_y_staff.sql                                      ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0003_pacientes.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0004_citas.sql                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0005_conversaciones_y_modulos.sql                              ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0006_rpc_publicas.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0007_testimonios_publicos.sql                                  ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0007 — Testimonios públicos para la landing
--
-- La sección de opiniones de index.html se armaba cruzando en el
-- navegador las respuestas de la encuesta con las citas, para sacar el
-- nombre del paciente. Eso tenía dos problemas.
--
-- El de privacidad, que existía ya en modo local: la página pública
-- cargaba el arreglo COMPLETO de citas —nombres, teléfonos, correos,
-- notas de todos los pacientes— nada más para extraer un nombre de pila.
--
-- El de funcionamiento, que aparece con backend: `nps_respuestas` y
-- `citas` están protegidas por RLS y el rol anónimo no tiene política
-- sobre ninguna de las dos, así que un visitante recibiría cero
-- renglones y la sección saldría vacía.
--
-- La solución es la misma que ya se usó para `clinica_publica`: una
-- vista que expone exactamente lo que la clínica publicaría de todos
-- modos, y nada más. RLS filtra renglones, no columnas — por eso darle
-- a anon una política sobre `nps_respuestas` sería peor: podría leer el
-- comentario junto con el cita_id y de ahí tirar del hilo.
-- ═══════════════════════════════════════════════════════════════════════

create view public.testimonios_publicos
with (security_invoker = false)
as
  select
    n.id,
    n.clinica_id,

    -- "María G." — nombre de pila más la inicial del apellido, que es lo
    -- que la landing ya mostraba. El apellido completo no sale nunca.
    btrim(
      split_part(btrim(c.nombre), ' ', 1) ||
      case
        when btrim(coalesce(c.apellidos, '')) <> ''
          then ' ' || left(btrim(c.apellidos), 1) || '.'
        else ''
      end
    ) as nombre_publico,

    n.puntuacion,
    n.comentario,
    n.creado_en
  from public.nps_respuestas n
  join public.citas    c  on c.id  = n.cita_id
  join public.clinicas cl on cl.id = n.clinica_id
  where cl.activa
    and n.puntuacion >= 8;   -- mismo umbral que ya aplicaba la landing

comment on view public.testimonios_publicos is
  'Opiniones de pacientes legibles sin autenticación, para la landing. '
  'Solo nombre de pila e inicial, puntuación, comentario y fecha: nunca '
  'teléfono, correo, folio ni identificador de cita.';

-- La landing la lee sin sesión.
grant select on public.testimonios_publicos to anon;
grant select on public.testimonios_publicos to authenticated;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0008_posts_campos_faltantes.sql                                ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0008 — Las tres columnas que le faltaban a `posts`
--
-- MediPost le pide a Claude cuatro cosas y las devuelve en bloques
-- separados: [CAPTION], [HASHTAGS], [SUGERENCIA_IMAGEN] y
-- [LLAMADA_A_ACCION]. El bloque de imagen trae además el prompt en
-- inglés para los generadores de imágenes, que es lo que la asistente
-- copia y pega en Firefly o Leonardo.
--
-- La tabla solo tenía columnas para las dos primeras. Al conectar el
-- módulo (B2) eso se habría traducido en que una clínica con backend
-- guardaba el caption y los hashtags, y perdía en silencio la
-- descripción de la imagen, el prompt y la llamada a la acción — tres de
-- las cuatro cosas por las que se hizo el módulo, y sin ningún error
-- visible que lo delatara.
--
-- Es aditivo y con valor por omisión: correrlo sobre una base con datos
-- no toca ni un renglón existente.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.posts
  add column if not exists sugerencia_imagen text default '',
  add column if not exists prompt_ia         text default '',
  add column if not exists llamada_accion    text default '';

comment on column public.posts.prompt_ia is
  'Prompt en inglés para generadores de imágenes (Firefly, Leonardo). Se muestra copiable en la UI.';
