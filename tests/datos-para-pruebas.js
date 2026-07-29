/* Capa de datos para las pruebas del inbox.

   conversaciones-store.js dejó de tocar localStorage en B2: ahora delega
   en js/api.mjs. Aquí se le inyecta la implementación local, que es la
   misma que corre en la demo pública.

   Hace falta el `import()` dinámico porque api-local.mjs es un módulo ES
   y estos archivos de prueba son CommonJS — `require()` no puede
   cargarlo. Por eso la función es async y se llama desde un `before()`.

   Sigue apoyándose en el stub de localStorage: api-local escribe ahí, así
   que `ls.clear()` continúa siendo la forma de reiniciar el estado entre
   pruebas. */

/** Arma el objeto con la forma de `window.API` a partir de api-local.mjs. */
async function montarApiLocal() {
  const l = await import("../js/api-local.mjs");

  return {
    clinica: {
      obtener: l.clinicaObtener,
      guardar: l.clinicaGuardar,
    },
    pacientes: {
      listar: l.pacientesListar,
      obtener: l.pacientesObtener,
      porTelefono: l.pacientesPorTelefono,
      guardar: l.pacientesGuardar,
      eliminar: l.pacientesEliminar,
      notas: l.pacientesNotas,
      agregarNota: l.pacientesAgregarNota,
    },
    citas: {
      listar: l.citasListar,
      obtener: l.citasObtener,
      porFolio: l.citasPorFolio,
      crear: l.citasCrear,
      actualizar: l.citasActualizar,
      eliminar: l.citasEliminar,
    },
    conversaciones: {
      listar: l.conversacionesListar,
      obtener: l.conversacionesObtener,
      upsert: l.conversacionesUpsert,
      cambiarEstado: l.conversacionesCambiarEstado,
      marcarLeida: l.conversacionesMarcarLeida,
      eliminar: l.conversacionesEliminar,
      contarPorEstado: l.conversacionesContarPorEstado,
    },
    mensajes: {
      listar: l.mensajesListar,
      agregar: l.mensajesAgregar,
      actualizarEstadoEnvio: l.mensajesActualizarEstadoEnvio,
    },
    documentos: {
      listar: l.documentosListar,
      crear: l.documentosCrear,
      eliminar: l.documentosEliminar,
    },
    posts: {
      listar: l.postsListar,
      crear: l.postsCrear,
      actualizar: l.postsActualizar,
      eliminar: l.postsEliminar,
    },
    nps: {
      listar: l.npsListar,
      responder: l.npsResponder,
      yaRespondida: l.npsYaRespondida,
      registrar: l.npsRegistrar,
    },
    seguimientos: {
      listar: l.seguimientosListar,
      registrar: l.seguimientosRegistrar,
      marcarEnviado: l.seguimientosMarcarEnviado,
    },
    publico: {
      solicitarCita: l.publicoSolicitarCita,
      clinica: l.publicoClinica,
      testimonios: l.publicoTestimonios,
    },
  };
}

module.exports = { montarApiLocal };
