/* Concatena supabase/migrations/*.sql en un solo archivo, para poder
   aplicarlas de un pegado en el editor SQL del panel de Supabase en vez
   de abrir seis archivos.

   El resultado es un artefacto GENERADO: no se edita a mano. La fuente de
   verdad siguen siendo los archivos numerados de supabase/migrations/.

   Uso:
     npm run db:bundle                  → todas (clínica nueva)
     npm run db:bundle -- --desde 0009  → solo de la 0009 en adelante

   El segundo caso es para una clínica que YA está en producción: volver a
   pegar el bundle completo le reventaría, porque las migraciones crean
   tablas sin `if not exists` a propósito — que truene es mejor que
   aplicar dos veces algo a medias sobre una base con expedientes dentro.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(RAIZ, "supabase", "migrations");

/* --desde 0009 · también acepta --desde=0009 y el nombre completo. */
const args = process.argv.slice(2);
const i = args.findIndex(a => a === "--desde" || a.startsWith("--desde="));
const desde = i === -1
  ? null
  : (args[i].includes("=") ? args[i].split("=")[1] : args[i + 1]);

const todos = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();

if (desde && !todos.some(f => f.startsWith(desde))) {
  console.error(`\n✖ No hay ninguna migración que empiece con "${desde}".`);
  console.error(`  Disponibles: ${todos.join(", ")}\n`);
  process.exit(1);
}

const archivos = desde ? todos.filter(f => f >= desde) : todos;

/* El parcial lleva otro nombre y está en .gitignore: depende de en qué
   versión esté cada clínica, así que guardarlo en el repositorio sería
   guardar una foto que envejece sola. */
const SALIDA = path.join(
  RAIZ, "supabase",
  desde ? "migraciones-pendientes.sql" : "migraciones-completas.sql"
);

const encabezado = `-- ═══════════════════════════════════════════════════════════════════════
-- ARCHIVO GENERADO — no lo edites.
--
-- Es la concatenación de supabase/migrations/*.sql, en orden, para poder
-- aplicar el esquema de un solo pegado en el editor SQL del panel de
-- Supabase.
${desde ? `--
-- PARCIAL: solo de ${desde} en adelante. Es para una clínica que ya está
-- corriendo y a la que solo le faltan estas. Si la base está vacía, usa
-- migraciones-completas.sql.
` : ""}--
-- Para cambiar el esquema, edita los archivos numerados y vuelve a correr:
--     npm run db:bundle
--
-- Generado desde: ${archivos.join(" · ")}
-- ═══════════════════════════════════════════════════════════════════════

`;

const cuerpo = archivos
  .map(f => {
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    return `\n-- ╔═══════════════════════════════════════════════════════════════════╗\n` +
           `-- ║  ${f.padEnd(63)}║\n` +
           `-- ╚═══════════════════════════════════════════════════════════════════╝\n\n${sql}`;
  })
  .join("\n");

fs.writeFileSync(SALIDA, encabezado + cuerpo, "utf8");

const kb = (fs.statSync(SALIDA).size / 1024).toFixed(1);
console.log(`Generado ${path.relative(RAIZ, SALIDA).replace(/\\/g, "/")} (${archivos.length} migraciones, ${kb} KB)`);
