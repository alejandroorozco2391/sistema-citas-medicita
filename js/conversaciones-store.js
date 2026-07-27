/* ═══════════════════════════════════════════════════════════════════════
   conversaciones-store.js — Capa de persistencia de MediInbox

   Ya no toca localStorage. Delega en js/api.mjs, que decide si los datos
   viven en este navegador (demo pública) o en Postgres (clínica real).

   Esta es exactamente la migración para la que se escribió el archivo:
   todas sus funciones devolvían Promise desde el primer día, aunque
   localStorage fuera síncrono, precisamente para que llegado este
   momento hubiera que reescribir cuerpos y no llamadas. Ni conversaciones.js
   ni chat.js ni los adaptadores cambiaron una línea por esto.

   Lo que SÍ sigue viviendo aquí es lo que es del inbox y no de la
   persistencia: el cruce de teléfonos entre canales, la normalización de
   texto para el buscador, y `ingerir()`, que es el punto de entrada
   único de todo lo que llega de un canal externo.

   ── La capa de datos ────────────────────────────────────────────────────
   En el navegador la publica js/puente-api.mjs como `window.API`. En las
   pruebas de node se inyecta con `_usarDatos()`, porque ahí no hay
   `window` ni módulos ES cargables desde un script clásico.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Constantes ──────────────────────────────────────────────────────── */
const CLAVE_CONV = "medicita_conversaciones";
const CLAVE_MSG = "medicita_mensajes";

const MAX_CONVERSACIONES = 200;
const MAX_MENSAJES = 5000;

const CANALES = ["medibot", "whatsapp", "voz", "chat_web"];
const ESTADOS = ["abierta", "requiere_atencion_humana", "resuelta"];

/* ─── Capa de datos ───────────────────────────────────────────────────── */
let _inyectada = null;

/** Inyecta la capa de datos. Solo lo usan las pruebas. */
function _usarDatos(api) {
  _inyectada = api;
}

function _api() {
  const api = _inyectada || (typeof window !== "undefined" ? window.API : null);
  if (!api) {
    throw new Error(
      "conversaciones-store: no hay capa de datos disponible. " +
      "En el navegador la publica js/puente-api.mjs; en pruebas, usa _usarDatos()."
    );
  }
  return api;
}

/* ─── Utilidades del inbox ────────────────────────────────────────────── */
/** Normaliza un teléfono a solo dígitos. */
function normalizarTel(tel) {
  return String(tel || "").replace(/\D/g, "");
}

/**
 * Clave de comparación entre teléfonos de distintas fuentes.
 *
 * El problema real: WhatsApp entrega el número en formato internacional
 * ("525588112233") y el expediente lo guarda como lo tecleó la asistente
 * ("55 8811 2233"). Comparando dígito a dígito nunca cruzarían, y toda
 * conversación de WhatsApp quedaría huérfana de expediente.
 *
 * Solución: comparar por los últimos 10 dígitos, que en México es el
 * número nacional completo (lada + local), sin importar si viene con el
 * 52 al frente, con +, o con el 1 de celular que usan algunos gateways.
 */
function claveTel(tel) {
  const d = normalizarTel(tel);
  return d.length > 10 ? d.slice(-10) : d;
}

/** Quita acentos y pasa a minúsculas — mismo criterio que admin.js/chat.js. */
function normalizarTexto(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/* ─── Pacientes (única lectura del expediente desde el inbox) ─────────── */
/**
 * Resuelve el perfil de paciente que corresponde a un teléfono.
 * Devuelve null si es un lead sin perfil todavía — caso normal y válido.
 */
async function resolverPaciente(telefono) {
  if (!claveTel(telefono)) return null;
  try {
    return await _api().pacientes.porTelefono(telefono);
  } catch {
    return null;
  }
}

/* ─── Conversaciones ──────────────────────────────────────────────────── */
async function listarConversaciones(filtros = {}) {
  return _api().conversaciones.listar(filtros);
}

async function obtenerConversacion(id) {
  return _api().conversaciones.obtener(id);
}

/**
 * Upsert de conversación.
 *
 * Identidad: `claveExterna` si el canal la aporta (conversation_id de
 * ElevenLabs, id de sesión de MediBot). Si no, la dupla canal+teléfono —
 * que es lo correcto para WhatsApp, donde el hilo con un contacto es
 * continuo y no tiene fin natural.
 */
async function crearOActualizarConversacion(datos) {
  return _api().conversaciones.upsert(datos);
}

async function cambiarEstado(id, estado) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  return _api().conversaciones.cambiarEstado(id, estado);
}

async function marcarLeida(id) {
  return _api().conversaciones.marcarLeida(id);
}

async function eliminarConversacion(id) {
  return _api().conversaciones.eliminar(id);
}

/* ─── Mensajes ────────────────────────────────────────────────────────── */
async function listarMensajes(conversacionId) {
  return _api().mensajes.listar(conversacionId);
}

/**
 * Agrega un mensaje. El resumen desnormalizado de la conversación
 * (ultimoMensaje / noLeidos / actualizadaEn) lo sincroniza la capa de
 * datos: en local a mano, en Postgres con un disparador. Eso importa
 * porque los webhooks van a insertar mensajes sin pasar por el navegador.
 */
async function agregarMensaje(conversacionId, msg) {
  return _api().mensajes.agregar(conversacionId, msg);
}

async function actualizarEstadoEnvio(mensajeId, estadoEnvio, detalle) {
  return _api().mensajes.actualizarEstadoEnvio(mensajeId, estadoEnvio, detalle);
}

/* ─── Ingesta desde adaptadores ───────────────────────────────────────── */
/**
 * Punto de entrada único para todo lo que viene de un canal externo.
 * Recibe la salida ya normalizada de un adaptador y la persiste,
 * resolviendo de paso el vínculo con el expediente del paciente.
 *
 * El día que exista el webhook de WhatsApp, va a llamar a esta misma
 * función con la salida del mismo adaptador. Es cableado, no reescritura.
 */
async function ingerir(normalizado) {
  const { conversacion, mensajes } = normalizado;

  if (!conversacion.pacienteId) {
    const pac = await resolverPaciente(conversacion.telefono);
    if (pac) {
      conversacion.pacienteId = pac.id;
      if (!conversacion.nombreContacto || conversacion.nombreContacto === "Contacto sin nombre") {
        conversacion.nombreContacto = `${pac.nombre} ${pac.apellidos}`.trim();
      }
    }
  }

  const conv = await crearOActualizarConversacion(conversacion);
  for (const m of mensajes || []) {
    await agregarMensaje(conv.id, m);
  }
  return conv;
}

/* ─── Métricas para la cabecera ───────────────────────────────────────── */
async function contarPorEstado() {
  return _api().conversaciones.contarPorEstado();
}

/* ─── Siembra de demo ─────────────────────────────────────────────────── */
/**
 * Siembra el dataset de muestra solo si no hay nada. El dataset vive en
 * js/conversaciones-demo.js (global `CONVERSACIONES_DEMO`), separado para
 * que el store no cargue con datos de mentira.
 *
 * No siembra nunca contra una clínica real: meterle nueve conversaciones
 * inventadas al inbox de un consultorio en producción sería peor que
 * mostrarlo vacío.
 */
async function sembrarDemoSiVacio() {
  if (typeof window !== "undefined" && window.MODO_DATOS === "remoto") return false;

  const { total } = await contarPorEstado();
  if (total > 0) return false;

  const demo = typeof CONVERSACIONES_DEMO !== "undefined" ? CONVERSACIONES_DEMO : null;
  if (!demo) return false;

  for (const item of demo) await ingerir(item);
  return true;
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CLAVE_CONV, CLAVE_MSG, CANALES, ESTADOS, MAX_CONVERSACIONES, MAX_MENSAJES,
    normalizarTel, claveTel, normalizarTexto,
    resolverPaciente, listarConversaciones, obtenerConversacion,
    crearOActualizarConversacion, cambiarEstado, marcarLeida, eliminarConversacion,
    listarMensajes, agregarMensaje, actualizarEstadoEnvio,
    ingerir, contarPorEstado, sembrarDemoSiVacio,
    _usarDatos,
  };
}
