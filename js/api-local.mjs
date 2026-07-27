/* ═══════════════════════════════════════════════════════════════════════
   api-local.mjs — Implementación de api.mjs sobre localStorage

   Esta es la implementación que mantiene viva la demo pública: cualquier
   visitante puede abrir el sistema, sin registrarse y sin backend, y todo
   sigue funcionando exactamente igual que hoy. api.mjs decide, según si
   hay sesión de Supabase iniciada, si delega aquí o en api-remoto.mjs.

   No inventa un modelo de datos nuevo: reutiliza y centraliza la lógica
   que ya vivía repartida en pacientes.js, admin.js, app.js, medipost.js,
   medidocs.js, encuesta.js y conversaciones-store.js. La idea es que esos
   módulos, cuando migren a llamar api.mjs en vez de tocar localStorage
   directamente, no encuentren sorpresas: las formas de los objetos son
   las mismas (camelCase, folio, creadoEn, etc.) que ya existen hoy.

   Todas las funciones son async y devuelven Promise aunque localStorage
   sea síncrono — es a propósito, para que el comportamiento sea idéntico
   al de api-remoto.mjs (que sí hace round-trips de red).
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Claves de localStorage ──────────────────────────────────────────── */
const CLAVE_CLINICA = "medicita_config_clinica";
const CLAVE_PACIENTES = "medicita_pacientes";
const CLAVE_CITAS = "medicita_citas";
const CLAVE_CONV = "medicita_conversaciones";
const CLAVE_MSG = "medicita_mensajes";
const CLAVE_DOCS = "medicita_docs";
const CLAVE_POSTS = "medicita_posts";
const CLAVE_NPS = "medicita_nps";
const CLAVE_FOLLOWUP = "medicita_followup_pendientes";

/* ─── Topes FIFO (mismos límites que ya usan pacientes.js/medipost.js/
       medidocs.js/conversaciones-store.js hoy) ───────────────────────── */
const MAX_POSTS = 50;
const MAX_DOCS = 100;
const MAX_CONVERSACIONES = 200;
const MAX_MENSAJES = 5000;
const MAX_NOTAS_PACIENTE = 20;

const CANALES = ["medibot", "whatsapp", "voz", "chat_web"];
const ESTADOS_CONV = ["abierta", "requiere_atencion_humana", "resuelta"];

/* ─── Utilidades internas ─────────────────────────────────────────────── */
/** Lee un arreglo de localStorage. Si el JSON está corrupto, [] en vez de tronar. */
function _leer(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) || "[]");
  } catch {
    return [];
  }
}

/** Lee un objeto único de localStorage (config de clínica). */
function _leerObjeto(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) || "{}");
  } catch {
    return {};
  }
}

function _guardar(clave, datos) {
  localStorage.setItem(clave, JSON.stringify(datos));
}

/**
 * Normaliza un teléfono a solo dígitos.
 * Estrictamente más permisivo que un simple `.replace(/\s/g,"")`: cualquier
 * par de teléfonos que coincidiera quitando espacios también coincide
 * quitando todo lo que no sea dígito.
 */
function normalizarTel(tel) {
  return String(tel || "").replace(/\D/g, "");
}

/**
 * Clave de comparación entre teléfonos de distintas fuentes (WhatsApp en
 * formato internacional vs. lo que tecleó la asistente). Se comparan los
 * últimos 10 dígitos, que en México son la lada + el número local completo.
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

/** Inserta al frente y poda por el final cuando se pasa el tope (FIFO). */
function _agregarConTope(arr, item, max) {
  arr.unshift(item);
  while (arr.length > max) arr.pop();
  return arr;
}

function _idPaciente() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `PAC-${yyyy}${mm}${dd}-${rand}`;
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

function _idDoc() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function _idPost() {
  return `POST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function _idNPS() {
  return `NPS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Folio de cita: mismo formato que generarFolio() en app.js / generarFolioAdmin() en admin.js. */
function _generarFolioCita() {
  const d = new Date();
  const aa = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return `CIT-${aa}${mm}${dd}-${rnd}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Clínica
   ═══════════════════════════════════════════════════════════════════════ */
export async function clinicaObtener() {
  return _leerObjeto(CLAVE_CLINICA);
}

export async function clinicaGuardar(cfg) {
  const datos = cfg || {};
  _guardar(CLAVE_CLINICA, datos);
  return datos;
}

/* ═══════════════════════════════════════════════════════════════════════
   Pacientes

   Reutiliza la lógica de pacientes.js (leerPacientes/guardarPacientes/
   pacientesVincularCita/agregarNotaPac), adaptada a la interfaz async de
   api.mjs.
   ═══════════════════════════════════════════════════════════════════════ */
export async function pacientesListar(filtros = {}) {
  const { busqueda, calificacion, sexo, comoNosEncontro } = filtros;
  return _leer(CLAVE_PACIENTES).filter((p) => {
    if (busqueda && busqueda.trim()) {
      const texto = normalizarTexto(`${p.nombre} ${p.apellidos} ${p.telefono} ${p.email}`);
      if (!texto.includes(normalizarTexto(busqueda))) return false;
    }
    if (calificacion && p.calificacion !== Number(calificacion)) return false;
    if (sexo && p.sexo !== sexo) return false;
    if (comoNosEncontro && p.comoNosEncontro !== comoNosEncontro) return false;
    return true;
  });
}

export async function pacientesObtener(id) {
  return _leer(CLAVE_PACIENTES).find((p) => p.id === id) || null;
}

export async function pacientesPorTelefono(tel) {
  const clave = claveTel(tel);
  if (!clave) return null;
  return _leer(CLAVE_PACIENTES).find((p) => claveTel(p.telefono) === clave) || null;
}

/**
 * Upsert de paciente. Con `id` que ya existe: mezcla los cambios sobre el
 * registro actual. Con `id` nuevo o sin `id`: crea un perfil completo con
 * los valores por defecto que ya usa el modal "Nuevo paciente" en
 * pacientes.js (arreglos vacíos, calificación 1, etc.).
 */
export async function pacientesGuardar(pac) {
  const pacientes = _leer(CLAVE_PACIENTES);
  const ahora = new Date().toISOString();
  const idx = pac.id ? pacientes.findIndex((p) => p.id === pac.id) : -1;

  if (idx >= 0) {
    pacientes[idx] = { ...pacientes[idx], ...pac, actualizadoEn: ahora };
    _guardar(CLAVE_PACIENTES, pacientes);
    return pacientes[idx];
  }

  const nuevo = {
    id: pac.id || _idPaciente(),
    nombre: "", apellidos: "", telefono: "", email: "",
    fechaNacimiento: "", sexo: "", estatura: "", peso: "",
    tipoSangre: "", alergias: "", enfermedadesCronicas: "", medicamentosActuales: "",
    tieneSeguro: false, nombreSeguro: "", numeroPoliza: "",
    ciudad: "", comoNosEncontro: "", ocupacion: "",
    calificacion: 1, notas: "", historialNotas: [],
    foliosCitas: [], foliosDocs: [], respuestasNPS: [],
    ...pac,
    creadoEn: pac.creadoEn || ahora,
    actualizadoEn: ahora,
  };
  pacientes.unshift(nuevo);
  _guardar(CLAVE_PACIENTES, pacientes);
  return nuevo;
}

export async function pacientesEliminar(id) {
  const pacientes = _leer(CLAVE_PACIENTES);
  const filtrados = pacientes.filter((p) => p.id !== id);
  _guardar(CLAVE_PACIENTES, filtrados);
  return filtrados.length !== pacientes.length;
}

export async function pacientesNotas(id) {
  const pac = await pacientesObtener(id);
  return pac?.historialNotas || [];
}

/** Igual que agregarNotaPac() en pacientes.js: más nueva al frente, tope 20. */
export async function pacientesAgregarNota(id, texto, autor) {
  const pacientes = _leer(CLAVE_PACIENTES);
  const idx = pacientes.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const historial = [...(pacientes[idx].historialNotas || [])];
  const nota = { texto, autor: autor || "", creadoEn: new Date().toISOString() };
  historial.unshift(nota);
  if (historial.length > MAX_NOTAS_PACIENTE) historial.splice(MAX_NOTAS_PACIENTE);

  pacientes[idx] = { ...pacientes[idx], historialNotas: historial, actualizadoEn: nota.creadoEn };
  _guardar(CLAVE_PACIENTES, pacientes);
  return nota;
}

/**
 * Crea o vincula el perfil de paciente correspondiente a una cita, por
 * teléfono (usando `claveTel`, no comparación literal). Es la lógica que
 * hoy está duplicada entre vincularPacienteDesdeIndex() (app.js) y
 * pacientesVincularCita() (pacientes.js), centralizada aquí para que
 * citasCrear/citasActualizar/publicoSolicitarCita compartan una sola
 * versión.
 */
function _asegurarPacientePorCita(cita) {
  const clave = claveTel(cita.telefono);
  if (!clave) return null;

  const pacientes = _leer(CLAVE_PACIENTES);
  const ahora = new Date().toISOString();
  const idx = pacientes.findIndex((p) => claveTel(p.telefono) === clave);

  if (idx >= 0) {
    const actualizaciones = { actualizadoEn: ahora };
    if (cita.folio && !pacientes[idx].foliosCitas.includes(cita.folio)) {
      actualizaciones.foliosCitas = [...pacientes[idx].foliosCitas, cita.folio];
    }
    if (cita.tieneSeguro) {
      actualizaciones.tieneSeguro = true;
      actualizaciones.nombreSeguro = cita.nombreSeguro || "";
      actualizaciones.numeroPoliza = cita.numeroPoliza || "";
    }
    pacientes[idx] = { ...pacientes[idx], ...actualizaciones };
    _guardar(CLAVE_PACIENTES, pacientes);
    return pacientes[idx];
  }

  const nuevo = {
    id: _idPaciente(),
    nombre: cita.nombre || "",
    apellidos: cita.apellidos || "",
    telefono: cita.telefono || "",
    email: cita.email || "",
    fechaNacimiento: "", sexo: "", estatura: "", peso: "",
    tipoSangre: "", alergias: "", enfermedadesCronicas: "", medicamentosActuales: "",
    tieneSeguro: cita.tieneSeguro || false,
    nombreSeguro: cita.nombreSeguro || "",
    numeroPoliza: cita.numeroPoliza || "",
    ciudad: "", comoNosEncontro: "", ocupacion: "",
    calificacion: 1, notas: "", historialNotas: [],
    foliosCitas: cita.folio ? [cita.folio] : [],
    foliosDocs: [], respuestasNPS: [],
    creadoEn: ahora, actualizadoEn: ahora,
  };
  pacientes.unshift(nuevo);
  _guardar(CLAVE_PACIENTES, pacientes);
  return nuevo;
}

/* ═══════════════════════════════════════════════════════════════════════
   Citas

   Nota de identidad: hoy una cita en localStorage no tiene un `id`
   separado de su `folio` (así la crean app.js y admin.js). Aquí se trata
   el folio como el identificador: `citasObtener(id)` busca por folio.
   ═══════════════════════════════════════════════════════════════════════ */
export async function citasListar(filtros = {}) {
  const { busqueda, fecha, doctor, estado } = filtros;
  let citas = _leer(CLAVE_CITAS);

  if (busqueda && busqueda.trim()) {
    const q = normalizarTexto(busqueda);
    citas = citas.filter((c) =>
      normalizarTexto(`${c.nombre} ${c.apellidos} ${c.folio} ${c.especialidad} ${c.doctor}`).includes(q)
    );
  }
  if (fecha) citas = citas.filter((c) => c.fecha === fecha);
  if (doctor) citas = citas.filter((c) => c.doctor === doctor);
  if (estado) citas = citas.filter((c) => c.estado === estado);

  return citas.sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn));
}

export async function citasObtener(id) {
  return _leer(CLAVE_CITAS).find((c) => c.folio === id) || null;
}

export async function citasPorFolio(folio) {
  return _leer(CLAVE_CITAS).find((c) => c.folio === folio) || null;
}

/**
 * Crea una cita. Si no trae folio, genera uno con el mismo formato que
 * usan app.js y admin.js (CIT-AAMMDD-XXXX). Vincula automáticamente el
 * perfil de paciente por teléfono, igual que guardarCitaEnStorage() +
 * vincularPacienteDesdeIndex() hacen hoy en conjunto.
 */
export async function citasCrear(cita) {
  const citas = _leer(CLAVE_CITAS);
  const folio = cita.folio || _generarFolioCita();
  const nueva = {
    folio,
    nombre: cita.nombre || "",
    apellidos: cita.apellidos || "",
    telefono: cita.telefono || "",
    email: cita.email || "",
    especialidad: cita.especialidad || "",
    doctor: cita.doctor || "",
    fecha: cita.fecha || "",
    hora: cita.hora || "",
    tipo: cita.tipo || "",
    notas: cita.notas || "",
    tieneSeguro: cita.tieneSeguro || false,
    nombreSeguro: cita.nombreSeguro || "",
    numeroPoliza: cita.numeroPoliza || "",
    estado: cita.estado || "pendiente",
    creadaEn: cita.creadaEn || new Date().toISOString(),
    ...(cita.origenManual ? { origenManual: true } : {}),
  };

  citas.unshift(nueva);
  _guardar(CLAVE_CITAS, citas);
  _asegurarPacientePorCita(nueva);
  return nueva;
}

export async function citasActualizar(id, cambios) {
  const citas = _leer(CLAVE_CITAS);
  const idx = citas.findIndex((c) => c.folio === id);
  if (idx === -1) return null;

  citas[idx] = { ...citas[idx], ...cambios };
  _guardar(CLAVE_CITAS, citas);
  _asegurarPacientePorCita(citas[idx]);
  return citas[idx];
}

export async function citasEliminar(id) {
  const citas = _leer(CLAVE_CITAS);
  const filtradas = citas.filter((c) => c.folio !== id);
  _guardar(CLAVE_CITAS, filtradas);
  return filtradas.length !== citas.length;
}

/* ═══════════════════════════════════════════════════════════════════════
   Conversaciones y mensajes (MediInbox)

   Copiado y adaptado de conversaciones-store.js: mismo modelo, mismos
   nombres de campos, misma poda FIFO. Se agrega la resolución automática
   de `pacienteId` por teléfono en el upsert (lo que antes hacía la función
   `ingerir()` de los adaptadores), para no perder esa vinculación al pasar
   por la capa única de api.mjs.
   ═══════════════════════════════════════════════════════════════════════ */
export async function conversacionesListar(filtros = {}) {
  const { canal, estado, texto } = filtros;
  let convs = _leer(CLAVE_CONV);

  if (canal && canal !== "todos") convs = convs.filter((c) => c.canal === canal);
  if (estado && estado !== "todos") convs = convs.filter((c) => c.estado === estado);

  if (texto && texto.trim()) {
    const q = normalizarTexto(texto);
    const mensajes = _leer(CLAVE_MSG);
    const convsConMatch = new Set(
      mensajes.filter((m) => normalizarTexto(m.contenido).includes(q)).map((m) => m.conversacionId)
    );
    const qDigitos = q.replace(/\D/g, "");
    convs = convs.filter((c) => {
      if (normalizarTexto(c.nombreContacto).includes(q)) return true;
      if (normalizarTexto(c.asunto).includes(q)) return true;
      if (convsConMatch.has(c.id)) return true;
      if (qDigitos && normalizarTel(c.telefono).includes(qDigitos)) return true;
      return false;
    });
  }

  return convs.sort((a, b) => new Date(b.actualizadaEn) - new Date(a.actualizadaEn));
}

export async function conversacionesObtener(id) {
  return _leer(CLAVE_CONV).find((c) => c.id === id) || null;
}

/**
 * Upsert de conversación. Identidad: `claveExterna` si el canal la aporta
 * (conversation_id de ElevenLabs, id de sesión de MediBot); si no, la
 * dupla canal+teléfono, correcta para WhatsApp donde el hilo es continuo.
 */
export async function conversacionesUpsert(datos) {
  const convs = _leer(CLAVE_CONV);
  const ahora = new Date().toISOString();
  const tel = claveTel(datos.telefono);

  let idx = -1;
  if (datos.claveExterna) {
    idx = convs.findIndex((c) => c.claveExterna && c.claveExterna === datos.claveExterna);
  }
  if (idx === -1 && tel) {
    idx = convs.findIndex((c) => c.canal === datos.canal && claveTel(c.telefono) === tel);
  }

  // Resuelve el vínculo con el expediente si aún no viene dado.
  let pacienteId = datos.pacienteId || null;
  let nombreContacto = datos.nombreContacto;
  if (!pacienteId && tel) {
    const pac = await pacientesPorTelefono(datos.telefono);
    if (pac) {
      pacienteId = pac.id;
      if (!nombreContacto || nombreContacto === "Contacto sin nombre") {
        nombreContacto = `${pac.nombre} ${pac.apellidos}`.trim();
      }
    }
  }

  if (idx !== -1) {
    const prev = convs[idx];
    convs[idx] = {
      ...prev,
      ...datos,
      id: prev.id,
      creadaEn: prev.creadaEn,
      nombreContacto: nombreContacto || prev.nombreContacto,
      pacienteId: pacienteId || prev.pacienteId,
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
    pacienteId: pacienteId,
    telefono: datos.telefono || "",
    nombreContacto: nombreContacto || "Contacto sin nombre",
    canal: CANALES.includes(datos.canal) ? datos.canal : "chat_web",
    canalMeta: datos.canalMeta || {},
    estado: ESTADOS_CONV.includes(datos.estado) ? datos.estado : "abierta",
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

export async function conversacionesCambiarEstado(id, estado) {
  if (!ESTADOS_CONV.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  const convs = _leer(CLAVE_CONV);
  const conv = convs.find((c) => c.id === id);
  if (!conv) return null;
  conv.estado = estado;
  conv.actualizadaEn = new Date().toISOString();
  conv.cerradaEn = estado === "resuelta" ? conv.actualizadaEn : null;
  _guardar(CLAVE_CONV, convs);
  return conv;
}

export async function conversacionesMarcarLeida(id) {
  const convs = _leer(CLAVE_CONV);
  const conv = convs.find((c) => c.id === id);
  if (!conv) return null;
  conv.noLeidos = 0;
  _guardar(CLAVE_CONV, convs);
  return conv;
}

export async function conversacionesEliminar(id) {
  _guardar(CLAVE_CONV, _leer(CLAVE_CONV).filter((c) => c.id !== id));
  _guardar(CLAVE_MSG, _leer(CLAVE_MSG).filter((m) => m.conversacionId !== id));
  return true;
}

export async function conversacionesContarPorEstado() {
  const convs = _leer(CLAVE_CONV);
  return {
    total: convs.length,
    abierta: convs.filter((c) => c.estado === "abierta").length,
    requiere_atencion_humana: convs.filter((c) => c.estado === "requiere_atencion_humana").length,
    resuelta: convs.filter((c) => c.estado === "resuelta").length,
    noLeidos: convs.reduce((s, c) => s + (c.noLeidos || 0), 0),
  };
}

/* ─── Mensajes ─────────────────────────────────────────────────────────── */
export async function mensajesListar(conversacionId) {
  return _leer(CLAVE_MSG)
    .filter((m) => m.conversacionId === conversacionId)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

/**
 * Agrega un mensaje y sincroniza el resumen desnormalizado de la
 * conversación (ultimoMensaje / noLeidos / actualizadaEn), que es lo que
 * permite dibujar el panel izquierdo sin leer todo el corpus de mensajes.
 */
export async function mensajesAgregar(conversacionId, msg) {
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
  if (mensajes.some((m) => m.id === nuevo.id)) return nuevo;

  mensajes.push(nuevo);
  _podarMensajes(mensajes);
  _guardar(CLAVE_MSG, mensajes);

  const convs = _leer(CLAVE_CONV);
  const conv = convs.find((c) => c.id === conversacionId);
  if (conv) {
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

export async function mensajesActualizarEstadoEnvio(id, estado, detalle) {
  const mensajes = _leer(CLAVE_MSG);
  const m = mensajes.find((x) => x.id === id);
  if (!m) return null;
  m.estadoEnvio = estado;
  if (detalle) m.metadata = { ...m.metadata, detalleEnvio: detalle };
  _guardar(CLAVE_MSG, mensajes);
  return m;
}

/* ─── Poda FIFO de conversaciones/mensajes ────────────────────────────── */
function _podarConversaciones(convs) {
  if (convs.length <= MAX_CONVERSACIONES) return;
  convs.sort((a, b) => new Date(a.actualizadaEn) - new Date(b.actualizadaEn));
  const sobran = convs.splice(0, convs.length - MAX_CONVERSACIONES);
  const ids = new Set(sobran.map((c) => c.id));
  _guardar(CLAVE_MSG, _leer(CLAVE_MSG).filter((m) => !ids.has(m.conversacionId)));
}

function _podarMensajes(mensajes) {
  if (mensajes.length <= MAX_MENSAJES) return;
  mensajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  mensajes.splice(0, mensajes.length - MAX_MENSAJES);
}

/* ═══════════════════════════════════════════════════════════════════════
   Documentos clínicos (MediDocs)
   ═══════════════════════════════════════════════════════════════════════ */
export async function documentosListar(filtros = {}) {
  let docs = _leer(CLAVE_DOCS);
  if (filtros.folio) docs = docs.filter((d) => d.folio === filtros.folio);
  if (filtros.pacienteId) {
    const pac = await pacientesObtener(filtros.pacienteId);
    const idsPac = pac?.foliosDocs || [];
    docs = docs.filter((d) => idsPac.includes(d.id));
  }
  return docs.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
}

/**
 * Guarda solo metadatos + inputs (no el HTML del documento, que se
 * regenera con Claude cada vez que se abre — así se evita llenar los 5MB
 * de localStorage). Vincula el documento con el perfil de paciente que
 * tenga ese folio de cita, igual que vincularDocConPacienteMD() en
 * medidocs.js.
 */
export async function documentosCrear(doc) {
  const docs = _leer(CLAVE_DOCS);
  const nuevo = {
    id: doc.id || _idDoc(),
    tipodoc: doc.tipodoc || "",
    folio: doc.folio || "",
    inputs: doc.inputs || {},
    creadoEn: doc.creadoEn || new Date().toISOString(),
  };
  _agregarConTope(docs, nuevo, MAX_DOCS);
  _guardar(CLAVE_DOCS, docs);

  if (nuevo.folio) {
    const pacientes = _leer(CLAVE_PACIENTES);
    const idx = pacientes.findIndex((p) => (p.foliosCitas || []).includes(nuevo.folio));
    if (idx !== -1 && !pacientes[idx].foliosDocs.includes(nuevo.id)) {
      pacientes[idx] = {
        ...pacientes[idx],
        foliosDocs: [...pacientes[idx].foliosDocs, nuevo.id],
        actualizadoEn: new Date().toISOString(),
      };
      _guardar(CLAVE_PACIENTES, pacientes);
    }
  }

  return nuevo;
}

export async function documentosEliminar(id) {
  const docs = _leer(CLAVE_DOCS);
  const filtrados = docs.filter((d) => d.id !== id);
  _guardar(CLAVE_DOCS, filtrados);
  return filtrados.length !== docs.length;
}

/* ═══════════════════════════════════════════════════════════════════════
   Posts (MediPost)
   ═══════════════════════════════════════════════════════════════════════ */
export async function postsListar() {
  return _leer(CLAVE_POSTS).sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
}

export async function postsCrear(post) {
  const posts = _leer(CLAVE_POSTS);
  const nuevo = {
    id: post.id || _idPost(),
    tipo: post.tipo || "",
    especialidad: post.especialidad || "",
    red: post.red || "",
    tono: post.tono || "",
    caption: post.caption || "",
    hashtags: post.hashtags || "",
    sugerenciaImagen: post.sugerenciaImagen || "",
    promptIA: post.promptIA || "",
    llamadaAccion: post.llamadaAccion || "",
    creadoEn: post.creadoEn || new Date().toISOString(),
    borrador: post.borrador ?? false,
    fechaProgramada: post.fechaProgramada ?? null,
  };
  _agregarConTope(posts, nuevo, MAX_POSTS);
  _guardar(CLAVE_POSTS, posts);
  return nuevo;
}

export async function postsActualizar(id, cambios) {
  const posts = _leer(CLAVE_POSTS);
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  posts[idx] = { ...posts[idx], ...cambios };
  _guardar(CLAVE_POSTS, posts);
  return posts[idx];
}

export async function postsEliminar(id) {
  const posts = _leer(CLAVE_POSTS);
  const filtrados = posts.filter((p) => p.id !== id);
  _guardar(CLAVE_POSTS, filtrados);
  return filtrados.length !== posts.length;
}

/* ═══════════════════════════════════════════════════════════════════════
   NPS (encuesta post-consulta)
   ═══════════════════════════════════════════════════════════════════════ */
export async function npsListar() {
  return _leer(CLAVE_NPS);
}

export async function npsYaRespondida(folio) {
  return _leer(CLAVE_NPS).some((r) => r.folio === folio);
}

/** Igual que enviarEncuesta() en encuesta.js, pero rechaza duplicados. */
export async function npsResponder(folio, puntuacion, comentario) {
  if (await npsYaRespondida(folio)) {
    throw new Error(`El folio ${folio} ya tiene una respuesta NPS registrada.`);
  }
  const nps = _leer(CLAVE_NPS);
  const respuesta = {
    id: _idNPS(),
    folio,
    puntuacion,
    comentario: comentario || "",
    fechaRespuesta: new Date().toISOString(),
  };
  nps.unshift(respuesta);
  _guardar(CLAVE_NPS, nps);
  return respuesta;
}

/* ═══════════════════════════════════════════════════════════════════════
   Seguimientos post-consulta (MediFollow: día 3 / día 30)
   ═══════════════════════════════════════════════════════════════════════ */
export async function seguimientosListar() {
  return _leer(CLAVE_FOLLOWUP);
}

/**
 * Registra un seguimiento pendiente para una cita. `citaId` se resuelve
 * como el folio de la cita (misma convención de identidad que citas.*).
 * Idempotente: si el folio ya tiene seguimiento registrado, devuelve el
 * existente en vez de duplicarlo — igual que registrarSeguimientoPendiente()
 * en admin.js.
 */
export async function seguimientosRegistrar(citaId, fechaAtendida) {
  const seguimientos = _leer(CLAVE_FOLLOWUP);
  const existente = seguimientos.find((s) => s.folio === citaId);
  if (existente) return existente;

  const cita = await citasObtener(citaId);
  const registro = {
    id: citaId,
    folio: citaId,
    nombrePaciente: cita ? `${cita.nombre} ${cita.apellidos}`.trim() : "",
    emailPaciente: cita?.email || "",
    fechaAtendida: fechaAtendida || new Date().toISOString(),
    emailEnviado_inmediato: false,
    emailEnviado_3d: false,
    emailEnviado_30d: false,
  };
  seguimientos.unshift(registro);
  _guardar(CLAVE_FOLLOWUP, seguimientos);
  return registro;
}

/** `cual` es "inmediato" | "3d" | "30d" — marca el campo emailEnviado_<cual>. */
export async function seguimientosMarcarEnviado(id, cual) {
  const seguimientos = _leer(CLAVE_FOLLOWUP);
  const item = seguimientos.find((s) => s.folio === id || s.id === id);
  if (!item) return null;
  item[`emailEnviado_${cual}`] = true;
  _guardar(CLAVE_FOLLOWUP, seguimientos);
  return item;
}

/* ═══════════════════════════════════════════════════════════════════════
   Público — solicitud de cita desde la landing, sin sesión

   Replica lo que hace hoy app.js al confirmar una cita: genera folio,
   guarda en medicita_citas y crea o vincula el perfil de paciente por
   teléfono. Se delega en citasCrear() para no duplicar esa lógica.
   ═══════════════════════════════════════════════════════════════════════ */
export async function publicoSolicitarCita(datos) {
  const cita = await citasCrear({ ...datos, estado: "pendiente" });
  return cita.folio;
}
