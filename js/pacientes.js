/* ═══════════════════════════════════════════════════════════════════
   M5 MediPacientes — Directorio de pacientes

   No toca localStorage: todo pasa por js/api.mjs (window.API), que decide
   si los expedientes viven en este navegador o en Postgres.
   ═══════════════════════════════════════════════════════════════════ */

const CLAVE_PAC = "medicita_pacientes";

const estadoPac = {
  filtros: { busqueda: "", calificacion: "", sexo: "", comoNosEncontro: "" },
  vistaGrid: true,
  editandoId: null,
};

/* ─── Init ──────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("tab-pacientes")) return;
  await window.APIListo;

  bindEventosPac();
  await renderDirectorio();
  await actualizarContadorPac();

  window.addEventListener("storage", (e) => {
    if (e.key === CLAVE_PAC || e.key === "medicita_citas") {
      renderDirectorio();
      actualizarContadorPac();
    }
  });
});

/* ─── Acceso a datos ────────────────────────────────────────────────── */
async function leerPacientes() {
  return API.pacientes.listar();
}

/* ─── Interconexión — funciones globales usadas desde otros archivos ── */

/**
 * Vincula una cita con el expediente de su paciente, creando el
 * expediente si es la primera vez que aparece ese teléfono.
 *
 * El cruce por teléfono ya no se hace aquí. Estaba copiado en cuatro
 * archivos con cuatro criterios distintos —este quitaba solo espacios, y
 * por eso no cruzaba "55-1234-5678" con "55 1234 5678"—. Ahora lo
 * resuelve la capa de datos, que compara por los últimos 10 dígitos, y en
 * Postgres es una columna generada con índice único.
 */
async function pacientesVincularCita(folio, datosCita) {
  const existente = await API.pacientes.porTelefono(datosCita.telefono);

  if (existente) {
    if ((existente.foliosCitas || []).includes(folio)) return existente;
    return API.pacientes.guardar({
      ...existente,
      foliosCitas: [...(existente.foliosCitas || []), folio],
    });
  }

  return API.pacientes.guardar({
    nombre:    datosCita.nombre || "",
    apellidos: datosCita.apellidos || "",
    telefono:  datosCita.telefono || "",
    email:     datosCita.email || "",
    foliosCitas: [folio],
  });
}

// Llamada desde medidocs.js al guardar un documento
async function pacientesVincularDoc(citaFolio, docId) {
  if (!citaFolio) return;
  const pacientes = await leerPacientes();
  const pac = pacientes.find(p => (p.foliosCitas || []).includes(citaFolio));
  if (!pac) return;
  if ((pac.foliosDocs || []).includes(docId)) return;

  return API.pacientes.guardar({
    ...pac,
    foliosDocs: [...(pac.foliosDocs || []), docId],
  });
}

// Llamada desde admin.js en cambiarEstado y cargarDatosMuestra
async function pacientesAsegurarVinculo(cita) {
  if (!cita) return;
  await pacientesVincularCita(cita.folio, {
    nombre:    cita.nombre,
    apellidos: cita.apellidos,
    telefono:  cita.telefono,
    email:     cita.email || "",
  });
  if (document.getElementById("tab-pacientes")) {
    await renderDirectorio();
    await actualizarContadorPac();
  }
}

/* ─── Cálculos cruzados con las citas ───────────────────────────────
   Reciben el arreglo de citas por parámetro en vez de leerlo. Antes cada
   una lo releía, y como se llaman dentro del .map() del directorio, eso
   significaba una lectura completa por cada paciente en cada render. */
function especialidadFrecuentePac(pac, citas) {
  const mias = citas.filter(c => pac.foliosCitas.includes(c.folio));
  if (!mias.length) return "—";
  const freq = {};
  mias.forEach(c => { freq[c.especialidad] = (freq[c.especialidad] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

function ultimaCitaFechaPac(pac, citas) {
  const fechas = citas
    .filter(c => pac.foliosCitas.includes(c.folio))
    .map(c => c.fecha)
    .filter(Boolean)
    .sort()
    .reverse();
  return fechas[0] || null;
}

/* ─── Filtrado ──────────────────────────────────────────────────────── */
async function pacientesFiltrados() {
  const todos = await leerPacientes();
  const { busqueda, calificacion, sexo, comoNosEncontro } = estadoPac.filtros;
  return todos.filter(p => {
    if (busqueda) {
      const texto = `${p.nombre} ${p.apellidos} ${p.telefono} ${p.email}`.toLowerCase();
      if (!texto.includes(busqueda.toLowerCase())) return false;
    }
    if (calificacion && p.calificacion !== Number(calificacion)) return false;
    if (sexo && p.sexo !== sexo) return false;
    if (comoNosEncontro && p.comoNosEncontro !== comoNosEncontro) return false;
    return true;
  });
}

/* ─── Render principal ──────────────────────────────────────────────── */
async function renderDirectorio() {
  const lista = await pacientesFiltrados();
  const cont = document.getElementById("pac-contador-resultados");
  if (cont) cont.textContent = `${lista.length} ${lista.length === 1 ? "paciente" : "pacientes"}`;

  /* Una sola lectura de citas para todo el render, que se pasa hacia
     abajo. Es lo que permite que las tarjetas sigan pintándose de forma
     síncrona sin releer por cada paciente. */
  const citas = await API.citas.listar();

  if (estadoPac.vistaGrid) {
    renderCardsGrid(lista, citas);
  } else {
    renderTablaLista(lista, citas);
  }
}

function renderCardsGrid(pacientes, citas) {
  const area = document.getElementById("pac-area");
  if (!area) return;

  if (pacientes.length === 0) {
    area.innerHTML = `
      <div class="pac-empty">
        <div class="pac-empty-icono">👥</div>
        <p class="pac-empty-titulo">No se encontraron pacientes</p>
        <p class="pac-empty-desc">Agrega el primer paciente o ajusta los filtros de búsqueda.</p>
        <button class="btn-nuevo-pac" onclick="abrirModalNuevoPac()">+ Nuevo paciente</button>
      </div>`;
    return;
  }

  area.innerHTML = `<div class="pac-grid">${pacientes.map(p => renderCardPaciente(p, citas)).join("")}</div>`;
}

function renderCardPaciente(p, citas) {
  const iniciales = `${p.nombre.charAt(0)}${p.apellidos.charAt(0)}`.toUpperCase();
  const estrellas = renderEstrellasPac(p.calificacion);
  const totalCitas = p.foliosCitas.length;
  const esp = especialidadFrecuentePac(p, citas);
  const ultima = ultimaCitaFechaPac(p, citas);
  const ultimaFmt = ultima
    ? new Date(ultima + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
    : "Sin citas aún";

  return `
  <div class="pac-card" data-id="${escaparAttrPac(p.id)}">
    <div class="pac-card-top">
      <div class="pac-avatar" aria-hidden="true">${iniciales}</div>
      <div class="pac-card-info">
        <div class="pac-nombre">${escHtmlPac(p.nombre)} ${escHtmlPac(p.apellidos)}</div>
        <div class="pac-estrellas" aria-label="${p.calificacion === 3 ? "VIP Oro" : p.calificacion === 2 ? "VIP Plata" : "Regular"}">${estrellas}</div>
      </div>
      <button class="pac-btn-editar" onclick="abrirModalEditarPac('${escaparAttrPac(p.id)}')"
              aria-label="Editar paciente ${escHtmlPac(p.nombre)}" title="Editar paciente">✏️</button>
    </div>
    <div class="pac-contacto">
      <span>📞 ${escHtmlPac(p.telefono)}</span>
      ${p.email ? `<span>✉️ ${escHtmlPac(p.email)}</span>` : ""}
    </div>
    <div class="pac-meta">
      <span class="pac-meta-item">🗓 ${totalCitas} ${totalCitas === 1 ? "cita" : "citas"}</span>
      ${esp !== "—" ? `<span class="pac-meta-item">🩺 ${escHtmlPac(esp)}</span>` : ""}
    </div>
    <div class="pac-ultima">Última cita: ${ultimaFmt}</div>
    <button class="pac-btn-perfil" onclick="abrirPerfilPac('${escaparAttrPac(p.id)}')"
            aria-label="Ver perfil de ${escHtmlPac(p.nombre)}">👤 Ver perfil</button>
  </div>`;
}

function renderTablaLista(pacientes, citas) {
  const area = document.getElementById("pac-area");
  if (!area) return;

  if (pacientes.length === 0) {
    area.innerHTML = `<div class="pac-empty"><div class="pac-empty-icono">👥</div><p class="pac-empty-titulo">No se encontraron pacientes</p></div>`;
    return;
  }

  const filas = pacientes.map(p => {
    const esp     = especialidadFrecuentePac(p, citas);
    const ultima  = ultimaCitaFechaPac(p, citas);
    const ultimaFmt = ultima
      ? new Date(ultima + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : "—";

    return `
    <tr>
      <td>
        <div class="paciente-nombre">${escHtmlPac(p.nombre)} ${escHtmlPac(p.apellidos)}</div>
        <div class="paciente-contacto">${escHtmlPac(p.telefono)}${p.email ? " · " + escHtmlPac(p.email) : ""}</div>
      </td>
      <td><span class="pac-estrellas-tabla">${renderEstrellasPac(p.calificacion)}</span></td>
      <td>${escHtmlPac(esp)}</td>
      <td class="td-fecha">${p.foliosCitas.length} ${p.foliosCitas.length === 1 ? "cita" : "citas"}</td>
      <td class="td-fecha"><div class="fecha-dia">${ultimaFmt}</div></td>
      <td class="td-acciones">
        <div class="acciones-inner">
          <button class="pac-btn-edit-tabla"
                  onclick="abrirPerfilPac('${escaparAttrPac(p.id)}')"
                  aria-label="Ver perfil de ${escHtmlPac(p.nombre)}">👤 Perfil</button>
          <button class="pac-btn-edit-tabla"
                  onclick="abrirModalEditarPac('${escaparAttrPac(p.id)}')"
                  aria-label="Editar paciente ${escHtmlPac(p.nombre)}">✏️ Editar</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  area.innerHTML = `
  <div class="tabla-scroll" role="region" tabindex="0">
    <table aria-label="Directorio de pacientes">
      <thead>
        <tr>
          <th scope="col">Paciente</th>
          <th scope="col">VIP</th>
          <th scope="col">Especialidad frecuente</th>
          <th scope="col">Total citas</th>
          <th scope="col">Última cita</th>
          <th scope="col">Acciones</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>`;
}

function renderEstrellasPac(n) {
  return n >= 3 ? "⭐⭐⭐" : n >= 2 ? "⭐⭐" : "⭐";
}

async function actualizarContadorPac() {
  const total = (await leerPacientes()).length;
  const el = document.getElementById("pac-total-counter");
  if (el) el.textContent = `${total} ${total === 1 ? "paciente registrado" : "pacientes registrados"}`;
}

/* ─── Eventos ───────────────────────────────────────────────────────── */
function bindEventosPac() {
  const busquedaEl = document.getElementById("pac-busqueda");
  if (busquedaEl) {
    busquedaEl.addEventListener("input", () => {
      estadoPac.filtros.busqueda = busquedaEl.value.trim();
      renderDirectorio();
    });
  }

  [
    ["pac-filtro-calificacion", "calificacion"],
    ["pac-filtro-sexo",          "sexo"],
    ["pac-filtro-origen",        "comoNosEncontro"],
  ].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        estadoPac.filtros[key] = el.value;
        renderDirectorio();
      });
    }
  });

  document.getElementById("btn-limpiar-pac")?.addEventListener("click", () => {
    estadoPac.filtros = { busqueda: "", calificacion: "", sexo: "", comoNosEncontro: "" };
    const busq = document.getElementById("pac-busqueda");
    if (busq) busq.value = "";
    ["pac-filtro-calificacion", "pac-filtro-sexo", "pac-filtro-origen"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    renderDirectorio();
  });

  document.getElementById("btn-vista-grid")?.addEventListener("click", () => {
    estadoPac.vistaGrid = true;
    document.getElementById("btn-vista-grid").classList.add("activo");
    document.getElementById("btn-vista-lista").classList.remove("activo");
    renderDirectorio();
  });

  document.getElementById("btn-vista-lista")?.addEventListener("click", () => {
    estadoPac.vistaGrid = false;
    document.getElementById("btn-vista-grid").classList.remove("activo");
    document.getElementById("btn-vista-lista").classList.add("activo");
    renderDirectorio();
  });

  document.getElementById("btn-nuevo-pac")?.addEventListener("click", abrirModalNuevoPac);
  document.getElementById("btn-exportar-pac")?.addEventListener("click", exportarPacientesCSV);

  // Modal: botones
  document.getElementById("btn-cerrar-modal-pac")?.addEventListener("click", cerrarModalPac);
  document.getElementById("btn-cancelar-pac")?.addEventListener("click", cerrarModalPac);
  document.getElementById("btn-guardar-pac")?.addEventListener("click", guardarPaciente);

  // Modal: cerrar al hacer clic fuera
  document.getElementById("modal-paciente")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) cerrarModalPac();
  });

  // Escape: cierra panel perfil o modal (en ese orden de prioridad)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const panel = document.getElementById("panel-perfil-pac");
    if (panel && !panel.classList.contains("oculto")) { cerrarPerfilPac(); return; }
    const modal = document.getElementById("modal-paciente");
    if (modal && !modal.classList.contains("oculto")) cerrarModalPac();
  });

  // Estrellas VIP en modal
  document.querySelectorAll(".pac-star-btn").forEach((btn, _i, todos) => {
    btn.addEventListener("click", () => {
      const val = parseInt(btn.dataset.val);
      todos.forEach((b, i) => b.classList.toggle("activa", i < val));
      document.getElementById("pac-modal-calificacion").value = val;
    });
  });

  // Panel perfil: tabs nav
  document.querySelectorAll(".perfil-tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      estadoPerfil.tabActiva = btn.dataset.ptab;
      document.querySelectorAll(".perfil-tab-btn").forEach((b) => {
        b.classList.toggle("activo", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      const pac = await API.pacientes.obtener(estadoPerfil.pacienteId);
      if (pac) await renderPerfilContenido(pac);
    });
  });
}

/* ─── Modal nuevo / editar paciente ─────────────────────────────────── */
function abrirModalNuevoPac() {
  estadoPac.editandoId = null;
  document.getElementById("modal-pac-titulo").textContent = "Nuevo paciente";
  limpiarFormPac();
  abrirModalPacInterno();
}

async function abrirModalEditarPac(id) {
  const p = await API.pacientes.obtener(id);
  if (!p) return;
  estadoPac.editandoId = id;
  document.getElementById("modal-pac-titulo").textContent = "Editar paciente";
  rellenarFormPac(p);
  abrirModalPacInterno();
}

function abrirModalPacInterno() {
  const modal = document.getElementById("modal-paciente");
  modal.classList.remove("oculto");
  document.body.style.overflow = "hidden";
  document.getElementById("pac-nombre")?.focus();
}

function cerrarModalPac() {
  document.getElementById("modal-paciente").classList.add("oculto");
  document.body.style.overflow = "";
  estadoPac.editandoId = null;
}

function limpiarFormPac() {
  [
    "pac-nombre","pac-apellidos","pac-telefono","pac-email",
    "pac-nacimiento","pac-estatura","pac-peso",
    "pac-alergias","pac-enfermedades","pac-medicamentos",
    "pac-ciudad","pac-ocupacion","pac-notas",
    "pac-aseg-otro","pac-poliza",
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });

  ["pac-sexo","pac-tipo-sangre","pac-origen","pac-aseguradora"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });

  const otroSeg = document.getElementById("pac-aseg-otro-campo");
  if (otroSeg) otroSeg.style.display = "none";

  document.getElementById("pac-modal-calificacion").value = "1";
  actualizarEstrellasBtnsPac(1);
}

function rellenarFormPac(p) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  set("pac-nombre",         p.nombre);
  set("pac-apellidos",      p.apellidos);
  set("pac-telefono",       p.telefono);
  set("pac-email",          p.email);
  set("pac-nacimiento",     p.fechaNacimiento);
  set("pac-sexo",           p.sexo);
  set("pac-estatura",       p.estatura);
  set("pac-peso",           p.peso);
  set("pac-tipo-sangre",    p.tipoSangre);
  set("pac-alergias",       p.alergias);
  set("pac-enfermedades",   p.enfermedadesCronicas);
  set("pac-medicamentos",   p.medicamentosActuales);
  set("pac-ciudad",         p.ciudad);
  set("pac-origen",         p.comoNosEncontro);
  set("pac-ocupacion",      p.ocupacion);
  set("pac-notas",          p.notas);

  const selAseg = document.getElementById("pac-aseguradora");
  const asegOtroCampo = document.getElementById("pac-aseg-otro-campo");
  const asegOtroInput = document.getElementById("pac-aseg-otro");
  if (selAseg) {
    const asegStd = ["GNP","AXA","Metlife","Mapfre","HDI","IMSS","ISSSTE"];
    if (asegStd.includes(p.nombreSeguro)) {
      selAseg.value = p.nombreSeguro;
      if (asegOtroCampo) asegOtroCampo.style.display = "none";
    } else if (p.nombreSeguro) {
      selAseg.value = "Otro";
      if (asegOtroInput) asegOtroInput.value = p.nombreSeguro;
      if (asegOtroCampo) asegOtroCampo.style.display = "";
    } else {
      selAseg.value = "";
      if (asegOtroCampo) asegOtroCampo.style.display = "none";
    }
  }
  set("pac-poliza", p.numeroPoliza);

  document.getElementById("pac-modal-calificacion").value = p.calificacion || 1;
  actualizarEstrellasBtnsPac(p.calificacion || 1);
}

function actualizarEstrellasBtnsPac(val) {
  document.querySelectorAll(".pac-star-btn").forEach((b, i) => {
    b.classList.toggle("activa", i < val);
  });
}

async function guardarPaciente() {
  const nombre    = document.getElementById("pac-nombre").value.trim();
  const apellidos = document.getElementById("pac-apellidos").value.trim();
  const telefono  = document.getElementById("pac-telefono").value.trim();

  if (!nombre || !apellidos || !telefono) {
    mostrarToast("Nombre, apellidos y teléfono son obligatorios.", "error");
    return;
  }

  const ahora = new Date().toISOString();

  const selAseg   = document.getElementById("pac-aseguradora");
  const nombreSeg = selAseg?.value === "Otro"
    ? (document.getElementById("pac-aseg-otro")?.value.trim() || "")
    : (selAseg?.value || "");

  const datosNuevos = {
    nombre,
    apellidos,
    telefono,
    email:                document.getElementById("pac-email").value.trim(),
    fechaNacimiento:      document.getElementById("pac-nacimiento").value,
    sexo:                 document.getElementById("pac-sexo").value,
    estatura:             document.getElementById("pac-estatura").value.trim(),
    peso:                 document.getElementById("pac-peso").value.trim(),
    tipoSangre:           document.getElementById("pac-tipo-sangre").value,
    alergias:             document.getElementById("pac-alergias").value.trim(),
    enfermedadesCronicas: document.getElementById("pac-enfermedades").value.trim(),
    medicamentosActuales: document.getElementById("pac-medicamentos").value.trim(),
    ciudad:               document.getElementById("pac-ciudad").value.trim(),
    comoNosEncontro:      document.getElementById("pac-origen").value,
    ocupacion:            document.getElementById("pac-ocupacion").value.trim(),
    calificacion:         parseInt(document.getElementById("pac-modal-calificacion").value) || 1,
    notas:                document.getElementById("pac-notas").value.trim(),
    tieneSeguro:          (selAseg?.value || "") !== "",
    nombreSeguro:         nombreSeg,
    numeroPoliza:         document.getElementById("pac-poliza")?.value.trim() || "",
    actualizadoEn:        ahora,
  };

  try {
    if (estadoPac.editandoId) {
      /* Se relee el expediente antes de guardar para no pisar campos que
         el formulario no toca (folios de citas, documentos, notas). */
      const previo = await API.pacientes.obtener(estadoPac.editandoId);
      await API.pacientes.guardar({ ...previo, ...datosNuevos, id: estadoPac.editandoId });
      mostrarToast("Paciente actualizado.", "ok");
    } else {
      await API.pacientes.guardar({
        ...datosNuevos,
        foliosCitas:   [],
        foliosDocs:    [],
        respuestasNPS: [],
        creadoEn:      ahora,
      });
      mostrarToast("Paciente registrado.", "ok");
    }
  } catch (e) {
    mostrarToast(`No se pudo guardar el expediente: ${e.message}`, "error");
    return;
  }

  cerrarModalPac();
  await renderDirectorio();
  await actualizarContadorPac();
}

/* ═══════════════════════════════════════════════════════════════════
   M5 Paso 2 — Panel lateral: Perfil individual de paciente
   ═══════════════════════════════════════════════════════════════════ */

const estadoPerfil = {
  pacienteId: null,
  tabActiva: "datos",
};

async function abrirPerfilPac(id) {
  const pac = await API.pacientes.obtener(id);
  if (!pac) return;
  estadoPerfil.pacienteId = id;
  estadoPerfil.tabActiva = "datos";
  await renderPerfilPac(pac);
  const panel = document.getElementById("panel-perfil-pac");
  const overlay = document.getElementById("pac-perfil-overlay");
  if (!panel) return;
  panel.classList.remove("oculto");
  setTimeout(() => panel.classList.add("visible"), 10);
  overlay.classList.remove("oculto");
  document.body.style.overflow = "hidden";
  document.getElementById("perfil-contenido")?.focus();
}

function cerrarPerfilPac() {
  const panel = document.getElementById("panel-perfil-pac");
  const overlay = document.getElementById("pac-perfil-overlay");
  if (!panel) return;
  panel.classList.remove("visible");
  overlay.classList.add("oculto");
  setTimeout(() => panel.classList.add("oculto"), 280);
  document.body.style.overflow = "";
  estadoPerfil.pacienteId = null;
}

async function renderPerfilPac(pac) {
  const iniciales = `${pac.nombre.charAt(0)}${pac.apellidos.charAt(0)}`.toUpperCase();
  const avatarEl = document.getElementById("perfil-avatar-lg");
  const nombreEl = document.getElementById("perfil-nombre-lg");
  const estrellasEl = document.getElementById("perfil-estrellas-lg");
  if (avatarEl) avatarEl.textContent = iniciales;
  if (nombreEl) nombreEl.textContent = `${pac.nombre} ${pac.apellidos}`;
  if (estrellasEl) estrellasEl.textContent = renderEstrellasPac(pac.calificacion);

  document.querySelectorAll(".perfil-tab-btn").forEach((btn) => {
    const activo = btn.dataset.ptab === estadoPerfil.tabActiva;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", activo ? "true" : "false");
  });

  await renderPerfilContenido(pac);
}

async function renderPerfilContenido(pac) {
  const cont = document.getElementById("perfil-contenido");
  if (!cont) return;
  switch (estadoPerfil.tabActiva) {
    case "datos":  cont.innerHTML = buildHtmlPerfilDatos(pac); break;
    case "citas":  cont.innerHTML = await buildHtmlPerfilCitas(pac); break;
    case "docs":   cont.innerHTML = await buildHtmlPerfilDocs(pac); break;
    case "notas":  cont.innerHTML = buildHtmlPerfilNotas(pac); break;
  }
}

/* ─── Tab: Datos ─────────────────────────────────────────────────── */
function buildHtmlPerfilDatos(pac) {
  const fila = (label, val) => {
    if (!val) return "";
    return `<div class="perfil-dato">
      <span class="perfil-dato-label">${label}</span>
      <span class="perfil-dato-val">${escHtmlPac(val)}</span>
    </div>`;
  };
  const nacFmt = pac.fechaNacimiento
    ? new Date(pac.fechaNacimiento + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return `
    <div class="perfil-seccion">
      <div class="perfil-seccion-titulo">Identificación</div>
      ${fila("Email", pac.email)}
      ${fila("Teléfono", pac.telefono)}
      ${fila("Fecha de nacimiento", nacFmt)}
      ${fila("Sexo", pac.sexo)}
      ${fila("Ocupación", pac.ocupacion)}
      ${fila("Ciudad", pac.ciudad)}
    </div>
    <div class="perfil-seccion">
      <div class="perfil-seccion-titulo">Datos médicos</div>
      ${fila("Tipo de sangre", pac.tipoSangre)}
      ${pac.estatura ? fila("Estatura", pac.estatura + " cm") : ""}
      ${pac.peso ? fila("Peso", pac.peso + " kg") : ""}
      ${fila("Alergias", pac.alergias)}
      ${fila("Enfermedades crónicas", pac.enfermedadesCronicas)}
      ${fila("Medicamentos actuales", pac.medicamentosActuales)}
    </div>
    <div class="perfil-seccion">
      <div class="perfil-seccion-titulo">Marketing</div>
      ${fila("Cómo nos encontró", pac.comoNosEncontro)}
    </div>
    <div class="perfil-seccion">
      <div class="perfil-seccion-titulo">Seguro médico</div>
      ${pac.tieneSeguro
        ? fila("Aseguradora", pac.nombreSeguro || "No especificada") +
          (pac.numeroPoliza ? fila("Número de póliza", pac.numeroPoliza) : "")
        : `<div class="perfil-dato"><span class="perfil-dato-label">Estado</span><span class="perfil-dato-val" style="color:var(--gris-suave)">Sin seguro médico</span></div>`
      }
    </div>
    ${buildHtmlConsentimiento(pac)}
    <div class="perfil-acciones">
      <button class="btn-perfil-secundario"
              onclick="abrirModalEditarPac('${escaparAttrPac(pac.id)}')">✏️ Editar datos</button>
    </div>`;
}

/**
 * Consentimiento para contacto que NO cuelga de una cita suya.
 *
 * Vive en el perfil y no en el modal de edición a propósito: no es un campo
 * más del expediente, es un permiso, y la LFPDPPP pide poder mostrar cuándo
 * se dio. Por eso se registra la fecha y se enseña.
 *
 * Nace apagado. Los recordatorios de 0014 nacen encendidos porque recordarle
 * su propia cita es parte del servicio; invitarlo a volver es publicidad, y
 * eso se pide.
 */
function buildHtmlConsentimiento(pac) {
  const acepta = Boolean(pac.aceptaPromociones) && !pac.bajaEn;
  const desde = pac.promocionesEn
    ? new Date(pac.promocionesEn).toLocaleDateString("es-MX",
        { day: "numeric", month: "long", year: "numeric" })
    : "";

  if (pac.bajaEn) {
    return `
      <div class="perfil-seccion">
        <div class="perfil-seccion-titulo">Contacto</div>
        <div class="consent-baja">
          🔕 Se dio de baja de todos los correos automáticos.
          No se le puede escribir hasta que él mismo lo reactive.
        </div>
      </div>`;
  }

  /* De dónde salió el permiso importa, y la interfaz lo dice. Que lo haya
     marcado el paciente en el formulario es evidencia; que lo haya capturado
     la clínica por él es una afirmación de la clínica, y si algún día alguien
     pregunta por qué se le escribió, no es lo mismo. */
  const porElPaciente = pac.consentimientoOrigen === "paciente_web";

  const evidencia = !acepta ? "" : `
    <div class="consent-evidencia">
      ${porElPaciente
        ? `✓ Lo marcó él mismo al agendar${desde ? `, el ${escHtmlPac(desde)}` : ""}.`
        : `⚠ Lo capturó el personal${desde ? ` el ${escHtmlPac(desde)}` : ""}.
           Es evidencia más débil que si lo marcara él en el formulario.`}
      ${pac.consentimientoTexto
        ? `<div class="consent-literal">“${escHtmlPac(pac.consentimientoTexto)}”</div>`
        : ""}
    </div>`;

  return `
    <div class="perfil-seccion">
      <div class="perfil-seccion-titulo">Contacto</div>
      <label class="consent-fila">
        <input type="checkbox" id="consent-promos" ${acepta ? "checked" : ""}
               onchange="cambiarConsentimientoPac('${escaparAttrPac(pac.id)}', this.checked)">
        <span class="consent-texto">
          <strong>Acepta invitaciones para volver</strong>
          <small>
            Correos que no cuelgan de una cita suya. Márcalo solo si te lo dijo:
            es un permiso, no una preferencia.
          </small>
        </span>
      </label>
      ${evidencia}
    </div>`;
}

async function cambiarConsentimientoPac(id, acepta) {
  try {
    const previo = await API.pacientes.obtener(id);
    await API.pacientes.guardar({
      ...previo,
      aceptaPromociones: Boolean(acepta),
      /* La fecha solo se pone al aceptar, y no se borra al desmarcar: es el
         registro de que alguna vez lo dijo, que es lo que hay que poder
         mostrar si alguien pregunta por qué se le escribió. */
      promocionesEn: acepta ? (previo.promocionesEn || new Date().toISOString()) : previo.promocionesEn,

      /* Se marca como capturado por el personal, y solo si no venía ya del
         paciente: un permiso que él dio en el formulario no se degrada
         porque alguien de la clínica toque la casilla después. */
      consentimientoOrigen: acepta
        ? (previo.consentimientoOrigen || "personal")
        : previo.consentimientoOrigen,
    });
    mostrarToast(acepta
      ? "Consentimiento registrado."
      : "Ya no se le enviarán invitaciones.", "ok");

    if (typeof refrescarReactivar === "function") await refrescarReactivar();
  } catch (e) {
    mostrarToast(`No se pudo guardar: ${e.message}`, "error");
  }
}

/* ─── Tab: Citas ─────────────────────────────────────────────────── */
async function buildHtmlPerfilCitas(pac) {
  const citas = await API.citas.listar();
  const mias = citas
    .filter((c) => pac.foliosCitas.includes(c.folio))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const botonAgendar = `
    <div class="perfil-acciones">
      <button class="btn-perfil-accion"
              onclick="agendarCitaPaciente('${escaparAttrPac(pac.telefono)}','${escaparAttrPac(pac.nombre)}','${escaparAttrPac(pac.apellidos)}')">
        🗓 Agendar nueva cita
      </button>
    </div>`;

  if (!mias.length) {
    return `<div class="perfil-empty">No hay citas vinculadas aún.</div>${botonAgendar}`;
  }

  const estadoLabel = (typeof labelEstado === "function") ? labelEstado : (e) => e;

  const items = mias.map((c) => {
    const fechaFmt = c.fecha
      ? new Date(c.fecha + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    return `<div class="perfil-cita-item">
      <div class="perfil-cita-folio">${escHtmlPac(c.folio)}</div>
      <div class="perfil-cita-info">
        <div class="perfil-cita-fecha">${fechaFmt} · ${escHtmlPac(c.hora)} hrs</div>
        <div class="perfil-cita-doctor">${escHtmlPac(c.doctor)} · ${escHtmlPac(c.especialidad)}</div>
      </div>
      <span class="badge-estado badge-${escHtmlPac(c.estado)}">${estadoLabel(c.estado)}</span>
    </div>`;
  }).join("");

  return `<div class="perfil-citas-lista">${items}</div>${botonAgendar}`;
}

function agendarCitaPaciente(telefono, nombre, apellidos) {
  sessionStorage.setItem("medicita_prefill_tel", telefono);
  sessionStorage.setItem("medicita_prefill_nombre", nombre);
  sessionStorage.setItem("medicita_prefill_apellidos", apellidos);
  window.open("index.html", "_blank");
}

/* ─── Tab: Documentos ────────────────────────────────────────────── */
async function buildHtmlPerfilDocs(pac) {
  const docs = await API.documentos.listar();
  const mios = docs
    .filter((d) => pac.foliosDocs.includes(d.id))
    .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));

  if (!mios.length) {
    return `<div class="perfil-empty">No hay documentos generados para este paciente.</div>`;
  }

  const TIPOS_DOC = {
    soap: "Nota de consulta (SOAP)",
    receta: "Receta médica",
    referencia: "Carta de referencia",
    constancia: "Constancia de atención",
    incapacidad: "Incapacidad temporal",
    consentimiento: "Consentimiento informado",
  };

  const items = mios.map((d) => {
    const fechaFmt = d.creadoEn
      ? new Date(d.creadoEn).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    const tipoLabel = TIPOS_DOC[d.tipodoc] || escHtmlPac(d.tipodoc);
    return `<div class="perfil-doc-item">
      <div class="perfil-doc-icono">📄</div>
      <div class="perfil-doc-info">
        <div class="perfil-doc-tipo">${tipoLabel}</div>
        <div class="perfil-doc-fecha">${fechaFmt} · Folio: ${escHtmlPac(d.folio || "—")}</div>
      </div>
      <a href="medidocs.html?folio=${encodeURIComponent(d.folio || "")}&doc=${encodeURIComponent(d.id)}"
         target="_blank" class="btn-perfil-accion-sm">Abrir</a>
    </div>`;
  }).join("");

  return `<div class="perfil-docs-lista">${items}</div>`;
}

/* ─── Tab: Notas ─────────────────────────────────────────────────── */
function buildHtmlPerfilNotas(pac) {
  const historial = pac.historialNotas || [];

  const listaHtml = historial.length === 0
    ? '<div class="perfil-empty">Sin notas internas aún.</div>'
    : historial.map((nota) => {
        const fechaFmt = new Date(nota.creadoEn).toLocaleString("es-MX", {
          day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        return `<div class="perfil-nota-item">
          <div class="perfil-nota-fecha">${fechaFmt}</div>
          <div class="perfil-nota-texto">${escHtmlPac(nota.texto)}</div>
        </div>`;
      }).join("");

  return `
    <div class="perfil-nota-form">
      <textarea id="nueva-nota-textarea" class="perfil-nota-textarea"
                placeholder="Escribe una nota interna…" rows="3"></textarea>
      <button class="btn-perfil-accion"
              onclick="agregarNotaPac('${escaparAttrPac(pac.id)}')">
        + Agregar nota
      </button>
    </div>
    <div class="perfil-notas-historial">${listaHtml}</div>`;
}

async function agregarNotaPac(id) {
  const textarea = document.getElementById("nueva-nota-textarea");
  const texto = textarea?.value.trim();
  if (!texto) { mostrarToast("Escribe una nota antes de guardar.", "error"); return; }

  try {
    /* El tope de 20 notas y el sello de tiempo los pone la capa de datos;
       en Postgres las notas viven en su propia tabla, auditables. */
    await API.pacientes.agregarNota(id, texto);
  } catch (e) {
    mostrarToast(`No se pudo guardar la nota: ${e.message}`, "error");
    return;
  }

  mostrarToast("Nota guardada.", "ok");
  const actualizado = await API.pacientes.obtener(id);
  if (actualizado) await renderPerfilContenido(actualizado);
}

/* ─── Exportar CSV ───────────────────────────────────────────────── */
async function exportarPacientesCSV() {
  const pacientes = await leerPacientes();
  if (!pacientes.length) { mostrarToast("No hay pacientes para exportar.", "error"); return; }

  const cols = [
    "ID", "Nombre", "Apellidos", "Teléfono", "Email", "Fecha nacimiento", "Sexo",
    "Estatura (cm)", "Peso (kg)", "Tipo sangre", "Alergias", "Enfermedades crónicas",
    "Medicamentos", "Ciudad", "Cómo nos encontró", "Ocupación", "VIP (1-3)",
    "Total citas", "Registrado el",
  ];

  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const filas = pacientes.map((p) => [
    esc(p.id), esc(p.nombre), esc(p.apellidos), esc(p.telefono), esc(p.email),
    esc(p.fechaNacimiento), esc(p.sexo), esc(p.estatura), esc(p.peso),
    esc(p.tipoSangre), esc(p.alergias), esc(p.enfermedadesCronicas),
    esc(p.medicamentosActuales), esc(p.ciudad), esc(p.comoNosEncontro),
    esc(p.ocupacion), esc(p.calificacion), esc(p.foliosCitas.length),
    esc(p.creadoEn ? p.creadoEn.slice(0, 10) : ""),
  ].join(","));

  const csv = "﻿" + [cols.map(esc).join(","), ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medicita_pacientes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("CSV exportado.", "ok");
}

/* ─── Utilidades ────────────────────────────────────────────────────── */
function escHtmlPac(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escaparAttrPac(str) {
  return String(str ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
