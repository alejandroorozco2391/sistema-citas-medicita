/* ═══════════════════════════════════════════════════════════════════════
   Paridad entre las dos implementaciones de la capa de datos.

   El sistema promete que api-local (localStorage, para la demo pública) y
   api-remoto (Supabase, para una clínica real) son intercambiables. Si una
   se desincroniza de la otra, el corte de B2 rompe la demo o el producto,
   y el error aparecería hasta que alguien lo viera fallar en pantalla.

   Alcance honesto: aquí se comprueba la SUPERFICIE de ambas y el
   COMPORTAMIENTO de la local. El comportamiento de la remota necesita un
   proyecto de Supabase vivo; lo que sí está verificado de ese lado es el
   esquema, las políticas y las funciones — en tests/db-*.test.mjs, contra
   un Postgres real.
   ═══════════════════════════════════════════════════════════════════════ */

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instalarLocalStorage } from "./stub-localstorage.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

const ls = instalarLocalStorage();
const local = await import("../js/api-local.mjs");

/** Los métodos que la interfaz declara, leídos del propio api.mjs. */
function metodosDeLaInterfaz() {
  const src = fs.readFileSync(path.join(RAIZ, "js", "api.mjs"), "utf8");
  return [...new Set([...src.matchAll(/impl\(\)\)\.(\w+)\(/g)].map(m => m[1]))];
}

/** Nombres exportados por un módulo, leídos del texto (api-remoto no se puede importar sin navegador). */
function exportadosDe(archivo) {
  const src = fs.readFileSync(path.join(RAIZ, "js", archivo), "utf8");
  return new Set([...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]));
}

/* ═══ Superficie ════════════════════════════════════════════════════════ */

test("la interfaz declara los métodos esperados", () => {
  const m = metodosDeLaInterfaz();
  assert.ok(m.length >= 35, `se esperaban al menos 35 métodos, hay ${m.length}`);
});

test("api-local implementa TODA la interfaz", () => {
  const faltan = metodosDeLaInterfaz().filter(n => typeof local[n] !== "function");
  assert.deepStrictEqual(faltan, [], `api-local no implementa: ${faltan.join(", ")}`);
});

test("api-remoto implementa TODA la interfaz", () => {
  const exportados = exportadosDe("api-remoto.mjs");
  const faltan = metodosDeLaInterfaz().filter(n => !exportados.has(n));
  assert.deepStrictEqual(faltan, [], `api-remoto no implementa: ${faltan.join(", ")}`);
});

test("ninguna implementación exporta métodos que la otra no tenga", () => {
  const iface = new Set(metodosDeLaInterfaz());
  const enLocal = exportadosDe("api-local.mjs");
  const enRemoto = exportadosDe("api-remoto.mjs");

  const soloLocal = [...enLocal].filter(n => iface.has(n) && !enRemoto.has(n));
  const soloRemoto = [...enRemoto].filter(n => iface.has(n) && !enLocal.has(n));

  assert.deepStrictEqual(soloLocal, [], `solo en local: ${soloLocal.join(", ")}`);
  assert.deepStrictEqual(soloRemoto, [], `solo en remoto: ${soloRemoto.join(", ")}`);
});

test("todos los métodos de api-local devuelven Promise", async () => {
  ls.clear();
  // Se prueban los de lectura, que no necesitan argumentos válidos.
  const lecturas = [
    "clinicaObtener", "pacientesListar", "citasListar", "conversacionesListar",
    "documentosListar", "postsListar", "npsListar", "seguimientosListar",
    "conversacionesContarPorEstado",
  ];
  for (const nombre of lecturas) {
    const r = local[nombre]();
    assert.ok(r instanceof Promise, `${nombre} debe devolver Promise en ambos modos`);
    await r;
  }
});

/* ═══ Comportamiento de la implementación local ═════════════════════════ */

test("la configuración de la clínica va y viene", async () => {
  ls.clear();
  await local.clinicaGuardar({ nombreClinica: "Consultorio Prueba", ciudad: "CDMX" });
  const cfg = await local.clinicaObtener();
  assert.strictEqual(cfg.nombreClinica, "Consultorio Prueba");
});

test("pedir cita crea el expediente y devuelve folio con el formato de siempre", async () => {
  ls.clear();
  const folio = await local.publicoSolicitarCita({
    nombre: "Ana", apellidos: "Martínez", telefono: "55 8811 2233",
    especialidad: "Cardiología", fecha: "2026-08-10", hora: "10:00", tipo: "Primera vez",
  });
  assert.match(folio, /^CIT-\d{6}-\d{4}$/);

  const pacientes = await local.pacientesListar();
  assert.strictEqual(pacientes.length, 1);
  assert.strictEqual(pacientes[0].nombre, "Ana");
});

test("el mismo teléfono en otro formato NO duplica el expediente", async () => {
  ls.clear();
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "55 8811 2233", fecha: "2026-08-10" });
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "525588112233", fecha: "2026-08-11" });
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "+52 55 8811-2233", fecha: "2026-08-12" });

  const pacientes = await local.pacientesListar();
  assert.strictEqual(pacientes.length, 1, "los tres formatos son la misma persona");

  const citas = await local.citasListar();
  assert.strictEqual(citas.length, 3);
});

test("buscar paciente por teléfono tolera el formato internacional", async () => {
  ls.clear();
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "55 8811 2233", fecha: "2026-08-10" });
  const p = await local.pacientesPorTelefono("525588112233");
  assert.ok(p, "el número de WhatsApp debe encontrar al paciente del expediente");
  assert.strictEqual(p.nombre, "Ana");
});

test("una encuesta no se puede responder dos veces", async () => {
  ls.clear();
  const folio = await local.publicoSolicitarCita({
    nombre: "Luis", telefono: "55 4040 5050", fecha: "2026-08-10",
  });
  await local.npsResponder(folio, 9, "Muy bien");
  assert.strictEqual(await local.npsYaRespondida(folio), true);
  await assert.rejects(() => local.npsResponder(folio, 2, "otra vez"), /respondida|ya/i);
});

test("conversaciones y mensajes conservan las reglas del inbox", async () => {
  ls.clear();
  const conv = await local.conversacionesUpsert({
    canal: "whatsapp", telefono: "55 8811 2233", nombreContacto: "Ana",
  });
  await local.mensajesAgregar(conv.id, { remitente: "paciente", contenido: "Buenas tardes" });
  await local.mensajesAgregar(conv.id, {
    remitente: "staff", tipo: "nota_interna", contenido: "Nota privada",
  });

  const actualizada = await local.conversacionesObtener(conv.id);
  assert.strictEqual(
    actualizada.ultimoMensaje.texto, "Buenas tardes",
    "una nota interna no debe asomarse al preview de la lista"
  );
  assert.strictEqual(actualizada.noLeidos, 1);
  assert.strictEqual((await local.mensajesListar(conv.id)).length, 2);
});

test("el upsert de conversación no duplica por formato de teléfono", async () => {
  ls.clear();
  const a = await local.conversacionesUpsert({ canal: "whatsapp", telefono: "525588112233" });
  const b = await local.conversacionesUpsert({ canal: "whatsapp", telefono: "55 8811 2233" });
  assert.strictEqual(a.id, b.id, "mismo número, mismo hilo");
  assert.strictEqual((await local.conversacionesListar()).length, 1);
});

test("un localStorage corrupto no tumba la capa de datos", async () => {
  ls.clear();
  ls.setItem("medicita_pacientes", "{esto no es json");
  assert.deepStrictEqual(await local.pacientesListar(), []);
});
