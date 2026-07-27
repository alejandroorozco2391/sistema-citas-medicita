/* ═══════════════════════════════════════════════════════════════════════
   Arnés de pruebas de base de datos.

   Levanta un Postgres real (pglite, compilado a WebAssembly) y le pone
   encima lo que Supabase da por hecho: el esquema `auth`, la función
   auth.uid(), los roles `anon` y `authenticated`, y los permisos por
   omisión sobre el esquema public.

   Eso último importa entender: en Supabase, toda tabla nueva de `public`
   queda con permisos concedidos a anon y authenticated. Lo único que
   impide que un anónimo lea la base entera es RLS. Por eso el arnés
   reproduce esa concesión — para que las pruebas midan la seguridad real
   y no una falsa sensación por falta de permisos.
   ═══════════════════════════════════════════════════════════════════════ */

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_MIGRACIONES = path.join(AQUI, "..", "supabase", "migrations");

export function migraciones() {
  return fs
    .readdirSync(DIR_MIGRACIONES)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

/** Postgres limpio, con el entorno de Supabase simulado y las migraciones aplicadas. */
export async function crearBase({ aplicarMigraciones = true } = {}) {
  const db = new PGlite();

  await db.exec(`
    create schema if not exists auth;

    create table auth.users (
      id    uuid primary key,
      email text unique
    );

    -- En Supabase lee el JWT; aquí, un parámetro de sesión.
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon')
        then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated')
        then create role authenticated nologin; end if;
    end $$;

    grant usage on schema public to anon, authenticated;
    grant usage on schema auth   to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant select on auth.users to authenticated;

    -- Igual que Supabase: las tablas nuevas nacen con permisos, y RLS es
    -- lo único que decide qué ve cada quien.
    alter default privileges in schema public grant all on tables    to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);

  if (aplicarMigraciones) {
    for (const archivo of migraciones()) {
      const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, archivo), "utf8");
      try {
        await db.exec(sql);
      } catch (e) {
        throw new Error(`Falló la migración ${archivo}: ${e.message}`);
      }
    }
  }

  return db;
}

/* ─── Ejecutar con distinta identidad ─────────────────────────────────── */

/** Como un usuario con sesión iniciada. Sujeto a RLS. */
export async function comoUsuario(db, usuarioId, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [usuarioId]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Como un visitante sin cuenta (la anon key del navegador). Sujeto a RLS. */
export async function comoAnonimo(db, fn) {
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/* ─── Semilla ─────────────────────────────────────────────────────────── */

/**
 * Crea una clínica con su equipo. Se ejecuta como superusuario, igual que
 * el aprovisionamiento real usa la service role key para poner la primera
 * piedra — es el único momento en que algo pasa por encima de RLS.
 */
export async function sembrarClinica(db, { nombre, sufijo }) {
  const { rows: [clinica] } = await db.query(
    "insert into clinicas (nombre_clinica, ciudad) values ($1, $2) returning id",
    [nombre, "CDMX"]
  );

  const usuarios = {};
  for (const rol of ["admin", "doctor", "recepcionista"]) {
    const { rows: [u] } = await db.query(
      "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
      [`${rol}${sufijo}@ejemplo.mx`]
    );
    await db.query(
      `insert into perfiles_staff (usuario_id, clinica_id, nombre, rol)
       values ($1, $2, $3, $4)`,
      [u.id, clinica.id, `${rol} ${sufijo}`, rol]
    );
    usuarios[rol] = u.id;
  }

  const { rows: [paciente] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono)
     values ($1, $2, $3, $4, $5) returning id`,
    [clinica.id, `PAC-TEST-${sufijo}`, "Paciente", `De ${nombre}`, `55 0000 ${sufijo}${sufijo}${sufijo}${sufijo}`]
  );

  const { rows: [cita] } = await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, fecha, especialidad)
     values ($1, $2, $3, $4, $5, current_date + 1, 'Medicina General') returning id, folio`,
    [clinica.id, paciente.id, `CIT-TEST-${sufijo}`, "Paciente", `55 0000 ${sufijo}${sufijo}${sufijo}${sufijo}`]
  );

  const { rows: [conversacion] } = await db.query(
    `insert into conversaciones (clinica_id, paciente_id, canal, telefono, nombre_contacto)
     values ($1, $2, 'whatsapp', $3, 'Paciente') returning id`,
    [clinica.id, paciente.id, `55 0000 ${sufijo}${sufijo}${sufijo}${sufijo}`]
  );

  await db.query(
    `insert into mensajes (clinica_id, conversacion_id, remitente, contenido)
     values ($1, $2, 'paciente', $3)`,
    [clinica.id, conversacion.id, `Mensaje secreto de ${nombre}`]
  );

  await db.query(
    `insert into documentos (clinica_id, cita_id, paciente_id, tipo_doc)
     values ($1, $2, $3, 'receta')`,
    [clinica.id, cita.id, paciente.id]
  );

  await db.query(
    `insert into posts (clinica_id, red, caption) values ($1, 'instagram', $2)`,
    [clinica.id, `Post de ${nombre}`]
  );

  await db.query(
    `insert into notas_paciente (clinica_id, paciente_id, texto, autor_nombre)
     values ($1, $2, 'Nota interna confidencial', 'Recepción')`,
    [clinica.id, paciente.id]
  );

  await db.query(
    `insert into nps_respuestas (clinica_id, cita_id, puntuacion, comentario)
     values ($1, $2, 9, 'Muy bien')`,
    [clinica.id, cita.id]
  );

  await db.query(
    `insert into seguimientos (clinica_id, cita_id, fecha_atendida)
     values ($1, $2, current_date)`,
    [clinica.id, cita.id]
  );

  return { clinicaId: clinica.id, usuarios, pacienteId: paciente.id, citaId: cita.id, folio: cita.folio, conversacionId: conversacion.id };
}

/** Tablas con datos de clínica, para recorrerlas en las pruebas de aislamiento. */
export const TABLAS_CON_CLINICA = [
  "pacientes",
  "notas_paciente",
  "citas",
  "seguimientos",
  "nps_respuestas",
  "conversaciones",
  "mensajes",
  "documentos",
  "posts",
];
