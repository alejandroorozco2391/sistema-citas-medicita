/* ─── Estado ──────────────────────────────────────────────────────────── */
const estadoAdmin = {
  citas: [],
  filtros: { busqueda: "", fecha: "", doctor: "", estado: "" },
};

// Credenciales EmailJS — solo en memoria, nunca en localStorage
let ejsServiceIdAdmin  = "";
let ejsTemplateIdAdmin = "";
let ejsPublicKeyAdmin  = "";

/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  aplicarAparienciaConfig(leerConfigClinica());
  cargarCitas();
  poblarFiltroDoctores();
  renderStats();
  renderTabla();
  bindEventos();
  bindConfigModal();
  bindModalNuevaCita();
  renderSeguimientos();
  actualizarBadgeSeguimientos();
  renderOpinionesRecientes();

  // Refresca si el paciente guarda una cita en otra pestaña
  window.addEventListener("storage", (e) => {
    if (e.key === "medicita_citas") {
      cargarCitas();
      renderStats();
      renderTabla();
      mostrarToast("Nueva cita recibida desde el sitio.", "ok");
    }
    if (e.key === "medicita_nps") {
      renderStats();
      renderOpinionesRecientes();
    }
  });
});

/* ─── Persistencia ────────────────────────────────────────────────────── */
function cargarCitas() {
  estadoAdmin.citas = JSON.parse(localStorage.getItem("medicita_citas") || "[]");
}

function guardarCitas() {
  localStorage.setItem("medicita_citas", JSON.stringify(estadoAdmin.citas));
}

/* ─── Filtros ─────────────────────────────────────────────────────────── */
function bindEventos() {
  document.getElementById("filtro-busqueda").addEventListener("input", aplicarFiltros);
  document.getElementById("filtro-fecha").addEventListener("change", aplicarFiltros);
  document.getElementById("filtro-doctor").addEventListener("change", aplicarFiltros);
  document.getElementById("filtro-estado").addEventListener("change", aplicarFiltros);
  document.getElementById("btn-limpiar-filtros").addEventListener("click", limpiarFiltros);
  document.getElementById("btn-hoy").addEventListener("click", filtrarHoy);
  document.getElementById("btn-exportar").addEventListener("click", exportarCSV);
  document.getElementById("btn-nueva-cita").addEventListener("click", abrirModalNuevaCita);
  document.getElementById("btn-muestra").addEventListener("click", cargarDatosMuestra);
  document.getElementById("btn-muestra-tabla").addEventListener("click", cargarDatosMuestra);
  document.getElementById("badge-seguimientos-btn").addEventListener("click", () => {
    document.getElementById("seccion-seguimientos").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("btn-ver-todas-nps").addEventListener("click", () => {
    const seccion = document.getElementById("seccion-nps");
    seccion.dataset.expandido = seccion.dataset.expandido === "true" ? "false" : "true";
    renderOpinionesRecientes();
  });
}

function poblarFiltroDoctores() {
  const select = document.getElementById("filtro-doctor");
  DOCTORES.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.nombre;
    opt.textContent = d.nombre;
    select.appendChild(opt);
  });
}

function aplicarFiltros() {
  estadoAdmin.filtros.busqueda = document.getElementById("filtro-busqueda").value.trim();
  estadoAdmin.filtros.fecha    = document.getElementById("filtro-fecha").value;
  estadoAdmin.filtros.doctor   = document.getElementById("filtro-doctor").value;
  estadoAdmin.filtros.estado   = document.getElementById("filtro-estado").value;
  renderTabla();
}

function limpiarFiltros() {
  document.getElementById("filtro-busqueda").value = "";
  document.getElementById("filtro-fecha").value    = "";
  document.getElementById("filtro-doctor").value   = "";
  document.getElementById("filtro-estado").value   = "";
  estadoAdmin.filtros = { busqueda: "", fecha: "", doctor: "", estado: "" };
  renderTabla();
}

function filtrarHoy() {
  const hoy = new Date().toISOString().split("T")[0];
  document.getElementById("filtro-fecha").value = hoy;
  estadoAdmin.filtros.fecha = hoy;
  renderTabla();
}

function citasFiltradas() {
  const { busqueda, fecha, doctor, estado } = estadoAdmin.filtros;
  return estadoAdmin.citas.filter((c) => {
    if (busqueda) {
      const texto = normalizarTexto(`${c.nombre} ${c.apellidos} ${c.folio} ${c.especialidad} ${c.doctor}`);
      if (!texto.includes(normalizarTexto(busqueda))) return false;
    }
    if (fecha && c.fecha !== fecha) return false;
    if (doctor && c.doctor !== doctor) return false;
    if (estado && c.estado !== estado) return false;
    return true;
  });
}

/* ─── Render tabla ────────────────────────────────────────────────────── */
function getPacVIPMap() {
  const pacs = JSON.parse(localStorage.getItem("medicita_pacientes") || "[]");
  const map = {};
  pacs.forEach(function (p) {
    const tel = (p.telefono || "").replace(/\s/g, "");
    if (tel) map[tel] = p.calificacion || 1;
  });
  return map;
}

function renderTabla() {
  const tbody  = document.getElementById("tabla-body");
  const empty  = document.getElementById("empty-state");
  const cont   = document.getElementById("contador-resultados");

  const citas  = citasFiltradas();
  // Más recientes primero
  citas.sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn));

  cont.textContent = citas.length === 1 ? "1 resultado" : `${citas.length} resultados`;

  if (citas.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "flex";
    return;
  }

  const vipMap = getPacVIPMap();
  empty.style.display = "none";
  tbody.innerHTML = citas.map((c) => {
    const fechaFmt   = formatFecha(c.fecha);
    const tienNotas  = c.notas && c.notas.trim().length > 0;
    const notasAttr  = tienNotas ? ` title="${escaparAttr(c.notas)}"` : "";
    const tel        = (c.telefono || "").replace(/\s/g, "");
    const esVIP      = (vipMap[tel] || 1) >= 3;
    return `
    <tr>
      <td class="td-folio"><span class="folio-chip">${c.folio}</span></td>
      <td>
        <div class="paciente-nombre">
          ${escapeHtml(c.nombre)} ${escapeHtml(c.apellidos)}
          ${esVIP ? '<span class="badge-vip" title="Paciente VIP ⭐⭐⭐">⭐ VIP</span>' : ""}
          ${tienNotas ? `<span class="icono-notas"${notasAttr} aria-label="Ver notas">📝</span>` : ""}
        </div>
        <div class="paciente-contacto">${escapeHtml(c.telefono)}${c.email ? " · " + escapeHtml(c.email) : ""}</div>
      </td>
      <td class="td-doctor">
        <div class="doctor-nombre">${escapeHtml(c.doctor)}</div>
        <div class="especialidad-nombre">${escapeHtml(c.especialidad)}</div>
      </td>
      <td class="td-fecha">
        <div class="fecha-dia">${fechaFmt}</div>
        <div class="fecha-hora">${c.hora} hrs</div>
      </td>
      <td class="td-tipo">${escapeHtml(c.tipo)}</td>
      <td class="td-estado">
        <span class="badge-estado badge-${c.estado}">${labelEstado(c.estado)}</span>
      </td>
      <td class="td-acciones">
        <div class="acciones-inner">
          <select class="select-estado" aria-label="Cambiar estado"
                  onchange="cambiarEstado('${c.folio}', this.value)">
            <option value="pendiente"  ${c.estado === "pendiente"  ? "selected" : ""}>⏳ Pendiente</option>
            <option value="confirmada" ${c.estado === "confirmada" ? "selected" : ""}>✅ Confirmada</option>
            <option value="atendida"   ${c.estado === "atendida"   ? "selected" : ""}>🩺 Atendida</option>
            <option value="cancelada"  ${c.estado === "cancelada"  ? "selected" : ""}>✕ Cancelada</option>
          </select>
          <a href="medidocs.html?folio=${encodeURIComponent(c.folio)}" target="_blank"
             class="btn-doc-tabla" title="Generar documento clínico" aria-label="Generar documento para ${c.folio}">📄</a>
          <button class="btn-eliminar" onclick="eliminarCita('${c.folio}')"
                  aria-label="Eliminar cita ${c.folio}" title="Eliminar">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/* ─── Acciones ────────────────────────────────────────────────────────── */
function cambiarEstado(folio, nuevoEstado) {
  const idx = estadoAdmin.citas.findIndex((c) => c.folio === folio);
  if (idx === -1) return;
  const estadoAnterior = estadoAdmin.citas[idx].estado;
  estadoAdmin.citas[idx].estado = nuevoEstado;
  guardarCitas();
  renderStats();
  renderTabla();
  mostrarToast(`Cita ${folio} → ${labelEstado(nuevoEstado)}`, "ok");

  if (nuevoEstado === "atendida" && estadoAnterior !== "atendida") {
    const cita = estadoAdmin.citas[idx];
    registrarSeguimientoPendiente(cita);
    enviarEmailSeguimientoInmediato(cita);
    renderSeguimientos();
    actualizarBadgeSeguimientos();
  }

  // M5: asegurar que la cita esté vinculada a un perfil de paciente
  if (typeof pacientesAsegurarVinculo === "function") {
    pacientesAsegurarVinculo(estadoAdmin.citas[idx]);
  }
}

function eliminarCita(folio) {
  if (!confirm(`¿Eliminar la cita ${folio}?\nEsta acción no se puede deshacer.`)) return;
  estadoAdmin.citas = estadoAdmin.citas.filter((c) => c.folio !== folio);
  guardarCitas();
  renderStats();
  renderTabla();
  mostrarToast(`Cita ${folio} eliminada.`, "ok");
}

/* ─── Stats ───────────────────────────────────────────────────────────── */
function renderStats() {
  const hoy = new Date().toISOString().split("T")[0];
  document.getElementById("stat-total").textContent       = estadoAdmin.citas.length;
  document.getElementById("stat-hoy").textContent         = estadoAdmin.citas.filter((c) => c.fecha === hoy).length;
  document.getElementById("stat-pendientes").textContent  = estadoAdmin.citas.filter((c) => c.estado === "pendiente").length;
  document.getElementById("stat-confirmadas").textContent = estadoAdmin.citas.filter((c) => c.estado === "confirmada").length;

  const nps = JSON.parse(localStorage.getItem("medicita_nps") || "[]");
  const numEl = document.getElementById("stat-nps");
  if (nps.length === 0) {
    numEl.textContent = "—";
    numEl.className = "stat-num";
  } else {
    const avg = nps.reduce((sum, r) => sum + r.puntuacion, 0) / nps.length;
    numEl.textContent = avg.toFixed(1);
    numEl.className = avg >= 8 ? "stat-num nps-verde" : avg >= 6 ? "stat-num nps-ambar" : "stat-num nps-rojo";
  }
}

/* ─── Export CSV ──────────────────────────────────────────────────────── */
function exportarCSV() {
  if (estadoAdmin.citas.length === 0) {
    mostrarToast("No hay citas para exportar.", "error");
    return;
  }
  const cols = ["Folio","Nombre","Apellidos","Teléfono","Email","Especialidad","Médico","Fecha","Hora","Tipo","Estado","Notas","Creada"];
  const filas = estadoAdmin.citas.map((c) => [
    c.folio, c.nombre, c.apellidos, c.telefono, c.email,
    c.especialidad, c.doctor, c.fecha, c.hora, c.tipo,
    c.estado, c.notas.replace(/\n/g, " "), c.creadaEn,
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));

  const csv = [cols.join(","), ...filas].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `medicita-citas-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("CSV exportado correctamente.", "ok");
}

/* ─── Datos de muestra ────────────────────────────────────────────────── */
function cargarDatosMuestra() {
  if (estadoAdmin.citas.length > 0) {
    if (!confirm("Ya hay citas guardadas. ¿Agregar los datos de muestra encima?")) return;
  }
  const HOY = new Date().toISOString().split("T")[0];
  const dias = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  };
  const MUESTRA = [
    { folio:"CIT-260601-4521", nombre:"Ana",      apellidos:"Martínez Soto",  telefono:"55 8811 2233", email:"ana.martinez@gmail.com",  especialidad:"Medicina General", doctor:"Dra. Laura Mendoza",     fecha:dias(2),  hora:"09:00", tipo:"Primera vez",      notas:"Dolor de cabeza frecuente desde hace dos semanas.",      estado:"confirmada", creadaEn:new Date(Date.now()-172800000).toISOString() },
    { folio:"CIT-260601-7832", nombre:"Roberto",  apellidos:"García Vega",    telefono:"55 9922 4455", email:"",                         especialidad:"Cardiología",      doctor:"Dr. Andrés Vega",        fecha:dias(1),  hora:"11:00", tipo:"Seguimiento",      notas:"",                                                        estado:"pendiente",  creadaEn:new Date(Date.now()-150000000).toISOString() },
    { folio:"CIT-260602-1190", nombre:"Lucía",    apellidos:"Torres Reyes",   telefono:"55 3344 6677", email:"lucia.torres@outlook.com", especialidad:"Pediatría",        doctor:"Dra. Sofía Herrera",     fecha:HOY,      hora:"10:00", tipo:"Revisión preventiva", notas:"Revisión de rutina de 12 meses.",                       estado:"atendida",   creadaEn:new Date(Date.now()-86400000).toISOString()  },
    { folio:"CIT-260602-3301", nombre:"Carlos",   apellidos:"Ramírez Luna",   telefono:"55 4455 7788", email:"",                         especialidad:"Traumatología",    doctor:"Dr. Roberto Jiménez",    fecha:dias(3),  hora:"08:00", tipo:"Primera vez",      notas:"Lesión en rodilla derecha al practicar fútbol.",          estado:"pendiente",  creadaEn:new Date(Date.now()-120000000).toISOString() },
    { folio:"CIT-260602-5544", nombre:"Valentina",apellidos:"López Cruz",     telefono:"55 6677 9900", email:"vlopez@hotmail.com",       especialidad:"Dermatología",     doctor:"Dra. Isabel Torres",     fecha:HOY,      hora:"11:00", tipo:"Primera vez",      notas:"",                                                        estado:"pendiente",  creadaEn:new Date(Date.now()-72000000).toISOString()  },
    { folio:"CIT-260603-2211", nombre:"Miguel",   apellidos:"Hernández Ríos", telefono:"55 7788 0011", email:"",                         especialidad:"Oftalmología",     doctor:"Dr. Miguel Ángel Flores",fecha:dias(7),  hora:"09:00", tipo:"Seguimiento",      notas:"Control post-operatorio de cataratas.",                   estado:"confirmada", creadaEn:new Date(Date.now()-28800000).toISOString()  },
    { folio:"CIT-260530-9988", nombre:"Patricia", apellidos:"Morales Díaz",   telefono:"55 1100 2233", email:"pmorales@empresa.com",     especialidad:"Neurología",       doctor:"Dra. Elena Castillo",    fecha:dias(-3), hora:"10:00", tipo:"Seguimiento",      notas:"",                                                        estado:"atendida",   creadaEn:new Date(Date.now()-432000000).toISOString() },
    { folio:"CIT-260531-6677", nombre:"Sandra",   apellidos:"Sánchez Medina", telefono:"55 2233 4455", email:"",                         especialidad:"Ginecología",      doctor:"Dra. Patricia Leal",     fecha:dias(5),  hora:"16:00", tipo:"Urgencia",         notas:"Acompañada por familiar.",                                estado:"pendiente",  creadaEn:new Date(Date.now()-345600000).toISOString() },
    { folio:"CIT-260531-3390", nombre:"Ernesto",  apellidos:"Fuentes Mora",   telefono:"55 5566 8899", email:"efuentes@correo.com",      especialidad:"Medicina General", doctor:"Dr. Carlos Ruiz",        fecha:dias(-1), hora:"12:00", tipo:"Revisión preventiva", notas:"Chequeo anual. Trae resultados de laboratorio previos.", estado:"cancelada",  creadaEn:new Date(Date.now()-259200000).toISOString() },
  ];
  estadoAdmin.citas = [...MUESTRA, ...estadoAdmin.citas];
  guardarCitas();
  renderStats();
  renderTabla();
  mostrarToast(`${MUESTRA.length} citas de muestra cargadas.`, "ok");

  // M5: vincular citas de muestra con perfiles de paciente
  if (typeof pacientesAsegurarVinculo === "function") {
    MUESTRA.forEach(c => pacientesAsegurarVinculo(c));
  }

  // Seguimientos de muestra
  const fechaDesde = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const seguimientosMuestra = [
    { folio:"CIT-260601-0001", nombrePaciente:"Ana Martínez Soto",   emailPaciente:"ana.martinez@gmail.com",  fechaAtendida:fechaDesde(35), emailEnviado_inmediato:true, emailEnviado_3d:true,  emailEnviado_30d:false },
    { folio:"CIT-260601-0002", nombrePaciente:"Roberto García Vega", emailPaciente:"",                        fechaAtendida:fechaDesde(5),  emailEnviado_inmediato:true, emailEnviado_3d:false, emailEnviado_30d:false },
    { folio:"CIT-260601-0003", nombrePaciente:"Lucía Torres Reyes",  emailPaciente:"lucia.torres@outlook.com",fechaAtendida:fechaDesde(1),  emailEnviado_inmediato:true, emailEnviado_3d:false, emailEnviado_30d:false },
    { folio:"CIT-260601-0004", nombrePaciente:"Carlos Ramírez Luna", emailPaciente:"",                        fechaAtendida:fechaDesde(32), emailEnviado_inmediato:true, emailEnviado_3d:true,  emailEnviado_30d:true  },
  ];
  const seguimientosExistentes = leerSeguimientos();
  const foliosSeg = new Set(seguimientosExistentes.map(s => s.folio));
  const nuevosSegs = seguimientosMuestra.filter(s => !foliosSeg.has(s.folio));
  if (nuevosSegs.length > 0) {
    guardarSeguimientos([...nuevosSegs, ...seguimientosExistentes]);
    renderSeguimientos();
    actualizarBadgeSeguimientos();
  }

  // NPS de muestra
  const ahoraIso = new Date().toISOString();
  const npsDesde = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const npsMuestra = [
    { folio:"CIT-260601-0001", puntuacion:9,  comentario:"Excelente atención, el doctor fue muy amable y resolvió todas mis dudas.", fechaRespuesta:npsDesde(30) },
    { folio:"CIT-260601-0002", puntuacion:6,  comentario:"La espera fue larga pero la consulta estuvo bien.",                         fechaRespuesta:npsDesde(4)  },
    { folio:"CIT-260601-0003", puntuacion:10, comentario:"Me encantó la clínica, muy limpia y organizada. Definitivamente regreso.",  fechaRespuesta:npsDesde(1)  },
    { folio:"CIT-260601-0004", puntuacion:8,  comentario:"Buena atención, el doctor muy profesional.",                                fechaRespuesta:npsDesde(28) },
    { folio:"CIT-260601-0005", puntuacion:10, comentario:"Muy buena experiencia, el personal muy amable desde la recepción.",         fechaRespuesta:npsDesde(10) },
  ];
  const npsExistentes = JSON.parse(localStorage.getItem("medicita_nps") || "[]");
  const foliosNps = new Set(npsExistentes.map(r => r.folio));
  const nuevosNps = npsMuestra.filter(r => !foliosNps.has(r.folio));
  if (nuevosNps.length > 0) {
    localStorage.setItem("medicita_nps", JSON.stringify([...nuevosNps, ...npsExistentes]));
    renderStats();
    renderOpinionesRecientes();
  }
}

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function normalizarTexto(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function labelEstado(estado) {
  return { pendiente: "Pendiente", confirmada: "Confirmada", atendida: "Atendida", cancelada: "Cancelada" }[estado] ?? estado;
}

function formatFecha(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escaparAttr(str) {
  return String(str ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ─── Configuración de clínica ────────────────────────────────────────── */
const CAMPOS_CONFIG = [
  ["cfg-nombre-clinica",  "nombreClinica"],
  ["cfg-ciudad",          "ciudad"],
  ["cfg-especialidad",    "especialidadPrincipal"],
  ["cfg-medico",          "nombreMedico"],
  ["cfg-telefono",        "telefono"],
  ["cfg-email",           "email"],
  ["cfg-logo",            "logoUrl"],
  ["cfg-cedula",          "cedulaProfesional"],
  ["cfg-horario",         "horarioAtencion"],
  ["cfg-direccion",       "direccionConsultorio"],
  // Personalización de landing
  ["cfg-frase-hero",      "fraseHero"],
  ["cfg-foto-hero",       "fotoHero"],
  ["cfg-foto-medico",     "fotoMedico"],
  ["cfg-total-pacientes", "totalPacientes"],
  ["cfg-anos-exp",        "anosExperiencia"],
  ["cfg-calif-promedio",  "calificacionPromedio"],
  ["cfg-bio-medico",      "bioMedico"],
  ["cfg-formacion",       "formacionMedico"],
  ["cfg-servicios",       "serviciosClinica"],
  ["cfg-whatsapp",        "whatsapp"],
  ["cfg-facebook",        "facebook"],
  ["cfg-instagram",       "instagram"],
  // Apariencia
  ["cfg-color-primario",  "colorPrimario"],
  ["cfg-color-acento",    "colorAcento"],
];

function leerConfigClinica() {
  return JSON.parse(localStorage.getItem("medicita_config_clinica") || "{}");
}

function guardarConfigClinica() {
  const cfg = {};
  CAMPOS_CONFIG.forEach(([inputId, key]) => {
    const el = document.getElementById(inputId);
    if (el) cfg[key] = el.value.trim();
  });
  const tipografiaEl = document.querySelector('input[name="cfg-tipografia"]:checked');
  if (tipografiaEl) cfg.tipografia = tipografiaEl.value;
  localStorage.setItem("medicita_config_clinica", JSON.stringify(cfg));
  aplicarAparienciaConfig(cfg);
}

function poblarFormConfig() {
  const cfg = leerConfigClinica();
  CAMPOS_CONFIG.forEach(([inputId, key]) => {
    const el = document.getElementById(inputId);
    if (el) el.value = cfg[key] || "";
  });

  // Color inputs: aplicar valor guardado o default
  const colorP = document.getElementById("cfg-color-primario");
  if (colorP) colorP.value = cfg.colorPrimario || "#1a6eb5";
  const colorA = document.getElementById("cfg-color-acento");
  if (colorA) colorA.value = cfg.colorAcento || "#f59e0b";
  actualizarEtiquetaColor("cfg-color-primario", "cfg-color-primario-label");
  actualizarEtiquetaColor("cfg-color-acento",   "cfg-color-acento-label");

  // Radio tipografía
  const tipografia = cfg.tipografia || "inter";
  const radioEl = document.querySelector(`input[name="cfg-tipografia"][value="${tipografia}"]`);
  if (radioEl) radioEl.checked = true;

  // Foto previews
  actualizarFotoPreview("cfg-foto-medico", "cfg-foto-medico-preview");
  actualizarFotoPreview("cfg-foto-hero",   "cfg-foto-hero-preview");

  // EmailJS — solo en memoria, no en localStorage
  document.getElementById("cfg-ejs-service").value  = ejsServiceIdAdmin;
  document.getElementById("cfg-ejs-template").value = ejsTemplateIdAdmin;
  document.getElementById("cfg-ejs-key").value      = ejsPublicKeyAdmin;
}

function bindConfigModal() {
  const modal = document.getElementById("modal-config");

  document.getElementById("btn-config-clinica").addEventListener("click", abrirModalConfig);
  document.getElementById("btn-cerrar-config").addEventListener("click", cerrarModalConfig);
  document.getElementById("btn-cancelar-config").addEventListener("click", cerrarModalConfig);
  document.getElementById("btn-guardar-config").addEventListener("click", () => {
    guardarConfigClinica();
    ejsServiceIdAdmin  = document.getElementById("cfg-ejs-service").value.trim();
    ejsTemplateIdAdmin = document.getElementById("cfg-ejs-template").value.trim();
    ejsPublicKeyAdmin  = document.getElementById("cfg-ejs-key").value.trim();
    if (ejsPublicKeyAdmin) emailjs.init({ publicKey: ejsPublicKeyAdmin });
    cerrarModalConfig();
    mostrarToast("Configuración guardada.", "ok");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModalConfig();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("oculto")) cerrarModalConfig();
  });

  // Tabs internas del modal
  modal.querySelectorAll(".cfg-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activarCfgTab(btn.dataset.ctab);
      if (btn.dataset.ctab === "preview") actualizarPreview();
    });
  });

  // Input listeners en todos los campos → actualizar preview en tiempo real
  modal.querySelectorAll("input:not([type='color']):not([type='radio']), textarea, select").forEach((el) => {
    el.addEventListener("input", actualizarPreview);
  });
  modal.querySelectorAll("input[type='radio']").forEach((el) => {
    el.addEventListener("change", actualizarPreview);
  });

  // Color inputs: live preview de colores + etiqueta
  const colorP = document.getElementById("cfg-color-primario");
  const colorA = document.getElementById("cfg-color-acento");

  if (colorP) {
    colorP.addEventListener("input", () => {
      actualizarEtiquetaColor("cfg-color-primario", "cfg-color-primario-label");
      document.documentElement.style.setProperty("--azul-principal", colorP.value);
      document.documentElement.style.setProperty("--azul-oscuro", ajustarBrillo(colorP.value, -24));
      actualizarPreview();
    });
  }
  if (colorA) {
    colorA.addEventListener("input", () => {
      actualizarEtiquetaColor("cfg-color-acento", "cfg-color-acento-label");
      document.documentElement.style.setProperty("--ambar", colorA.value);
      actualizarPreview();
    });
  }

  // Foto previews al escribir URL
  ["cfg-foto-medico", "cfg-foto-hero"].forEach((inputId) => {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener("input", () => actualizarFotoPreview(inputId, `${inputId}-preview`));
  });
}

function abrirModalConfig() {
  poblarFormConfig();
  activarCfgTab("clinica");
  const modal = document.getElementById("modal-config");
  modal.classList.remove("oculto");
  document.body.style.overflow = "hidden";
  document.getElementById("cfg-nombre-clinica").focus();
}

function cerrarModalConfig() {
  document.getElementById("modal-config").classList.add("oculto");
  document.body.style.overflow = "";
  // Restaurar colores al estado guardado (en caso de previsualización sin guardar)
  aplicarAparienciaConfig(leerConfigClinica());
}

/* ─── Apariencia: colores y tipografía ────────────────────────────────── */
function aplicarAparienciaConfig(cfg) {
  if (cfg.colorPrimario) {
    document.documentElement.style.setProperty("--azul-principal", cfg.colorPrimario);
    document.documentElement.style.setProperty("--azul-oscuro", ajustarBrillo(cfg.colorPrimario, -24));
  }
  if (cfg.colorAcento) {
    document.documentElement.style.setProperty("--ambar", cfg.colorAcento);
  }
  if (cfg.tipografia) {
    const fonts = {
      inter:   "'Inter', 'Segoe UI', system-ui, sans-serif",
      georgia: "Georgia, 'Times New Roman', serif",
      system:  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    };
    document.body.style.fontFamily = fonts[cfg.tipografia] || fonts.inter;
  }
}

function ajustarBrillo(hex, amount) {
  const clean = hex.replace("#", "");
  const num   = parseInt(clean, 16);
  const r     = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g     = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b     = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function activarCfgTab(tabId) {
  document.querySelectorAll(".cfg-tab-btn").forEach((btn) => {
    const activa = btn.dataset.ctab === tabId;
    btn.classList.toggle("activa", activa);
    btn.setAttribute("aria-selected", activa ? "true" : "false");
  });
  document.querySelectorAll(".cfg-tab-panel").forEach((panel) => {
    panel.classList.toggle("activa", panel.id === `ctab-${tabId}`);
  });
}

function actualizarEtiquetaColor(inputId, labelId) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (input && label) label.textContent = input.value;
}

function actualizarFotoPreview(inputId, previewId) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;
  const url = input.value.trim();
  if (url) {
    preview.src = url;
    preview.classList.remove("oculto");
    preview.onerror = () => preview.classList.add("oculto");
  } else {
    preview.classList.add("oculto");
  }
}

function leerValoresFormConfig() {
  const vals = {};
  CAMPOS_CONFIG.forEach(([inputId, key]) => {
    const el = document.getElementById(inputId);
    if (el) vals[key] = el.value.trim();
  });
  const tipografiaEl = document.querySelector('input[name="cfg-tipografia"]:checked');
  vals.tipografia = tipografiaEl ? tipografiaEl.value : "inter";
  return vals;
}

function actualizarPreview() {
  const v            = leerValoresFormConfig();
  const col          = v.colorPrimario || "#1a6eb5";
  const nombre       = escapeHtml(v.nombreMedico           || "Dr. Nombre Apellido");
  const especialidad = escapeHtml(v.especialidadPrincipal  || "Especialidad");
  const ciudad       = escapeHtml(v.ciudad                 || "Ciudad");
  const frase        = escapeHtml(v.fraseHero              || "Atención médica profesional y personalizada");
  const bioRaw       = v.bioMedico || "Descripción del médico...";
  const bio          = escapeHtml(bioRaw.substring(0, 120)) + (bioRaw.length > 120 ? "…" : "");
  const cedula       = v.cedulaProfesional ? `Céd. ${escapeHtml(v.cedulaProfesional)}` : "";
  const pacs         = escapeHtml(v.totalPacientes ? `+${Number(v.totalPacientes).toLocaleString("es-MX")}` : "+2,000");
  const anos         = escapeHtml(v.anosExperiencia ? `${v.anosExperiencia}+` : "20+");
  const calif        = escapeHtml(v.calificacionPromedio || "4.9");
  const horario      = escapeHtml(v.horarioAtencion     || "Lun–Vie 9–18h");
  const iniciales    = (v.nombreMedico || "M D").split(" ").slice(0, 2).map((w) => (w[0] || "")).join("").toUpperCase();

  const fotoMedicoHtml = v.fotoMedico
    ? `<img src="${v.fotoMedico}" class="prev-foto-medico" alt="" />`
    : `<div class="prev-avatar-medico" style="background:${col};">${iniciales}</div>`;

  const fotoHeroHtml = v.fotoHero
    ? `<img src="${v.fotoHero}" alt="" style="width:100%;height:72px;object-fit:cover;border-radius:8px;margin-top:12px;opacity:.65;" />`
    : "";

  const contenedor = document.getElementById("cfg-preview-contenido");
  if (!contenedor) return;

  contenedor.innerHTML = `
    <div class="prev-hero" style="background:${col};">
      <div class="prev-badge">${especialidad} · ${ciudad}</div>
      <h3 class="prev-titulo">${nombre}</h3>
      <p class="prev-frase">${frase}</p>
      <div class="prev-btns">
        <span class="prev-btn-p" style="background:#fff;color:${col};">Agendar cita</span>
        <span class="prev-btn-s">Ver servicios</span>
      </div>
      ${fotoHeroHtml}
    </div>
    <div class="prev-stats" style="background:${col};">
      <div class="prev-stat"><div class="prev-stat-num">${pacs}</div><div class="prev-stat-label">Pacientes</div></div>
      <div class="prev-stat"><div class="prev-stat-num">${anos}</div><div class="prev-stat-label">Años exp.</div></div>
      <div class="prev-stat"><div class="prev-stat-num">${calif} ★</div><div class="prev-stat-label">Calificación</div></div>
      <div class="prev-stat"><div class="prev-stat-num">📅</div><div class="prev-stat-label">${horario}</div></div>
    </div>
    <div class="prev-medico">
      ${fotoMedicoHtml}
      <div class="prev-medico-info">
        <div class="prev-medico-nombre">${nombre}</div>
        <div class="prev-medico-esp">${especialidad}</div>
        ${cedula ? `<div class="prev-medico-ced">${cedula}</div>` : ""}
        <p class="prev-medico-bio">${bio}</p>
      </div>
    </div>
  `;
}

/* ─── Seguimientos post-consulta ──────────────────────────────────────── */
function leerSeguimientos() {
  return JSON.parse(localStorage.getItem("medicita_followup_pendientes") || "[]");
}

function guardarSeguimientos(seguimientos) {
  localStorage.setItem("medicita_followup_pendientes", JSON.stringify(seguimientos));
}

function diasDesde(fechaIso) {
  return Math.floor((Date.now() - new Date(fechaIso).getTime()) / 86400000);
}

function encuestaBaseUrl() {
  return window.location.href.replace(/[^/]*$/, "") + "encuesta.html";
}

function registrarSeguimientoPendiente(cita) {
  const seguimientos = leerSeguimientos();
  if (seguimientos.some((s) => s.folio === cita.folio)) return;
  seguimientos.unshift({
    folio: cita.folio,
    nombrePaciente: `${cita.nombre} ${cita.apellidos}`,
    emailPaciente: cita.email || "",
    fechaAtendida: new Date().toISOString(),
    emailEnviado_inmediato: false,
    emailEnviado_3d: false,
    emailEnviado_30d: false,
  });
  guardarSeguimientos(seguimientos);
}

async function enviarEmailSeguimientoInmediato(cita) {
  if (!ejsPublicKeyAdmin || !ejsServiceIdAdmin || !ejsTemplateIdAdmin) return;
  if (!cita.email) return;

  const seguimientos = leerSeguimientos();
  const idx = seguimientos.findIndex((s) => s.folio === cita.folio);
  try {
    await emailjs.send(ejsServiceIdAdmin, ejsTemplateIdAdmin, {
      to_email:   cita.email,
      to_name:    `${cita.nombre} ${cita.apellidos}`,
      asunto:     `Gracias por tu visita, ${cita.nombre} — ¿cómo te sentiste?`,
      html_email: buildEmailSeguimientoHTML(cita),
    });
    if (idx !== -1) {
      seguimientos[idx].emailEnviado_inmediato = true;
      guardarSeguimientos(seguimientos);
    }
    mostrarToast(`✉️ Email de seguimiento enviado a ${cita.email}`, "ok");
  } catch (_) {
    // Fallo silencioso — EmailJS puede no estar configurado
  }
}

async function enviarEmailDiferido(folio, tipo) {
  const seguimientos = leerSeguimientos();
  const idx = seguimientos.findIndex((s) => s.folio === folio);
  if (idx === -1) return;

  const seg = seguimientos[idx];
  if (!seg.emailPaciente) {
    mostrarToast("Este paciente no tiene email registrado.", "error");
    return;
  }
  if (!ejsPublicKeyAdmin || !ejsServiceIdAdmin || !ejsTemplateIdAdmin) {
    mostrarToast("Configura EmailJS en ⚙️ Configurar clínica antes de enviar.", "error");
    return;
  }

  const asunto = tipo === "3d"
    ? `¿Cómo te has sentido? Seguimiento post-consulta — ${folio}`
    : `Seguimiento 30 días — ¿cómo sigues? — ${folio}`;

  try {
    await emailjs.send(ejsServiceIdAdmin, ejsTemplateIdAdmin, {
      to_email:   seg.emailPaciente,
      to_name:    seg.nombrePaciente,
      asunto,
      html_email: buildEmailDiferidoHTML(seg, tipo),
    });
    seguimientos[idx][tipo === "3d" ? "emailEnviado_3d" : "emailEnviado_30d"] = true;
    guardarSeguimientos(seguimientos);
    renderSeguimientos();
    actualizarBadgeSeguimientos();
    mostrarToast(`✉️ Email enviado a ${seg.emailPaciente}`, "ok");
  } catch (err) {
    mostrarToast(`Error al enviar: ${err?.text ?? "Error desconocido"}`, "error");
  }
}

function renderSeguimientos() {
  const todos = leerSeguimientos();
  const activos = todos.filter((s) => !s.emailEnviado_3d || !s.emailEnviado_30d);

  const seccion = document.getElementById("seccion-seguimientos");
  const tbody   = document.getElementById("seguimientos-body");

  if (activos.length === 0) {
    seccion.classList.add("oculto");
    return;
  }
  seccion.classList.remove("oculto");
  document.getElementById("seguimientos-badge").textContent = activos.length;

  tbody.innerHTML = activos.map((s) => {
    const dias      = diasDesde(s.fechaAtendida);
    const tieneEmail = !!s.emailPaciente;
    return `
    <tr>
      <td>
        <div class="paciente-nombre">${escapeHtml(s.nombrePaciente)}</div>
        <div class="paciente-contacto">${tieneEmail ? escapeHtml(s.emailPaciente) : '<span style="color:var(--rojo);font-size:.78rem">Sin email</span>'}</div>
      </td>
      <td class="td-fecha">
        <div class="fecha-dia">${formatFecha(s.fechaAtendida.split("T")[0])}</div>
        <div class="fecha-hora">Hace ${dias} día${dias !== 1 ? "s" : ""}</div>
      </td>
      <td>${buildCeldaSeguimiento(s, "3d", dias, tieneEmail)}</td>
      <td>${buildCeldaSeguimiento(s, "30d", dias, tieneEmail)}</td>
    </tr>`;
  }).join("");
}

function buildCeldaSeguimiento(s, tipo, dias, tieneEmail) {
  const enviado         = tipo === "3d" ? s.emailEnviado_3d : s.emailEnviado_30d;
  const diasRequeridos  = tipo === "3d" ? 3 : 30;
  const vencido         = dias >= diasRequeridos;

  if (enviado) return `<span class="seg-chip seg-enviado">✓ Enviado</span>`;
  if (!tieneEmail) return `<span class="seg-chip seg-sin-email">Sin email</span>`;
  if (vencido) {
    return `<button class="seg-btn seg-btn-urgente"
              onclick="enviarEmailDiferido('${s.folio}','${tipo}')">⏰ Enviar ahora</button>`;
  }
  const faltan = diasRequeridos - dias;
  return `<span class="seg-chip seg-programado">📅 En ${faltan} día${faltan !== 1 ? "s" : ""}</span>`;
}

function actualizarBadgeSeguimientos() {
  const pendientes = leerSeguimientos().filter((s) => !s.emailEnviado_3d || !s.emailEnviado_30d);
  const btn = document.getElementById("badge-seguimientos-btn");
  if (pendientes.length > 0) {
    document.getElementById("badge-seguimientos-num").textContent = pendientes.length;
    btn.classList.remove("oculto");
  } else {
    btn.classList.add("oculto");
  }
}

/* ─── Emails de seguimiento ───────────────────────────────────────────── */
function buildEmailSeguimientoHTML(cita) {
  const cfg       = leerConfigClinica();
  const clinica   = cfg.nombreClinica || "MediCita";
  const telefono  = cfg.telefono  || "55 1234 5678";
  const emailCli  = cfg.email     || "contacto@medicita.mx";
  const nombre    = `${cita.nombre} ${cita.apellidos}`;
  const fechaFmt  = cita.fecha
    ? new Date(cita.fecha + "T12:00:00").toLocaleDateString("es-MX", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      })
    : "—";
  const encuestaUrl = `${encuestaBaseUrl()}?folio=${cita.folio}`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px 10px;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f4c8a 0%,#1a6eb5 100%);padding:32px 28px;border-radius:14px 14px 0 0;text-align:center;">
    <div style="font-size:40px;margin-bottom:12px;">🏥</div>
    <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;">${clinica}</h1>
    <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px;">Seguimiento post-consulta</p>
  </div>
  <div style="background:#d1fae5;padding:20px 28px;text-align:center;border:1px solid rgba(0,0,0,.05);border-top:none;border-bottom:none;">
    <div style="font-size:30px;margin-bottom:8px;">🩺</div>
    <h2 style="color:#065f46;margin:0;font-size:20px;font-weight:700;">Gracias por tu visita</h2>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;">
    <p style="color:#374151;margin:0 0 14px;font-size:15px;">Estimado/a <strong>${nombre}</strong>,</p>
    <p style="color:#4b5563;margin:0 0 20px;font-size:14px;line-height:1.65;">
      Fue un gusto atenderte el <strong>${fechaFmt}</strong>. Queremos saber cómo te has sentido después de tu consulta.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${encuestaUrl}"
         style="display:inline-block;background:#1a6eb5;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">
        ⭐ Calificar mi experiencia
      </a>
      <p style="color:#64748b;font-size:12px;margin:10px 0 0;">Solo toma 30 segundos · Anónimo · Opcional</p>
    </div>
    <div style="background:#f0f9ff;border-left:3px solid #1a6eb5;padding:12px 16px;margin:20px 0;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1a6eb5;text-transform:uppercase;letter-spacing:.06em;">Recomendaciones post-consulta</p>
      <ul style="margin:0;padding-left:16px;color:#374151;font-size:13px;line-height:1.9;">
        <li>Sigue las indicaciones y el tratamiento prescrito por tu médico</li>
        <li>Si presentas molestias o síntomas nuevos, contáctanos de inmediato</li>
        <li>Recuerda tomar tus medicamentos en las dosis y horarios indicados</li>
        <li>Si tienes dudas, llámanos al <strong>${telefono}</strong></li>
      </ul>
    </div>
    <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #f1f5f9;font-size:13px;color:#6b7280;line-height:1.6;">
      Cualquier duda, llámanos al <strong style="color:#374151;">${telefono}</strong> o escríbenos a
      <a href="mailto:${emailCli}" style="color:#1a6eb5;text-decoration:none;">${emailCli}</a>
    </p>
  </div>
  <div style="background:#0f172a;padding:18px 28px;border-radius:0 0 14px 14px;text-align:center;">
    <p style="color:rgba(255,255,255,.5);font-size:12px;margin:0;">${clinica} · ${telefono} · ${emailCli}</p>
    <p style="color:rgba(255,255,255,.18);font-size:10px;margin:10px 0 0;">Correo automático — por favor no respondas directamente.</p>
  </div>
</div>
</body>
</html>`;
}

function buildEmailDiferidoHTML(seg, tipo) {
  const cfg       = leerConfigClinica();
  const clinica   = cfg.nombreClinica || "MediCita";
  const telefono  = cfg.telefono  || "55 1234 5678";
  const emailCli  = cfg.email     || "contacto@medicita.mx";
  const es3d      = tipo === "3d";
  const encuestaUrl = `${encuestaBaseUrl()}?folio=${seg.folio}`;

  const icono  = es3d ? "💊" : "📋";
  const titulo = es3d ? "¿Cómo te has sentido?" : "Seguimiento a 30 días";
  const cuerpo = es3d
    ? `Han pasado <strong>3 días</strong> desde tu consulta. Esperamos que te encuentres mejor y que estés siguiendo las indicaciones de tu médico.`
    : `Han pasado <strong>30 días</strong> desde tu consulta. Queremos saber cómo has evolucionado y si tienes alguna duda sobre tu tratamiento.`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px 10px;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f4c8a 0%,#1a6eb5 100%);padding:32px 28px;border-radius:14px 14px 0 0;text-align:center;">
    <div style="font-size:40px;margin-bottom:12px;">🏥</div>
    <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;">${clinica}</h1>
    <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px;">Seguimiento de salud</p>
  </div>
  <div style="background:#e8f2fc;padding:20px 28px;text-align:center;border:1px solid rgba(0,0,0,.05);border-top:none;border-bottom:none;">
    <div style="font-size:30px;margin-bottom:8px;">${icono}</div>
    <h2 style="color:#0f4c8a;margin:0;font-size:20px;font-weight:700;">${titulo}</h2>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;">
    <p style="color:#374151;margin:0 0 14px;font-size:15px;">Estimado/a <strong>${seg.nombrePaciente}</strong>,</p>
    <p style="color:#4b5563;margin:0 0 20px;font-size:14px;line-height:1.65;">${cuerpo}</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${encuestaUrl}"
         style="display:inline-block;background:#1a6eb5;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">
        ⭐ Calificar mi experiencia
      </a>
      <p style="color:#64748b;font-size:12px;margin:10px 0 0;">Si aún no has dejado tu opinión, toma un momento para ayudarnos a mejorar</p>
    </div>
    <p style="color:#4b5563;margin:0;font-size:14px;line-height:1.65;">
      Si tienes alguna pregunta, síntoma nuevo o necesitas agendar una cita de seguimiento, no dudes en contactarnos.
    </p>
    <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #f1f5f9;font-size:13px;color:#6b7280;line-height:1.6;">
      Llámanos al <strong style="color:#374151;">${telefono}</strong> o escríbenos a
      <a href="mailto:${emailCli}" style="color:#1a6eb5;text-decoration:none;">${emailCli}</a>
    </p>
  </div>
  <div style="background:#0f172a;padding:18px 28px;border-radius:0 0 14px 14px;text-align:center;">
    <p style="color:rgba(255,255,255,.5);font-size:12px;margin:0;">${clinica} · ${telefono} · ${emailCli}</p>
    <p style="color:rgba(255,255,255,.18);font-size:10px;margin:10px 0 0;">Correo automático — por favor no respondas directamente.</p>
  </div>
</div>
</body>
</html>`;
}

/* ─── Opiniones NPS ───────────────────────────────────────────────────── */
function renderOpinionesRecientes() {
  const nps      = JSON.parse(localStorage.getItem("medicita_nps") || "[]");
  const seccion  = document.getElementById("seccion-nps");
  const tbody    = document.getElementById("nps-body");
  const btnVer   = document.getElementById("btn-ver-todas-nps");

  if (nps.length === 0) {
    seccion.classList.add("oculto");
    return;
  }
  seccion.classList.remove("oculto");
  document.getElementById("nps-total-badge").textContent = nps.length;

  const expandido = seccion.dataset.expandido === "true";
  const lista     = expandido ? nps : nps.slice(0, 5);
  const citas     = JSON.parse(localStorage.getItem("medicita_citas") || "[]");

  tbody.innerHTML = lista.map((r) => {
    const cita     = citas.find((c) => c.folio === r.folio);
    const paciente = cita ? `${cita.nombre} ${cita.apellidos}` : "—";
    const fecha    = new Date(r.fechaRespuesta).toLocaleDateString("es-MX", {
      day: "numeric", month: "short", year: "numeric",
    });
    const claseNum = r.puntuacion >= 9 ? "nps-num nps-num-alto"
                   : r.puntuacion >= 7 ? "nps-num nps-num-medio"
                   : "nps-num nps-num-bajo";
    const comentarioHtml = r.comentario
      ? escapeHtml(r.comentario)
      : `<span class="sin-comentario">Sin comentario</span>`;
    return `
    <tr>
      <td class="td-folio"><span class="folio-chip">${r.folio}</span></td>
      <td>${escapeHtml(paciente)}</td>
      <td><span class="${claseNum}">${r.puntuacion}/10</span></td>
      <td class="td-comentario-nps">${comentarioHtml}</td>
      <td class="td-fecha"><div class="fecha-dia">${fecha}</div></td>
    </tr>`;
  }).join("");

  if (nps.length <= 5) {
    btnVer.style.display = "none";
  } else {
    btnVer.style.display = "";
    btnVer.textContent   = expandido ? "Ver menos" : `Ver todas (${nps.length})`;
  }
}

/* ─── Toast ───────────────────────────────────────────────────────────── */
let toastTimer = null;
function mostrarToast(mensaje, tipo = "ok") {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.className = `visible toast-${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ""; }, 3200);
}

/* ─── Modal: Nueva cita manual ────────────────────────────────────────── */
function bindModalNuevaCita() {
  const modal = document.getElementById("modal-nueva-cita");

  document.getElementById("btn-cerrar-nc").addEventListener("click", cerrarModalNuevaCita);
  document.getElementById("btn-cancelar-nc").addEventListener("click", cerrarModalNuevaCita);
  document.getElementById("btn-guardar-nc").addEventListener("click", guardarNuevaCita);
  document.getElementById("nc-especialidad").addEventListener("change", onEspecialidadCambioNC);
  document.getElementById("nc-doctor").addEventListener("change", onDoctorCambioNC);
  document.getElementById("nc-telefono").addEventListener("blur", onTelefonoBlurNC);

  document.getElementById("nc-tiene-seguro")?.addEventListener("change", (e) => {
    document.getElementById("nc-seguro-campos")?.classList.toggle("visible", e.target.checked);
  });
  document.getElementById("nc-aseguradora")?.addEventListener("change", (e) => {
    const otro = document.getElementById("nc-aseg-otro-campo");
    if (otro) otro.style.display = e.target.value === "Otro" ? "" : "none";
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModalNuevaCita();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("oculto")) cerrarModalNuevaCita();
  });

  // Poblar especialidades
  const selEsp = document.getElementById("nc-especialidad");
  ESPECIALIDADES.forEach((esp) => {
    const opt = document.createElement("option");
    opt.value = esp.nombre;
    opt.textContent = `${esp.icono} ${esp.nombre}`;
    selEsp.appendChild(opt);
  });

  // Fechas: mínimo mañana, máximo 60 días
  const fechaInput = document.getElementById("nc-fecha");
  const hoy   = new Date();
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  const max60  = new Date(hoy); max60.setDate(hoy.getDate() + 60);
  fechaInput.min = manana.toISOString().split("T")[0];
  fechaInput.max = max60.toISOString().split("T")[0];
}

function abrirModalNuevaCita() {
  limpiarFormularioNC();
  document.getElementById("modal-nueva-cita").classList.remove("oculto");
  document.body.style.overflow = "hidden";
  document.getElementById("nc-nombre").focus();
}

function cerrarModalNuevaCita() {
  document.getElementById("modal-nueva-cita").classList.add("oculto");
  document.body.style.overflow = "";
}

function limpiarFormularioNC() {
  ["nc-nombre", "nc-apellidos", "nc-telefono", "nc-email", "nc-notas"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("nc-especialidad").value = "";
  const selDoc = document.getElementById("nc-doctor");
  selDoc.innerHTML = '<option value="">— Selecciona especialidad —</option>';
  selDoc.disabled = true;
  const selHor = document.getElementById("nc-horario");
  selHor.innerHTML = '<option value="">— Selecciona médico —</option>';
  selHor.disabled = true;
  document.getElementById("nc-tipo").value = "";
  document.getElementById("nc-fecha").value = "";
  document.getElementById("nc-confirmar").checked = true;
  document.getElementById("nc-banner-pac").className = "nc-banner oculto";
  document.getElementById("nc-error").className = "nc-error-msg oculto";

  const ncTieneSeg = document.getElementById("nc-tiene-seguro");
  if (ncTieneSeg) ncTieneSeg.checked = false;
  const ncCamposSeg = document.getElementById("nc-seguro-campos");
  if (ncCamposSeg) ncCamposSeg.classList.remove("visible");
  const ncAseg = document.getElementById("nc-aseguradora");
  if (ncAseg) ncAseg.value = "";
  const ncOtroCampo = document.getElementById("nc-aseg-otro-campo");
  if (ncOtroCampo) ncOtroCampo.style.display = "none";
  const ncOtro = document.getElementById("nc-aseg-otro");
  if (ncOtro) ncOtro.value = "";
  const ncPoliza = document.getElementById("nc-poliza");
  if (ncPoliza) ncPoliza.value = "";
}

function onEspecialidadCambioNC() {
  const espNombre = document.getElementById("nc-especialidad").value;
  const selDoc    = document.getElementById("nc-doctor");
  const selHor    = document.getElementById("nc-horario");

  selHor.innerHTML = '<option value="">— Selecciona médico —</option>';
  selHor.disabled  = true;

  if (!espNombre) {
    selDoc.innerHTML = '<option value="">— Selecciona especialidad —</option>';
    selDoc.disabled  = true;
    return;
  }

  const doctores = DOCTORES.filter((d) => {
    const esp = ESPECIALIDADES.find((e) => e.id === d.especialidadId);
    return esp && esp.nombre === espNombre;
  });

  selDoc.innerHTML = '<option value="">— Seleccionar médico —</option>';
  doctores.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.nombre;
    opt.textContent = d.nombre;
    selDoc.appendChild(opt);
  });
  selDoc.disabled = false;
}

function onDoctorCambioNC() {
  const docNombre = document.getElementById("nc-doctor").value;
  const selHor    = document.getElementById("nc-horario");

  if (!docNombre) {
    selHor.innerHTML = '<option value="">— Selecciona médico —</option>';
    selHor.disabled  = true;
    return;
  }

  const doctor = DOCTORES.find((d) => d.nombre === docNombre);
  if (!doctor || !doctor.horarios.length) {
    selHor.innerHTML = '<option value="">Sin horarios disponibles</option>';
    selHor.disabled  = true;
    return;
  }

  selHor.innerHTML = '<option value="">— Seleccionar horario —</option>';
  doctor.horarios.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = `${h} hrs`;
    selHor.appendChild(opt);
  });
  selHor.disabled = false;
}

function onTelefonoBlurNC() {
  const tel    = document.getElementById("nc-telefono").value.trim();
  const banner = document.getElementById("nc-banner-pac");
  if (!tel) { banner.className = "nc-banner oculto"; return; }

  const telNorm   = normalizarTexto(tel);
  const pacientes = JSON.parse(localStorage.getItem("medicita_pacientes") || "[]");
  const pac = pacientes.find((p) => normalizarTexto(p.telefono || "") === telNorm);

  if (pac) {
    banner.className   = "nc-banner nc-banner-encontrado";
    banner.textContent = `✓ Paciente encontrado: ${pac.nombre} ${pac.apellidos}`;
    document.getElementById("nc-nombre").value    = pac.nombre    || "";
    document.getElementById("nc-apellidos").value = pac.apellidos || "";
    document.getElementById("nc-email").value     = pac.email     || "";
  } else {
    banner.className   = "nc-banner nc-banner-nuevo";
    banner.textContent = "Paciente nuevo — se creará su perfil al guardar";
  }
}

function generarFolioAdmin() {
  const now = new Date();
  const aa  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, "0");
  const dd  = String(now.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return `CIT-${aa}${mm}${dd}-${rnd}`;
}

function guardarNuevaCita() {
  const nombre       = document.getElementById("nc-nombre").value.trim();
  const apellidos    = document.getElementById("nc-apellidos").value.trim();
  const telefono     = document.getElementById("nc-telefono").value.trim();
  const email        = document.getElementById("nc-email").value.trim();
  const especialidad = document.getElementById("nc-especialidad").value;
  const doctor       = document.getElementById("nc-doctor").value;
  const fecha        = document.getElementById("nc-fecha").value;
  const horario      = document.getElementById("nc-horario").value;
  const tipo         = document.getElementById("nc-tipo").value;
  const notas        = document.getElementById("nc-notas").value.trim();
  const confirmar    = document.getElementById("nc-confirmar").checked;
  const errorEl      = document.getElementById("nc-error");
  const tieneSeguro  = document.getElementById("nc-tiene-seguro")?.checked || false;
  const ncAseg       = document.getElementById("nc-aseguradora");
  const nombreSeguro = ncAseg?.value === "Otro"
    ? (document.getElementById("nc-aseg-otro")?.value.trim() || "")
    : (ncAseg?.value || "");
  const numeroPoliza = document.getElementById("nc-poliza")?.value.trim() || "";

  const faltantes = [];
  if (!nombre)       faltantes.push("Nombre");
  if (!apellidos)    faltantes.push("Apellidos");
  if (!telefono)     faltantes.push("Teléfono");
  if (!especialidad) faltantes.push("Especialidad");
  if (!doctor)       faltantes.push("Médico");
  if (!fecha)        faltantes.push("Fecha");
  if (!horario)      faltantes.push("Horario");
  if (!tipo)         faltantes.push("Tipo de consulta");

  if (faltantes.length > 0) {
    errorEl.textContent = `Completa los campos requeridos: ${faltantes.join(", ")}.`;
    errorEl.className   = "nc-error-msg";
    return;
  }
  errorEl.className = "nc-error-msg oculto";

  const folio = generarFolioAdmin();
  const ahora = new Date().toISOString();

  const nuevaCita = {
    folio, nombre, apellidos, telefono, email,
    especialidad, doctor, fecha, hora: horario,
    tipo, notas,
    tieneSeguro, nombreSeguro, numeroPoliza,
    estado:   confirmar ? "confirmada" : "pendiente",
    creadaEn: ahora,
    origenManual: true,
  };

  estadoAdmin.citas.unshift(nuevaCita);
  guardarCitas();

  // Lógica de paciente
  const pacientes = JSON.parse(localStorage.getItem("medicita_pacientes") || "[]");
  const telNorm   = normalizarTexto(telefono);
  const idxPac    = pacientes.findIndex((p) => normalizarTexto(p.telefono || "") === telNorm);
  let pacienteNuevo = false;

  if (idxPac !== -1) {
    if (!pacientes[idxPac].foliosCitas) pacientes[idxPac].foliosCitas = [];
    if (!pacientes[idxPac].foliosCitas.includes(folio)) {
      pacientes[idxPac].foliosCitas.push(folio);
    }
    if (tieneSeguro) {
      pacientes[idxPac].tieneSeguro  = true;
      pacientes[idxPac].nombreSeguro = nombreSeguro;
      pacientes[idxPac].numeroPoliza = numeroPoliza;
    }
    pacientes[idxPac].actualizadoEn = ahora;
  } else {
    pacienteNuevo = true;
    const hoy = new Date();
    const id  = `PAC-${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,"0")}${String(hoy.getDate()).padStart(2,"0")}-${String(Math.floor(Math.random()*9000)+1000)}`;
    pacientes.unshift({
      id, nombre, apellidos, telefono, email,
      fechaNacimiento: "", sexo: "", estatura: "", peso: "",
      tipoSangre: "", alergias: "", enfermedadesCronicas: "", medicamentosActuales: "",
      ciudad: "", comoNosEncontro: "", ocupacion: "",
      calificacion: 1, notas: "",
      tieneSeguro, nombreSeguro, numeroPoliza,
      foliosCitas: [folio], foliosDocs: [], respuestasNPS: [],
      creadoEn: ahora, actualizadoEn: ahora,
    });
  }
  localStorage.setItem("medicita_pacientes", JSON.stringify(pacientes));

  renderStats();
  renderTabla();
  cerrarModalNuevaCita();

  const msg = pacienteNuevo
    ? `Cita registrada · Perfil de paciente creado — Folio: ${folio}`
    : `Cita registrada — Folio: ${folio}`;
  mostrarToast(msg, "ok");
}
