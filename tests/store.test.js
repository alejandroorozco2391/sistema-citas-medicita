/* Pruebas de la capa de persistencia del inbox.
   Se instala un stub de localStorage ANTES de requerir el store. */

const test = require("node:test");
const assert = require("node:assert");
const { instalarLocalStorage } = require("./stub-localstorage.js");

const ls = instalarLocalStorage();
const store = require("../js/conversaciones-store.js");

function limpiar() {
  ls.clear();
}

function sembrarPacientes() {
  ls.setItem(
    "medicita_pacientes",
    JSON.stringify([
      { id: "PAC-1", nombre: "Ana", apellidos: "Martínez Soto", telefono: "55 8811 2233" },
      { id: "PAC-2", nombre: "Roberto", apellidos: "García Vega", telefono: "55 9922 4455" },
    ])
  );
}

/* ═══ Teléfonos y texto ═════════════════════════════════════════════════ */

test("normalizarTel reduce cualquier formato a puros dígitos", () => {
  assert.strictEqual(store.normalizarTel("55 8811 2233"), "5588112233");
  assert.strictEqual(store.normalizarTel("55-8811-2233"), "5588112233");
  assert.strictEqual(store.normalizarTel("+52 (55) 8811 2233"), "525588112233");
  assert.strictEqual(store.normalizarTel(null), "");
});

test("normalizarTexto quita acentos y baja a minúsculas", () => {
  assert.strictEqual(store.normalizarTexto("  Méndez JOSÉ ñ "), "mendez jose n");
});

test("claveTel iguala el formato internacional de WhatsApp con el del expediente", () => {
  // WhatsApp entrega "525588112233"; la asistente tecleó "55 8811 2233".
  assert.strictEqual(store.claveTel("525588112233"), store.claveTel("55 8811 2233"));
  assert.strictEqual(store.claveTel("+52 55 9922 4455"), store.claveTel("5599224455"));
  // El 1 de celular que anteponen algunos gateways tampoco debe estorbar.
  assert.strictEqual(store.claveTel("5215588112233"), store.claveTel("5588112233"));
});

test("claveTel no confunde dos números nacionales distintos", () => {
  assert.notStrictEqual(store.claveTel("525588112233"), store.claveTel("525599224455"));
});

/* ═══ Vínculo con el expediente ═════════════════════════════════════════ */

test("resolverPaciente cruza teléfonos con formatos distintos", async () => {
  limpiar();
  sembrarPacientes();
  // El paciente está guardado como "55 8811 2233"; se busca con guiones.
  const pac = await store.resolverPaciente("55-8811-2233");
  assert.strictEqual(pac.id, "PAC-1");
});

test("resolverPaciente cruza el número internacional de WhatsApp con el expediente", async () => {
  limpiar();
  sembrarPacientes();
  // Caso real: el webhook de WhatsApp manda wa_id con lada de país.
  const pac = await store.resolverPaciente("525588112233");
  assert.ok(pac, "una conversación de WhatsApp no debe quedar huérfana de expediente");
  assert.strictEqual(pac.id, "PAC-1");
});

test("resolverPaciente devuelve null para un lead sin perfil", async () => {
  limpiar();
  sembrarPacientes();
  assert.strictEqual(await store.resolverPaciente("55 0000 0000"), null);
});

/* ═══ Upsert de conversaciones ══════════════════════════════════════════ */

test("upsert por claveExterna: dos ingestas del mismo id son una conversación", async () => {
  limpiar();
  const a = await store.crearOActualizarConversacion({
    claveExterna: "conv_abc", canal: "voz", telefono: "5599224455", nombreContacto: "Roberto",
  });
  const b = await store.crearOActualizarConversacion({
    claveExterna: "conv_abc", canal: "voz", telefono: "5599224455", nombreContacto: "Roberto",
  });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual((await store.listarConversaciones()).length, 1);
});

test("upsert por canal+teléfono cuando el canal no da clave (WhatsApp)", async () => {
  limpiar();
  await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "55 8811 2233" });
  await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  assert.strictEqual((await store.listarConversaciones()).length, 1, "mismo número, distinto formato");
});

test("el mismo teléfono en canales distintos son conversaciones distintas", async () => {
  limpiar();
  await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.crearOActualizarConversacion({ canal: "medibot", telefono: "5588112233" });
  assert.strictEqual((await store.listarConversaciones()).length, 2);
});

test("un upsert con campos vacíos no borra lo que ya se sabía", async () => {
  limpiar();
  await store.crearOActualizarConversacion({
    claveExterna: "k1", canal: "whatsapp", telefono: "5588112233",
    nombreContacto: "Ana Martínez", asunto: "Dolor de cabeza", pacienteId: "PAC-1",
  });
  const b = await store.crearOActualizarConversacion({
    claveExterna: "k1", canal: "whatsapp", telefono: "5588112233",
    nombreContacto: "", asunto: "", pacienteId: null,
  });
  assert.strictEqual(b.nombreContacto, "Ana Martínez");
  assert.strictEqual(b.asunto, "Dolor de cabeza");
  assert.strictEqual(b.pacienteId, "PAC-1");
});

/* ═══ Mensajes y resumen desnormalizado ═════════════════════════════════ */

test("agregarMensaje actualiza ultimoMensaje y sube el contador de no leídos", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { remitente: "paciente", contenido: "Hola, buenas tardes" });

  const conv = await store.obtenerConversacion(c.id);
  assert.strictEqual(conv.ultimoMensaje.texto, "Hola, buenas tardes");
  assert.strictEqual(conv.ultimoMensaje.remitente, "paciente");
  assert.strictEqual(conv.noLeidos, 1);
});

test("un mensaje del staff no cuenta como no leído", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { remitente: "staff", contenido: "Con gusto la atiendo" });
  assert.strictEqual((await store.obtenerConversacion(c.id)).noLeidos, 0);
});

test("una nota interna no se muestra como último mensaje del hilo", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { remitente: "paciente", contenido: "¿Me confirman?" });
  await store.agregarMensaje(c.id, {
    remitente: "staff", tipo: "nota_interna", contenido: "Ojo: paciente moroso",
  });

  const conv = await store.obtenerConversacion(c.id);
  assert.strictEqual(conv.ultimoMensaje.texto, "¿Me confirman?", "la nota interna no debe filtrarse al preview");
  assert.strictEqual((await store.listarMensajes(c.id)).length, 2, "pero sí vive en el hilo");
});

test("un mensaje de audio muestra un preview legible, no vacío", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { remitente: "paciente", tipo: "audio", contenido: "" });
  assert.match((await store.obtenerConversacion(c.id)).ultimoMensaje.texto, /voz/i);
});

test("reingerir el mismo mensaje no duplica el hilo (idempotencia)", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  const msg = { id: "MSG-wa-wamid.AAA", remitente: "paciente", contenido: "Hola" };
  await store.agregarMensaje(c.id, msg);
  await store.agregarMensaje(c.id, msg);
  assert.strictEqual((await store.listarMensajes(c.id)).length, 1);
});

test("los mensajes salen ordenados cronológicamente", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { contenido: "tercero", fecha: "2026-07-03T10:00:00.000Z" });
  await store.agregarMensaje(c.id, { contenido: "primero", fecha: "2026-07-01T10:00:00.000Z" });
  await store.agregarMensaje(c.id, { contenido: "segundo", fecha: "2026-07-02T10:00:00.000Z" });

  assert.deepStrictEqual(
    (await store.listarMensajes(c.id)).map(m => m.contenido),
    ["primero", "segundo", "tercero"]
  );
});

/* ═══ Estado y lectura ══════════════════════════════════════════════════ */

test("cambiarEstado a resuelta sella cerradaEn, y volver a abrir lo limpia", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  const r = await store.cambiarEstado(c.id, "resuelta");
  assert.ok(r.cerradaEn);
  const a = await store.cambiarEstado(c.id, "abierta");
  assert.strictEqual(a.cerradaEn, null);
});

test("cambiarEstado rechaza un estado inventado", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await assert.rejects(() => store.cambiarEstado(c.id, "archivada"), /Estado inválido/);
});

test("marcarLeida pone el contador en cero", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { remitente: "paciente", contenido: "Hola" });
  await store.marcarLeida(c.id);
  assert.strictEqual((await store.obtenerConversacion(c.id)).noLeidos, 0);
});

/* ═══ Filtros y búsqueda ════════════════════════════════════════════════ */

async function sembrarVariadas() {
  limpiar();
  const a = await store.crearOActualizarConversacion({
    canal: "whatsapp", telefono: "5588112233", nombreContacto: "Ana Martínez", asunto: "Cita de control",
  });
  await store.agregarMensaje(a.id, { remitente: "paciente", contenido: "Tengo dolor de cabeza" });

  const b = await store.crearOActualizarConversacion({
    canal: "voz", telefono: "5599224455", nombreContacto: "Roberto García", asunto: "Llamada",
  });
  await store.cambiarEstado(b.id, "requiere_atencion_humana");

  const c = await store.crearOActualizarConversacion({
    canal: "medibot", telefono: "5533446677", nombreContacto: "Lucía Torres", asunto: "Costos",
  });
  await store.cambiarEstado(c.id, "resuelta");
  return { a, b, c };
}

test("filtra por canal", async () => {
  await sembrarVariadas();
  const r = await store.listarConversaciones({ canal: "voz" });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].canal, "voz");
});

test("filtra por estado", async () => {
  await sembrarVariadas();
  const r = await store.listarConversaciones({ estado: "requiere_atencion_humana" });
  assert.strictEqual(r.length, 1);
});

test("'todos' no filtra nada", async () => {
  await sembrarVariadas();
  assert.strictEqual((await store.listarConversaciones({ canal: "todos", estado: "todos" })).length, 3);
});

test("busca por nombre sin importar acentos ni mayúsculas", async () => {
  await sembrarVariadas();
  const r = await store.listarConversaciones({ texto: "LUCIA" });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombreContacto, "Lucía Torres");
});

test("busca dentro del cuerpo de los mensajes, no solo en el encabezado", async () => {
  await sembrarVariadas();
  const r = await store.listarConversaciones({ texto: "dolor de cabeza" });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].nombreContacto, "Ana Martínez");
});

test("busca por teléfono aunque se escriba con otro formato", async () => {
  await sembrarVariadas();
  const r = await store.listarConversaciones({ texto: "55-9922" });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].canal, "voz");
});

test("una búsqueda sin dígitos no hace match con todos los teléfonos", async () => {
  await sembrarVariadas();
  assert.strictEqual((await store.listarConversaciones({ texto: "zzzzz" })).length, 0);
});

test("la lista sale con la conversación más reciente primero", async () => {
  limpiar();
  const v = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "111", nombreContacto: "Vieja" });
  await store.agregarMensaje(v.id, { contenido: "hace rato", fecha: "2026-07-01T10:00:00.000Z" });
  const n = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "222", nombreContacto: "Nueva" });
  await store.agregarMensaje(n.id, { contenido: "ahorita", fecha: "2026-07-20T10:00:00.000Z" });

  const r = await store.listarConversaciones();
  assert.strictEqual(r[0].nombreContacto, "Nueva");
});

/* ═══ Ingesta ═══════════════════════════════════════════════════════════ */

test("ingerir vincula la conversación con el expediente del paciente", async () => {
  limpiar();
  sembrarPacientes();
  const conv = await store.ingerir({
    conversacion: { canal: "whatsapp", telefono: "55 8811 2233", nombreContacto: "" },
    mensajes: [{ remitente: "paciente", contenido: "Hola" }],
  });

  assert.strictEqual(conv.pacienteId, "PAC-1");
  assert.strictEqual(conv.nombreContacto, "Ana Martínez Soto", "toma el nombre del expediente");
  assert.strictEqual((await store.listarMensajes(conv.id)).length, 1);
});

test("ingerir un lead sin perfil deja pacienteId en null sin romperse", async () => {
  limpiar();
  sembrarPacientes();
  const conv = await store.ingerir({
    conversacion: { canal: "whatsapp", telefono: "55 0000 1111", nombreContacto: "Desconocido" },
    mensajes: [{ remitente: "paciente", contenido: "¿Precios?" }],
  });
  assert.strictEqual(conv.pacienteId, null);
  assert.strictEqual(conv.nombreContacto, "Desconocido");
});

/* ═══ Métricas y poda ═══════════════════════════════════════════════════ */

test("contarPorEstado cuadra con lo guardado", async () => {
  await sembrarVariadas();
  const m = await store.contarPorEstado();
  assert.strictEqual(m.total, 3);
  assert.strictEqual(m.abierta, 1);
  assert.strictEqual(m.requiere_atencion_humana, 1);
  assert.strictEqual(m.resuelta, 1);
});

test("la poda FIFO respeta el tope y descarta lo más viejo", async () => {
  limpiar();
  const extra = 5;
  for (let i = 0; i < store.MAX_CONVERSACIONES + extra; i++) {
    const c = await store.crearOActualizarConversacion({
      canal: "whatsapp", telefono: String(1000000 + i), nombreContacto: `Contacto ${i}`,
    });
    await store.agregarMensaje(c.id, {
      contenido: `msg ${i}`,
      fecha: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    });
  }

  const todas = await store.listarConversaciones();
  assert.strictEqual(todas.length, store.MAX_CONVERSACIONES);
  assert.ok(
    !todas.some(c => c.nombreContacto === "Contacto 0"),
    "las más viejas son las que se van"
  );
  assert.ok(todas.some(c => c.nombreContacto === `Contacto ${store.MAX_CONVERSACIONES + extra - 1}`));
});

test("al podar una conversación también se van sus mensajes", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  await store.agregarMensaje(c.id, { contenido: "hola" });
  await store.eliminarConversacion(c.id);
  assert.strictEqual((await store.listarMensajes(c.id)).length, 0);
  assert.strictEqual(await store.obtenerConversacion(c.id), null);
});

/* ═══ Robustez ══════════════════════════════════════════════════════════ */

test("localStorage corrupto no tumba la app, devuelve vacío", async () => {
  limpiar();
  ls.setItem("medicita_conversaciones", "{no es json");
  assert.deepStrictEqual(await store.listarConversaciones(), []);
});

test("actualizarEstadoEnvio deja rastro del motivo", async () => {
  limpiar();
  const c = await store.crearOActualizarConversacion({ canal: "whatsapp", telefono: "5588112233" });
  const m = await store.agregarMensaje(c.id, { remitente: "staff", contenido: "Le confirmo" });
  const act = await store.actualizarEstadoEnvio(m.id, "pendiente", "Requiere WhatsApp Business API");
  assert.strictEqual(act.estadoEnvio, "pendiente");
  assert.match(act.metadata.detalleEnvio, /Business API/);
});
