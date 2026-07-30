-- ═══════════════════════════════════════════════════════════════════════
-- ARCHIVO GENERADO — no lo edites.
--
-- Es la concatenación de supabase/migrations/*.sql, en orden, para poder
-- aplicar el esquema de un solo pegado en el editor SQL del panel de
-- Supabase.
--
-- Para cambiar el esquema, edita los archivos numerados y vuelve a correr:
--     npm run db:bundle
--
-- Generado desde: 0001_utilidades.sql · 0002_clinicas_y_staff.sql · 0003_pacientes.sql · 0004_citas.sql · 0005_conversaciones_y_modulos.sql · 0006_rpc_publicas.sql · 0007_testimonios_publicos.sql · 0008_posts_campos_faltantes.sql · 0009_horarios.sql · 0010_escalaciones.sql · 0011_fecha_en_palabras.sql · 0012_doble_reserva.sql · 0013_permisos_de_funciones.sql · 0014_avisos_automaticos.sql · 0015_sitio_url_publica.sql · 0016_mis_citas.sql · 0017_reactivacion.sql
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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0009_horarios.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0010_escalaciones.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0010 — Escalación a humano
--
-- Un paciente pide hablar con una persona, o el agente no puede resolver
-- lo que le están pidiendo. Lo que NO puede pasar es que eso se pierda:
-- una escalación sin acuse deja al paciente peor que si nunca hubiera
-- pedido un humano. Pidió ayuda, le dijeron que sí, y nadie llegó.
--
-- Por eso el centro de esta migración no es la tabla, es el ciclo:
--
--   pendiente ──(alguien la toma)──> reconocida ──> resuelta
--       │
--       └──(nadie la toma a tiempo)──> sube de nivel ──> vencida
--
-- Y `vencida` NO se cierra sola. Nunca. Se queda visible hasta que un
-- humano la cierre a mano. Es la única garantía de que nada se traspapela.
--
-- El reloj que hace subir la escalera es pg_cron, y se programa aparte:
-- ver supabase/cron.sql. Esta migración no depende de esa extensión, para
-- que el esquema se pueda probar contra un Postgres pelón.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── La escalación ─────────────────────────────────────────────────────
create table public.escalaciones (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references public.clinicas(id) on delete cascade,

  -- De dónde viene. Todo opcional: un paciente sin expediente que escribe
  -- por WhatsApp a las 11 de la noche también tiene derecho a un humano.
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  paciente_id     uuid references public.pacientes(id) on delete set null,
  cita_id         uuid references public.citas(id) on delete set null,
  canal_origen    text not null default 'medibot',

  -- Con quién hay que hablar. Se copian aquí y no solo por referencia:
  -- son el registro de con qué datos se pidió el contacto.
  contacto_nombre   text not null default '',
  contacto_telefono text not null default '',
  contacto_email    text not null default '',
  telefono_clave    text generated always as
                      (right(regexp_replace(coalesce(contacto_telefono, ''), '\D', '', 'g'), 10)) stored,

  motivo   text not null check (motivo in (
             'urgencia_medica',    -- posible emergencia
             'duda_clinica',       -- pregunta que exige criterio médico
             'queja',              -- inconformidad
             'agenda',             -- cambio complicado de cita
             'administrativo',     -- costos, seguros, facturación
             'peticion_explicita', -- "quiero hablar con una persona"
             'bot_no_pudo'         -- el agente se rindió
           )),
  urgencia text not null default 'normal' check (urgencia in ('alta', 'normal', 'baja')),
  resumen  text not null default '',

  destino_rol text not null check (destino_rol in ('doctor', 'recepcionista', 'admin')),
  asignado_a  uuid references public.perfiles_staff(id) on delete set null,

  estado text not null default 'pendiente'
           check (estado in ('pendiente', 'reconocida', 'resuelta', 'vencida')),
  nivel  smallint not null default 0 check (nivel between 0 and 3),

  vence_en       timestamptz not null,
  reconocida_en  timestamptz,
  reconocida_por uuid references public.perfiles_staff(id) on delete set null,
  resuelta_en    timestamptz,
  resuelta_por   uuid references public.perfiles_staff(id) on delete set null,
  nota_cierre    text default '',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.escalaciones is
  'Petición de atención humana con acuse obligatorio. El estado `vencida` nunca se cierra solo: esa es la garantía de que nada se traspapela.';
comment on column public.escalaciones.nivel is
  '0 al rol destino · 1 a todo el personal · 2 además por correo · 3 vencida.';

create index escalaciones_abiertas_idx
  on public.escalaciones (clinica_id, estado, vence_en)
  where estado in ('pendiente', 'vencida');

-- Para el freno de abuso: contar cuántas pidió este teléfono hoy.
create index escalaciones_telefono_idx
  on public.escalaciones (clinica_id, telefono_clave, creado_en);

create index escalaciones_conversacion_idx on public.escalaciones (conversacion_id);

create trigger escalaciones_actualizado_en
  before update on public.escalaciones
  for each row execute function public.tocar_actualizado_en();

-- ─── Bandeja de salida ─────────────────────────────────────────────────
-- Separar "subir la escalera" de "entregar el aviso" es lo que permite
-- reintentar un correo sin volver a disparar la escalera, y deja el hueco
-- para que WhatsApp sea después solo otro remitente.
create table public.avisos_pendientes (
  id            uuid primary key default gen_random_uuid(),
  clinica_id    uuid not null references public.clinicas(id) on delete cascade,
  escalacion_id uuid not null references public.escalaciones(id) on delete cascade,

  canal        text not null default 'email' check (canal in ('email')),
  destinatario text not null,
  asunto       text not null default '',
  cuerpo       text not null default '',

  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'enviado', 'fallido')),
  intentos     integer not null default 0,
  ultimo_error text default '',

  creado_en    timestamptz not null default now(),
  enviado_en   timestamptz
);

comment on table public.avisos_pendientes is
  'Cola de avisos por entregar. La drena una función de Vercel; los reintentos no vuelven a mover la escalación.';

create index avisos_pendientes_cola_idx
  on public.avisos_pendientes (estado, creado_en)
  where estado = 'pendiente';

-- ═══ Ruteo ═════════════════════════════════════════════════════════════
-- A quién le toca y para cuándo. Depende del motivo Y del horario, que
-- por eso hubo que construir MediHorario primero.
create or replace function public.rutear_escalacion(
  p_clinica  uuid,
  p_motivo   text,
  p_urgencia text,
  p_momento  timestamptz default now()
)
returns table (destino_rol text, vence_en timestamptz)
language plpgsql
stable
as $$
declare
  v_abierto boolean;
  v_prox    timestamptz;
  v_rol     text;
  v_margen  interval;
begin
  v_rol := case p_motivo
    when 'urgencia_medica' then 'doctor'
    when 'duda_clinica'    then 'doctor'
    when 'queja'           then 'admin'
    else                        'recepcionista'
  end;

  -- Si no hay nadie con ese rol, se cae al que siempre existe. Enrutar a
  -- un rol vacío es enrutar a nadie, que es el hoyo negro otra vez.
  if not exists (
    select 1 from public.perfiles_staff
    where clinica_id = p_clinica and activo and rol = v_rol
  ) then
    v_rol := 'admin';
    if not exists (
      select 1 from public.perfiles_staff
      where clinica_id = p_clinica and activo and rol = 'admin'
    ) then
      v_rol := 'recepcionista';
    end if;
  end if;

  v_margen := case p_urgencia
    when 'alta' then interval '5 minutes'
    when 'baja' then interval '60 minutes'
    else             interval '15 minutes'
  end;

  v_abierto := public.en_horario(p_clinica, p_momento);

  -- Una posible urgencia médica NO espera a que abran. Va al doctor con
  -- el reloj corriendo aunque sea domingo de madrugada.
  if p_motivo = 'urgencia_medica' then
    return query select v_rol, p_momento + interval '15 minutes';
    return;
  end if;

  if v_abierto then
    return query select v_rol, p_momento + v_margen;
    return;
  end if;

  -- Cerrado: el reloj empieza a correr cuando abran, no antes. Vencer una
  -- escalación a las 3 de la mañana solo produce alertas que nadie puede
  -- atender, y enseña al personal a ignorarlas.
  v_prox := public.proxima_apertura(p_clinica, p_momento);
  return query select v_rol, coalesce(v_prox, p_momento + interval '12 hours') + v_margen;
end;
$$;

comment on function public.rutear_escalacion is
  'Decide destino y plazo según motivo, urgencia y horario. urgencia_medica nunca espera a que abran.';

-- ═══ Avisos ════════════════════════════════════════════════════════════
create or replace function public.encolar_aviso_escalacion(
  p_escalacion uuid,
  p_tipo       text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e       record;
  v_roles   text[];
  v_asunto  text;
  v_cuerpo  text;
  v_n       int := 0;
  v_dest    record;
begin
  select * into v_e from public.escalaciones where id = p_escalacion;
  if not found then return 0; end if;

  -- Nivel 2 avisa a quien decide; vencida, a todo el mundo.
  v_roles := case when p_tipo = 'vencida'
                  then array['doctor', 'recepcionista', 'admin']
                  else array['doctor', 'admin'] end;

  v_asunto := case when p_tipo = 'vencida'
    then '⚠ Escalación SIN ATENDER: ' || v_e.motivo
    else 'Escalación sin acuse: ' || v_e.motivo end;

  v_cuerpo :=
    'Paciente: '  || coalesce(nullif(v_e.contacto_nombre, ''), 'sin nombre') || E'\n' ||
    'Teléfono: '  || coalesce(nullif(v_e.contacto_telefono, ''), 'no proporcionado') || E'\n' ||
    'Motivo: '    || v_e.motivo || ' (urgencia ' || v_e.urgencia || ')' || E'\n' ||
    'Canal: '     || v_e.canal_origen || E'\n' ||
    'Pedida: '    || to_char(v_e.creado_en, 'YYYY-MM-DD HH24:MI') || E'\n\n' ||
    'Lo que pidió:' || E'\n' || coalesce(nullif(v_e.resumen, ''), '(sin detalle)') || E'\n\n' ||
    case when p_tipo = 'vencida'
      then 'NADIE LA HA TOMADO. Sigue abierta en el panel y no se va a cerrar sola.'
      else 'Sigue sin acuse. Ábrela en el panel y dale "La tomo".' end;

  -- El correo del personal vive en auth.users, no en perfiles_staff. Se
  -- puede leer desde aquí porque la función es security definer.
  for v_dest in
    select distinct u.email
    from public.perfiles_staff p
    join auth.users u on u.id = p.usuario_id
    where p.clinica_id = v_e.clinica_id
      and p.activo
      and p.rol = any(v_roles)
      and coalesce(u.email, '') <> ''
  loop
    insert into public.avisos_pendientes
      (clinica_id, escalacion_id, destinatario, asunto, cuerpo)
    values
      (v_e.clinica_id, v_e.id, v_dest.email, v_asunto, v_cuerpo);
    v_n := v_n + 1;
  end loop;

  -- Nadie con correo: al menos que quede el de la clínica, o el aviso se
  -- evapora sin dejar rastro de que se intentó.
  if v_n = 0 then
    insert into public.avisos_pendientes
      (clinica_id, escalacion_id, destinatario, asunto, cuerpo)
    select v_e.clinica_id, v_e.id, c.email, v_asunto, v_cuerpo
    from public.clinicas c
    where c.id = v_e.clinica_id and coalesce(c.email, '') <> '';
    get diagnostics v_n = row_count;
  end if;

  return v_n;
end;
$$;

-- ═══ La escalera ═══════════════════════════════════════════════════════
-- La corre pg_cron cada minuto. Es la única pieza del sistema que trabaja
-- sin que haya un navegador abierto — y es exactamente para lo que se
-- construyó el backend.
create or replace function public.promover_escalaciones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e record;
  v_n int := 0;
begin
  for v_e in
    select id, nivel, conversacion_id
    from public.escalaciones
    where estado = 'pendiente'
      and vence_en <= now()
    for update skip locked
  loop
    v_n := v_n + 1;

    if v_e.nivel = 0 then
      -- Deja de ser "de recepción" y pasa a ser de todos.
      update public.escalaciones
         set nivel = 1, vence_en = now() + interval '5 minutes'
       where id = v_e.id;

    elsif v_e.nivel = 1 then
      update public.escalaciones
         set nivel = 2, vence_en = now() + interval '10 minutes'
       where id = v_e.id;
      perform public.encolar_aviso_escalacion(v_e.id, 'nivel2');

    else
      -- Fin de la escalera. No hay nivel 4 ni cierre automático: se queda
      -- en rojo hasta que alguien la atienda.
      update public.escalaciones
         set estado = 'vencida', nivel = 3
       where id = v_e.id;

      update public.conversaciones
         set estado = 'requiere_atencion_humana'
       where id = v_e.conversacion_id
         and estado <> 'resuelta';

      perform public.encolar_aviso_escalacion(v_e.id, 'vencida');
    end if;
  end loop;

  return v_n;
end;
$$;

comment on function public.promover_escalaciones is
  'Sube de nivel las escalaciones sin acuse. La programa pg_cron cada minuto (ver supabase/cron.sql).';

-- ═══ Acuse y cierre ════════════════════════════════════════════════════
-- Tomar una escalación detiene la escalera EN SECO. Es lo que hace que el
-- ciclo signifique algo: quien la toma se está haciendo responsable.
create or replace function public.escalacion_reconocer(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_yo uuid;
begin
  select id into v_yo from public.perfiles_staff
   where usuario_id = auth.uid() and activo;

  update public.escalaciones
     set estado = 'reconocida',
         reconocida_en = now(),
         reconocida_por = v_yo,
         asignado_a = coalesce(asignado_a, v_yo)
   where id = p_id
     and clinica_id = public.clinica_actual()
     and estado in ('pendiente', 'vencida');

  if not found then
    raise exception 'Esa escalación ya no está abierta';
  end if;
end;
$$;

-- Cerrar exige decir qué pasó. Un cierre sin nota es indistinguible de
-- alguien limpiando la lista para que deje de parpadear.
create or replace function public.escalacion_resolver(p_id uuid, p_nota text)
returns void
language plpgsql
as $$
declare
  v_yo uuid;
begin
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Hay que anotar qué se hizo antes de cerrarla';
  end if;

  select id into v_yo from public.perfiles_staff
   where usuario_id = auth.uid() and activo;

  update public.escalaciones
     set estado = 'resuelta',
         resuelta_en = now(),
         resuelta_por = v_yo,
         nota_cierre = trim(p_nota),
         reconocida_en = coalesce(reconocida_en, now()),
         reconocida_por = coalesce(reconocida_por, v_yo)
   where id = p_id
     and clinica_id = public.clinica_actual()
     and estado <> 'resuelta';

  if not found then
    raise exception 'Esa escalación ya estaba cerrada';
  end if;
end;
$$;

-- ═══ Pedir un humano sin tener cuenta ══════════════════════════════════
-- Es la puerta del paciente. Misma forma que solicitar_cita: el rol
-- anónimo no tiene política sobre ninguna tabla, y esta función valida
-- por dentro.
create or replace function public.escalar_a_humano(
  p_motivo          text,
  p_resumen         text,
  p_urgencia        text default 'normal',
  p_nombre          text default '',
  p_telefono        text default '',
  p_email           text default '',
  p_canal           text default 'medibot',
  p_conversacion_id uuid default null,
  p_clinica_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinica   uuid := coalesce(p_clinica_id, public.clinica_unica());
  v_tel_clave text := public.clave_telefono(p_telefono);
  v_recientes int;
  v_ruta      record;
  v_id        uuid;
  v_abierto   boolean;
  v_prox      timestamptz;
  v_paciente  uuid;
begin
  if p_motivo is null or p_motivo = '' then
    raise exception 'Falta el motivo de la escalación';
  end if;

  -- Freno de abuso, igual que en solicitar_cita: la anon key es pública.
  -- El tope es más bajo que el de citas (3 contra 5) porque cada
  -- escalación le suena el teléfono a una persona de verdad.
  if v_tel_clave <> '' then
    select count(*) into v_recientes
    from public.escalaciones
    where clinica_id = v_clinica
      and telefono_clave = v_tel_clave
      and creado_en > now() - interval '24 hours';

    if v_recientes >= 3 then
      raise exception 'Ya hay varias solicitudes de contacto desde este teléfono. Alguien de la clínica te va a llamar.';
    end if;

    select id into v_paciente
    from public.pacientes
    where clinica_id = v_clinica and telefono_clave = v_tel_clave
    limit 1;
  end if;

  select r.destino_rol, r.vence_en into v_ruta
  from public.rutear_escalacion(v_clinica, p_motivo, coalesce(p_urgencia, 'normal')) r;

  insert into public.escalaciones (
    clinica_id, conversacion_id, paciente_id, canal_origen,
    contacto_nombre, contacto_telefono, contacto_email,
    motivo, urgencia, resumen, destino_rol, vence_en
  ) values (
    v_clinica, p_conversacion_id, v_paciente, coalesce(p_canal, 'medibot'),
    coalesce(p_nombre, ''), coalesce(p_telefono, ''), coalesce(p_email, ''),
    p_motivo, coalesce(p_urgencia, 'normal'), coalesce(p_resumen, ''),
    v_ruta.destino_rol, v_ruta.vence_en
  )
  returning id into v_id;

  -- La conversación queda marcada para que salte en el inbox.
  if p_conversacion_id is not null then
    update public.conversaciones
       set estado = 'requiere_atencion_humana'
     where id = p_conversacion_id and clinica_id = v_clinica;
  end if;

  v_abierto := public.en_horario(v_clinica);
  v_prox    := public.proxima_apertura(v_clinica);

  -- Se devuelve el estado del mundo, no una frase hecha: quien llama
  -- redacta, pero solo puede prometer lo que estos datos sostienen.
  return jsonb_build_object(
    'id',            v_id,
    'destino',       v_ruta.destino_rol,
    'urgencia',      coalesce(p_urgencia, 'normal'),
    'abiertoAhora',  v_abierto,
    'atencionEn',    case when v_abierto then null else v_prox end,
    'esEmergencia',  p_motivo = 'urgencia_medica',
    'instruccion',
      case
        when p_motivo = 'urgencia_medica' then
          'ANTES QUE NADA dile que si es una emergencia llame al 911 o vaya a urgencias AHORA, sin esperar respuesta. Después confirma que ya avisaste a la clínica.'
        when v_abierto then
          'Confirma que ya avisaste y que en unos minutos lo contactan.'
        when v_prox is not null then
          'Confirma que ya avisaste y di que lo contactan cuando abra el consultorio, en la fecha y hora de atencionEn. No prometas antes.'
        else
          'Confirma que ya avisaste. NO prometas una hora: el consultorio no tiene horario cargado y sería inventarla.'
      end
  );
end;
$$;

comment on function public.escalar_a_humano is
  'Puerta sin sesión para pedir atención humana. Devuelve el estado real del horario para que nadie prometa una hora que no se sostiene.';

-- ═══ RLS ═══════════════════════════════════════════════════════════════
alter table public.escalaciones      enable row level security;
alter table public.avisos_pendientes enable row level security;

-- Todo el personal las ve, sin distinción de rol: recepción tiene que
-- poder darse cuenta de que la escalación del doctor lleva veinte minutos
-- sin que nadie la toque. Ocultársela sería reconstruir el hoyo negro
-- dentro del propio equipo.
create policy escalaciones_todo on public.escalaciones
  for all to authenticated
  using (clinica_id = public.clinica_actual())
  with check (clinica_id = public.clinica_actual());

-- La bandeja de salida es solo de lectura para el personal: quien la
-- escribe es la escalera, y quien la vacía es la función de Vercel con la
-- service role key.
create policy avisos_lectura on public.avisos_pendientes
  for select to authenticated
  using (clinica_id = public.clinica_actual());

-- ─── Permisos ──────────────────────────────────────────────────────────
revoke all on function public.escalar_a_humano          from public;
revoke all on function public.rutear_escalacion         from public;
revoke all on function public.promover_escalaciones     from public;
revoke all on function public.encolar_aviso_escalacion  from public;
revoke all on function public.escalacion_reconocer      from public;
revoke all on function public.escalacion_resolver       from public;

-- Lo único que alcanza un paciente sin cuenta.
grant execute on function public.escalar_a_humano to anon, authenticated;

grant execute on function public.escalacion_reconocer to authenticated;
grant execute on function public.escalacion_resolver  to authenticated;
grant execute on function public.rutear_escalacion    to authenticated;

-- promover_escalaciones() y encolar_aviso_escalacion() NO se conceden a
-- nadie: las corre pg_cron como dueño de la base. Si un usuario pudiera
-- llamarlas, podría acelerar la escalera de otra clínica.


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0011_fecha_en_palabras.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0011 — La hora que se le dice al paciente, ya escrita
--
-- `escalar_a_humano` devolvía `atencionEn` como timestamptz crudo:
--   2026-07-30T15:00:00+00:00
--
-- Que son las 09:00 en México. Pero quien redacta la respuesta es un
-- modelo de lenguaje, y para decir "a las nueve" tenía que convertir de
-- UTC a la zona de la clínica él mismo. En la primera prueba contra un
-- proyecto real dijo "a las 10 am".
--
-- Nadie lo habría notado: suena razonable, y el paciente se presenta una
-- hora tarde o espera una llamada que ya ocurrió. Es la misma clase de
-- error silencioso que esta fase lleva corrigiendo desde la zona horaria
-- incrustada en 0006.
--
-- La corrección no es afinar el prompt, es quitarle el cálculo: la base
-- ya sabe la zona de la clínica, así que devuelve la frase hecha y el
-- modelo solo la repite.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Fecha y hora en español, en la zona de la clínica ─────────────────
-- Con arreglos y no con to_char(..., 'TMDay'): el formato TM depende de
-- la configuración regional del servidor, que en Supabase es inglesa. Un
-- "Thursday 30 of July" no sirve, y peor: funcionaría en la máquina de
-- alguien y no en producción.
create or replace function public.fecha_en_palabras(
  p_momento timestamptz,
  p_tz      text default 'America/Mexico_City'
)
returns text
language plpgsql
immutable
as $$
declare
  DIAS  constant text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  MESES constant text[] := array['enero','febrero','marzo','abril','mayo','junio',
                                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  v_local timestamp;
begin
  if p_momento is null then return null; end if;

  v_local := p_momento at time zone coalesce(p_tz, 'America/Mexico_City');

  return DIAS[extract(dow from v_local)::int + 1]
      || ' ' || extract(day from v_local)::int
      || ' de ' || MESES[extract(month from v_local)::int]
      || ' a las ' || to_char(v_local, 'HH24:MI');
end;
$$;

comment on function public.fecha_en_palabras is
  'Fecha y hora en español, ya convertida a la zona de la clínica. Existe para que quien redacte no tenga que calcularla.';

-- ─── escalar_a_humano devuelve la frase, no el cálculo ─────────────────
-- Mismo cuerpo que en 0010 salvo el bloque de salida.
create or replace function public.escalar_a_humano(
  p_motivo          text,
  p_resumen         text,
  p_urgencia        text default 'normal',
  p_nombre          text default '',
  p_telefono        text default '',
  p_email           text default '',
  p_canal           text default 'medibot',
  p_conversacion_id uuid default null,
  p_clinica_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinica   uuid := coalesce(p_clinica_id, public.clinica_unica());
  v_tel_clave text := public.clave_telefono(p_telefono);
  v_recientes int;
  v_ruta      record;
  v_id        uuid;
  v_abierto   boolean;
  v_prox      timestamptz;
  v_paciente  uuid;
  v_tz        text;
begin
  if p_motivo is null or p_motivo = '' then
    raise exception 'Falta el motivo de la escalación';
  end if;

  -- Freno de abuso, igual que en solicitar_cita: la anon key es pública.
  -- El tope es más bajo que el de citas (3 contra 5) porque cada
  -- escalación le suena el teléfono a una persona de verdad.
  if v_tel_clave <> '' then
    select count(*) into v_recientes
    from public.escalaciones
    where clinica_id = v_clinica
      and telefono_clave = v_tel_clave
      and creado_en > now() - interval '24 hours';

    if v_recientes >= 3 then
      raise exception 'Ya hay varias solicitudes de contacto desde este teléfono. Alguien de la clínica te va a llamar.';
    end if;

    select id into v_paciente
    from public.pacientes
    where clinica_id = v_clinica and telefono_clave = v_tel_clave
    limit 1;
  end if;

  select r.destino_rol, r.vence_en into v_ruta
  from public.rutear_escalacion(v_clinica, p_motivo, coalesce(p_urgencia, 'normal')) r;

  insert into public.escalaciones (
    clinica_id, conversacion_id, paciente_id, canal_origen,
    contacto_nombre, contacto_telefono, contacto_email,
    motivo, urgencia, resumen, destino_rol, vence_en
  ) values (
    v_clinica, p_conversacion_id, v_paciente, coalesce(p_canal, 'medibot'),
    coalesce(p_nombre, ''), coalesce(p_telefono, ''), coalesce(p_email, ''),
    p_motivo, coalesce(p_urgencia, 'normal'), coalesce(p_resumen, ''),
    v_ruta.destino_rol, v_ruta.vence_en
  )
  returning id into v_id;

  if p_conversacion_id is not null then
    update public.conversaciones
       set estado = 'requiere_atencion_humana'
     where id = p_conversacion_id and clinica_id = v_clinica;
  end if;

  select zona_horaria into v_tz from public.clinicas where id = v_clinica;
  v_abierto := public.en_horario(v_clinica);
  v_prox    := public.proxima_apertura(v_clinica);

  return jsonb_build_object(
    'id',            v_id,
    'destino',       v_ruta.destino_rol,
    'urgencia',      coalesce(p_urgencia, 'normal'),
    'abiertoAhora',  v_abierto,
    'atencionEn',    case when v_abierto then null else v_prox end,

    -- Lo que de verdad se le dice al paciente. Ya en la zona de la
    -- clínica y en palabras, para que nadie tenga que convertirlo.
    'atencionEnTexto',
      case when v_abierto then null
           else public.fecha_en_palabras(v_prox, v_tz) end,

    'esEmergencia',  p_motivo = 'urgencia_medica',
    'instruccion',
      case
        when p_motivo = 'urgencia_medica' then
          'ANTES QUE NADA dile que si es una emergencia llame al 911 o vaya a urgencias AHORA, sin esperar respuesta. Después confirma que ya avisaste a la clínica.'
        when v_abierto then
          'Confirma que ya avisaste y que en unos minutos lo contactan.'
        when v_prox is not null then
          'Confirma que ya avisaste y di que lo contactan el ' ||
          public.fecha_en_palabras(v_prox, v_tz) ||
          '. Copia esa hora TAL CUAL, en el campo atencionEnTexto. No la conviertas, no la redondees y no le sumes margen: ya viene en la hora local de la clínica.'
        else
          'Confirma que ya avisaste. NO prometas una hora: el consultorio no tiene horario cargado y sería inventarla.'
      end
  );
end;
$$;

revoke all on function public.escalar_a_humano   from public;
revoke all on function public.fecha_en_palabras  from public;
grant execute on function public.escalar_a_humano  to anon, authenticated;
grant execute on function public.fecha_en_palabras to authenticated;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0012_doble_reserva.sql                                         ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0013_permisos_de_funciones.sql                                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0013 — Las funciones que nadie debería alcanzar
--
-- Desde 0006 los permisos se escribieron así:
--
--     revoke all on function public.lo_que_sea from public;
--     grant execute on function public.lo_que_sea to authenticated;
--
-- Y no servía de nada. `revoke ... from public` quita el permiso del
-- pseudo-rol PUBLIC, pero en Supabase toda función nueva de `public` nace
-- con EXECUTE concedido DIRECTAMENTE a `anon` y `authenticated`, por las
-- default privileges del proyecto. Un permiso concedido a `anon` no se
-- quita revocándoselo a PUBLIC.
--
-- Resultado real, medido: `anon` podía ejecutar las 29 funciones del
-- esquema. La mayoría es inofensiva —son SECURITY INVOKER y RLS las
-- contiene, o solo devuelven null sin sesión— pero dos no lo eran:
--
--   · `encolar_aviso_escalacion(id, motivo)` es SECURITY DEFINER y encola
--     correo. La anon key va escrita en el HTML de la landing, así que
--     cualquiera podía llamarla en bucle y vaciar la cuota de EmailJS de
--     la clínica, mandándole basura a su propio personal.
--
--   · `promover_escalaciones()` es SECURITY DEFINER y escribe: sube
--     niveles, marca `vencida` y toca conversaciones. Es del reloj, y el
--     reloj es pg_cron.
--
-- Esta migración cierra eso y fija la convención. De aquí en adelante:
-- revocar de PUBLIC, de `anon` y de `authenticated`, y después conceder a
-- quien de verdad la necesita. tests/db-permisos.test.mjs recorre el
-- esquema entero y falla si aparece una función nueva sin decidir a qué
-- lado pertenece.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Del reloj, y de nadie más ─────────────────────────────────────────
-- pg_cron corre como dueño de la base, así que no necesita concesión: por
-- eso estas dos pueden quedarse sin un solo rol con permiso.
revoke all on function public.promover_escalaciones()          from public, anon, authenticated;
revoke all on function public.encolar_aviso_escalacion(uuid, text) from public, anon, authenticated;

-- ─── Del personal con sesión ───────────────────────────────────────────
-- Ninguna es un agujero por sí sola —son SECURITY INVOKER y RLS decide—
-- pero ofrecerle al visitante una función para reescribir el horario de la
-- clínica es exactamente el error que ya cometimos con las herramientas de
-- MediBot: que la base lo frene no vuelve correcto ofrecerlo.
revoke all on function public.guardar_horario_base(jsonb)                  from public, anon;
revoke all on function public.citas_afectadas_por_cierre(date, time, time) from public, anon;
revoke all on function public.horario_del_dia(uuid, date, uuid)            from public, anon;
revoke all on function public.en_horario(uuid, timestamptz)                from public, anon;
revoke all on function public.proxima_apertura(uuid, timestamptz)          from public, anon;
revoke all on function public.horario_texto(uuid)                          from public, anon;
revoke all on function public.escalacion_reconocer(uuid)                   from public, anon;
revoke all on function public.escalacion_resolver(uuid, text)              from public, anon;
revoke all on function public.rutear_escalacion(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.horas_ocupadas(text, date)                   from public, anon;
revoke all on function public.slot_ocupado(uuid, text, date, text, uuid)   from public, anon;

-- 0006 ya decía que estas dos eran "solo para usuarios con sesión". Ahora
-- lo es de verdad.
revoke all on function public.clinica_actual() from public, anon;
revoke all on function public.rol_actual()     from public, anon;

-- Detalle interno de las funciones SECURITY DEFINER que la llaman. Una
-- función DEFINER corre con los permisos de su dueño, así que quitarle el
-- acceso a `anon` no rompe a `solicitar_cita` ni a `escalar_a_humano`.
revoke all on function public.clinica_unica()                     from public, anon;
revoke all on function public.fecha_en_palabras(timestamptz, text) from public, anon;
revoke all on function public.generar_folio_cita()                from public, anon;
revoke all on function public.generar_codigo_paciente()           from public, anon;

-- ─── Funciones de disparador ───────────────────────────────────────────
-- Llamarlas fuera de un disparador falla de todas formas, pero no tienen
-- por qué estar ofrecidas.
revoke all on function public.tocar_actualizado_en()             from public, anon, authenticated;
revoke all on function public.sincronizar_resumen_conversacion() from public, anon, authenticated;

-- ═══ Lo que el visitante sin cuenta SÍ debe alcanzar ═══════════════════
-- Se vuelve a conceder explícitamente, para que esta lista quede escrita
-- en un solo lugar y se pueda leer de corrido. Son seis puertas y cada una
-- valida por dentro:
--
--   solicitar_cita          pedir cita desde la landing
--   responder_encuesta      contestar el NPS con el folio como credencial
--   encuesta_ya_respondida  la pantalla previa de la encuesta
--   horario_disponible      no ofrecer un día en que el consultorio cierra
--   horas_ocupadas_publico  no ofrecer una hora ya tomada
--   escalar_a_humano        pedir una persona sin tener cuenta
grant execute on function public.solicitar_cita(
  text, text, text, text, text, text, date, text, text, text, boolean, text, text, uuid
) to anon, authenticated;
grant execute on function public.responder_encuesta(text, smallint, text) to anon, authenticated;
grant execute on function public.encuesta_ya_respondida(text)             to anon, authenticated;
grant execute on function public.horario_disponible(date, date, uuid)     to anon, authenticated;
grant execute on function public.horas_ocupadas_publico(text, date, uuid) to anon, authenticated;
grant execute on function public.escalar_a_humano(
  text, text, text, text, text, text, text, uuid, uuid
) to anon, authenticated;

-- Normalizadores puros: cero acceso a datos, y los necesita el motor para
-- evaluar las columnas generadas de citas y pacientes.
grant execute on function public.clave_telefono(text) to anon, authenticated;
grant execute on function public.clave_hora(text)     to anon, authenticated;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0014_avisos_automaticos.sql                                    ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0014 — El reloj puesto a trabajar
--
-- 0004 dejó escrito esto sobre la tabla `seguimientos`:
--
--     "Hoy los envíos de día 3 y 30 son manuales porque no había dónde
--      correr un cron; esta tabla es lo que el trabajo programado va a
--      leer cuando exista."
--
-- Ya existe. La Fase E trajo pg_cron, la bandeja de salida y la función
-- que la vacía. Esta migración le pone un PRODUCTOR: nadie más tiene que
-- acordarse de mandar nada.
--
--   · recordatorio_cita   la víspera de la cita
--   · seguimiento_3d      tres días después de la consulta
--   · seguimiento_30d     al mes
--
-- Lo que NO es esto: contacto proactivo de mercadotecnia. Todo lo que sale
-- de aquí cuelga de una cita que ese paciente pidió. La diferencia importa
-- legalmente —la LFPDPPP trata los datos de salud como sensibles— y es la
-- razón por la que el consentimiento nace en `true`: un recordatorio de la
-- cita que acabas de agendar es parte del servicio, no publicidad. Lo que
-- lo vuelve defendible en la práctica es que la baja sea de un clic, y de
-- eso se encarga `darse_de_baja`.
--
-- Y sigue siendo solo correo. SMS y WhatsApp entran después cambiando el
-- CHECK de `avisos_pendientes.canal` y agregando un remitente en
-- api/avisar.js — para eso se separó la escalera del envío.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── A dónde apunta el enlace ──────────────────────────────────────────
-- El correo de seguimiento lleva el enlace a la encuesta, y el de baja
-- lleva el de la baja. Sin esto habría que incrustar el dominio en la
-- función, y cada clínica vive en su propio despliegue.
alter table public.clinicas
  add column if not exists sitio_url text not null default '';

comment on column public.clinicas.sitio_url is
  'https://… del despliegue de ESTA clínica, sin diagonal final. Sin él no se encolan avisos con enlace.';

-- ─── Consentimiento y salida ───────────────────────────────────────────
-- Dos interruptores y no uno: alguien puede querer que le recuerden su
-- cita —le sirve— y no querer el correo de "¿cómo te fue?". Meterlos en la
-- misma casilla obliga a elegir entre las dos cosas, y casi todos elegirían
-- apagarlo todo.
alter table public.pacientes
  add column if not exists avisa_recordatorios boolean not null default true,
  add column if not exists avisa_seguimientos  boolean not null default true,
  add column if not exists baja_en             timestamptz,
  -- 122 bits al azar, del generador que trae Postgres de fábrica. Se evita
  -- gen_random_bytes() a propósito: es de pgcrypto, y aunque Supabase la
  -- tenga, el esquema tiene que aplicarse contra un Postgres pelón — así
  -- corren las pruebas.
  add column if not exists baja_token          text not null
                             default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists pacientes_baja_token_unico
  on public.pacientes (baja_token);

comment on column public.pacientes.baja_token is
  'Credencial del enlace de baja. Va en cada correo; con ella se puede dar de baja sin iniciar sesión y sin poder ver nada más.';

-- ═══ La bandeja de salida deja de ser solo de escalaciones ═════════════
alter table public.avisos_pendientes
  alter column escalacion_id drop not null;

alter table public.avisos_pendientes
  add column if not exists tipo text not null default 'escalacion',
  add column if not exists cita_id     uuid references public.citas(id)     on delete cascade,
  add column if not exists paciente_id uuid references public.pacientes(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'avisos_pendientes_tipo_valido') then
    alter table public.avisos_pendientes
      add constraint avisos_pendientes_tipo_valido check (tipo in (
        'escalacion', 'recordatorio_cita', 'seguimiento_3d', 'seguimiento_30d'
      ));
  end if;
end $$;

-- ─── Idempotencia, y de aquí cuelga todo el diseño ─────────────────────
-- El productor corre cada hora. Que no duplique NO depende de que el
-- horario sea exacto ni de que nadie lo llame dos veces: depende de este
-- índice. Es lo que permite que el trabajo sea "recórrelo otra vez, por si
-- la vez pasada falló" en lugar de "córrelo exactamente una vez o el
-- paciente recibe el mismo correo cinco veces".
create unique index if not exists avisos_unico_por_cita
  on public.avisos_pendientes (clinica_id, tipo, cita_id)
  where cita_id is not null;

create index if not exists avisos_paciente_idx
  on public.avisos_pendientes (clinica_id, paciente_id, creado_en);

-- ═══ Tope de frecuencia ════════════════════════════════════════════════
-- Aunque cada aviso por separado sea legítimo, tres en una semana ya es
-- ruido y la siguiente acción del paciente es marcar el correo como spam
-- — y eso se lo lleva el dominio entero de la clínica, incluidos los
-- correos que sí quiere.
create or replace function public.puede_recibir_aviso(p_paciente uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_paciente is null or (
    coalesce((select baja_en is null from public.pacientes where id = p_paciente), false)
    and (
      select count(*) < 3
      from public.avisos_pendientes
      where paciente_id = p_paciente
        and tipo <> 'escalacion'
        and creado_en > now() - interval '7 days'
    )
  );
$$;

comment on function public.puede_recibir_aviso is
  'Tope de 3 avisos automáticos por paciente cada 7 días, y respeta la baja. No aplica a escalaciones: esas van al personal.';

-- ═══ Pie de todos los correos automáticos ══════════════════════════════
create or replace function public.pie_de_aviso(p_clinica uuid, p_paciente uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_url   text;
  v_token text;
  v_nom   text;
begin
  select sitio_url, nombre_clinica into v_url, v_nom
  from public.clinicas where id = p_clinica;

  select baja_token into v_token from public.pacientes where id = p_paciente;

  if coalesce(v_url, '') = '' or v_token is null then
    /* Sin enlace de baja no se manda un correo automático. Es la línea que
       separa "seguimiento del servicio" de "correo del que no te puedes
       bajar", y sin ella lo segundo es lo que sale. */
    return null;
  end if;

  return E'\n\n—\n' || coalesce(v_nom, 'Tu clínica') ||
         E'\nSi no quieres recibir estos correos, cancélalos aquí: ' ||
         v_url || '/baja.html?t=' || v_token;
end;
$$;

-- ═══ Productor 1: recordatorio de la cita ══════════════════════════════
create or replace function public.encolar_recordatorios(p_clinica uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_manana date;
  v_c     record;
  v_pie   text;
  v_n     int := 0;
begin
  select zona_horaria into v_tz from public.clinicas where id = p_clinica and activa;
  if v_tz is null then return 0; end if;

  v_manana := ((now() at time zone v_tz)::date) + 1;

  for v_c in
    select c.*, cl.nombre_clinica, cl.telefono as tel_clinica
    from public.citas c
    join public.clinicas cl on cl.id = c.clinica_id
    where c.clinica_id = p_clinica
      and c.fecha = v_manana
      and c.estado in ('pendiente', 'confirmada')
      and coalesce(c.email, '') <> ''
      and c.paciente_id is not null
      -- El interruptor del paciente, no una preferencia global.
      and exists (select 1 from public.pacientes p
                  where p.id = c.paciente_id and p.avisa_recordatorios and p.baja_en is null)
      and public.puede_recibir_aviso(c.paciente_id)
  loop
    v_pie := public.pie_de_aviso(p_clinica, v_c.paciente_id);
    continue when v_pie is null;

    begin
      insert into public.avisos_pendientes (
        clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
      ) values (
        p_clinica, 'recordatorio_cita', v_c.id, v_c.paciente_id, 'email', v_c.email,
        'Recordatorio: tu cita es mañana',
        'Hola ' || coalesce(nullif(v_c.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
        'Te recordamos tu cita de mañana:' || E'\n\n' ||
        '  Fecha: '  || to_char(v_c.fecha, 'DD/MM/YYYY') ||
          case when coalesce(v_c.hora, '') <> '' then ' a las ' || v_c.hora else '' end || E'\n' ||
        '  Médico: ' || coalesce(nullif(v_c.doctor, ''), 'por asignar') || E'\n' ||
        '  Folio: '  || v_c.folio || E'\n\n' ||
        'Si no puedes asistir, avísanos' ||
          case when coalesce(v_c.tel_clinica, '') <> ''
               then ' al ' || v_c.tel_clinica else '' end ||
        ' para dársela a alguien más.' || v_pie
      );
      v_n := v_n + 1;
    exception when unique_violation then
      -- Ya se encoló en una corrida anterior de hoy. Es lo esperado.
      null;
    end;
  end loop;

  return v_n;
end;
$$;

-- ═══ Productor 2: seguimiento post-consulta ════════════════════════════
create or replace function public.encolar_seguimientos(p_clinica uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz   text;
  v_url  text;
  v_hoy  date;
  v_s    record;
  v_pie  text;
  v_tipo text;
  v_n    int := 0;
begin
  select zona_horaria, sitio_url into v_tz, v_url
  from public.clinicas where id = p_clinica and activa;
  if v_tz is null then return 0; end if;

  v_hoy := (now() at time zone v_tz)::date;

  for v_s in
    select s.id as seg_id, s.email_enviado_3d, s.email_enviado_30d, s.fecha_atendida,
           c.id as cita_id, c.paciente_id, c.email, c.nombre, c.folio, c.doctor
    from public.seguimientos s
    join public.citas c on c.id = s.cita_id
    where s.clinica_id = p_clinica
      and coalesce(c.email, '') <> ''
      and c.paciente_id is not null
      and (
        (s.fecha_atendida = v_hoy - 3  and not s.email_enviado_3d) or
        (s.fecha_atendida = v_hoy - 30 and not s.email_enviado_30d)
      )
      and exists (select 1 from public.pacientes p
                  where p.id = c.paciente_id and p.avisa_seguimientos and p.baja_en is null)
      and public.puede_recibir_aviso(c.paciente_id)
  loop
    v_tipo := case when v_s.fecha_atendida = v_hoy - 3
                   then 'seguimiento_3d' else 'seguimiento_30d' end;

    v_pie := public.pie_de_aviso(p_clinica, v_s.paciente_id);
    continue when v_pie is null;

    begin
      insert into public.avisos_pendientes (
        clinica_id, tipo, cita_id, paciente_id, canal, destinatario, asunto, cuerpo
      ) values (
        p_clinica, v_tipo, v_s.cita_id, v_s.paciente_id, 'email', v_s.email,
        case when v_tipo = 'seguimiento_3d'
             then '¿Cómo te has sentido?'
             else 'Ya pasó un mes de tu consulta' end,
        'Hola ' || coalesce(nullif(v_s.nombre, ''), 'qué tal') || ',' || E'\n\n' ||
        case when v_tipo = 'seguimiento_3d' then
          'Han pasado unos días desde tu consulta' ||
          case when coalesce(v_s.doctor, '') <> '' then ' con ' || v_s.doctor else '' end ||
          '. Queremos saber cómo te has sentido.' || E'\n\n' ||
          'Si sigues con molestias o tienes dudas sobre tu tratamiento, responde este ' ||
          'correo o llámanos: no esperes a la siguiente cita.'
        else
          'Ya pasó un mes de tu consulta. Si tu tratamiento terminó y todo va bien, ' ||
          'nos alegra saberlo.' || E'\n\n' ||
          'Si quedó algo pendiente o quieres una revisión de control, con gusto te agendamos.'
        end || E'\n\n' ||
        'Cuéntanos cómo te fue en un minuto: ' || v_url || '/encuesta.html?folio=' || v_s.folio ||
        v_pie
      );

      /* Se marca al ENCOLAR, no al entregar. Si el correo falla,
         avisos_pendientes tiene sus propios cinco reintentos; volver a
         encolarlo cada hora desde aquí sería una segunda cola, sin tope. */
      if v_tipo = 'seguimiento_3d'
        then update public.seguimientos set email_enviado_3d = true, enviado_3d_en = now()
             where id = v_s.seg_id;
        else update public.seguimientos set email_enviado_30d = true, enviado_30d_en = now()
             where id = v_s.seg_id;
      end if;

      v_n := v_n + 1;
    exception when unique_violation then
      null;
    end;
  end loop;

  return v_n;
end;
$$;

-- ═══ El barrido, que es lo que llama pg_cron ═══════════════════════════
create or replace function public.encolar_avisos_del_dia()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cl  record;
  v_hora int;
  v_n   int := 0;
begin
  for v_cl in select id, zona_horaria from public.clinicas where activa loop
    /* La hora LOCAL de esa clínica, no la del servidor. Supabase corre en
       UTC: sin convertir, a un consultorio de Tijuana le saldrían los
       correos a las 2 de la mañana. */
    v_hora := extract(hour from (now() at time zone v_cl.zona_horaria))::int;

    -- Ventana amplia a propósito. Lo que evita duplicados es el índice
    -- único, no la puntualidad, así que el barrido puede correr muchas
    -- veces: si a las 8 la base estaba caída, a las 9 se recupera solo.
    continue when v_hora < 8 or v_hora > 20;

    v_n := v_n
         + public.encolar_recordatorios(v_cl.id)
         + public.encolar_seguimientos(v_cl.id);
  end loop;

  return v_n;
end;
$$;

comment on function public.encolar_avisos_del_dia is
  'Productor de avisos automáticos. Lo llama pg_cron cada hora; es idempotente por el índice avisos_unico_por_cita.';

-- ═══ La salida fácil ═══════════════════════════════════════════════════
-- Sin sesión, con el token del correo como única credencial. No devuelve
-- nada que sirva para identificar a nadie más allá del nombre de pila —
-- suficiente para que la página diga a quién está dando de baja, y nada
-- más. El token es el mismo criterio que el folio en la encuesta: quien lo
-- tiene es porque recibió el correo.
create or replace function public.consultar_baja(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p record;
begin
  select p.nombre, p.avisa_recordatorios, p.avisa_seguimientos, p.baja_en,
         cl.nombre_clinica
  into v_p
  from public.pacientes p
  join public.clinicas cl on cl.id = p.clinica_id
  where p.baja_token = trim(p_token);

  if not found then
    return jsonb_build_object('valido', false);
  end if;

  return jsonb_build_object(
    'valido', true,
    'nombre', v_p.nombre,
    'clinica', v_p.nombre_clinica,
    'recordatorios', v_p.avisa_recordatorios and v_p.baja_en is null,
    'seguimientos',  v_p.avisa_seguimientos  and v_p.baja_en is null,
    'dadoDeBaja', v_p.baja_en is not null
  );
end;
$$;

create or replace function public.darse_de_baja(
  p_token   text,
  p_alcance text default 'todo'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_alcance not in ('todo', 'seguimientos', 'reactivar') then
    raise exception 'Alcance no válido';
  end if;

  select id into v_id from public.pacientes where baja_token = trim(p_token);
  if v_id is null then
    raise exception 'Ese enlace ya no es válido. Escríbenos y lo resolvemos.';
  end if;

  if p_alcance = 'todo' then
    update public.pacientes
      set baja_en = now(), avisa_recordatorios = false, avisa_seguimientos = false
      where id = v_id;

  elsif p_alcance = 'seguimientos' then
    -- Solo el "¿cómo te fue?". Conserva el recordatorio de la cita, que es
    -- lo que la mayoría quiere seguir recibiendo.
    update public.pacientes
      set baja_en = null, avisa_seguimientos = false, avisa_recordatorios = true
      where id = v_id;

  else
    update public.pacientes
      set baja_en = null, avisa_seguimientos = true, avisa_recordatorios = true
      where id = v_id;
  end if;

  /* Lo que ya estaba encolado y no ha salido, se cancela. Dar de baja y
     que al minuto llegue un correo más es exactamente lo que hace que la
     gente deje de creerle al enlace. */
  update public.avisos_pendientes
    set estado = 'fallido', ultimo_error = 'cancelado por baja del paciente'
    where paciente_id = v_id and estado = 'pendiente' and tipo <> 'escalacion';

  return public.consultar_baja(p_token);
end;
$$;

comment on function public.darse_de_baja is
  'Baja sin sesión con el token del correo. Cancela además lo que ya estuviera encolado.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
-- Convención de 0013: revocar de los tres y conceder a quien la necesita.
revoke all on function public.encolar_avisos_del_dia()      from public, anon, authenticated;
revoke all on function public.encolar_recordatorios(uuid)   from public, anon, authenticated;
revoke all on function public.encolar_seguimientos(uuid)    from public, anon, authenticated;
revoke all on function public.pie_de_aviso(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.puede_recibir_aviso(uuid)     from public, anon;

revoke all on function public.consultar_baja(text)       from public, anon, authenticated;
revoke all on function public.darse_de_baja(text, text)  from public, anon, authenticated;

-- Las dos puertas nuevas del visitante sin cuenta. La baja tiene que
-- funcionar sin sesión: exigirle una cuenta a alguien para dejar de
-- escribirle es no dejar que se vaya.
grant execute on function public.consultar_baja(text)      to anon, authenticated;
grant execute on function public.darse_de_baja(text, text) to anon, authenticated;

grant execute on function public.puede_recibir_aviso(uuid) to authenticated;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0015_sitio_url_publica.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0015 — `sitio_url` sale por la vista pública
--
-- Para que `npm run db:verificar` pueda comprobar algo que 0014 no puede
-- ver desde dentro de la base: que la URL a la que apuntan los correos
-- automáticos sea un despliegue con las credenciales puestas.
--
-- El caso real que lo motivó: `sitio_url` estaba bien escrita y apuntaba a
-- un despliegue que existía y respondía… pero con las etiquetas <meta> en
-- marcador, así que ese despliegue corre en modo local. El enlace de baja
-- de cada correo abría una página que buscaba al paciente en el
-- localStorage del visitante y contestaba "enlace no válido".
--
-- Nada de eso se ve leyendo el SQL ni el HTML por separado. Solo aparece
-- cuando un paciente hace clic — y ahí ya es tarde.
--
-- Y hay un caso peor que la misma comprobación caza: que `sitio_url`
-- apunte al despliegue de OTRA clínica. Eso no da error en ninguna parte;
-- simplemente los pacientes de una acaban dándose de baja en la base de la
-- otra.
--
-- Exponerla no filtra nada: es la dirección del sitio público, y quien lee
-- la vista con la llave pública está justamente ahí.
-- ═══════════════════════════════════════════════════════════════════════

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
    zona_horaria, sitio_url
  from public.clinicas
  where activa;

grant select on public.clinica_publica to anon;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0016_mis_citas.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════
-- 0016 — "Mis citas": el paciente consulta y cancela la suya
--
-- Hasta aquí, un paciente que no podía ir solo tenía dos salidas: llamar a
-- la clínica en horario de oficina, o no avisar. La segunda es gratis y es
-- la que casi todos eligen — y eso es exactamente un no-show, que la
-- pestaña de Analytics ya mide sin poder hacer nada al respecto.
--
-- Cancelar con un clic no es una comodidad: es la única forma de que ese
-- hueco vuelva a la agenda a tiempo para dárselo a alguien más. El índice
-- `citas_slot_unico` de 0012 excluye `cancelada`, así que liberar el hueco
-- ya funciona solo.
--
-- ── La credencial ──────────────────────────────────────────────────────
-- Folio Y teléfono, los dos. Ni uno solo alcanza:
--
--   · el folio viaja en cada correo, así que quien intercepte uno lo tiene;
--   · el teléfono lo sabe cualquiera que conozca al paciente, y probar
--     números al azar contra una lista de folios sería trivial.
--
-- Juntos, quien puede cancelar es quien recibió el correo Y sabe con qué
-- número se agendó. Es el mismo criterio que `responder_encuesta` con el
-- folio, subido un escalón porque esto sí modifica la agenda.
--
-- Y nunca se dice si el folio existe: un folio malo y un teléfono que no
-- corresponde dan el mismo mensaje. Distinguirlos convertiría esto en un
-- oráculo para adivinar folios.
--
-- ── Por qué estas dos devuelven el error en vez de lanzarlo ────────────
-- Porque `raise exception` aborta la transacción entera, y con ella el
-- INSERT en la bitácora de intentos. El freno de abuso quedaba escrito,
-- parecía correcto, y no podía contar nada: cada fallo se registraba y se
-- deshacía en el mismo suspiro. Lo cazó la prueba, no la lectura.
--
-- Así que el contrato es `{ ok: true, … }` o `{ ok: false, error: "…" }`.
-- Las excepciones se quedan solo para lo que no necesita dejar rastro.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Quién canceló y por qué ───────────────────────────────────────────
-- No es lo mismo que cancele el paciente que que cancele recepción, y la
-- clínica necesita distinguirlo: un paciente que cancela avisa, uno al que
-- recepción cancela por otra razón es otra conversación. Sin esta columna,
-- las dos cosas se ven idénticas en la tabla.
alter table public.citas
  add column if not exists cancelada_por text,
  add column if not exists motivo_cancelacion text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'citas_cancelada_por_valido') then
    alter table public.citas
      add constraint citas_cancelada_por_valido
        check (cancelada_por is null or cancelada_por in ('paciente', 'clinica'));
  end if;
end $$;

comment on column public.citas.cancelada_por is
  'Quién la canceló. NULL mientras no esté cancelada. Un paciente que avisa no es lo mismo que una cancelación del consultorio.';

-- ─── Freno de abuso ────────────────────────────────────────────────────
-- La anon key es pública, así que esta función se puede llamar en bucle
-- probando folios. Se registran los intentos FALLIDOS por teléfono para
-- poder cortar; los aciertos no se limitan, porque alguien consultando su
-- propia cita varias veces no está haciendo nada malo.
create table if not exists public.intentos_mis_citas (
  id         bigserial primary key,
  clinica_id uuid not null references public.clinicas(id) on delete cascade,
  tel_clave  text not null,
  creado_en  timestamptz not null default now()
);

create index if not exists intentos_mis_citas_idx
  on public.intentos_mis_citas (clinica_id, tel_clave, creado_en);

alter table public.intentos_mis_citas enable row level security;

/* Nadie tiene política: es una bitácora interna de la que solo escriben las
   funciones SECURITY DEFINER de abajo. Ni el personal necesita leerla. */

comment on table public.intentos_mis_citas is
  'Intentos fallidos de "Mis citas", para frenar el barrido de folios. Sin políticas: solo la tocan las funciones SECURITY DEFINER.';

-- ─── El resolvedor: ¿de quién es esta pareja folio + teléfono? ─────────
create or replace function public.paciente_de_folio(
  p_folio    text,
  p_telefono text,
  p_clinica  uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clave text;
  v_pac   uuid;
begin
  v_clave := public.clave_telefono(p_telefono);
  if length(v_clave) < 10 or coalesce(trim(p_folio), '') = '' then
    return null;
  end if;

  /* Se cruza por el teléfono DE LA CITA y no por el del expediente: es el
     número con el que se agendó, que es lo que el paciente recuerda. Si
     después actualizó su teléfono en el expediente, el viejo sigue
     sirviendo para el folio viejo — y eso es lo correcto. */
  select c.paciente_id into v_pac
  from public.citas c
  where c.clinica_id = p_clinica
    and upper(trim(c.folio)) = upper(trim(p_folio))
    and c.telefono_clave = v_clave;

  return v_pac;
end;
$$;

-- ═══ Consultar mis citas ═══════════════════════════════════════════════
create or replace function public.mis_citas(
  p_folio      text,
  p_telefono   text,
  p_clinica_id uuid default null
)
returns jsonb
language plpgsql
volatile                      -- escribe en la bitácora de intentos
security definer
set search_path = public
as $$
declare
  v_clinica  uuid;
  v_clave    text;
  v_pac      uuid;
  v_fallidos int;
  v_citas    jsonb;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());
  v_clave   := public.clave_telefono(p_telefono);

  if length(v_clave) < 10 then
    return jsonb_build_object('ok', false, 'error', 'El teléfono debe tener 10 dígitos.');
  end if;

  -- Diez fallos en una hora desde el mismo número es un script, no alguien
  -- que no se acuerda de su folio.
  select count(*) into v_fallidos
  from public.intentos_mis_citas
  where clinica_id = v_clinica
    and tel_clave = v_clave
    and creado_en > now() - interval '1 hour';

  if v_fallidos >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Llámanos y te ayudamos.');
  end if;

  v_pac := public.paciente_de_folio(p_folio, p_telefono, v_clinica);

  if v_pac is null then
    insert into public.intentos_mis_citas (clinica_id, tel_clave) values (v_clinica, v_clave);
    /* Se DEVUELVE, no se lanza: una excepción desharía el insert de arriba
       en la misma transacción y el freno no podría contar nada.

       Mismo mensaje para folio inexistente y teléfono que no corresponde.
       Distinguirlos volvería esto un oráculo para adivinar folios. */
    return jsonb_build_object(
      'ok', false,
      'error', 'No encontramos ninguna cita con esos datos. Revísalos, por favor.'
    );
  end if;

  /* Se devuelven las citas de ESE paciente, no solo la del folio: quien
     probó los dos factores ya demostró ser esa persona, y lo que va a
     querer ver es su próxima cita, no la del correo que abrió.

     La ventana empieza 30 días atrás para que quepa la consulta reciente
     —"¿qué me dijo el doctor el martes?"— sin volcarle el historial de
     años, que aquí no le sirve de nada. */
  select coalesce(jsonb_agg(x order by x->>'fecha', x->>'hora'), '[]'::jsonb) into v_citas
  from (
    select jsonb_build_object(
             'folio',        c.folio,
             'fecha',        c.fecha,
             'hora',         c.hora,
             'especialidad', c.especialidad,
             'doctor',       c.doctor,
             'tipo',         c.tipo,
             'estado',       c.estado,
             'cancelable',   c.estado in ('pendiente', 'confirmada')
                             and c.fecha > (now() at time zone
                                   (select zona_horaria from public.clinicas where id = v_clinica))::date
           ) as x
    from public.citas c
    where c.clinica_id = v_clinica
      and c.paciente_id = v_pac
      and c.fecha >= current_date - 30
  ) t;

  return jsonb_build_object(
    'ok', true,
    'nombre', (select nombre from public.pacientes where id = v_pac),
    'citas',  v_citas
  );
end;
$$;

comment on function public.mis_citas is
  'Citas del paciente dueño de esa pareja folio + teléfono. No revela si el folio existe.';

-- ═══ Cancelar mi cita ══════════════════════════════════════════════════
create or replace function public.cancelar_mi_cita(
  p_folio      text,
  p_telefono   text,
  p_motivo     text default '',
  p_clinica_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinica uuid;
  v_pac     uuid;
  v_c       record;
  v_hoy     date;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());
  v_pac     := public.paciente_de_folio(p_folio, p_telefono, v_clinica);

  if v_pac is null then
    insert into public.intentos_mis_citas (clinica_id, tel_clave)
      values (v_clinica, public.clave_telefono(p_telefono));
    -- Se devuelve para que el insert de arriba sobreviva. Ver la nota de
    -- la cabecera del archivo.
    return jsonb_build_object(
      'ok', false,
      'error', 'No encontramos ninguna cita con esos datos. Revísalos, por favor.'
    );
  end if;

  select * into v_c
  from public.citas
  where clinica_id = v_clinica and upper(trim(folio)) = upper(trim(p_folio));

  if v_c.estado = 'cancelada' then
    /* No es un error: es alguien que le dio dos veces al botón, o que
       abrió el correo viejo. Reventar aquí lo dejaría creyendo que su
       cancelación no funcionó. */
    return jsonb_build_object('ok', true, 'folio', v_c.folio, 'yaEstaba', true);
  end if;

  if v_c.estado = 'atendida' then
    return jsonb_build_object('ok', false, 'error', 'Esa consulta ya se realizó, no se puede cancelar.');
  end if;

  v_hoy := (now() at time zone
             (select zona_horaria from public.clinicas where id = v_clinica))::date;

  /* La cita de hoy NO se cancela desde aquí, y es a propósito: a estas
     horas el consultorio ya organizó el día alrededor de ese hueco, y una
     cancelación silenciosa a las 8:55 para una cita de las 9:00 es peor que
     una llamada. Se le pide que llame. */
  if v_c.fecha <= v_hoy then
    return jsonb_build_object(
      'ok', false,
      'error', 'Tu cita es hoy o ya pasó. Llámanos para cancelarla, por favor.'
    );
  end if;

  update public.citas
    set estado = 'cancelada',
        cancelada_por = 'paciente',
        motivo_cancelacion = left(coalesce(trim(p_motivo), ''), 300)
    where id = v_c.id;

  /* El recordatorio que ya estuviera encolado se cancela: recibir "tu cita
     es mañana" después de haberla cancelado es lo que hace que nadie vuelva
     a confiar en estos correos. */
  update public.avisos_pendientes
    set estado = 'fallido', ultimo_error = 'cita cancelada por el paciente'
    where cita_id = v_c.id and estado = 'pendiente';

  return jsonb_build_object(
    'ok', true,
    'folio', v_c.folio,
    'fecha', v_c.fecha,
    'hora',  v_c.hora
  );
end;
$$;

comment on function public.cancelar_mi_cita is
  'Cancela una cita futura con folio + teléfono. Libera el hueco (citas_slot_unico excluye cancelada) y anula el recordatorio encolado.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
-- Convención de 0013: revocar de los tres y conceder a quien la necesita.
revoke all on function public.paciente_de_folio(text, text, uuid) from public, anon, authenticated;
revoke all on function public.mis_citas(text, text, uuid)         from public, anon, authenticated;
revoke all on function public.cancelar_mi_cita(text, text, text, uuid) from public, anon, authenticated;

-- Las dos puertas nuevas del paciente sin cuenta. `paciente_de_folio` NO:
-- es el resolvedor interno, y ofrecerlo sería ofrecer un comprobador de
-- parejas folio+teléfono sin el freno de abuso que sí tienen las otras dos.
grant execute on function public.mis_citas(text, text, uuid)            to anon, authenticated;
grant execute on function public.cancelar_mi_cita(text, text, text, uuid) to anon, authenticated;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0017_reactivacion.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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
