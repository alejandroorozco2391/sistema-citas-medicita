/* ═══════════════════════════════════════════════════════════════════════
   Comprobación de un proyecto de Supabase ya desplegado.

   Las pruebas de tests/db-*.test.mjs corren contra un Postgres simulado y
   verifican que el esquema ESTÁ BIEN DISEÑADO. Este script es otra cosa:
   comprueba que el proyecto de verdad, el que va a usar una clínica, ESTÁ
   BIEN APLICADO.

   Lo más importante que hace: intentar leer, con la llave pública, las
   tablas que deberían estar protegidas. Si alguna devuelve renglones,
   RLS no está haciendo su trabajo y esa clínica no puede salir a
   producción.

   Uso:  npm run db:verificar
   Lee la URL y la llave de las etiquetas <meta> de login.html, para no
   tener credenciales duplicadas en dos lugares.
   ═══════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ─── Credenciales ────────────────────────────────────────────────────── */
/* Primero js/config-local.mjs (fuera del repo, es lo normal al
   desarrollar); si no está, las etiquetas <meta> de login.html, que es
   de donde las toma un despliegue real. */
async function leerCredenciales() {
  const local = path.join(RAIZ, "js", "config-local.mjs");
  if (fs.existsSync(local)) {
    const cfg = (await import(pathToFileURL(local).href)).default ?? {};
    if (cfg.url && cfg.anonKey && !cfg.url.includes("TU_")) {
      return { url: cfg.url, llave: cfg.anonKey, origen: "js/config-local.mjs" };
    }
  }

  const html = fs.readFileSync(path.join(RAIZ, "login.html"), "utf8");
  const meta = n => html.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || "";
  return { url: meta("supabase-url"), llave: meta("supabase-anon-key"), origen: "login.html" };
}

const { url: urlCruda, llave: LLAVE, origen } = await leerCredenciales();
const URL_BASE = urlCruda.replace(/\/+$/, "");

if (!URL_BASE || !LLAVE || URL_BASE.includes("TU_") || LLAVE.includes("TU_")) {
  console.error("\n✖ No hay credenciales de un proyecto real.");
  console.error("  Copia js/config-local.ejemplo.mjs como js/config-local.mjs");
  console.error("  y pon ahí la URL y la publishable key de tu proyecto.\n");
  process.exit(1);
}

const cabeceras = { apikey: LLAVE, Authorization: `Bearer ${LLAVE}` };
let fallas = 0;
const mal = m => { console.log("  ✖ " + m); fallas++; };
const bien = m => console.log("  ✓ " + m);

async function pedir(ruta) {
  const r = await fetch(URL_BASE + ruta, { headers: cabeceras });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no era JSON */ }
  return { estado: r.status, json, texto };
}

/* ─── Tablas que deben existir ────────────────────────────────────────── */
const TABLAS = [
  "clinicas", "perfiles_staff", "pacientes", "notas_paciente", "citas",
  "seguimientos", "nps_respuestas", "conversaciones", "mensajes",
  "documentos", "posts",
  // Fase E
  "horarios_base", "horarios_excepciones", "escalaciones", "avisos_pendientes",
];

console.log(`\nProyecto: ${URL_BASE}`);
console.log(`Credenciales leídas de: ${origen}\n`);

console.log("[1] ¿Está aplicado el esquema?");
let faltantes = 0;
for (const tabla of TABLAS) {
  const { estado } = await pedir(`/rest/v1/${tabla}?select=*&limit=1`);
  if (estado === 404) { faltantes++; }
}
if (faltantes === TABLAS.length) {
  mal(`ninguna de las ${TABLAS.length} tablas existe — falta aplicar las migraciones`);
  console.log("\n     Pega supabase/migraciones-completas.sql en el editor SQL del panel,");
  console.log("     o corre  npx supabase db push  si tienes la CLI enlazada.\n");
  process.exit(1);
} else if (faltantes > 0) {
  mal(`faltan ${faltantes} de ${TABLAS.length} tablas — el esquema quedó a medias`);
} else {
  bien(`las ${TABLAS.length} tablas existen`);
}

/* ─── La prueba que importa ───────────────────────────────────────────── */
console.log("\n[2] ¿RLS bloquea a la llave pública? (la que va escrita en el HTML)");
for (const tabla of TABLAS) {
  const { estado, json } = await pedir(`/rest/v1/${tabla}?select=*&limit=5`);

  if (estado === 404) { mal(`${tabla}: no existe`); continue; }
  if (estado === 401 || estado === 403) { bien(`${tabla}: acceso denegado`); continue; }

  if (Array.isArray(json)) {
    if (json.length === 0) bien(`${tabla}: 0 renglones`);
    else mal(`FUGA en ${tabla}: devolvió ${json.length} renglón(es) sin sesión`);
  } else {
    mal(`${tabla}: respuesta inesperada (HTTP ${estado})`);
  }
}

/* ─── Lo que sí debe ser público ──────────────────────────────────────── */
console.log("\n[3] ¿La landing puede leer los datos de la clínica?");
{
  const { estado, json } = await pedir("/rest/v1/clinica_publica?select=nombre_clinica");
  if (estado === 404) mal("la vista clinica_publica no existe");
  else if (!Array.isArray(json)) mal(`respuesta inesperada (HTTP ${estado})`);
  else if (json.length === 0) mal("la vista responde pero no hay ninguna clínica activa: falta correr supabase/seed-clinica.sql");
  else bien(`clinica_publica visible: ${json.map(c => c.nombre_clinica).join(", ")}`);
}
{
  const { json } = await pedir("/rest/v1/clinica_publica?select=plan");
  if (Array.isArray(json)) mal("la vista pública expone el plan contratado");
  else bien("el plan contratado no se expone");
}

/* La landing muestra opiniones sin sesión. Si esta vista no existe, la
   sección sale vacía en producción y nadie se entera hasta que un
   prospecto ve la página sin prueba social. */
{
  const { estado, json } = await pedir("/rest/v1/testimonios_publicos?select=nombre_publico&limit=1");

  if (estado === 404) {
    mal("la vista testimonios_publicos no existe (¿faltó aplicar 0007?)");
  } else if (!Array.isArray(json)) {
    mal(`testimonios_publicos: respuesta inesperada (HTTP ${estado})`);
  } else {
    bien("testimonios_publicos legible sin sesión");

    /* Solo tiene sentido preguntar por fugas si la vista existe: sobre una
       vista ausente, todas las columnas dan 404 y el resultado parecería
       limpio. Anidarlo evita ese falso "todo bien". */
    const fugas = [];
    for (const col of ["telefono", "email", "folio", "cita_id"]) {
      const { json: j } = await pedir(`/rest/v1/testimonios_publicos?select=${col}&limit=1`);
      if (Array.isArray(j)) fugas.push(col);
    }
    if (fugas.length) mal(`FUGA: testimonios_publicos expone ${fugas.join(", ")}`);
    else bien("los testimonios no exponen datos de contacto");
  }
}

/* MediPost guarda cuatro bloques; la tabla original solo tenía dos. */
{
  const { estado, json } = await pedir("/rest/v1/posts?select=prompt_ia&limit=1");
  if (estado === 404 || json?.code === "42703" || json?.code === "PGRST204") {
    mal("a la tabla posts le faltan columnas (¿faltó aplicar 0008?)");
  } else {
    bien("posts tiene las columnas de MediPost completas");
  }
}

/* ─── Funciones de los flujos sin sesión ──────────────────────────────── */
console.log("\n[4] ¿Existen las funciones públicas?");

/* Se llaman con argumentos deliberadamente inválidos, no con un cuerpo
   vacío. La razón: PostgREST responde 404 tanto cuando la función no
   existe como cuando existe pero la firma no cuadra, así que un cuerpo
   vacío no distingue una cosa de la otra.

   Con los nombres de argumento correctos, la firma sí cuadra y la
   función corre — y aborta en su propia validación antes de tocar nada.
   Un error de validación es prueba de que la función está ahí y de que
   valida. Lo que delata la ausencia es el código PGRST202. */
/* Cada sonda dice de qué migración viene, para que el mensaje de error
   apunte al archivo que de verdad falta y no siempre al mismo. */
const SONDAS = [
  ["solicitar_cita",         { p_nombre: "", p_apellidos: "", p_telefono: "" }, "0006_rpc_publicas.sql"],
  ["responder_encuesta",     { p_folio: "__NO_EXISTE__", p_puntuacion: 5 },     "0006_rpc_publicas.sql"],
  ["encuesta_ya_respondida", { p_folio: "__NO_EXISTE__" },                      "0006_rpc_publicas.sql"],
  // Fase E: la landing consulta el horario y el paciente puede pedir un humano.
  ["horario_disponible",     { p_desde: "2000-01-01", p_hasta: "2099-01-01" },  "0009_horarios.sql"],
  ["escalar_a_humano",       { p_motivo: "", p_resumen: "" },                   "0010_escalaciones.sql"],
];

for (const [fn, cuerpo, migracion] of SONDAS) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...cabeceras, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no era JSON */ }

  if (json?.code === "PGRST202") mal(`${fn}: no existe (¿faltó aplicar ${migracion}?)`);
  else if (r.status === 401 || r.status === 403) mal(`${fn}: existe pero anon no puede ejecutarla`);
  else bien(`${fn}: presente y validando`);
}

/* ─── Lo único que este script NO puede comprobar ─────────────────────── */
console.log("\n[5] El reloj de las escalaciones");
console.log("  · No se puede verificar desde aquí: `cron.job` vive fuera del");
console.log("    esquema público y la llave pública no lo alcanza — que es");
console.log("    justo como debe ser.");
console.log("  · Compruébalo en el editor SQL del panel:");
console.log("      select jobname, schedule, active from cron.job where jobname like 'medicita-%';");
console.log("    Deben salir DOS renglones con active = true. Si no, la");
console.log("    escalación funciona pero la re-alerta no ocurre con el panel");
console.log("    cerrado. Ver supabase/cron.sql.");

console.log(
  fallas === 0
    ? "\n✅ El proyecto está listo\n"
    : `\n❌ ${fallas} problema(s). No pongas esta clínica en producción todavía.\n`
);
process.exit(fallas ? 1 : 0);
