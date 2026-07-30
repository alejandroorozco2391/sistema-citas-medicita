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

  /* Contacto proactivo. Encontrar candidatos es automático; MANDAR es una
     decisión de una persona, y por eso no hay productor en pg_cron llamando
     a `invitarAVolver`. Un lote de "vuelve" que sale solo, a gente que no lo
     pidió, es lo que termina marcando el dominio de la clínica como spam —
     y eso se lleva también los correos que sus pacientes sí querían. */
  async porReactivar(dias)  { return (await impl()).pacientesPorReactivar(dias); },
  async invitarAVolver(id, mensaje) {
    return (await impl()).pacientesInvitarAVolver(id, mensaje);
  },
};

export const citas = {
  async listar(filtros)    { return (await impl()).citasListar(filtros); },
  async obtener(id)        { return (await impl()).citasObtener(id); },
  async porFolio(folio)    { return (await impl()).citasPorFolio(folio); },
  async crear(cita)        { return (await impl()).citasCrear(cita); },
  async actualizar(id, cambios) { return (await impl()).citasActualizar(id, cambios); },
  async eliminar(id)       { return (await impl()).citasEliminar(id); },

  /* Horas ya tomadas de un médico en una fecha, en HH:MM.
     `crear` y `actualizar` rechazan un hueco ocupado por su cuenta —eso lo
     garantiza un índice único en Postgres, no la buena voluntad de quien
     llame— pero un formulario que ofrece una hora y luego la rechaza es un
     formulario que hace perder el tiempo. Esto es para no ofrecerla. */
  async horasOcupadas(doctor, fecha) {
    return (await impl()).citasHorasOcupadas(doctor, fecha);
  },
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

  /* Registrar es lo mismo visto desde el panel: personal de la clínica
     capturando o sembrando. Va por la superficie normal, no por la
     pública — si no, sembrar la demo escribiría en la base de una clínica
     real mientras el resto de los datos se queda en este navegador. */
  async registrar(folio, puntuacion, comentario) {
    return (await impl()).npsRegistrar(folio, puntuacion, comentario);
  },
};

/**
 * Horario de atención.
 *
 * `base` es la semana normal; `excepciones` es lo que pasa de verdad ese
 * día. `delDia()` devuelve ya resuelto lo uno encima de lo otro, y es lo
 * único que debería consultar quien solo quiere saber si hay alguien.
 */
export const horarios = {
  async base()                  { return (await impl()).horariosBase(); },
  async guardarBase(bloques)    { return (await impl()).horariosGuardarBase(bloques); },
  async excepciones(desde, hasta) { return (await impl()).horariosExcepciones(desde, hasta); },
  async agregarExcepcion(exc)   { return (await impl()).horariosAgregarExcepcion(exc); },
  async quitarExcepcion(id)     { return (await impl()).horariosQuitarExcepcion(id); },
  async delDia(fecha)           { return (await impl()).horariosDelDia(fecha); },
  async abiertoAhora()          { return (await impl()).horariosAbiertoAhora(); },
  async proximaApertura()       { return (await impl()).horariosProximaApertura(); },

  /* A quién deja plantado un cierre. Se consulta ANTES de guardarlo:
     cerrar el jueves y dejar tres pacientes citados es justo el silencio
     que hay que evitar. */
  async citasAfectadas(fecha, horaInicio, horaFin) {
    return (await impl()).horariosCitasAfectadas(fecha, horaInicio, horaFin);
  },

  /* Y la otra mitad, la que faltaba: cancelarlas Y avisarle a cada uno,
     ofreciéndole reagendar. Devuelve a quién NO se pudo avisar por falta de
     correo — esa gente hay que llamarla, y el sistema tiene que decirlo en
     voz alta en vez de contar solo los avisados. */
  async cancelarBloque(opciones) {
    return (await impl()).horariosCancelarBloque(opciones);
  },
};

/**
 * Escalaciones a humano.
 *
 * `promover()` es la escalera. Con backend la corre pg_cron cada minuto y
 * aquí es un no-op; sin backend la adelanta el navegador mientras la
 * pestaña esté abierta, que es todo lo que una demo puede hacer y así se
 * le dice al usuario.
 */
export const escalaciones = {
  async listar(filtros)      { return (await impl()).escalacionesListar(filtros); },
  async crear(datos)         { return (await impl()).escalacionesCrear(datos); },
  async reconocer(id)        { return (await impl()).escalacionesReconocer(id); },
  async resolver(id, nota)   { return (await impl()).escalacionesResolver(id, nota); },
  async contarAbiertas()     { return (await impl()).escalacionesContarAbiertas(); },
  async promover()           { return (await impl()).escalacionesPromover(); },
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

  /* El formulario de citas no debe ofrecer un día en que el consultorio
     está cerrado. Devuelve el horario ya resuelto por fecha, sin el
     motivo del cierre: que esté cerrado es público, por qué no lo es. */
  async horarioDisponible(desde, hasta) {
    return (await implPublica()).publicoHorarioDisponible(desde, hasta);
  },

  /* Ni una hora que ya tiene dueño. Devuelve horas, nunca de quién son. */
  async horasOcupadas(doctor, fecha) {
    return (await implPublica()).publicoHorasOcupadas(doctor, fecha);
  },

  /* "Mis citas": el paciente ve y cancela lo suyo sin cuenta.

     La credencial son DOS factores, folio y teléfono. El folio viaja en
     cada correo y el teléfono lo sabe cualquiera que conozca al paciente;
     juntos, quien cancela es quien recibió el correo Y sabe con qué número
     se agendó.

     Devuelven `{ok:false, error}` en vez de lanzar. No es estilo: el freno
     de abuso registra los intentos fallidos, y una excepción desharía ese
     registro en la misma transacción. */
  async misCitas(folio, telefono) {
    return (await implPublica()).publicoMisCitas(folio, telefono);
  },
  async cancelarMiCita(folio, telefono, motivo) {
    return (await implPublica()).publicoCancelarMiCita(folio, telefono, motivo);
  },

  /* Bajarse de los correos automáticos. La credencial es el token que viaja
     en el propio correo; exigirle una cuenta a alguien para dejar de
     escribirle sería no dejarlo irse. */
  async consultarBaja(token) {
    return (await implPublica()).publicoConsultarBaja(token);
  },
  async darseDeBaja(token, alcance) {
    return (await implPublica()).publicoDarseDeBaja(token, alcance);
  },

  /* Pedir un humano tampoco requiere cuenta: quien lo necesita casi nunca
     la tiene. Devuelve el estado real del horario para que quien redacte
     la respuesta solo pueda prometer lo que ese dato sostiene. */
  async escalarAHumano(datos) {
    return (await implPublica()).publicoEscalarAHumano(datos);
  },
};
