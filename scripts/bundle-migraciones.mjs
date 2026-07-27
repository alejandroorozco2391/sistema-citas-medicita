/* Concatena supabase/migrations/*.sql en un solo archivo, para poder
   aplicarlas de un pegado en el editor SQL del panel de Supabase en vez
   de abrir seis archivos.

   El resultado es un artefacto GENERADO: no se edita a mano. La fuente de
   verdad siguen siendo los archivos numerados de supabase/migrations/.

   Uso:  npm run db:bundle
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(RAIZ, "supabase", "migrations");
const SALIDA = path.join(RAIZ, "supabase", "migraciones-completas.sql");

const archivos = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();

const encabezado = `-- ═══════════════════════════════════════════════════════════════════════
-- ARCHIVO GENERADO — no lo edites.
--
-- Es la concatenación de supabase/migrations/*.sql, en orden, para poder
-- aplicar el esquema completo de un solo pegado en el editor SQL del
-- panel de Supabase.
--
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
console.log(`Generado supabase/migraciones-completas.sql (${archivos.length} migraciones, ${kb} KB)`);
