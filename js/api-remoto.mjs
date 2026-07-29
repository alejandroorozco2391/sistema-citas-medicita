/* ═══════════════════════════════════════════════════════════════════════
   api-remoto.mjs — Implementación sobre Supabase

   Aquí vive toda la traducción entre dos mundos:

     Postgres  →  snake_case, uuid, date, timestamptz
     Los módulos → camelCase, folios de texto, fechas ISO

   La traducción se concentra en los mapeadores `deDb*` / `aDb*` de la
   parte de arriba. Es a propósito: cuando los 9 módulos pasen a esta capa
   no van a cambiar cómo leen un paciente, solo de dónde sale.

   El `clinica_id` no lo pone nunca quien llama — se resuelve una vez al
   iniciar sesión. Así ningún módulo puede equivocarse de clínica, y RLS
   está detrás como segunda cerradura si alguien lo intentara.
   ═══════════════════════════════════════════════════════════════════════ */

import { obtenerCliente } from "./supabase-client.mjs";

/* ─── Acceso ──────────────────────────────────────────────────────────── */
let _clinicaId = null;

async function db() {
  const cliente = await obtenerCliente();
  if (!cliente) throw new Error("No hay backend configurado en este despliegue");
  return cliente;
}

/** La clínica del usuario autenticado. Se pregunta una vez por sesión. */
async function clinicaId() {
  if (_clinicaId) return _clinicaId;
  const cliente = await db();
  const { data, error } = await cliente.rpc("clinica_actual");
  if (error) throw error;
  if (!data) throw new Error("Tu usuario no tiene una clínica asignada");
  _clinicaId = data;
  return _clinicaId;
}

/** Se llama al cerrar sesión: la próxima puede ser de otra clínica. */
export function olvidarClinica() {
  _clinicaId = null;
}

function reventar({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

const soloFecha = v => (v ? String(v).slice(0, 10) : null);

/* ═══════════════════════════════════════════════════════════════════════
   Mapeadores
   ═══════════════════════════════════════════════════════════════════════ */

function deDbPaciente(r) {
  if (!r) return null;
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre, apellidos: r.apellidos,
    telefono: r.telefono, email: r.email,
    fechaNacimiento: soloFecha(r.fecha_nacimiento) || "",
    sexo: r.sexo, estatura: r.estatura, peso: r.peso, tipoSangre: r.tipo_sangre,
    alergias: r.alergias,
    enfermedadesCronicas: r.enfermedades_cronicas,
    medicamentosActuales: r.medicamentos_actuales,
    tieneSeguro: r.tiene_seguro, nombreSeguro: r.nombre_seguro, numeroPoliza: r.numero_poliza,
    ciudad: r.ciudad, comoNosEncontro: r.como_nos_encontro, ocupacion: r.ocupacion,
    calificacion: r.calificacion,
    creadoEn: r.creado_en, actualizadoEn: r.actualizado_en,
  };
}

function aDbPaciente(p) {
  const d = {
    codigo: p.codigo || null,
    nombre: p.nombre ?? "", apellidos: p.apellidos ?? "",
    telefono: p.telefono ?? "", email: p.email ?? "",
    // Una cadena vacía no es una fecha: Postgres la rechaza.
    fecha_nacimiento: p.fechaNacimiento || null,
    sexo: p.sexo ?? "", estatura: p.estatura ?? "", peso: p.peso ?? "",
    tipo_sangre: p.tipoSangre ?? "",
    alergias: p.alergias ?? "",
    enfermedades_cronicas: p.enfermedadesCronicas ?? "",
    medicamentos_actuales: p.medicamentosActuales ?? "",
    tiene_seguro: Boolean(p.tieneSeguro),
    nombre_seguro: p.nombreSeguro ?? "", numero_poliza: p.numeroPoliza ?? "",
    ciudad: p.ciudad ?? "", como_nos_encontro: p.comoNosEncontro ?? "",
    ocupacion: p.ocupacion ?? "",
    calificacion: p.calificacion ?? 1,
  };
  if (p.id) d.id = p.id;
  return d;
}

function deDbCita(r) {
  if (!r) return null;
  return {
    id: r.id, folio: r.folio, pacienteId: r.paciente_id,
    nombre: r.nombre, apellidos: r.apellidos,
    telefono: r.telefono, email: r.email,
    especialidad: r.especialidad, doctor: r.doctor,
    fecha: soloFecha(r.fecha), hora: r.hora, tipo: r.tipo, notas: r.notas,
    estado: r.estado, origen: r.origen,
    tieneSeguro: r.tiene_seguro, nombreSeguro: r.nombre_seguro, numeroPoliza: r.numero_poliza,
    creadaEn: r.creado_en,
  };
}

function aDbCita(c) {
  const d = {
    folio: c.folio,
    paciente_id: c.pacienteId || null,
    nombre: c.nombre ?? "", apellidos: c.apellidos ?? "",
    telefono: c.telefono ?? "", email: c.email ?? "",
    especialidad: c.especialidad ?? "", doctor: c.doctor ?? "",
    fecha: c.fecha || null, hora: c.hora ?? "", tipo: c.tipo ?? "", notas: c.notas ?? "",
    estado: c.estado ?? "pendiente",
    origen: c.origen ?? "panel",
    tiene_seguro: Boolean(c.tieneSeguro),
    nombre_seguro: c.nombreSeguro ?? "", numero_poliza: c.numeroPoliza ?? "",
  };
  if (c.id) d.id = c.id;
  return d;
}

function deDbConversacion(r) {
  if (!r) return null;
  return {
    id: r.id, claveExterna: r.clave_externa, pacienteId: r.paciente_id,
    telefono: r.telefono, nombreContacto: r.nombre_contacto,
    canal: r.canal, canalMeta: r.canal_meta || {},
    estado: r.estado, asunto: r.asunto,
    ultimoMensaje: r.ultimo_mensaje || null,
    noLeidos: r.no_leidos ?? 0,
    creadaEn: r.creado_en, actualizadaEn: r.actualizado_en, cerradaEn: r.cerrado_en,
  };
}

function deDbMensaje(r) {
  if (!r) return null;
  return {
    id: r.id, claveExterna: r.clave_externa, conversacionId: r.conversacion_id,
    remitente: r.remitente, autorNombre: r.autor_nombre,
    tipo: r.tipo, contenido: r.contenido,
    audioUrl: r.audio_url, duracionSeg: r.duracion_seg,
    estadoEnvio: r.estado_envio, metadata: r.metadata || {},
    fecha: r.fecha,
  };
}

function deDbClinica(r) {
  if (!r) return {};
  return {
    id: r.id,
    nombreClinica: r.nombre_clinica, nombreMedico: r.nombre_medico,
    especialidadPrincipal: r.especialidad_principal, ciudad: r.ciudad,
    telefono: r.telefono, email: r.email, whatsapp: r.whatsapp,
    cedulaProfesional: r.cedula_profesional, horarioAtencion: r.horario_atencion,
    direccionConsultorio: r.direccion_consultorio,
    logoUrl: r.logo_url, fraseHero: r.frase_hero, fotoHero: r.foto_hero,
    fotoMedico: r.foto_medico, bioMedico: r.bio_medico,
    formacionMedico: r.formacion_medico, serviciosClinica: r.servicios_clinica,
    totalPacientes: r.total_pacientes, anosExperiencia: r.anos_experiencia,
    calificacionPromedio: r.calificacion_promedio,
    facebook: r.facebook, instagram: r.instagram,
    colorPrimario: r.color_primario, colorAcento: r.color_acento,
    tipografia: r.tipografia,
  };
}

function aDbClinica(c) {
  return {
    nombre_clinica: c.nombreClinica ?? "", nombre_medico: c.nombreMedico ?? "",
    especialidad_principal: c.especialidadPrincipal ?? "", ciudad: c.ciudad ?? "",
    telefono: c.telefono ?? "", email: c.email ?? "", whatsapp: c.whatsapp ?? "",
    cedula_profesional: c.cedulaProfesional ?? "", horario_atencion: c.horarioAtencion ?? "",
    direccion_consultorio: c.direccionConsultorio ?? "",
    logo_url: c.logoUrl ?? "", frase_hero: c.fraseHero ?? "", foto_hero: c.fotoHero ?? "",
    foto_medico: c.fotoMedico ?? "", bio_medico: c.bioMedico ?? "",
    formacion_medico: c.formacionMedico ?? "", servicios_clinica: c.serviciosClinica ?? "",
    total_pacientes: c.totalPacientes ?? "", anos_experiencia: c.anosExperiencia ?? "",
    calificacion_promedio: c.calificacionPromedio ?? "",
    facebook: c.facebook ?? "", instagram: c.instagram ?? "",
    color_primario: c.colorPrimario || "#1a6eb5",
    color_acento: c.colorAcento || "#f59e0b",
    tipografia: c.tipografia || "Inter",
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Clínica
   ═══════════════════════════════════════════════════════════════════════ */

export async function clinicaObtener() {
  const cliente = await db();
  const id = await clinicaId();
  const fila = reventar(await cliente.from("clinicas").select("*").eq("id", id).maybeSingle());
  return deDbClinica(fila);
}

/**
 * Datos de la clínica para la landing, que se pinta sin sesión.
 *
 * Lee la vista `clinica_publica`, no la tabla: `clinicas` está protegida
 * por RLS y anon no tiene política sobre ella. La vista expone lo que la
 * clínica publicaría de todos modos y deja fuera el plan contratado.
 *
 * No filtra por clínica porque el modelo de despliegue es un proyecto de
 * Supabase por clínica: aquí solo hay una activa.
 */
export async function publicoClinica() {
  const cliente = await db();
  const fila = reventar(
    await cliente.from("clinica_publica").select("*").limit(1).maybeSingle()
  );
  return fila ? deDbClinica(fila) : {};
}

export async function clinicaGuardar(cfg) {
  const cliente = await db();
  const id = await clinicaId();
  const fila = reventar(
    await cliente.from("clinicas").update(aDbClinica(cfg)).eq("id", id).select().single()
  );
  return deDbClinica(fila);
}

/* ═══════════════════════════════════════════════════════════════════════
   Pacientes
   ═══════════════════════════════════════════════════════════════════════ */

export async function pacientesListar(filtros = {}) {
  const cliente = await db();
  let q = cliente.from("pacientes").select("*").order("apellidos").order("nombre");

  if (filtros.texto) {
    const t = `%${filtros.texto}%`;
    q = q.or(`nombre.ilike.${t},apellidos.ilike.${t},telefono.ilike.${t},email.ilike.${t}`);
  }
  if (filtros.calificacion) q = q.eq("calificacion", filtros.calificacion);
  if (filtros.sexo) q = q.eq("sexo", filtros.sexo);

  return (reventar(await q) || []).map(deDbPaciente);
}

export async function pacientesObtener(id) {
  const cliente = await db();
  return deDbPaciente(
    reventar(await cliente.from("pacientes").select("*").eq("id", id).maybeSingle())
  );
}

export async function pacientesPorTelefono(telefono) {
  const cliente = await db();
  const clave = String(telefono || "").replace(/\D/g, "").slice(-10);
  if (!clave) return null;
  return deDbPaciente(
    reventar(await cliente.from("pacientes").select("*").eq("telefono_clave", clave).maybeSingle())
  );
}

export async function pacientesGuardar(pac) {
  const cliente = await db();
  const fila = { ...aDbPaciente(pac), clinica_id: await clinicaId() };
  const guardado = pac.id
    ? reventar(await cliente.from("pacientes").update(fila).eq("id", pac.id).select().single())
    : reventar(await cliente.from("pacientes").insert(fila).select().single());
  return deDbPaciente(guardado);
}

export async function pacientesEliminar(id) {
  const cliente = await db();
  reventar(await cliente.from("pacientes").delete().eq("id", id));
}

export async function pacientesNotas(pacienteId) {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("notas_paciente").select("*")
      .eq("paciente_id", pacienteId).order("creado_en", { ascending: false })
  );
  return (filas || []).map(r => ({
    id: r.id, texto: r.texto, autorNombre: r.autor_nombre, creadoEn: r.creado_en,
  }));
}

export async function pacientesAgregarNota(pacienteId, texto, autorNombre = "") {
  const cliente = await db();
  const fila = reventar(
    await cliente.from("notas_paciente").insert({
      clinica_id: await clinicaId(),
      paciente_id: pacienteId,
      texto,
      autor_nombre: autorNombre,
    }).select().single()
  );
  return { id: fila.id, texto: fila.texto, autorNombre: fila.autor_nombre, creadoEn: fila.creado_en };
}

/* ═══════════════════════════════════════════════════════════════════════
   Citas
   ═══════════════════════════════════════════════════════════════════════ */

export async function citasListar(filtros = {}) {
  const cliente = await db();
  let q = cliente.from("citas").select("*").order("fecha", { ascending: false });

  if (filtros.estado && filtros.estado !== "todos") q = q.eq("estado", filtros.estado);
  if (filtros.fecha) q = q.eq("fecha", filtros.fecha);
  if (filtros.doctor) q = q.eq("doctor", filtros.doctor);
  if (filtros.pacienteId) q = q.eq("paciente_id", filtros.pacienteId);
  if (filtros.texto) {
    const t = `%${filtros.texto}%`;
    q = q.or(`nombre.ilike.${t},apellidos.ilike.${t},folio.ilike.${t},telefono.ilike.${t}`);
  }

  return (reventar(await q) || []).map(deDbCita);
}

export async function citasObtener(id) {
  const cliente = await db();
  return deDbCita(reventar(await cliente.from("citas").select("*").eq("id", id).maybeSingle()));
}

export async function citasPorFolio(folio) {
  const cliente = await db();
  return deDbCita(
    reventar(await cliente.from("citas").select("*").eq("folio", folio).maybeSingle())
  );
}

/** Folio de cita con el formato de siempre: `CIT-AAMMDD-XXXX`. */
function _folioCita() {
  const d = new Date();
  const aa = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `CIT-${aa}${mm}${dd}-${Math.floor(Math.random() * 9000) + 1000}`;
}

/**
 * Crea una cita desde el panel o desde MediBot.
 *
 * Hace dos cosas que la versión anterior daba por hechas y no lo eran:
 *
 * 1. **Genera el folio.** `citas.folio` es NOT NULL, y al centralizar la
 *    generación en la capa de datos (B2) los módulos dejaron de mandarlo.
 *    Solo api-local lo generaba, así que contra Postgres toda cita creada
 *    desde el chat o desde "+ Nueva cita" moría con violación de NOT NULL.
 *    El reintento es contra el índice único `(clinica_id, folio)`, mismo
 *    criterio que ya usa la función `solicitar_cita`.
 *
 * 2. **Vincula el expediente.** api-local llama a `_asegurarPacientePorCita`
 *    y aquí no había nada equivalente: no hay disparador en la tabla, solo
 *    la RPC pública lo hacía. Una cita creada desde el panel se habría
 *    quedado sin paciente, y el expediente sin esa cita.
 */
export async function citasCrear(cita) {
  const cliente = await db();
  const idClinica = await clinicaId();

  let pacienteId = cita.pacienteId || null;
  if (!pacienteId && cita.telefono) {
    const existente = await pacientesPorTelefono(cita.telefono);
    pacienteId = existente
      ? existente.id
      : (await pacientesGuardar({
          nombre: cita.nombre || "",
          apellidos: cita.apellidos || "",
          telefono: cita.telefono,
          email: cita.email || "",
          tieneSeguro: Boolean(cita.tieneSeguro),
          nombreSeguro: cita.nombreSeguro || "",
          numeroPoliza: cita.numeroPoliza || "",
        })).id;
  }

  for (let intento = 0; intento < 12; intento++) {
    const folio = cita.folio || _folioCita();
    const { data, error } = await cliente
      .from("citas")
      .insert({ ...aDbCita({ ...cita, folio, pacienteId }), clinica_id: idClinica })
      .select()
      .single();

    if (!error) return deDbCita(data);

    /* 23505 es violación de índice único. Si el folio lo eligió quien
       llama, el choque es suyo y hay que avisarle; si lo generamos aquí,
       se reintenta con otro. */
    if (cita.folio || error.code !== "23505") throw new Error(error.message);
  }

  throw new Error("No se pudo generar un folio libre para hoy. Intenta de nuevo.");
}

/** Actualización parcial: solo viajan las columnas que vengan en `cambios`. */
const COLUMNAS_CITA = {
  estado: "estado", notas: "notas", fecha: "fecha", hora: "hora",
  doctor: "doctor", especialidad: "especialidad", tipo: "tipo",
  pacienteId: "paciente_id", email: "email", telefono: "telefono",
  nombre: "nombre", apellidos: "apellidos",
  tieneSeguro: "tiene_seguro", nombreSeguro: "nombre_seguro", numeroPoliza: "numero_poliza",
};

export async function citasActualizar(id, cambios) {
  const cliente = await db();

  const fila = {};
  for (const [clave, valor] of Object.entries(cambios || {})) {
    const columna = COLUMNAS_CITA[clave];
    if (!columna) continue;
    // Una cadena vacía no es una fecha válida para Postgres.
    fila[columna] = columna === "fecha" ? (valor || null) : valor;
  }

  if (Object.keys(fila).length === 0) return citasObtener(id);

  return deDbCita(
    reventar(await cliente.from("citas").update(fila).eq("id", id).select().single())
  );
}

export async function citasEliminar(id) {
  const cliente = await db();
  reventar(await cliente.from("citas").delete().eq("id", id));
}

/* ═══════════════════════════════════════════════════════════════════════
   Conversaciones y mensajes
   ═══════════════════════════════════════════════════════════════════════ */

export async function conversacionesListar(filtros = {}) {
  const cliente = await db();
  let q = cliente.from("conversaciones").select("*").order("actualizado_en", { ascending: false });

  if (filtros.canal && filtros.canal !== "todos") q = q.eq("canal", filtros.canal);
  if (filtros.estado && filtros.estado !== "todos") q = q.eq("estado", filtros.estado);

  let filas = reventar(await q) || [];

  // La búsqueda entra al cuerpo de los mensajes, no solo al encabezado.
  // Se hace en dos pasos porque Postgrest no cruza tablas en un `or`.
  if (filtros.texto && filtros.texto.trim()) {
    const t = filtros.texto.trim();
    const patron = `%${t}%`;
    const conMatch = reventar(
      await cliente.from("mensajes").select("conversacion_id").ilike("contenido", patron)
    ) || [];
    const ids = new Set(conMatch.map(m => m.conversacion_id));
    const tDigitos = t.replace(/\D/g, "");
    const tLower = t.toLowerCase();
    filas = filas.filter(c =>
      ids.has(c.id) ||
      (c.nombre_contacto || "").toLowerCase().includes(tLower) ||
      (c.asunto || "").toLowerCase().includes(tLower) ||
      (tDigitos && (c.telefono || "").replace(/\D/g, "").includes(tDigitos))
    );
  }

  return filas.map(deDbConversacion);
}

export async function conversacionesObtener(id) {
  const cliente = await db();
  return deDbConversacion(
    reventar(await cliente.from("conversaciones").select("*").eq("id", id).maybeSingle())
  );
}

/**
 * Upsert con la misma identidad que define la base: clave externa del
 * proveedor si la hay; si no, canal + teléfono.
 */
export async function conversacionesUpsert(datos) {
  const cliente = await db();
  const cid = await clinicaId();
  const clave = String(datos.telefono || "").replace(/\D/g, "").slice(-10);

  let existente = null;
  if (datos.claveExterna) {
    existente = reventar(
      await cliente.from("conversaciones").select("*")
        .eq("clave_externa", datos.claveExterna).maybeSingle()
    );
  }
  if (!existente && clave) {
    existente = reventar(
      await cliente.from("conversaciones").select("*")
        .eq("canal", datos.canal).eq("telefono_clave", clave)
        .is("clave_externa", null).maybeSingle()
    );
  }

  // No degradar con vacíos lo que ya se sabía.
  const fila = {
    clinica_id: cid,
    clave_externa: datos.claveExterna || existente?.clave_externa || null,
    paciente_id: datos.pacienteId || existente?.paciente_id || null,
    telefono: datos.telefono || existente?.telefono || "",
    nombre_contacto: datos.nombreContacto || existente?.nombre_contacto || "",
    canal: datos.canal,
    canal_meta: datos.canalMeta || existente?.canal_meta || {},
    estado: datos.estado || existente?.estado || "abierta",
    asunto: datos.asunto || existente?.asunto || "",
  };

  const guardada = existente
    ? reventar(await cliente.from("conversaciones").update(fila).eq("id", existente.id).select().single())
    : reventar(await cliente.from("conversaciones").insert(fila).select().single());

  return deDbConversacion(guardada);
}

export async function conversacionesCambiarEstado(id, estado) {
  const cliente = await db();
  const fila = reventar(
    await cliente.from("conversaciones")
      .update({ estado, cerrado_en: estado === "resuelta" ? new Date().toISOString() : null })
      .eq("id", id).select().single()
  );
  return deDbConversacion(fila);
}

export async function conversacionesMarcarLeida(id) {
  const cliente = await db();
  reventar(await cliente.from("conversaciones").update({ no_leidos: 0 }).eq("id", id));
}

export async function conversacionesEliminar(id) {
  const cliente = await db();
  reventar(await cliente.from("conversaciones").delete().eq("id", id));
}

export async function conversacionesContarPorEstado() {
  const cliente = await db();
  const filas = reventar(await cliente.from("conversaciones").select("estado,no_leidos")) || [];
  return {
    total: filas.length,
    abierta: filas.filter(c => c.estado === "abierta").length,
    requiere_atencion_humana: filas.filter(c => c.estado === "requiere_atencion_humana").length,
    resuelta: filas.filter(c => c.estado === "resuelta").length,
    noLeidos: filas.reduce((s, c) => s + (c.no_leidos || 0), 0),
  };
}

export async function mensajesListar(conversacionId) {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("mensajes").select("*")
      .eq("conversacion_id", conversacionId).order("fecha")
  );
  return (filas || []).map(deDbMensaje);
}

/**
 * El resumen de la conversación (último mensaje, no leídos) NO se toca
 * aquí: lo mantiene un disparador en la base. Así queda consistente
 * aunque el mensaje entre por un webhook y no por el navegador.
 */
export async function mensajesAgregar(conversacionId, msg) {
  const cliente = await db();
  const fila = {
    clinica_id: await clinicaId(),
    conversacion_id: conversacionId,
    clave_externa: msg.id || msg.claveExterna || null,
    remitente: msg.remitente || "sistema",
    autor_nombre: msg.autorNombre || "",
    tipo: msg.tipo || "texto",
    contenido: msg.contenido || "",
    audio_url: msg.audioUrl || null,
    duracion_seg: msg.duracionSeg ?? null,
    estado_envio: msg.estadoEnvio || (msg.remitente === "paciente" ? "recibido" : "enviado"),
    metadata: msg.metadata || {},
    fecha: msg.fecha || new Date().toISOString(),
  };

  const { data, error } = await cliente.from("mensajes").insert(fila).select().single();

  // 23505 = clave duplicada. Reingerir el mismo webhook no es un error:
  // es exactamente lo que la idempotencia debe absorber en silencio.
  if (error && error.code === "23505") {
    const previo = reventar(
      await cliente.from("mensajes").select("*").eq("clave_externa", fila.clave_externa).maybeSingle()
    );
    return deDbMensaje(previo);
  }
  if (error) throw new Error(error.message);
  return deDbMensaje(data);
}

export async function mensajesActualizarEstadoEnvio(id, estadoEnvio, detalle) {
  const cliente = await db();
  const previo = reventar(
    await cliente.from("mensajes").select("metadata").eq("id", id).maybeSingle()
  );
  const metadata = { ...(previo?.metadata || {}) };
  if (detalle) metadata.detalleEnvio = detalle;

  return deDbMensaje(
    reventar(
      await cliente.from("mensajes").update({ estado_envio: estadoEnvio, metadata })
        .eq("id", id).select().single()
    )
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Documentos y posts
   ═══════════════════════════════════════════════════════════════════════ */

/* El documento se identifica hacia afuera por el folio de su cita, que es
   lo que la asistente ve y teclea. En la base el vínculo es cita_id, así
   que se trae el folio por join: sin él, el historial de MediDocs saldría
   con la columna de folio en blanco y el clic para reabrir un documento
   no encontraría su cita. */
const deDbDocumento = r => ({
  id: r.id,
  codigo: r.codigo,
  citaId: r.cita_id,
  folio: r.citas?.folio || "",
  pacienteId: r.paciente_id,
  tipodoc: r.tipo_doc,
  inputs: r.inputs || {},
  creadoEn: r.creado_en,
});

export async function documentosListar(filtros = {}) {
  const cliente = await db();
  let q = cliente.from("documentos")
    .select("*, citas(folio)")
    .order("creado_en", { ascending: false });
  if (filtros.pacienteId) q = q.eq("paciente_id", filtros.pacienteId);
  if (filtros.citaId) q = q.eq("cita_id", filtros.citaId);

  let docs = (reventar(await q) || []).map(deDbDocumento);
  if (filtros.folio) docs = docs.filter(d => d.folio === filtros.folio);
  return docs;
}

export async function documentosCrear(doc) {
  const cliente = await db();

  /* Quien llama trabaja con folios, no con uuids. Se resuelve aquí para
     que medidocs.js no tenga que saber cómo se llama la cita por dentro. */
  let citaId = doc.citaId || null;
  let pacienteId = doc.pacienteId || null;
  if (!citaId && doc.folio) {
    const cita = reventar(
      await cliente.from("citas").select("id, paciente_id").eq("folio", doc.folio).maybeSingle()
    );
    if (cita) {
      citaId = cita.id;
      pacienteId = pacienteId || cita.paciente_id;
    }
  }

  const fila = reventar(
    await cliente.from("documentos").insert({
      clinica_id: await clinicaId(),
      cita_id: citaId,
      paciente_id: pacienteId,
      codigo: doc.codigo || null,
      tipo_doc: doc.tipodoc || doc.tipoDoc || "",
      inputs: doc.inputs || {},
    }).select("*, citas(folio)").single()
  );
  return deDbDocumento(fila);
}

export async function documentosEliminar(id) {
  const cliente = await db();
  reventar(await cliente.from("documentos").delete().eq("id", id));
}

const deDbPost = r => ({
  id: r.id, tipo: r.tipo, especialidad: r.especialidad, red: r.red, tono: r.tono,
  caption: r.caption, hashtags: r.hashtags,
  sugerenciaImagen: r.sugerencia_imagen ?? "",
  promptIA: r.prompt_ia ?? "",
  llamadaAccion: r.llamada_accion ?? "",
  fechaProgramada: soloFecha(r.fecha_programada),
  publicado: r.publicado, borrador: r.borrador, creadoEn: r.creado_en,
});

export async function postsListar() {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("posts").select("*").order("creado_en", { ascending: false })
  );
  return (filas || []).map(deDbPost);
}

export async function postsCrear(post) {
  const cliente = await db();
  const fila = reventar(
    await cliente.from("posts").insert({
      clinica_id: await clinicaId(),
      tipo: post.tipo ?? "", especialidad: post.especialidad ?? "",
      red: post.red ?? "", tono: post.tono ?? "",
      caption: post.caption ?? "", hashtags: post.hashtags ?? "",
      sugerencia_imagen: post.sugerenciaImagen ?? "",
      prompt_ia: post.promptIA ?? "",
      llamada_accion: post.llamadaAccion ?? "",
      fecha_programada: post.fechaProgramada || null,
      publicado: Boolean(post.publicado),
      borrador: post.borrador !== false,
    }).select().single()
  );
  return deDbPost(fila);
}

export async function postsActualizar(id, cambios) {
  const cliente = await db();
  const fila = {};
  if ("caption" in cambios) fila.caption = cambios.caption;
  if ("hashtags" in cambios) fila.hashtags = cambios.hashtags;
  if ("fechaProgramada" in cambios) fila.fecha_programada = cambios.fechaProgramada || null;
  if ("publicado" in cambios) fila.publicado = Boolean(cambios.publicado);
  if ("borrador" in cambios) fila.borrador = Boolean(cambios.borrador);

  return deDbPost(
    reventar(await cliente.from("posts").update(fila).eq("id", id).select().single())
  );
}

export async function postsEliminar(id) {
  const cliente = await db();
  reventar(await cliente.from("posts").delete().eq("id", id));
}

/* ═══════════════════════════════════════════════════════════════════════
   NPS y seguimientos
   ═══════════════════════════════════════════════════════════════════════ */

export async function npsListar() {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("nps_respuestas")
      .select("*, citas(folio, nombre, apellidos)")
      .order("creado_en", { ascending: false })
  );
  return (filas || []).map(r => ({
    id: r.id,
    folio: r.citas?.folio || "",
    paciente: `${r.citas?.nombre || ""} ${r.citas?.apellidos || ""}`.trim(),
    puntuacion: r.puntuacion,
    comentario: r.comentario,
    fechaRespuesta: r.creado_en,
  }));
}

/** Va por RPC: es el flujo que usa el paciente desde encuesta.html, sin sesión. */
export async function npsResponder(folio, puntuacion, comentario = "") {
  const cliente = await db();
  const { error } = await cliente.rpc("responder_encuesta", {
    p_folio: folio, p_puntuacion: puntuacion, p_comentario: comentario,
  });
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Registra una respuesta desde el panel, no desde la encuesta.
 *
 * No usa la RPC `responder_encuesta`: esa es para el paciente anónimo y
 * valida como tal. Aquí hay sesión de staff, así que se inserta directo
 * y RLS se encarga de que sea en la clínica correcta.
 */
export async function npsRegistrar(folio, puntuacion, comentario = "") {
  const cliente = await db();

  const cita = reventar(
    await cliente.from("citas").select("id").eq("folio", folio).maybeSingle()
  );
  if (!cita) throw new Error(`No existe ninguna cita con el folio ${folio}.`);

  const fila = reventar(
    await cliente.from("nps_respuestas").insert({
      clinica_id: await clinicaId(),
      cita_id: cita.id,
      puntuacion,
      comentario: comentario || "",
    }).select().single()
  );

  return {
    id: fila.id,
    folio,
    puntuacion: fila.puntuacion,
    comentario: fila.comentario,
    fechaRespuesta: fila.creado_en,
  };
}

export async function npsYaRespondida(folio) {
  const cliente = await db();
  const { data, error } = await cliente.rpc("encuesta_ya_respondida", { p_folio: folio });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Opiniones para la landing. Lee la vista `testimonios_publicos`, no la
 * tabla: `nps_respuestas` está protegida por RLS y el rol anónimo no
 * tiene política sobre ella, así que un visitante sin sesión no vería
 * nada. La vista expone solo lo publicable (ver migración 0007).
 */
export async function publicoTestimonios({ minPuntuacion = 8, limite = 3 } = {}) {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("testimonios_publicos")
      .select("id, nombre_publico, puntuacion, comentario, creado_en")
      .gte("puntuacion", minPuntuacion)
      .order("creado_en", { ascending: false })
      .limit(limite)
  );
  return (filas || []).map(r => ({
    id: r.id,
    nombrePublico: r.nombre_publico || "",
    puntuacion: r.puntuacion,
    comentario: r.comentario || "",
    creadoEn: r.creado_en || "",
  }));
}

export async function seguimientosListar() {
  const cliente = await db();
  const filas = reventar(
    await cliente.from("seguimientos")
      .select("*, citas(folio, nombre, apellidos, email)")
      .order("fecha_atendida", { ascending: false })
  );
  return (filas || []).map(r => ({
    id: r.id,
    citaId: r.cita_id,
    folio: r.citas?.folio || "",
    paciente: `${r.citas?.nombre || ""} ${r.citas?.apellidos || ""}`.trim(),
    email: r.citas?.email || "",
    fechaAtendida: soloFecha(r.fecha_atendida),
    emailEnviado_3d: r.email_enviado_3d,
    emailEnviado_30d: r.email_enviado_30d,
  }));
}

export async function seguimientosRegistrar(citaId, fechaAtendida) {
  const cliente = await db();
  const { data, error } = await cliente.from("seguimientos").insert({
    clinica_id: await clinicaId(),
    cita_id: citaId,
    fecha_atendida: fechaAtendida || new Date().toISOString().slice(0, 10),
  }).select().single();

  // Ya existía: marcar "atendida" dos veces no debe tronar.
  if (error && error.code === "23505") return null;
  if (error) throw new Error(error.message);
  return { id: data.id, citaId: data.cita_id };
}

export async function seguimientosMarcarEnviado(id, cual) {
  const cliente = await db();
  const ahora = new Date().toISOString();
  const fila = cual === "30d"
    ? { email_enviado_30d: true, enviado_30d_en: ahora }
    : { email_enviado_3d: true, enviado_3d_en: ahora };
  reventar(await cliente.from("seguimientos").update(fila).eq("id", id));
}

/* ═══════════════════════════════════════════════════════════════════════
   Flujo público
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Pedir cita desde la landing. Va por RPC y no por INSERT directo: el rol
 * anónimo no tiene política sobre ninguna tabla, y la función es la que
 * valida, frena abuso y fija estado y origen.
 */
export async function publicoSolicitarCita(d) {
  const cliente = await db();
  const { data, error } = await cliente.rpc("solicitar_cita", {
    p_nombre: d.nombre, p_apellidos: d.apellidos || "",
    p_telefono: d.telefono, p_email: d.email || "",
    p_especialidad: d.especialidad || "", p_doctor: d.doctor || "",
    p_fecha: d.fecha, p_hora: d.hora || "", p_tipo: d.tipo || "",
    p_notas: d.notas || "",
    p_tiene_seguro: Boolean(d.tieneSeguro),
    p_nombre_seguro: d.nombreSeguro || "", p_numero_poliza: d.numeroPoliza || "",
  });
  if (error) throw new Error(error.message);
  return data;
}
