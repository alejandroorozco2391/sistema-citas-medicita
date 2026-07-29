/* ═══════════════════════════════════════════════════════════════════════
   supabase/reset-datos.sql

   Es un script que se pega a mano en el panel y borra expedientes. No hay
   deshacer. Las dos cosas que tienen que ser ciertas son simétricas y
   ninguna se ve a simple vista leyendo el SQL:

     · que borre todo lo de la clínica indicada
     · que no roce nada de las demás

   Un `where clinica_id` olvidado en una de las nueve tablas cumple lo
   primero y viola lo segundo, y en un proyecto de una sola clínica
   —que es el despliegue normal— nadie se daría cuenta nunca.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearBase, sembrarClinica, TABLAS_CON_CLINICA } from "./db-harness.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA = path.join(AQUI, "..", "supabase", "reset-datos.sql");

/* El script está escrito para editarse a mano en dos líneas. Aquí se
   editan igual, con la misma forma exacta, para que la prueba corra el
   archivo de verdad y no una copia paralela que se pueda desincronizar. */
function guionReset({ clinica, borrarClinica = false }) {
  let sql = fs.readFileSync(RUTA, "utf8");

  /* Se comprueba que el patrón encuentre, no que el texto cambie: pedir
     `false` cuando ya dice `false` produce una sustitución legítima e
     idéntica, y compararla contra el original daría un falso fallo. */
  const sustituir = (patron, nuevo, que) => {
    assert.match(sql, patron, `no se encontró ${que} en reset-datos.sql: ¿cambió su forma?`);
    sql = sql.replace(patron, nuevo);
  };

  sustituir(/v_nombre_clinica\s+text\s+:=\s+'[^']*';/,
            `v_nombre_clinica  text := '${clinica}';`, "v_nombre_clinica");
  sustituir(/v_borrar_clinica\s+boolean\s+:=\s+\w+;/,
            `v_borrar_clinica  boolean := ${borrarClinica};`, "v_borrar_clinica");

  return sql;
}

async function cuenta(db, tabla, clinicaId) {
  const { rows } = await db.query(
    `select count(*)::int as n from ${tabla} where clinica_id = $1`,
    [clinicaId]
  );
  return rows[0].n;
}

/** Todas las tablas con datos, para una clínica. */
async function inventario(db, clinicaId) {
  const r = {};
  for (const t of TABLAS_CON_CLINICA) r[t] = await cuenta(db, t, clinicaId);
  return r;
}

async function baseConDosClinicas() {
  const db = await crearBase();
  const a = await sembrarClinica(db, { nombre: "Clínica Norte", sufijo: "1" });
  const b = await sembrarClinica(db, { nombre: "Clínica Sur", sufijo: "2" });
  return { db, a, b };
}

test("la semilla deja las nueve tablas con datos (si no, el resto no prueba nada)", async () => {
  const { db, a } = await baseConDosClinicas();
  const antes = await inventario(db, a.clinicaId);
  for (const [tabla, n] of Object.entries(antes)) {
    assert.ok(n > 0, `${tabla} nació vacía: la prueba de borrado sería vacua`);
  }
  await db.close();
});

test("borra las nueve tablas de la clínica indicada", async () => {
  const { db, a } = await baseConDosClinicas();

  await db.exec(guionReset({ clinica: "Clínica Norte" }));

  const despues = await inventario(db, a.clinicaId);
  for (const [tabla, n] of Object.entries(despues)) {
    assert.equal(n, 0, `${tabla} quedó con ${n} renglón(es) de la clínica borrada`);
  }
  await db.close();
});

test("no toca ni un renglón de las demás clínicas", async () => {
  const { db, b } = await baseConDosClinicas();

  const antes = await inventario(db, b.clinicaId);
  await db.exec(guionReset({ clinica: "Clínica Norte" }));
  const despues = await inventario(db, b.clinicaId);

  assert.deepEqual(despues, antes, "el reset alcanzó datos de otra clínica");
  await db.close();
});

test("por omisión conserva la clínica y su personal: el sistema arranca vacío pero funcional", async () => {
  const { db, a } = await baseConDosClinicas();

  await db.exec(guionReset({ clinica: "Clínica Norte", borrarClinica: false }));

  const { rows: cl } = await db.query("select count(*)::int as n from clinicas where id = $1", [a.clinicaId]);
  const { rows: st } = await db.query("select count(*)::int as n from perfiles_staff where clinica_id = $1", [a.clinicaId]);
  assert.equal(cl[0].n, 1, "se borró la clínica sin pedirlo");
  assert.equal(st[0].n, 3, "se borró el personal sin pedirlo");
  await db.close();
});

test("con la bandera en true borra también la clínica y sus perfiles", async () => {
  const { db, a, b } = await baseConDosClinicas();

  await db.exec(guionReset({ clinica: "Clínica Norte", borrarClinica: true }));

  const { rows: cl } = await db.query("select count(*)::int as n from clinicas where id = $1", [a.clinicaId]);
  const { rows: st } = await db.query("select count(*)::int as n from perfiles_staff where clinica_id = $1", [a.clinicaId]);
  assert.equal(cl[0].n, 0);
  assert.equal(st[0].n, 0);

  /* Y la otra sigue entera, con su equipo. */
  const { rows: otra } = await db.query("select count(*)::int as n from perfiles_staff where clinica_id = $1", [b.clinicaId]);
  assert.equal(otra[0].n, 3, "borrar una clínica se llevó el personal de otra");
  await db.close();
});

test("un nombre que no existe aborta en vez de reportar éxito", async () => {
  const { db, a } = await baseConDosClinicas();

  await assert.rejects(
    () => db.exec(guionReset({ clinica: "Clínica Que No Existe" })),
    /No hay ninguna clínica/,
    "un dedazo en el nombre debe reventar, no borrar cero renglones en silencio"
  );

  /* Y que el intento fallido no haya borrado nada de paso. */
  const inv = await inventario(db, a.clinicaId);
  for (const [tabla, n] of Object.entries(inv)) {
    assert.ok(n > 0, `${tabla} se vació pese a que el script abortó`);
  }
  await db.close();
});

test("correrlo dos veces no falla", async () => {
  const { db } = await baseConDosClinicas();

  await db.exec(guionReset({ clinica: "Clínica Norte" }));
  await db.exec(guionReset({ clinica: "Clínica Norte" }));  // la clínica sigue existiendo

  await db.close();
});

test("el script no queda con datos de una clínica real dentro", async () => {
  /* El repositorio es la plantilla de la siguiente clínica. Un nombre real
     aquí haría que alguien lo corriera contra la base equivocada. */
  const sql = fs.readFileSync(RUTA, "utf8");
  const nombre = sql.match(/v_nombre_clinica\s+text\s+:=\s+'([^']*)'/)?.[1] ?? "";
  assert.match(nombre, /Ejemplo/, `el nombre por omisión debe ser un marcador, no "${nombre}"`);

  const bandera = sql.match(/v_borrar_clinica\s+boolean\s+:=\s+(\w+)/)?.[1];
  assert.equal(bandera, "false", "la opción destructiva no debe venir activada por omisión");
});
