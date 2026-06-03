/* ─── Estado ──────────────────────────────────────────────────────────── */
const estadoAdmin = {
  citas: [],
  filtros: { busqueda: "", fecha: "", doctor: "", estado: "" },
};

/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  cargarCitas();
  poblarFiltroDoctores();
  renderStats();
  renderTabla();
  bindEventos();

  // Refresca si el paciente guarda una cita en otra pestaña
  window.addEventListener("storage", (e) => {
    if (e.key === "medicita_citas") {
      cargarCitas();
      renderStats();
      renderTabla();
      mostrarToast("Nueva cita recibida desde el sitio.", "ok");
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
  document.getElementById("btn-muestra").addEventListener("click", cargarDatosMuestra);
  document.getElementById("btn-muestra-tabla").addEventListener("click", cargarDatosMuestra);
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
      const texto = `${c.nombre} ${c.apellidos} ${c.folio} ${c.especialidad} ${c.doctor}`.toLowerCase();
      if (!texto.includes(busqueda.toLowerCase())) return false;
    }
    if (fecha && c.fecha !== fecha) return false;
    if (doctor && c.doctor !== doctor) return false;
    if (estado && c.estado !== estado) return false;
    return true;
  });
}

/* ─── Render tabla ────────────────────────────────────────────────────── */
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

  empty.style.display = "none";
  tbody.innerHTML = citas.map((c) => {
    const fechaFmt   = formatFecha(c.fecha);
    const tienNotas  = c.notas && c.notas.trim().length > 0;
    const notasAttr  = tienNotas ? ` title="${escaparAttr(c.notas)}"` : "";
    return `
    <tr>
      <td class="td-folio"><span class="folio-chip">${c.folio}</span></td>
      <td>
        <div class="paciente-nombre">
          ${escapeHtml(c.nombre)} ${escapeHtml(c.apellidos)}
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
  estadoAdmin.citas[idx].estado = nuevoEstado;
  guardarCitas();
  renderStats();
  renderTabla();
  mostrarToast(`Cita ${folio} → ${labelEstado(nuevoEstado)}`, "ok");
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
  document.getElementById("stat-total").textContent      = estadoAdmin.citas.length;
  document.getElementById("stat-hoy").textContent        = estadoAdmin.citas.filter((c) => c.fecha === hoy).length;
  document.getElementById("stat-pendientes").textContent = estadoAdmin.citas.filter((c) => c.estado === "pendiente").length;
  document.getElementById("stat-confirmadas").textContent = estadoAdmin.citas.filter((c) => c.estado === "confirmada").length;
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
}

/* ─── Utilidades ──────────────────────────────────────────────────────── */
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

/* ─── Toast ───────────────────────────────────────────────────────────── */
let toastTimer = null;
function mostrarToast(mensaje, tipo = "ok") {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.className = `visible toast-${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ""; }, 3200);
}
