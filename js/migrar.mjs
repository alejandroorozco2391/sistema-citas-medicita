/* ═══════════════════════════════════════════════════════════════════════
   migrar.mjs — Pasar los datos del navegador a la base de datos

   El reto no es mover filas, es reconstruir los vínculos. En localStorage
   todo se enlaza con cadenas de texto (`foliosCitas: ["CIT-260601-4521"]`,
   `conversacionId: "CONV-..."`), y en Postgres con UUID. Así que la
   migración va en orden de dependencias y va construyendo mapas de
   equivalencia sobre la marcha.

   Es idempotente: cada entidad se busca por su llave natural antes de
   insertarse (teléfono para el paciente, folio para la cita, clave del
   proveedor para conversaciones y mensajes). Volver a correrla no
   duplica nada, así que si algo falla a la mitad se puede reintentar.
   ═══════════════════════════════════════════════════════════════════════ */

import { obtenerCliente } from "./supabase-client.mjs";

export const CLAVES = {
  config: "medicita_config_clinica",
  pacientes: "medicita_pacientes",
  citas: "medicita_citas",
  conversaciones: "medicita_conversaciones",
  mensajes: "medicita_mensajes",
  documentos: "medicita_docs",
  posts: "medicita_posts",
  nps: "medicita_nps",
  seguimientos: "medicita_followup_pendientes",
};

/* ─── Utilidades puras (se prueban en node sin backend) ───────────────── */

export function leerClave(clave, porOmision = []) {
  try {
    const crudo = localStorage.getItem(clave);
    if (!crudo) return porOmision;
    return JSON.parse(crudo);
  } catch {
    return porOmision;
  }
}

export function claveTel(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/** Fecha ISO válida o null: una cadena vacía no es una fecha para Postgres. */
export function fechaONull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Inventario de lo que hay en este navegador, para enseñarlo antes de tocar nada. */
export function inventario() {
  const cuenta = {};
  for (const [nombre, clave] of Object.entries(CLAVES)) {
    if (nombre === "config") {
      const cfg = leerClave(clave, {});
      cuenta[nombre] = cfg && Object.keys(cfg).length ? 1 : 0;
    } else {
      const v = leerClave(clave, []);
      cuenta[nombre] = Array.isArray(v) ? v.length : 0;
    }
  }
  return cuenta;
}

/* ─── Reporte ─────────────────────────────────────────────────────────── */
function nuevoReporte() {
  return { pasos: [], errores: [] };
}

function anotar(rep, entidad, { insertados = 0, existentes = 0, omitidos = 0 }) {
  rep.pasos.push({ entidad, insertados, existentes, omitidos });
}

/* ═══════════════════════════════════════════════════════════════════════
   Migración
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {Object} opciones
 * @param {string} opciones.clinicaId  clínica destino
 * @param {Function} opciones.alAvanzar  callback(texto) para la barra de progreso
 */
export async function migrarTodo({ clinicaId, alAvanzar = () => {} } = {}) {
  const cliente = await obtenerCliente();
  if (!cliente) throw new Error("No hay backend configurado");
  if (!clinicaId) throw new Error("Falta la clínica destino");

  const rep = nuevoReporte();

  // Mapas de equivalencia entre el mundo viejo y el nuevo.
  const idPacientePorTel = new Map();   // telefonoClave → uuid
  const idPacientePorViejo = new Map(); // "PAC-…"       → uuid
  const idCitaPorFolio = new Map();     // "CIT-…"       → uuid
  const idConvPorVieja = new Map();     // "CONV-…"      → uuid

  /* ── 1. Configuración de la clínica ── */
  alAvanzar("Configuración de la clínica…");
  const cfg = leerClave(CLAVES.config, {});
  if (cfg && Object.keys(cfg).length) {
    const { error } = await cliente.from("clinicas").update({
      nombre_clinica: cfg.nombreClinica || "Mi clínica",
      nombre_medico: cfg.nombreMedico || "",
      especialidad_principal: cfg.especialidadPrincipal || "",
      ciudad: cfg.ciudad || "", telefono: cfg.telefono || "", email: cfg.email || "",
      whatsapp: cfg.whatsapp || "",
      cedula_profesional: cfg.cedulaProfesional || "",
      horario_atencion: cfg.horarioAtencion || "",
      direccion_consultorio: cfg.direccionConsultorio || "",
      logo_url: cfg.logoUrl || "", frase_hero: cfg.fraseHero || "",
      foto_hero: cfg.fotoHero || "", foto_medico: cfg.fotoMedico || "",
      bio_medico: cfg.bioMedico || "", formacion_medico: cfg.formacionMedico || "",
      servicios_clinica: cfg.serviciosClinica || "",
      total_pacientes: cfg.totalPacientes || "", anos_experiencia: cfg.anosExperiencia || "",
      calificacion_promedio: cfg.calificacionPromedio || "",
      facebook: cfg.facebook || "", instagram: cfg.instagram || "",
      color_primario: cfg.colorPrimario || "#1a6eb5",
      color_acento: cfg.colorAcento || "#f59e0b",
      tipografia: cfg.tipografia || "Inter",
    }).eq("id", clinicaId);
    if (error) rep.errores.push(`Configuración: ${error.message}`);
    anotar(rep, "Configuración", { insertados: error ? 0 : 1 });
  } else {
    anotar(rep, "Configuración", { omitidos: 1 });
  }

  /* ── 2. Pacientes ── */
  alAvanzar("Expedientes de pacientes…");
  const pacientes = leerClave(CLAVES.pacientes);
  let ins = 0, exi = 0, omi = 0;

  for (const p of pacientes) {
    const tel = claveTel(p.telefono);
    if (!tel) { omi++; continue; }

    const { data: previo } = await cliente.from("pacientes")
      .select("id").eq("clinica_id", clinicaId).eq("telefono_clave", tel).maybeSingle();

    if (previo) {
      idPacientePorTel.set(tel, previo.id);
      if (p.id) idPacientePorViejo.set(p.id, previo.id);
      exi++;
      continue;
    }

    const { data, error } = await cliente.from("pacientes").insert({
      clinica_id: clinicaId,
      codigo: p.id || null,
      nombre: p.nombre || "", apellidos: p.apellidos || "",
      telefono: p.telefono || "", email: p.email || "",
      fecha_nacimiento: fechaONull(p.fechaNacimiento),
      sexo: p.sexo || "", estatura: p.estatura || "", peso: p.peso || "",
      tipo_sangre: p.tipoSangre || "",
      alergias: p.alergias || "",
      enfermedades_cronicas: p.enfermedadesCronicas || "",
      medicamentos_actuales: p.medicamentosActuales || "",
      tiene_seguro: Boolean(p.tieneSeguro),
      nombre_seguro: p.nombreSeguro || "", numero_poliza: p.numeroPoliza || "",
      ciudad: p.ciudad || "", como_nos_encontro: p.comoNosEncontro || "",
      ocupacion: p.ocupacion || "",
      calificacion: p.calificacion || 1,
    }).select("id").single();

    if (error) { rep.errores.push(`Paciente ${p.nombre || p.id}: ${error.message}`); omi++; continue; }

    idPacientePorTel.set(tel, data.id);
    if (p.id) idPacientePorViejo.set(p.id, data.id);
    ins++;

    // Las notas embebidas salen a su propia tabla.
    for (const n of p.historialNotas || []) {
      await cliente.from("notas_paciente").insert({
        clinica_id: clinicaId, paciente_id: data.id,
        texto: n.texto || String(n), autor_nombre: n.autor || "",
        creado_en: n.creadoEn || new Date().toISOString(),
      });
    }
  }
  anotar(rep, "Pacientes", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 3. Citas ── */
  alAvanzar("Citas…");
  const citas = leerClave(CLAVES.citas);
  ins = exi = omi = 0;

  for (const c of citas) {
    if (!c.folio) { omi++; continue; }

    const { data: previa } = await cliente.from("citas")
      .select("id").eq("clinica_id", clinicaId).eq("folio", c.folio).maybeSingle();

    if (previa) { idCitaPorFolio.set(c.folio, previa.id); exi++; continue; }

    const fecha = fechaONull(c.fecha);
    if (!fecha) { rep.errores.push(`Cita ${c.folio}: fecha inválida`); omi++; continue; }

    const { data, error } = await cliente.from("citas").insert({
      clinica_id: clinicaId,
      paciente_id: idPacientePorTel.get(claveTel(c.telefono)) || null,
      folio: c.folio,
      nombre: c.nombre || "", apellidos: c.apellidos || "",
      telefono: c.telefono || "", email: c.email || "",
      especialidad: c.especialidad || "", doctor: c.doctor || "",
      fecha, hora: c.hora || "", tipo: c.tipo || "", notas: c.notas || "",
      estado: ["pendiente", "confirmada", "atendida", "cancelada"].includes(c.estado)
        ? c.estado : "pendiente",
      tiene_seguro: Boolean(c.tieneSeguro),
      nombre_seguro: c.nombreSeguro || "", numero_poliza: c.numeroPoliza || "",
      origen: c.origen || "migracion",
      creado_en: c.creadaEn || new Date().toISOString(),
    }).select("id").single();

    if (error) { rep.errores.push(`Cita ${c.folio}: ${error.message}`); omi++; continue; }
    idCitaPorFolio.set(c.folio, data.id);
    ins++;
  }
  anotar(rep, "Citas", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 4. Conversaciones ── */
  alAvanzar("Conversaciones…");
  const convs = leerClave(CLAVES.conversaciones);
  ins = exi = omi = 0;

  for (const cv of convs) {
    const tel = claveTel(cv.telefono);

    let previa = null;
    if (cv.claveExterna) {
      ({ data: previa } = await cliente.from("conversaciones")
        .select("id").eq("clinica_id", clinicaId).eq("clave_externa", cv.claveExterna).maybeSingle());
    }
    if (!previa && tel) {
      ({ data: previa } = await cliente.from("conversaciones")
        .select("id").eq("clinica_id", clinicaId).eq("canal", cv.canal)
        .eq("telefono_clave", tel).is("clave_externa", null).maybeSingle());
    }

    if (previa) { idConvPorVieja.set(cv.id, previa.id); exi++; continue; }

    const { data, error } = await cliente.from("conversaciones").insert({
      clinica_id: clinicaId,
      clave_externa: cv.claveExterna || null,
      paciente_id: idPacientePorViejo.get(cv.pacienteId) || idPacientePorTel.get(tel) || null,
      telefono: cv.telefono || "", nombre_contacto: cv.nombreContacto || "",
      canal: cv.canal, canal_meta: cv.canalMeta || {},
      estado: cv.estado || "abierta", asunto: cv.asunto || "",
      no_leidos: cv.noLeidos || 0,
      creado_en: cv.creadaEn || new Date().toISOString(),
    }).select("id").single();

    if (error) { rep.errores.push(`Conversación ${cv.id}: ${error.message}`); omi++; continue; }
    idConvPorVieja.set(cv.id, data.id);
    ins++;
  }
  anotar(rep, "Conversaciones", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 5. Mensajes ── */
  alAvanzar("Mensajes…");
  const mensajes = leerClave(CLAVES.mensajes);
  ins = exi = omi = 0;

  // En orden cronológico, para que el disparador deje bien el resumen.
  const ordenados = [...mensajes].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  for (const m of ordenados) {
    const convId = idConvPorVieja.get(m.conversacionId);
    if (!convId) { omi++; continue; }

    if (m.id) {
      const { data: previo } = await cliente.from("mensajes")
        .select("id").eq("clinica_id", clinicaId).eq("clave_externa", m.id).maybeSingle();
      if (previo) { exi++; continue; }
    }

    const { error } = await cliente.from("mensajes").insert({
      clinica_id: clinicaId, conversacion_id: convId,
      clave_externa: m.id || null,
      remitente: m.remitente || "sistema", autor_nombre: m.autorNombre || "",
      tipo: m.tipo || "texto", contenido: m.contenido || "",
      audio_url: m.audioUrl || null, duracion_seg: m.duracionSeg ?? null,
      estado_envio: m.estadoEnvio || "enviado",
      metadata: m.metadata || {},
      fecha: m.fecha || new Date().toISOString(),
    });

    if (error) { rep.errores.push(`Mensaje ${m.id}: ${error.message}`); omi++; continue; }
    ins++;
  }
  anotar(rep, "Mensajes", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 6. Documentos ── */
  alAvanzar("Documentos clínicos…");
  const docs = leerClave(CLAVES.documentos);
  ins = exi = omi = 0;

  for (const d of docs) {
    const citaId = idCitaPorFolio.get(d.folio) || null;
    const { data: previo } = await cliente.from("documentos")
      .select("id").eq("clinica_id", clinicaId).eq("codigo", d.id || "").maybeSingle();
    if (previo) { exi++; continue; }

    const { error } = await cliente.from("documentos").insert({
      clinica_id: clinicaId, cita_id: citaId,
      paciente_id: null,
      codigo: d.id || null, tipo_doc: d.tipodoc || "", inputs: d.inputs || {},
      creado_en: d.creadoEn || new Date().toISOString(),
    });
    if (error) { rep.errores.push(`Documento ${d.id}: ${error.message}`); omi++; continue; }
    ins++;
  }
  anotar(rep, "Documentos", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 7. Posts ── */
  alAvanzar("Posts de redes…");
  const posts = leerClave(CLAVES.posts);
  ins = omi = 0;

  for (const p of posts) {
    const { error } = await cliente.from("posts").insert({
      clinica_id: clinicaId,
      tipo: p.tipo || "", especialidad: p.especialidad || "",
      red: p.red || "", tono: p.tono || "",
      caption: p.caption || "", hashtags: p.hashtags || "",
      fecha_programada: fechaONull(p.fechaProgramada),
      publicado: Boolean(p.publicado), borrador: p.borrador !== false,
      creado_en: p.creadoEn || new Date().toISOString(),
    });
    if (error) { rep.errores.push(`Post ${p.id}: ${error.message}`); omi++; continue; }
    ins++;
  }
  anotar(rep, "Posts", { insertados: ins, omitidos: omi });

  /* ── 8. NPS ── */
  alAvanzar("Respuestas de encuestas…");
  const nps = leerClave(CLAVES.nps);
  ins = exi = omi = 0;

  for (const n of nps) {
    const citaId = idCitaPorFolio.get(n.folio);
    if (!citaId) { omi++; continue; }

    const { data: previo } = await cliente.from("nps_respuestas")
      .select("id").eq("cita_id", citaId).maybeSingle();
    if (previo) { exi++; continue; }

    const { error } = await cliente.from("nps_respuestas").insert({
      clinica_id: clinicaId, cita_id: citaId,
      puntuacion: n.puntuacion, comentario: n.comentario || "",
      creado_en: n.fechaRespuesta || new Date().toISOString(),
    });
    if (error) { rep.errores.push(`NPS ${n.folio}: ${error.message}`); omi++; continue; }
    ins++;
  }
  anotar(rep, "Encuestas NPS", { insertados: ins, existentes: exi, omitidos: omi });

  /* ── 9. Seguimientos ── */
  alAvanzar("Seguimientos pendientes…");
  const seg = leerClave(CLAVES.seguimientos);
  ins = exi = omi = 0;

  for (const s of seg) {
    const citaId = idCitaPorFolio.get(s.folio);
    if (!citaId) { omi++; continue; }

    const { data: previo } = await cliente.from("seguimientos")
      .select("id").eq("cita_id", citaId).maybeSingle();
    if (previo) { exi++; continue; }

    const { error } = await cliente.from("seguimientos").insert({
      clinica_id: clinicaId, cita_id: citaId,
      fecha_atendida: fechaONull(s.fechaAtendida) || new Date().toISOString().slice(0, 10),
      email_enviado_3d: Boolean(s.emailEnviado_3d),
      email_enviado_30d: Boolean(s.emailEnviado_30d),
    });
    if (error) { rep.errores.push(`Seguimiento ${s.folio}: ${error.message}`); omi++; continue; }
    ins++;
  }
  anotar(rep, "Seguimientos", { insertados: ins, existentes: exi, omitidos: omi });

  alAvanzar("Listo");
  return rep;
}

/**
 * Borra los datos locales. Se ofrece SOLO después de una migración
 * exitosa: si se borrara antes, un error a media migración dejaría a la
 * clínica sin sus datos en ningún lado.
 */
export function limpiarLocal() {
  for (const clave of Object.values(CLAVES)) localStorage.removeItem(clave);
  localStorage.removeItem("medicita_demo_seeded");
  localStorage.removeItem("medicita_sesion");
}
