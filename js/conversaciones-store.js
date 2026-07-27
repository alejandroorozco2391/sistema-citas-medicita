/* ═══════════════════════════════════════════════════════════════════════
   conversaciones-store.js — Capa de persistencia de MediInbox

   Es el ÚNICO módulo del inbox que toca localStorage. Nadie más lee ni
   escribe `medicita_conversaciones`, `medicita_mensajes` ni
   `medicita_pacientes` desde este módulo en adelante.

   Todas las funciones devuelven Promise aunque debajo localStorage sea
   síncrono. Eso es deliberado: el día que exista backend, migrar es
   reescribir el cuerpo de estas funciones (fetch a /api/conversaciones)
   sin tocar una sola línea de quien las llama.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Constantes ──────────────────────────────────────────────────────── */
const CLAVE_CONV = "medicita_conversaciones";
const CLAVE_MSG = "medicita_mensajes";
const CLAVE_PACIENTES = "medicita_pacientes";

const MAX_CONVERSACIONES = 200;
const MAX_MENSAJES = 5000;

const CANALES = ["medibot", "whatsapp", "voz", "chat_web"];
const ESTADOS = ["abierta", "requiere_atencion_humana", "resuelta"];

/* ─── Utilidades internas ─────────────────────────────────────────────── */
function _leer(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) || "[]");
  } catch {
    return [];
  }
}

function _guardar(clave, datos) {
  localStorage.setItem(clave, JSON.stringify(datos));
}

/**
 * Normaliza un teléfono a solo dígitos.
 *
 * pacientes.js usa `.replace(/\s/g,"")` — solo quita espacios. Aquí se
 * quita todo lo que no sea dígito, que es estrictamente más permisivo:
 * cualquier par de teléfonos que coincidiera quitando espacios también
 * coincide quitando no-dígitos. Así "55 1234 5678" y "55-1234-5678"
 * resuelven al mismo paciente, cosa que pacientes.js no logra.
 */
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

function _idConversacion() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `CONV-${yyyy}${mm}${dd}-${rand}`;
}

function _idMensaje() {
  return `MSG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
  const tel = claveTel(telefono);
  if (!tel) return null;
  let pacientes = [];
  try {
    pacientes = JSON.parse(localStorage.getItem(CLAVE_PACIENTES) || "[]");
  } catch {
    return null;
  }
  return pacientes.find(p => claveTel(p.telefono) === tel) || null;
}

/* ─── Conversaciones ──────────────────────────────────────────────────── */
async function listarConversaciones(filtros = {}) {
  const { canal, estado, texto } = filtros;
  let convs = _leer(CLAVE_CONV);

  if (canal && canal !== "todos") convs = convs.filter(c => c.canal === canal);
  if (estado && estado !== "todos") convs = convs.filter(c => c.estado === estado);

  if (texto && texto.trim()) {
    const q = normalizarTexto(texto);
    // Buscar en la conversación y también dentro del cuerpo de sus mensajes,
    // para que "dolor de cabeza" encuentre el hilo donde se dijo.
    const mensajes = _leer(CLAVE_MSG);
    const convsConMatch = new Set(
      mensajes
        .filter(m => normalizarTexto(m.contenido).includes(q))
        .map(m => m.conversacionId)
    );
    const qDigitos = q.replace(/\D/g, "");
    convs = convs.filter(c => {
      if (normalizarTexto(c.nombreContacto).includes(q)) return true;
      if (normalizarTexto(c.asunto).includes(q)) return true;
      if (convsConMatch.has(c.id)) return true;
      // Solo comparar teléfonos si la búsqueda trae dígitos; si no,
      // includes("") daría true para todos.
      if (qDigitos && normalizarTel(c.telefono).includes(qDigitos)) return true;
      return false;
    });
  }

  return convs.sort((a, b) => new Date(b.actualizadaEn) - new Date(a.actualizadaEn));
}

async function obtenerConversacion(id) {
  return _leer(CLAVE_CONV).find(c => c.id === id) || null;
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
  const convs = _leer(CLAVE_CONV);
  const ahora = new Date().toISOString();
  const tel = claveTel(datos.telefono);

  let idx = -1;
  if (datos.claveExterna) {
    idx = convs.findIndex(c => c.claveExterna && c.claveExterna === datos.claveExterna);
  }
  if (idx === -1 && tel) {
    idx = convs.findIndex(c => c.canal === datos.canal && claveTel(c.telefono) === tel);
  }

  if (idx !== -1) {
    const prev = convs[idx];
    convs[idx] = {
      ...prev,
      ...datos,
      id: prev.id,
      creadaEn: prev.creadaEn,
      // No degradar datos ya conocidos con vacíos que venga trayendo el payload
      nombreContacto: datos.nombreContacto || prev.nombreContacto,
      pacienteId: datos.pacienteId || prev.pacienteId,
      asunto: datos.asunto || prev.asunto,
      estado: datos.estado || prev.estado,
      ultimoMensaje: prev.ultimoMensaje,
      noLeidos: prev.noLeidos,
      actualizadaEn: ahora,
    };
    _guardar(CLAVE_CONV, convs);
    return convs[idx];
  }

  const nueva = {
    id: _idConversacion(),
    claveExterna: datos.claveExterna || null,
    pacienteId: datos.pacienteId || null,
    telefono: datos.telefono || "",
    nombreContacto: datos.nombreContacto || "Contacto sin nombre",
    canal: CANALES.includes(datos.canal) ? datos.canal : "chat_web",
    canalMeta: datos.canalMeta || {},
    estado: ESTADOS.includes(datos.estado) ? datos.estado : "abierta",
    asunto: datos.asunto || "",
    ultimoMensaje: null,
    noLeidos: 0,
    creadaEn: ahora,
    actualizadaEn: ahora,
    cerradaEn: null,
  };

  convs.push(nueva);
  _podarConversaciones(convs);
  _guardar(CLAVE_CONV, convs);
  return nueva;
}

async function cambiarEstado(id, estado) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  const convs = _leer(CLAVE_CONV);
  const conv = convs.find(c => c.id === id);
  if (!conv) return null;
  conv.estado = estado;
  conv.actualizadaEn = new Date().toISOString();
  conv.cerradaEn = estado === "resuelta" ? conv.actualizadaEn : null;
  _guardar(CLAVE_CONV, convs);
  return conv;
}

async function marcarLeida(id) {
  const convs = _leer(CLAVE_CONV);
  const conv = convs.find(c => c.id === id);
  if (!conv) return;
  conv.noLeidos = 0;
  _guardar(CLAVE_CONV, convs);
}

async function eliminarConversacion(id) {
  _guardar(CLAVE_CONV, _leer(CLAVE_CONV).filter(c => c.id !== id));
  _guardar(CLAVE_MSG, _leer(CLAVE_MSG).filter(m => m.conversacionId !== id));
}

/* ─── Mensajes ────────────────────────────────────────────────────────── */
async function listarMensajes(conversacionId) {
  return _leer(CLAVE_MSG)
    .filter(m => m.conversacionId === conversacionId)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

/**
 * Agrega un mensaje y sincroniza el resumen desnormalizado de la
 * conversación (ultimoMensaje / noLeidos / actualizadaEn), que es lo que
 * permite dibujar el panel izquierdo sin leer el corpus de mensajes.
 */
async function agregarMensaje(conversacionId, msg) {
  const mensajes = _leer(CLAVE_MSG);
  const nuevo = {
    id: msg.id || _idMensaje(),
    conversacionId,
    remitente: msg.remitente || "sistema",
    autorNombre: msg.autorNombre || "",
    tipo: msg.tipo || "texto",
    contenido: msg.contenido || "",
    audioUrl: msg.audioUrl || null,
    duracionSeg: msg.duracionSeg ?? null,
    estadoEnvio: msg.estadoEnvio || (msg.remitente === "paciente" ? "recibido" : "enviado"),
    metadata: msg.metadata || {},
    fecha: msg.fecha || new Date().toISOString(),
  };

  // Idempotencia: reingerir el mismo payload no debe duplicar el hilo.
  if (mensajes.some(m => m.id === nuevo.id)) return nuevo;

  mensajes.push(nuevo);
  _podarMensajes(mensajes);
  _guardar(CLAVE_MSG, mensajes);

  const convs = _leer(CLAVE_CONV);
  const conv = convs.find(c => c.id === conversacionId);
  if (conv) {
    // Las notas internas no son "el último mensaje" del hilo con el paciente.
    if (nuevo.tipo !== "nota_interna") {
      conv.ultimoMensaje = {
        texto: nuevo.tipo === "audio" ? "🎧 Mensaje de voz" : nuevo.contenido,
        remitente: nuevo.remitente,
        fecha: nuevo.fecha,
      };
    }
    conv.actualizadaEn = nuevo.fecha;
    if (nuevo.remitente === "paciente") conv.noLeidos = (conv.noLeidos || 0) + 1;
    _guardar(CLAVE_CONV, convs);
  }

  return nuevo;
}

async function actualizarEstadoEnvio(mensajeId, estadoEnvio, detalle) {
  const mensajes = _leer(CLAVE_MSG);
  const m = mensajes.find(x => x.id === mensajeId);
  if (!m) return null;
  m.estadoEnvio = estadoEnvio;
  if (detalle) m.metadata = { ...m.metadata, detalleEnvio: detalle };
  _guardar(CLAVE_MSG, mensajes);
  return m;
}

/* ─── Ingesta desde adaptadores ───────────────────────────────────────── */
/**
 * Punto de entrada único para todo lo que viene de un canal externo.
 * Recibe la salida ya normalizada de un adaptador y la persiste,
 * resolviendo de paso el vínculo con el expediente del paciente.
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

/* ─── Poda FIFO ───────────────────────────────────────────────────────── */
function _podarConversaciones(convs) {
  if (convs.length <= MAX_CONVERSACIONES) return;
  convs.sort((a, b) => new Date(a.actualizadaEn) - new Date(b.actualizadaEn));
  const sobran = convs.splice(0, convs.length - MAX_CONVERSACIONES);
  const ids = new Set(sobran.map(c => c.id));
  _guardar(CLAVE_MSG, _leer(CLAVE_MSG).filter(m => !ids.has(m.conversacionId)));
}

function _podarMensajes(mensajes) {
  if (mensajes.length <= MAX_MENSAJES) return;
  mensajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  mensajes.splice(0, mensajes.length - MAX_MENSAJES);
}

/* ─── Métricas para la cabecera ───────────────────────────────────────── */
async function contarPorEstado() {
  const convs = _leer(CLAVE_CONV);
  return {
    total: convs.length,
    abierta: convs.filter(c => c.estado === "abierta").length,
    requiere_atencion_humana: convs.filter(c => c.estado === "requiere_atencion_humana").length,
    resuelta: convs.filter(c => c.estado === "resuelta").length,
    noLeidos: convs.reduce((s, c) => s + (c.noLeidos || 0), 0),
  };
}

/* ─── Siembra de demo ─────────────────────────────────────────────────── */
/**
 * Siembra el dataset de muestra solo si no hay nada. El dataset vive en
 * js/conversaciones-demo.js (global `CONVERSACIONES_DEMO`), separado para
 * que el store no cargue con datos de mentira.
 */
async function sembrarDemoSiVacio() {
  if (_leer(CLAVE_CONV).length > 0) return false;
  const demo = typeof CONVERSACIONES_DEMO !== "undefined" ? CONVERSACIONES_DEMO : null;
  if (!demo) return false;
  for (const item of demo) await ingerir(item);
  return true;
}

async function borrarTodo() {
  localStorage.removeItem(CLAVE_CONV);
  localStorage.removeItem(CLAVE_MSG);
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CLAVE_CONV, CLAVE_MSG, CANALES, ESTADOS, MAX_CONVERSACIONES, MAX_MENSAJES,
    normalizarTel, claveTel, normalizarTexto,
    resolverPaciente, listarConversaciones, obtenerConversacion,
    crearOActualizarConversacion, cambiarEstado, marcarLeida, eliminarConversacion,
    listarMensajes, agregarMensaje, actualizarEstadoEnvio,
    ingerir, contarPorEstado, sembrarDemoSiVacio, borrarTodo,
  };
}
