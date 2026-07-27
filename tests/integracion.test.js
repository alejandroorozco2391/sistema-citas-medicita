/* Prueba de extremo a extremo: payload crudo del proveedor → adaptador →
   store → vínculo con el expediente. Usa el dataset de demo real, así que
   si alguien rompe un adaptador o el cruce de teléfonos, esto lo caza. */

const test = require("node:test");
const assert = require("node:assert");
const { instalarLocalStorage } = require("./stub-localstorage.js");

const ls = instalarLocalStorage();
const store = require("../js/conversaciones-store.js");
const { CONVERSACIONES_DEMO } = require("../js/conversaciones-demo.js");

/* Los mismos pacientes que siembra cargarDatosMuestra() en admin.js. */
const PACIENTES_MUESTRA = [
  { id: "PAC-1", nombre: "Ana", apellidos: "Martínez Soto", telefono: "55 8811 2233" },
  { id: "PAC-2", nombre: "Roberto", apellidos: "García Vega", telefono: "55 9922 4455" },
  { id: "PAC-3", nombre: "Lucía", apellidos: "Torres Reyes", telefono: "55 3344 6677" },
  { id: "PAC-4", nombre: "Carlos", apellidos: "Ramírez Luna", telefono: "55 4455 7788" },
  { id: "PAC-5", nombre: "Valentina", apellidos: "López Cruz", telefono: "55 6677 9900" },
  { id: "PAC-6", nombre: "Miguel", apellidos: "Hernández Ríos", telefono: "55 7788 0011" },
  { id: "PAC-7", nombre: "Patricia", apellidos: "Morales Díaz", telefono: "55 1100 2233" },
];

async function sembrarTodo() {
  ls.clear();
  ls.setItem("medicita_pacientes", JSON.stringify(PACIENTES_MUESTRA));
  for (const item of CONVERSACIONES_DEMO) await store.ingerir(item);
}

test("el dataset de demo cubre los 4 canales", async () => {
  await sembrarTodo();
  const canales = new Set((await store.listarConversaciones()).map(c => c.canal));
  assert.deepStrictEqual(
    [...canales].sort(),
    ["chat_web", "medibot", "voz", "whatsapp"]
  );
});

test("toda conversación de demo llega con mensajes", async () => {
  await sembrarTodo();
  for (const c of await store.listarConversaciones()) {
    const msgs = await store.listarMensajes(c.id);
    assert.ok(msgs.length > 0, `${c.nombreContacto} (${c.canal}) llegó sin mensajes`);
  }
});

test("las conversaciones de WhatsApp SÍ se vinculan al expediente pese a la lada 52", async () => {
  await sembrarTodo();
  const wa = (await store.listarConversaciones({ canal: "whatsapp" })).filter(
    c => c.telefono.startsWith("52")
  );
  const conocidas = wa.filter(c =>
    PACIENTES_MUESTRA.some(p => store.claveTel(p.telefono) === store.claveTel(c.telefono))
  );
  assert.ok(conocidas.length > 0, "el dataset debe traer al menos un número conocido");
  for (const c of conocidas) {
    assert.ok(c.pacienteId, `${c.nombreContacto} quedó sin pacienteId`);
  }
});

test("las llamadas de voz también cruzan con el expediente", async () => {
  await sembrarTodo();
  const voz = await store.listarConversaciones({ canal: "voz" });
  const conocidas = voz.filter(c =>
    PACIENTES_MUESTRA.some(p => store.claveTel(p.telefono) === store.claveTel(c.telefono))
  );
  for (const c of conocidas) {
    assert.ok(c.pacienteId, "una llamada de un paciente conocido debe traer pacienteId");
    assert.notStrictEqual(
      c.nombreContacto,
      "Llamada entrante",
      "el nombre debe tomarse del expediente, no quedarse en el genérico"
    );
  }
});

test("el lead sin perfil entra igual, con pacienteId en null", async () => {
  await sembrarTodo();
  const huerfanas = (await store.listarConversaciones()).filter(c => !c.pacienteId);
  assert.ok(huerfanas.length >= 1, "el dataset incluye un lead sin expediente a propósito");
  for (const c of huerfanas) {
    assert.ok((await store.listarMensajes(c.id)).length > 0);
  }
});

test("hay al menos una conversación que pide atención humana", async () => {
  await sembrarTodo();
  const m = await store.contarPorEstado();
  assert.ok(m.requiere_atencion_humana >= 1);
});

test("reingerir el dataset completo no duplica nada (idempotencia end-to-end)", async () => {
  await sembrarTodo();
  const antesConv = (await store.listarConversaciones()).length;
  const antesMsgs = JSON.parse(ls.getItem("medicita_mensajes")).length;

  for (const item of CONVERSACIONES_DEMO) await store.ingerir(item);

  assert.strictEqual((await store.listarConversaciones()).length, antesConv);
  assert.strictEqual(
    JSON.parse(ls.getItem("medicita_mensajes")).length,
    antesMsgs,
    "los canales con id de proveedor no deben duplicar mensajes al reingerir"
  );
});

test("ninguna conversación queda sin preview del último mensaje", async () => {
  await sembrarTodo();
  for (const c of await store.listarConversaciones()) {
    assert.ok(c.ultimoMensaje, `${c.nombreContacto} sin ultimoMensaje`);
    assert.ok(String(c.ultimoMensaje.texto).trim(), `${c.nombreContacto} con preview vacío`);
  }
});

test("captura en vivo de MediBot: volcar en cada turno no duplica el hilo", async () => {
  // Reproduce lo que hace chat.js: tras CADA turno vuelca la conversación
  // COMPLETA al inbox. Sin ids deterministas, esto duplicaría todo.
  ls.clear();
  const { adaptarMediBot } = require("../js/conversaciones-adapters.js");
  const ctx = { sesionId: "mb_prueba_1", telefono: "55 8811 2233", inicioEn: "2026-07-26T10:00:00.000Z" };

  const conversacion = [];
  const turnos = [
    { role: "user", content: "Hola, necesito una cita" },
    { role: "assistant", content: [{ type: "text", text: "¡Claro! ¿Qué especialidad?" }] },
    { role: "user", content: "Dermatología" },
    { role: "assistant", content: [{ type: "text", text: "Tenemos a la Dra. Isabel Torres." }] },
  ];

  let convId = null;
  for (const t of turnos) {
    conversacion.push(t);
    const conv = await store.ingerir(adaptarMediBot(conversacion, ctx));
    convId = conv.id;
  }

  assert.strictEqual((await store.listarConversaciones()).length, 1, "debe ser un solo hilo");
  assert.strictEqual(
    (await store.listarMensajes(convId)).length,
    4,
    "4 mensajes, no 10 — los ya volcados se reconocen por id"
  );
});

test("captura en vivo: el teléfono descubierto a media conversación vincula el expediente", async () => {
  // En chat.js el teléfono solo se conoce cuando el bot llama a crear_cita,
  // a mitad del hilo. El vínculo debe completarse retroactivamente.
  ls.clear();
  ls.setItem("medicita_pacientes", JSON.stringify(PACIENTES_MUESTRA));
  const { adaptarMediBot } = require("../js/conversaciones-adapters.js");

  const conversacion = [{ role: "user", content: "Quiero una cita" }];
  const anon = await store.ingerir(adaptarMediBot(conversacion, { sesionId: "mb_2" }));
  assert.strictEqual(anon.pacienteId, null, "arranca anónima");

  conversacion.push({ role: "assistant", content: [{ type: "text", text: "Listo, la agendé." }] });
  const conConcacto = await store.ingerir(
    adaptarMediBot(conversacion, { sesionId: "mb_2", telefono: "55 8811 2233" })
  );

  assert.strictEqual(conConcacto.id, anon.id, "sigue siendo el mismo hilo");
  assert.strictEqual(conConcacto.pacienteId, "PAC-1", "ya quedó vinculada al expediente");
});

test("el hilo de MediBot no arrastra fontanería de tool use", async () => {
  await sembrarTodo();
  for (const c of await store.listarConversaciones({ canal: "medibot" })) {
    for (const m of await store.listarMensajes(c.id)) {
      assert.ok(!/tool_use_id|tool_result/.test(m.contenido), "se filtró fontanería al hilo");
    }
  }
});
