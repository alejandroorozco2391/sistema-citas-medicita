/* ═══════════════════════════════════════════════════════════════════════
   api.mjs — La única puerta a los datos

   Una interfaz, dos implementaciones detrás:

     · api-local.mjs   → localStorage. Es como funciona la demo pública,
                         que cualquiera debe poder clicar sin registrarse.
     · api-remoto.mjs  → Supabase. Es como funciona una clínica de verdad.

   El interruptor es la sesión: sin sesión, modo local.

   ── Contrato de formas ──────────────────────────────────────────────────
   Las formas de datos que salen de aquí son las MISMAS que hoy viven en
   localStorage (camelCase, `folio`, `creadoEn`, etc.). La base de datos
   usa snake_case, y traducir es responsabilidad de api-remoto.

   Eso es deliberado: cuando los 9 módulos pasen a usar esta capa, no
   tendrán que cambiar cómo leen un paciente o una cita. Solo de dónde.

   Todo devuelve Promise en ambos modos.
   ═══════════════════════════════════════════════════════════════════════ */

import { modoActual, hayBackendConfigurado } from "./supabase-client.mjs";

let _impl = null;
let _implPub = null;
let _modo = null;

/**
 * Resuelve la implementación que toca. Se cachea porque el modo no cambia
 * a media sesión: iniciar o cerrar sesión recarga la página.
 */
async function impl() {
  if (_impl) return _impl;
  _modo = await modoActual();
  _impl = _modo === "remoto"
    ? await import("./api-remoto.mjs")
    : await import("./api-local.mjs");
  return _impl;
}

/**
 * Implementación para la superficie SIN sesión.
 *
 * Hay tres flujos que por diseño ocurren sin que nadie haya iniciado
 * sesión: un paciente pide cita desde la landing, responde la encuesta,
 * y la landing muestra los datos de la clínica. El interruptor normal no
 * sirve aquí — `modoActual()` devuelve "local" cuando no hay sesión, así
 * que en la landing de una clínica real la cita del paciente se habría
 * guardado en el localStorage de su propio navegador y la clínica nunca
 * se habría enterado.
 *
 * Para esta superficie el criterio correcto no es "¿hay sesión?" sino
 * "¿hay backend?". Del lado de la base ya están las piezas que lo
 * permiten sin abrir nada: la vista `clinica_publica`, la vista
 * `testimonios_publicos` y las funciones SECURITY DEFINER
 * `solicitar_cita` y `responder_encuesta`, que validan por dentro.
 */
async function implPublica() {
  if (_implPub) return _implPub;
  _implPub = hayBackendConfigurado()
    ? await import("./api-remoto.mjs")
    : await import("./api-local.mjs");
  return _implPub;
}

export async function modo() {
  await impl();
  return _modo;
}

/** Solo para pruebas: fuerza una implementación concreta. */
export function _forzarImpl(implementacion, nombreModo) {
  _impl = implementacion;
  _implPub = implementacion;
  _modo = nombreModo || "forzado";
}

/* ═══════════════════════════════════════════════════════════════════════
   Superficie

   Cada método delega en la implementación activa. Se escribe explícito y
   no con un Proxy mágico para que la superficie quede a la vista: esto es
   la documentación de qué puede hacer el sistema con sus datos.
   ═══════════════════════════════════════════════════════════════════════ */

export const clinica = {
  async obtener()          { return (await impl()).clinicaObtener(); },
  async guardar(cfg)       { return (await impl()).clinicaGuardar(cfg); },
};

export const pacientes = {
  async listar(filtros)    { return (await impl()).pacientesListar(filtros); },
  async obtener(id)        { return (await impl()).pacientesObtener(id); },
  async porTelefono(tel)   { return (await impl()).pacientesPorTelefono(tel); },
  async guardar(pac)       { return (await impl()).pacientesGuardar(pac); },
  async eliminar(id)       { return (await impl()).pacientesEliminar(id); },
  async notas(id)          { return (await impl()).pacientesNotas(id); },
  async agregarNota(id, texto, autor) {
    return (await impl()).pacientesAgregarNota(id, texto, autor);
  },
};

export const citas = {
  async listar(filtros)    { return (await impl()).citasListar(filtros); },
  async obtener(id)        { return (await impl()).citasObtener(id); },
  async porFolio(folio)    { return (await impl()).citasPorFolio(folio); },
  async crear(cita)        { return (await impl()).citasCrear(cita); },
  async actualizar(id, cambios) { return (await impl()).citasActualizar(id, cambios); },
  async eliminar(id)       { return (await impl()).citasEliminar(id); },
};

export const conversaciones = {
  async listar(filtros)    { return (await impl()).conversacionesListar(filtros); },
  async obtener(id)        { return (await impl()).conversacionesObtener(id); },
  async upsert(datos)      { return (await impl()).conversacionesUpsert(datos); },
  async cambiarEstado(id, estado) { return (await impl()).conversacionesCambiarEstado(id, estado); },
  async marcarLeida(id)    { return (await impl()).conversacionesMarcarLeida(id); },
  async eliminar(id)       { return (await impl()).conversacionesEliminar(id); },
  async contarPorEstado()  { return (await impl()).conversacionesContarPorEstado(); },
};

export const mensajes = {
  async listar(conversacionId) { return (await impl()).mensajesListar(conversacionId); },
  async agregar(conversacionId, msg) { return (await impl()).mensajesAgregar(conversacionId, msg); },
  async actualizarEstadoEnvio(id, estado, detalle) {
    return (await impl()).mensajesActualizarEstadoEnvio(id, estado, detalle);
  },
};

export const documentos = {
  async listar(filtros)    { return (await impl()).documentosListar(filtros); },
  async crear(doc)         { return (await impl()).documentosCrear(doc); },
  async eliminar(id)       { return (await impl()).documentosEliminar(id); },
};

export const posts = {
  async listar()           { return (await impl()).postsListar(); },
  async crear(post)        { return (await impl()).postsCrear(post); },
  async actualizar(id, cambios) { return (await impl()).postsActualizar(id, cambios); },
  async eliminar(id)       { return (await impl()).postsEliminar(id); },
};

export const nps = {
  async listar()           { return (await impl()).npsListar(); },
  /* Responder va por la superficie pública: quien contesta la encuesta es
     el paciente desde su celular, y no tiene sesión. */
  async responder(folio, puntuacion, comentario) {
    return (await implPublica()).npsResponder(folio, puntuacion, comentario);
  },
  async yaRespondida(folio) { return (await implPublica()).npsYaRespondida(folio); },
};

export const seguimientos = {
  async listar()           { return (await impl()).seguimientosListar(); },
  async registrar(citaId, fechaAtendida) {
    return (await impl()).seguimientosRegistrar(citaId, fechaAtendida);
  },
  async marcarEnviado(id, cual) { return (await impl()).seguimientosMarcarEnviado(id, cual); },
};

/**
 * Superficie de la landing y la encuesta: todo esto ocurre sin sesión.
 *
 * Va contra el backend siempre que exista uno, aunque nadie haya
 * iniciado sesión — ver `implPublica()` arriba. Ninguno de estos métodos
 * devuelve datos que la clínica no publique de todos modos.
 */
export const publico = {
  async solicitarCita(datos) { return (await implPublica()).publicoSolicitarCita(datos); },
  async clinica()            { return (await implPublica()).publicoClinica(); },
  async testimonios(opciones) { return (await implPublica()).publicoTestimonios(opciones); },
};
