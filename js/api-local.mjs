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
const CLAVE_HORARIOS = "medicita_horarios";
const CLAVE_ESCALACIONES = "medicita_escalaciones";

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

/**
 * Sufijo único para ids internos.
 *
 * Antes estos ids llevaban 4 dígitos aleatorios: 10 000 combinaciones. Con
 * `_idMensaje` eso era una fuga de datos silenciosa —dos mensajes creados
 * en el mismo milisegundo chocaban con probabilidad 1/10 000, y como
 * `mensajesAgregar` descarta ids repetidos por idempotencia, el segundo
 * mensaje simplemente desaparecía del hilo sin ningún error.
 *
 * Lo cazó una prueba intermitente del inbox. Es la misma clase de defecto
 * que B1 encontró en los folios, y la respuesta es la misma: quitarle el
 * azar al problema en vez de bajarle la probabilidad.
 *
 * Estos ids no son visibles para nadie —los que sí lo son, folio de cita y
 * código de paciente, conservan su formato y se protegen con reintento—,
 * así que aquí se puede usar un UUID sin más.
 */
let _contadorId = 0;
function _sufijoUnico() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  _contadorId = (_contadorId + 1) % 1e9;
  return `${Date.now().toString(36)}-${_contadorId}-${Math.random().toString(36).slice(2, 12)}`;
}

function _idConversacion() {
  return `CONV-${_sufijoUnico()}`;
}

function _idMensaje() {
  return `MSG-${_sufijoUnico()}`;
}

function _idDoc() {
  return _sufijoUnico();
}

function _idPost() {
  return `POST-${_sufijoUnico()}`;
}

function _idNPS() {
  return `NPS-${_sufijoUnico()}`;
}

/**
 * Folio de cita — mismo formato de siempre, `CIT-AAMMDD-XXXX`.
 *
 * Aquí el formato SÍ importa: el paciente lo lee por teléfono, lo trae
 * apuntado y aparece en documentos ya emitidos. Así que en vez de cambiar
 * la forma, se reintenta hasta encontrar uno libre — que es exactamente lo
 * que hace `solicitar_cita` en Postgres contra su índice único.
 *
 * Con 9 000 combinaciones por día y ~60 citas diarias, la probabilidad de
 * choque ronda el 16%: sin esto, tarde o temprano dos pacientes distintos
 * comparten folio.
 */
function _folioCitaLibre(citas) {
  const d = new Date();
  const aa = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const usados = new Set(citas.map((c) => c.folio));

  for (let intento = 0; intento < 50; intento++) {
    const folio = `CIT-${aa}${mm}${dd}-${Math.floor(Math.random() * 9000) + 1000}`;
    if (!usados.has(folio)) return folio;
  }
  /* 50 choques seguidos significa que el día está lleno. Antes que
     devolver un folio repetido en silencio, se avisa. */
  throw new Error("No se pudo generar un folio libre para hoy. Contacta a soporte.");
}

/**
 * Código de paciente — `PAC-AAAAMMDD-XXXX`, con el mismo criterio y el
 * mismo motivo que el folio: aparece en pantalla y en documentos.
 */
function _codigoPacienteLibre(pacientes) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const usados = new Set(pacientes.map((p) => p.id));

  for (let intento = 0; intento < 50; intento++) {
    const id = `PAC-${yyyy}${mm}${dd}-${Math.floor(Math.random() * 9000) + 1000}`;
    if (!usados.has(id)) return id;
  }
  throw new Error("No se pudo generar un código de paciente libre para hoy.");
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

/**
 * Datos de la clínica para la landing, que se pinta sin sesión.
 *
 * En local es lo mismo que clinicaObtener() —hay un solo consultorio y
 * su configuración es el objeto entero—, pero se expone aparte porque en
 * remoto no es lo mismo: allá esto lee la vista `clinica_publica`, que
 * deja fuera el plan contratado y el estado de la cuenta.
 */
export async function publicoClinica() {
  return _leerObjeto(CLAVE_CLINICA);
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
    id: pac.id || _codigoPacienteLibre(pacientes),
    nombre: "", apellidos: "", telefono: "", email: "",
    fechaNacimiento: "", sexo: "", estatura: "", peso: "",
    tipoSangre: "", alergias: "", enfermedadesCronicas: "", medicamentosActuales: "",
    tieneSeguro: false, nombreSeguro: "", numeroPoliza: "",
    ciudad: "", comoNosEncontro: "", ocupacion: "",
    calificacion: 1, notas: "", historialNotas: [],
    foliosCitas: [], foliosDocs: [], respuestasNPS: [],
    ...preferenciasDeAviso(),
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
    id: _codigoPacienteLibre(pacientes),
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
    ...preferenciasDeAviso(),
    creadoEn: ahora, actualizadoEn: ahora,
  };
  pacientes.unshift(nuevo);
  _guardar(CLAVE_PACIENTES, pacientes);
  return nuevo;
}

/**
 * Consentimiento y token de baja, espejo de las columnas que 0014 agregó a
 * `pacientes`.
 *
 * En modo local no hay reloj y por lo tanto no sale ningún correo
 * automático, así que esto no se usa para nada… salvo que la página de baja
 * exista en los dos modos. Y tiene que existir: si solo funcionara contra
 * el backend, `baja.html` quedaría escrita contra un contrato que se cumple
 * a medias, que es exactamente el error que ya cometimos con los
 * testimonios.
 */
function preferenciasDeAviso() {
  return {
    avisaRecordatorios: true,
    avisaSeguimientos: true,
    bajaEn: null,
    bajaToken: (crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, ""),
  };
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

/* ─── El hueco ocupado ─────────────────────────────────────────────────
   Espejo del índice `citas_slot_unico` de 0012. Aquí no hay Postgres que
   lo garantice, así que se comprueba a mano — y por eso la comprobación
   vive en UN solo lugar, no en cada módulo que agenda.

   `_claveHora` es la versión en JS de clave_hora(): si una cambia, cambia
   la otra. Sin normalizar, '9:00' y '09:00' pasarían como huecos distintos
   en la demo y no en producción, que es la peor de las dos opciones. */
const OCUPA_EL_HUECO = new Set(["pendiente", "confirmada"]);

function _claveHora(h) {
  const t = String(h ?? "").trim();
  if (!t) return "";
  if (!t.includes(":")) return t.toLowerCase();
  const [hh, mm = ""] = t.split(":");
  return `${hh.trim().padStart(2, "0")}:${(mm.trim() || "00").padStart(2, "0")}`;
}

const _claveDoctor = d => String(d ?? "").trim().toLowerCase();

function _huecoTomadoPor(citas, { doctor, fecha, hora }, excluirFolio = null) {
  const clave = _claveHora(hora);
  if (!clave) return null;   // una solicitud sin hora no reserva nada
  return citas.find(c =>
    c.folio !== excluirFolio &&
    OCUPA_EL_HUECO.has(c.estado) &&
    c.fecha === fecha &&
    _claveDoctor(c.doctor) === _claveDoctor(doctor) &&
    _claveHora(c.hora) === clave
  ) || null;
}

const MENSAJE_HUECO = "Esa hora ya está ocupada con ese médico. Elige otra, por favor.";

/** Horas ya tomadas de un médico en una fecha, normalizadas a HH:MM. */
export async function citasHorasOcupadas(doctor, fecha) {
  return [...new Set(
    _leer(CLAVE_CITAS)
      .filter(c => OCUPA_EL_HUECO.has(c.estado) &&
                   c.fecha === fecha &&
                   _claveDoctor(c.doctor) === _claveDoctor(doctor) &&
                   _claveHora(c.hora))
      .map(c => _claveHora(c.hora))
  )].sort();
}

/**
 * Crea una cita. Si no trae folio, genera uno con el mismo formato que
 * usan app.js y admin.js (CIT-AAMMDD-XXXX). Vincula automáticamente el
 * perfil de paciente por teléfono, igual que guardarCitaEnStorage() +
 * vincularPacienteDesdeIndex() hacen hoy en conjunto.
 */
export async function citasCrear(cita) {
  const citas = _leer(CLAVE_CITAS);
  const folio = cita.folio || _folioCitaLibre(citas);

  if (OCUPA_EL_HUECO.has(cita.estado || "pendiente") &&
      _huecoTomadoPor(citas, cita)) {
    throw new Error(MENSAJE_HUECO);
  }
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

  /* Reagendar es la otra forma de chocar con el hueco. Se evalúa la cita
     RESULTANTE, no los cambios: mover solo la hora deja fecha y médico como
     estaban, y hay que revisar la combinación completa. */
  const resultante = { ...citas[idx], ...cambios };
  if (OCUPA_EL_HUECO.has(resultante.estado) &&
      _huecoTomadoPor(citas, resultante, citas[idx].folio)) {
    throw new Error(MENSAJE_HUECO);
  }

  citas[idx] = resultante;
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

/**
 * Opiniones que la landing puede mostrar sin sesión.
 *
 * Devuelve la misma forma que la vista `testimonios_publicos` de la base
 * (nombre de pila más inicial, puntuación, comentario, fecha) y nada
 * más. Que aquí los datos completos estén al alcance no es motivo para
 * entregarlos: la landing es pública en ambos modos, y si en local
 * devolviéramos el expediente entero, la página quedaría escrita contra
 * un contrato que en remoto no se cumple.
 */
export async function publicoTestimonios({ minPuntuacion = 8, limite = 3 } = {}) {
  const citas = _leer(CLAVE_CITAS);

  return _leer(CLAVE_NPS)
    .filter((r) => r.puntuacion >= minPuntuacion)
    .slice(0, limite)
    .map((r) => {
      const cita = citas.find((c) => c.folio === r.folio);
      const nombre = String(cita?.nombre || "").trim().split(/\s+/)[0] || "";
      const inicial = String(cita?.apellidos || "").trim().charAt(0);
      return {
        id: r.id || r.folio,
        nombrePublico: [nombre, inicial ? `${inicial}.` : ""].filter(Boolean).join(" "),
        puntuacion: r.puntuacion,
        comentario: r.comentario || "",
        creadoEn: r.fechaRespuesta || "",
      };
    });
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

/**
 * Registra una respuesta desde el panel, no desde la encuesta.
 *
 * Se ve igual que npsResponder pero es otra cosa, y por eso existe
 * aparte: `responder` es el paciente contestando desde su celular sin
 * sesión, y vive en la superficie pública. Esto es personal de la
 * clínica capturando o sembrando datos, y va por la superficie normal.
 *
 * La distinción no es cosmética. Al confundirlas, la siembra de datos de
 * demostración salía disparada contra el Supabase de la clínica real
 * —porque la superficie pública resuelve por "¿hay backend?" y no por
 * "¿hay sesión?"— mientras las citas se quedaban en este navegador.
 */
export async function npsRegistrar(folio, puntuacion, comentario) {
  return npsResponder(folio, puntuacion, comentario);
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

/* ═══════════════════════════════════════════════════════════════════════
   Horario de atención (MediHorario)

   Espejo de 0009_horarios.sql. Las reglas tienen que ser LAS MISMAS que
   las de Postgres, porque la landing y el agente van a razonar con esto
   en los dos modos:

     · una excepción PISA a la base para esa fecha, no se suma
     · un cierre gana sobre cualquier bloque alternativo del mismo día
     · sin horario cargado, la respuesta es "cerrado" y `null`, nunca una
       fecha inventada

   Diferencia deliberada: aquí no hay zona horaria configurable. La demo
   corre en el navegador del visitante y su reloj ES la hora local; una
   zona distinta a la suya no significaría nada.
   ═══════════════════════════════════════════════════════════════════════ */

const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function _horarios() {
  const h = _leerObjeto(CLAVE_HORARIOS);
  return { base: h.base || [], excepciones: h.excepciones || [] };
}

/** "9:5" → "09:05". Deja las horas comparables como texto. */
function _hhmm(valor) {
  const m = String(valor || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Día de la semana de "YYYY-MM-DD", 0 = domingo, igual que extract(dow). */
function _diaSemana(fecha) {
  return new Date(`${fecha}T00:00:00`).getDay();
}

function _soloFecha(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function horariosBase() {
  return _horarios().base;
}

/**
 * Reemplaza la semana completa. La rejilla del panel es la fuente: un
 * guardado parcial dejaría vivos los bloques que el usuario quitó de la
 * pantalla. Devuelve el texto del membrete, igual que la función de SQL.
 */
export async function horariosGuardarBase(bloques) {
  const limpios = (bloques || []).map((b) => ({
    id: `HOR-${_sufijoUnico()}`,
    diaSemana: Number(b.diaSemana),
    horaInicio: _hhmm(b.horaInicio),
    horaFin: _hhmm(b.horaFin),
  }));

  for (const b of limpios) {
    if (!(b.diaSemana >= 0 && b.diaSemana <= 6)) throw new Error("Día de la semana inválido");
    if (!b.horaInicio || !b.horaFin) throw new Error("Falta la hora de inicio o de fin");
    if (b.horaFin <= b.horaInicio) throw new Error("La hora de fin debe ser posterior a la de inicio");
  }

  for (const a of limpios) {
    for (const b of limpios) {
      if (a === b || a.diaSemana !== b.diaSemana) continue;
      if (a.horaInicio < b.horaFin && b.horaInicio < a.horaFin) {
        throw new Error("Hay bloques que se enciman en el mismo día");
      }
    }
  }

  const h = _horarios();
  _guardar(CLAVE_HORARIOS, { ...h, base: limpios });

  /* El membrete de MediDocs y la landing leen `horarioAtencion`. Se
     regenera aquí para que no puedan decir cosas distintas. */
  const texto = _horarioTexto(limpios);
  const cfg = _leerObjeto(CLAVE_CLINICA);
  _guardar(CLAVE_CLINICA, { ...cfg, horarioAtencion: texto });
  return texto;
}

/** Resumen legible agrupando días consecutivos iguales. Espejo de horario_texto(). */
function _horarioTexto(base) {
  const firma = [];
  for (let d = 0; d <= 6; d++) {
    firma[d] = base
      .filter((b) => b.diaSemana === d)
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
      .map((b) => `${b.horaInicio}–${b.horaFin}`)
      .join(", ");
  }

  const partes = [];
  let d = 0;
  while (d <= 6) {
    if (!firma[d]) { d++; continue; }
    const ini = d;
    while (d < 6 && firma[d + 1] === firma[ini]) d++;
    const etiqueta = ini === d ? DIAS_CORTOS[ini] : `${DIAS_CORTOS[ini]}–${DIAS_CORTOS[d]}`;
    partes.push(`${etiqueta} ${firma[ini]}`);
    d++;
  }
  return partes.join(" · ");
}

export async function horariosExcepciones(desde, hasta) {
  return _horarios()
    .excepciones.filter((e) => (!desde || e.fecha >= desde) && (!hasta || e.fecha <= hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function horariosAgregarExcepcion(exc) {
  const cerrado = !!exc.cerrado;
  const registro = {
    id: `EXC-${_sufijoUnico()}`,
    fecha: String(exc.fecha || "").slice(0, 10),
    cerrado,
    horaInicio: cerrado ? null : _hhmm(exc.horaInicio),
    horaFin: cerrado ? null : _hhmm(exc.horaFin),
    motivo: exc.motivo || "",
    creadoEn: new Date().toISOString(),
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(registro.fecha)) throw new Error("Fecha inválida");
  if (!cerrado) {
    if (!registro.horaInicio || !registro.horaFin) throw new Error("Falta la hora de inicio o de fin");
    if (registro.horaFin <= registro.horaInicio) throw new Error("La hora de fin debe ser posterior a la de inicio");
  }

  const h = _horarios();

  /* Un día se cierra una vez: dos clics en "Cerrar" no deben dejar el
     cierre duplicado en la lista. */
  if (cerrado && h.excepciones.some((e) => e.fecha === registro.fecha && e.cerrado)) {
    return h.excepciones.find((e) => e.fecha === registro.fecha && e.cerrado);
  }

  h.excepciones.push(registro);
  _guardar(CLAVE_HORARIOS, h);
  return registro;
}

export async function horariosQuitarExcepcion(id) {
  const h = _horarios();
  const antes = h.excepciones.length;
  h.excepciones = h.excepciones.filter((e) => e.id !== id);
  _guardar(CLAVE_HORARIOS, h);
  return antes !== h.excepciones.length;
}

/** Bloques ya resueltos para una fecha. Espejo de horario_del_dia(). */
export async function horariosDelDia(fecha) {
  const dia = String(fecha).slice(0, 10);
  const { base, excepciones } = _horarios();
  const delDia = excepciones.filter((e) => e.fecha === dia);

  if (delDia.length) {
    if (delDia.some((e) => e.cerrado)) return [];
    return delDia
      .map((e) => ({ horaInicio: e.horaInicio, horaFin: e.horaFin }))
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  }

  return base
    .filter((b) => b.diaSemana === _diaSemana(dia))
    .map((b) => ({ horaInicio: b.horaInicio, horaFin: b.horaFin }))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

export async function horariosAbiertoAhora() {
  const ahora = new Date();
  const hora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
  const bloques = await horariosDelDia(_soloFecha(ahora));
  return bloques.some((b) => hora >= b.horaInicio && hora < b.horaFin);
}

/**
 * Siguiente instante con alguien en el consultorio, en ISO. Si ya está
 * abierto, devuelve ahora. `null` si no hay horario en 14 días — devolver
 * una fecha cualquiera haría que el agente prometiera algo falso.
 */
export async function horariosProximaApertura() {
  const ahora = new Date();

  for (let i = 0; i <= 14; i++) {
    const dia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + i);
    const bloques = await horariosDelDia(_soloFecha(dia));

    for (const b of bloques) {
      const [hi, mi] = b.horaInicio.split(":").map(Number);
      const [hf, mf] = b.horaFin.split(":").map(Number);
      const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hi, mi);
      const fin = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hf, mf);

      if (ahora < inicio) return inicio.toISOString();
      if (ahora < fin) return ahora.toISOString();
    }
  }
  return null;
}

/** Citas vivas que quedarían fuera si se cierra o se recorta esa fecha. */
export async function horariosCitasAfectadas(fecha, horaInicio, horaFin) {
  const dia = String(fecha).slice(0, 10);
  const ini = horaInicio ? _hhmm(horaInicio) : null;
  const fin = horaFin ? _hhmm(horaFin) : null;

  return _leer(CLAVE_CITAS)
    .filter((c) => c.fecha === dia && ["pendiente", "confirmada"].includes(c.estado))
    .filter((c) => {
      if (!ini) return true;                    // se cierra el día entero
      const h = _hhmm(c.hora);
      if (!h) return true;                      // sin hora: que lo vea un humano
      return h < ini || h >= fin;
    })
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
}

/**
 * Superficie pública: el horario resuelto por fecha, para que el
 * formulario de la landing no ofrezca un día cerrado. No devuelve el
 * motivo — que el consultorio esté cerrado es público, por qué no lo es.
 */
export async function publicoHorarioDisponible(desde, hasta) {
  const salida = [];
  const d = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const tope = new Date(`${String(hasta).slice(0, 10)}T00:00:00`);

  if (isNaN(d) || isNaN(tope) || tope < d) throw new Error("Rango de fechas inválido");
  if ((tope - d) / 86400000 > 90) throw new Error("El rango de fechas no puede pasar de 90 días");

  while (d <= tope) {
    const fecha = _soloFecha(d);
    for (const b of await horariosDelDia(fecha)) {
      salida.push({ fecha, horaInicio: b.horaInicio, horaFin: b.horaFin });
    }
    d.setDate(d.getDate() + 1);
  }
  return salida;
}

/**
 * Superficie pública: las horas ya tomadas de un médico, para que la
 * landing no ofrezca un hueco que ya tiene dueño.
 *
 * Aplica el mismo tope de fechas que la función SQL, aunque aquí no haya
 * nada que proteger. Es a propósito: si el recorte solo existiera en uno de
 * los dos modos, la página quedaría escrita contra un contrato que se
 * cumple a medias — el mismo criterio que se siguió con los testimonios.
 */
export async function publicoHorasOcupadas(doctor, fecha) {
  const dia = String(fecha || "").slice(0, 10);
  if (!dia) return [];

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const pedida = new Date(`${dia}T00:00:00`);
  if (isNaN(pedida)) return [];

  const dias = Math.round((pedida - hoy) / 86400000);
  if (dias < -1 || dias > 60) return [];

  return citasHorasOcupadas(doctor, dia);
}

/* ─── "Mis citas" ─────────────────────────────────────────────────────────
   Espejo de mis_citas() y cancelar_mi_cita() de 0016, incluido el contrato
   `{ok, error}` y el hecho de que un folio inexistente y un teléfono que no
   corresponde den el MISMO mensaje.

   Lo que NO se replica es el freno de abuso: aquí los datos son de este
   navegador, así que no hay nada que barrer probando folios. Se dice en voz
   alta para que nadie lea la ausencia como un descuido. */

const MISMO_ERROR_MIS_CITAS =
  "No encontramos ninguna cita con esos datos. Revísalos, por favor.";

function _citaDeFolioYTel(folio, telefono) {
  const f = String(folio || "").trim().toUpperCase();
  const t = claveTel(telefono);
  if (!f || t.length < 10) return null;
  return _leer(CLAVE_CITAS).find(
    (c) => String(c.folio || "").trim().toUpperCase() === f && claveTel(c.telefono) === t
  ) || null;
}

export async function publicoMisCitas(folio, telefono) {
  if (claveTel(telefono).length < 10) {
    return { ok: false, error: "El teléfono debe tener 10 dígitos." };
  }

  const cita = _citaDeFolioYTel(folio, telefono);
  if (!cita) return { ok: false, error: MISMO_ERROR_MIS_CITAS };

  const tel = claveTel(cita.telefono);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const limite = new Date(hoy); limite.setDate(limite.getDate() - 30);

  const suyas = _leer(CLAVE_CITAS)
    .filter((c) => claveTel(c.telefono) === tel)
    .filter((c) => {
      const d = new Date(`${String(c.fecha).slice(0, 10)}T00:00:00`);
      return !isNaN(d) && d >= limite;
    })
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))
    .map((c) => ({
      folio: c.folio, fecha: c.fecha, hora: c.hora,
      especialidad: c.especialidad, doctor: c.doctor, tipo: c.tipo,
      estado: c.estado,
      cancelable: ["pendiente", "confirmada"].includes(c.estado) &&
                  new Date(`${String(c.fecha).slice(0, 10)}T00:00:00`) > hoy,
    }));

  return { ok: true, nombre: cita.nombre || "", citas: suyas };
}

export async function publicoCancelarMiCita(folio, telefono, motivo = "") {
  const cita = _citaDeFolioYTel(folio, telefono);
  if (!cita) return { ok: false, error: MISMO_ERROR_MIS_CITAS };

  if (cita.estado === "cancelada") {
    return { ok: true, folio: cita.folio, yaEstaba: true };
  }
  if (cita.estado === "atendida") {
    return { ok: false, error: "Esa consulta ya se realizó, no se puede cancelar." };
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (new Date(`${String(cita.fecha).slice(0, 10)}T00:00:00`) <= hoy) {
    return { ok: false, error: "Tu cita es hoy o ya pasó. Llámanos para cancelarla, por favor." };
  }

  await citasActualizar(cita.folio, {
    estado: "cancelada",
    canceladaPor: "paciente",
    motivoCancelacion: String(motivo || "").slice(0, 300),
  });

  return { ok: true, folio: cita.folio, fecha: cita.fecha, hora: cita.hora };
}

/* ─── Baja de los correos automáticos ─────────────────────────────────────
   Espejo de consultar_baja() y darse_de_baja() de 0014.

   Los perfiles creados en este navegador ANTES de esto no traen token, y no
   se les rellena: en modo local no hay reloj, así que nunca recibieron un
   correo del que bajarse y no existe ningún enlace suyo dando vueltas. Los
   nuevos sí lo traen, y con eso la página se comporta igual en los dos
   modos — que es lo único que se necesita de este lado. */

function _pacientePorToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  return _leer(CLAVE_PACIENTES).find(p => p.bajaToken === t) || null;
}

export async function publicoConsultarBaja(token) {
  const p = _pacientePorToken(token);
  if (!p) return { valido: false };

  return {
    valido: true,
    nombre: p.nombre || "",
    clinica: (await publicoClinica())?.nombreClinica || "",
    recordatorios: p.avisaRecordatorios !== false && !p.bajaEn,
    seguimientos:  p.avisaSeguimientos  !== false && !p.bajaEn,
    dadoDeBaja: Boolean(p.bajaEn),
  };
}

export async function publicoDarseDeBaja(token, alcance = "todo") {
  if (!["todo", "seguimientos", "reactivar"].includes(alcance)) {
    throw new Error("Alcance no válido");
  }

  const pacientes = _leer(CLAVE_PACIENTES);
  const idx = pacientes.findIndex(p => p.bajaToken === String(token || "").trim());
  if (idx === -1) throw new Error("Ese enlace ya no es válido. Escríbenos y lo resolvemos.");

  const cambio = alcance === "todo"
    ? { bajaEn: new Date().toISOString(), avisaRecordatorios: false, avisaSeguimientos: false }
    : alcance === "seguimientos"
      ? { bajaEn: null, avisaRecordatorios: true, avisaSeguimientos: false }
      : { bajaEn: null, avisaRecordatorios: true, avisaSeguimientos: true };

  pacientes[idx] = { ...pacientes[idx], ...cambio, actualizadoEn: new Date().toISOString() };
  _guardar(CLAVE_PACIENTES, pacientes);

  return publicoConsultarBaja(token);
}

/* ═══════════════════════════════════════════════════════════════════════
   Escalaciones a humano

   Espejo de 0010_escalaciones.sql, con una diferencia que la interfaz
   tiene que decir en voz alta: aquí NO hay reloj. Sin backend la escalera
   solo avanza cuando alguien llama a escalacionesPromover(), y eso lo hace
   el panel mientras la pestaña esté abierta.

   Es todo lo que una demo puede hacer, y fingir lo contrario sería
   exactamente el error que la escalación viene a corregir.
   ═══════════════════════════════════════════════════════════════════════ */

const MOTIVOS_ESC = [
  "urgencia_medica", "duda_clinica", "queja", "agenda",
  "administrativo", "peticion_explicita", "bot_no_pudo",
];
const MAX_ESCALACIONES = 200;

/** Minutos de plazo según urgencia. Mismos números que rutear_escalacion(). */
const MARGEN_ESC = { alta: 5, normal: 15, baja: 60 };

function _destinoEsc(motivo) {
  if (motivo === "urgencia_medica" || motivo === "duda_clinica") return "doctor";
  if (motivo === "queja") return "admin";
  return "recepcionista";
}

/**
 * A quién le toca y para cuándo.
 *
 * En local no hay tabla de personal, así que el destino es informativo:
 * sirve para que el panel lo muestre y para que la demo enseñe el ruteo.
 */
async function _rutearEsc(motivo, urgencia, ahora = new Date()) {
  const destinoRol = _destinoEsc(motivo);
  const margen = (MARGEN_ESC[urgencia] ?? MARGEN_ESC.normal) * 60000;

  /* Una posible urgencia médica no espera a que abran. */
  if (motivo === "urgencia_medica") {
    return { destinoRol, venceEn: new Date(ahora.getTime() + 15 * 60000).toISOString() };
  }

  if (await horariosAbiertoAhora()) {
    return { destinoRol, venceEn: new Date(ahora.getTime() + margen).toISOString() };
  }

  /* Cerrado: el reloj empieza cuando abran. Vencerla de madrugada solo
     produce alertas que nadie puede atender. */
  const proxima = await horariosProximaApertura();
  const base = proxima ? new Date(proxima) : new Date(ahora.getTime() + 12 * 3600000);
  return { destinoRol, venceEn: new Date(base.getTime() + margen).toISOString() };
}

export async function escalacionesListar(filtros = {}) {
  let lista = _leer(CLAVE_ESCALACIONES);

  if (filtros.abiertas) {
    lista = lista.filter((e) => e.estado === "pendiente" || e.estado === "vencida");
  }
  if (filtros.estado) lista = lista.filter((e) => e.estado === filtros.estado);

  /* Las vencidas primero: llevan más tiempo sin que nadie conteste, y son
     justo las que no deben perderse hasta abajo de la lista. */
  const peso = (e) => (e.estado === "vencida" ? 0 : e.estado === "pendiente" ? 1 : 2);
  return lista.sort(
    (a, b) => peso(a) - peso(b) || String(b.creadoEn).localeCompare(String(a.creadoEn))
  );
}

export async function escalacionesCrear(datos) {
  const motivo = MOTIVOS_ESC.includes(datos.motivo) ? datos.motivo : "peticion_explicita";
  const urgencia = ["alta", "normal", "baja"].includes(datos.urgencia) ? datos.urgencia : "normal";
  const ahora = new Date();

  const { destinoRol, venceEn } = await _rutearEsc(motivo, urgencia, ahora);
  const paciente = datos.telefono ? await pacientesPorTelefono(datos.telefono) : null;

  const escalacion = {
    id: `ESC-${_sufijoUnico()}`,
    conversacionId: datos.conversacionId || null,
    pacienteId: paciente ? paciente.id : null,
    citaId: datos.citaId || null,
    canalOrigen: datos.canalOrigen || "medibot",
    contactoNombre: datos.nombre || "",
    contactoTelefono: datos.telefono || "",
    contactoEmail: datos.email || "",
    motivo, urgencia,
    resumen: datos.resumen || "",
    destinoRol,
    estado: "pendiente",
    nivel: 0,
    venceEn,
    reconocidaEn: null, reconocidaPor: null,
    resueltaEn: null, resueltaPor: null, notaCierre: "",
    creadoEn: ahora.toISOString(),
  };

  const lista = _leer(CLAVE_ESCALACIONES);
  _guardar(CLAVE_ESCALACIONES, _agregarConTope(lista, escalacion, MAX_ESCALACIONES));

  if (escalacion.conversacionId) {
    try {
      await conversacionesCambiarEstado(escalacion.conversacionId, "requiere_atencion_humana");
    } catch {
      /* La conversación pudo haberse podado por FIFO. La escalación vale
         igual: lo que importa es que alguien llame a ese paciente. */
    }
  }

  return escalacion;
}

/** En la demo la sesión es el rol elegido en el inbox; puede no haber ninguno. */
function _quienSoy() {
  try {
    return JSON.parse(localStorage.getItem("medicita_sesion") || "{}").nombre || "Personal";
  } catch {
    return "Personal";
  }
}

export async function escalacionesReconocer(id) {
  const lista = _leer(CLAVE_ESCALACIONES);
  const e = lista.find((x) => x.id === id);
  if (!e) throw new Error("Esa escalación ya no existe");
  if (e.estado !== "pendiente" && e.estado !== "vencida") {
    throw new Error("Esa escalación ya no está abierta");
  }

  e.estado = "reconocida";
  e.reconocidaEn = new Date().toISOString();
  e.reconocidaPor = _quienSoy();
  _guardar(CLAVE_ESCALACIONES, lista);
  return e;
}

export async function escalacionesResolver(id, nota) {
  /* Un cierre sin nota es indistinguible de alguien limpiando la lista
     para que deje de parpadear. */
  if (!String(nota || "").trim()) {
    throw new Error("Hay que anotar qué se hizo antes de cerrarla");
  }

  const lista = _leer(CLAVE_ESCALACIONES);
  const e = lista.find((x) => x.id === id);
  if (!e) throw new Error("Esa escalación ya no existe");
  if (e.estado === "resuelta") throw new Error("Esa escalación ya estaba cerrada");

  const ahora = new Date().toISOString();
  e.estado = "resuelta";
  e.resueltaEn = ahora;
  e.resueltaPor = _quienSoy();
  e.notaCierre = String(nota).trim();
  e.reconocidaEn = e.reconocidaEn || ahora;
  e.reconocidaPor = e.reconocidaPor || e.resueltaPor;
  _guardar(CLAVE_ESCALACIONES, lista);
  return e;
}

export async function escalacionesContarAbiertas() {
  const lista = await escalacionesListar({ abiertas: true });
  return {
    total: lista.length,
    vencidas: lista.filter((e) => e.estado === "vencida").length,
  };
}

/**
 * La escalera. Espejo de promover_escalaciones().
 *
 * Devuelve cuántas movió, para que el panel sepa si tiene que repintar.
 * `vencida` es terminal: no hay nivel 4 ni cierre automático, y esa es la
 * garantía entera de la función.
 */
export async function escalacionesPromover() {
  const lista = _leer(CLAVE_ESCALACIONES);
  const ahora = Date.now();
  let movidas = 0;

  for (const e of lista) {
    if (e.estado !== "pendiente") continue;
    if (new Date(e.venceEn).getTime() > ahora) continue;

    movidas++;
    if (e.nivel === 0) {
      e.nivel = 1;
      e.venceEn = new Date(ahora + 5 * 60000).toISOString();
    } else if (e.nivel === 1) {
      e.nivel = 2;
      e.venceEn = new Date(ahora + 10 * 60000).toISOString();
    } else {
      e.estado = "vencida";
      e.nivel = 3;
      if (e.conversacionId) {
        try {
          await conversacionesCambiarEstado(e.conversacionId, "requiere_atencion_humana");
        } catch { /* la conversación pudo haberse podado */ }
      }
    }
  }

  if (movidas) _guardar(CLAVE_ESCALACIONES, lista);
  return movidas;
}

/**
 * Superficie pública: pedir un humano sin tener cuenta.
 *
 * Devuelve el estado real del horario en vez de una frase hecha, igual
 * que la RPC. Quien redacta la respuesta solo puede prometer lo que estos
 * datos sostienen.
 */
export async function publicoEscalarAHumano(datos) {
  const escalacion = await escalacionesCrear(datos);

  const abiertoAhora = await horariosAbiertoAhora();
  const proxima = abiertoAhora ? null : await horariosProximaApertura();
  const esEmergencia = escalacion.motivo === "urgencia_medica";
  const cuando = proxima ? _fechaEnPalabras(proxima) : null;

  let instruccion;
  if (esEmergencia) {
    instruccion = "ANTES QUE NADA dile que si es una emergencia llame al 911 o vaya a urgencias AHORA, sin esperar respuesta. Después confirma que ya avisaste a la clínica.";
  } else if (abiertoAhora) {
    instruccion = "Confirma que ya avisaste y que en unos minutos lo contactan.";
  } else if (cuando) {
    instruccion = `Confirma que ya avisaste y di que lo contactan el ${cuando}. ` +
      "Copia esa hora TAL CUAL, en el campo atencionEnTexto. No la conviertas, " +
      "no la redondees y no le sumes margen: ya viene en la hora local de la clínica.";
  } else {
    instruccion = "Confirma que ya avisaste. NO prometas una hora: el consultorio no tiene horario cargado y sería inventarla.";
  }

  return {
    id: escalacion.id,
    destino: escalacion.destinoRol,
    urgencia: escalacion.urgencia,
    abiertoAhora,
    atencionEn: proxima,
    atencionEnTexto: cuando,
    esEmergencia,
    instruccion,
  };
}

/**
 * "jueves 30 de julio a las 09:00". Espejo de fecha_en_palabras().
 *
 * Existe porque quien redacta la respuesta al paciente es un modelo de
 * lenguaje: dándole un ISO con zona horaria tiene que convertirlo él, y
 * en la primera prueba contra un proyecto real dijo una hora de más.
 * Nadie lo habría notado — suena razonable, y el paciente espera una
 * llamada que ya ocurrió.
 */
const _DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const _MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function _fechaEnPalabras(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${_DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${_MESES[d.getMonth()]} a las ${hh}:${mm}`;
}
