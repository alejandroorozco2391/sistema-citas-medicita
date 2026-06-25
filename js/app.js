/* ─── Estado de la aplicación ─────────────────────────────────────────── */
const estado = {
  especialidadSeleccionada: null,
  doctorSeleccionado: null,
  paso: 1,
};

/* ─── Inicialización ──────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  renderEspecialidades();
  inicializarFormulario();
  inicializarNav();
  inicializarFechaMin();
});

/* ─── Navegación ──────────────────────────────────────────────────────── */
function inicializarNav() {
  const hamburger = document.getElementById("hamburger");
  const navMenu = document.getElementById("nav-menu");

  hamburger.addEventListener("click", () => {
    navMenu.classList.toggle("activo");
    hamburger.setAttribute("aria-expanded", navMenu.classList.contains("activo"));
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => navMenu.classList.remove("activo"));
  });

  window.addEventListener("scroll", () => {
    const navbar = document.getElementById("navbar");
    navbar.classList.toggle("scrolled", window.scrollY > 60);
  });
}

/* ─── Especialidades ──────────────────────────────────────────────────── */
function renderEspecialidades() {
  const grid = document.getElementById("grid-especialidades");
  grid.innerHTML = ESPECIALIDADES.map((esp) => `
    <div class="card-especialidad" data-id="${esp.id}" role="button" tabindex="0"
         aria-label="Seleccionar ${esp.nombre}" style="--color-esp: ${esp.color}">
      <div class="card-icono">${esp.icono}</div>
      <h3 class="card-titulo">${esp.nombre}</h3>
      <p class="card-desc">${esp.descripcion}</p>
      <span class="card-cta">Agendar cita →</span>
    </div>
  `).join("");

  grid.querySelectorAll(".card-especialidad").forEach((card) => {
    card.addEventListener("click", () => seleccionarEspecialidad(parseInt(card.dataset.id)));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") seleccionarEspecialidad(parseInt(card.dataset.id));
    });
  });
}

function seleccionarEspecialidad(id) {
  estado.especialidadSeleccionada = ESPECIALIDADES.find((e) => e.id === id);
  document.querySelectorAll(".card-especialidad").forEach((c) => c.classList.remove("seleccionada"));
  document.querySelector(`.card-especialidad[data-id="${id}"]`).classList.add("seleccionada");

  actualizarSelectorEspecialidad(id);
  document.getElementById("agendar").scrollIntoView({ behavior: "smooth", block: "start" });
}

function actualizarSelectorEspecialidad(id) {
  const select = document.getElementById("especialidad");
  select.value = id;
  select.dispatchEvent(new Event("change"));
}

/* ─── Formulario ──────────────────────────────────────────────────────── */
function inicializarFormulario() {
  const selectEsp = document.getElementById("especialidad");
  const selectDoc = document.getElementById("doctor");

  // Pre-fill desde perfil de paciente (M5)
  const prefillTel = sessionStorage.getItem("medicita_prefill_tel");
  if (prefillTel) {
    const elTel = document.getElementById("telefono");
    if (elTel) elTel.value = prefillTel;
    const prefNombre = sessionStorage.getItem("medicita_prefill_nombre");
    const prefApellidos = sessionStorage.getItem("medicita_prefill_apellidos");
    if (prefNombre) { const el = document.getElementById("nombre"); if (el) el.value = prefNombre; }
    if (prefApellidos) { const el = document.getElementById("apellidos"); if (el) el.value = prefApellidos; }
    sessionStorage.removeItem("medicita_prefill_tel");
    sessionStorage.removeItem("medicita_prefill_nombre");
    sessionStorage.removeItem("medicita_prefill_apellidos");
    document.getElementById("agendar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  selectEsp.innerHTML = '<option value="">-- Selecciona una especialidad --</option>' +
    ESPECIALIDADES.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join("");

  selectEsp.addEventListener("change", () => {
    const id = parseInt(selectEsp.value);
    estado.especialidadSeleccionada = ESPECIALIDADES.find((e) => e.id === id) || null;
    cargarDoctores(id, selectDoc);
  });

  selectDoc.addEventListener("change", () => {
    const id = parseInt(selectDoc.value);
    estado.doctorSeleccionado = DOCTORES.find((d) => d.id === id) || null;
    cargarHorarios(estado.doctorSeleccionado);
  });

  document.getElementById("form-cita").addEventListener("submit", manejarEnvio);

  document.getElementById("fecha").addEventListener("change", () => {
    if (estado.doctorSeleccionado) cargarHorarios(estado.doctorSeleccionado);
  });

  const toggleSeguro = document.getElementById("tiene-seguro");
  const seguroCampos = document.getElementById("seguro-campos");
  if (toggleSeguro && seguroCampos) {
    toggleSeguro.addEventListener("change", () => {
      seguroCampos.classList.toggle("visible", toggleSeguro.checked);
    });
  }
  const selAseguradora = document.getElementById("aseguradora");
  const asegOtroCampo  = document.getElementById("aseg-otro-campo");
  if (selAseguradora && asegOtroCampo) {
    selAseguradora.addEventListener("change", () => {
      asegOtroCampo.style.display = selAseguradora.value === "Otro" ? "" : "none";
    });
  }
}

function inicializarFechaMin() {
  const hoy = new Date();
  const manana = new Date(hoy);
  manana.setDate(hoy.getDate() + 1);
  const limite = new Date(hoy);
  limite.setDate(hoy.getDate() + 60);

  const fmt = (d) => d.toISOString().split("T")[0];
  const inputFecha = document.getElementById("fecha");
  inputFecha.min = fmt(manana);
  inputFecha.max = fmt(limite);
}

function cargarDoctores(especialidadId, selectDoc) {
  selectDoc.innerHTML = '<option value="">-- Selecciona un médico --</option>';
  selectDoc.disabled = !especialidadId;

  if (!especialidadId) return;

  const doctoresFiltrados = DOCTORES.filter((d) => d.especialidadId === especialidadId);
  doctoresFiltrados.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.nombre;
    selectDoc.appendChild(opt);
  });

  limpiarHorarios();
}

function cargarHorarios(doctor) {
  const contenedor = document.getElementById("horarios-container");
  const grid = document.getElementById("grid-horarios");
  const fecha = document.getElementById("fecha").value;

  if (!doctor || !fecha) {
    limpiarHorarios();
    return;
  }

  grid.innerHTML = doctor.horarios.map((h) => `
    <button type="button" class="btn-horario" data-hora="${h}" aria-label="Seleccionar ${h}">${h}</button>
  `).join("");

  contenedor.style.display = "block";

  grid.querySelectorAll(".btn-horario").forEach((btn) => {
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".btn-horario").forEach((b) => b.classList.remove("activo"));
      btn.classList.add("activo");
      btn.setAttribute("aria-pressed", "true");
    });
  });
}

function limpiarHorarios() {
  const contenedor = document.getElementById("horarios-container");
  contenedor.style.display = "none";
  document.getElementById("grid-horarios").innerHTML = "";
}

function manejarEnvio(e) {
  e.preventDefault();

  const horarioSeleccionado = document.querySelector(".btn-horario.activo");
  if (!horarioSeleccionado) {
    mostrarAlerta("Por favor selecciona un horario disponible.", "error");
    return;
  }

  const selAseg = document.getElementById("aseguradora");
  const nombreSeguro = selAseg?.value === "Otro"
    ? (document.getElementById("aseg-otro")?.value.trim() || "")
    : (selAseg?.value || "");

  const datos = {
    nombre: document.getElementById("nombre").value.trim(),
    apellidos: document.getElementById("apellidos").value.trim(),
    telefono: document.getElementById("telefono").value.trim(),
    email: document.getElementById("email").value.trim(),
    especialidad: estado.especialidadSeleccionada?.nombre,
    doctor: DOCTORES.find((d) => d.id === parseInt(document.getElementById("doctor").value))?.nombre,
    fecha: document.getElementById("fecha").value,
    hora: horarioSeleccionado.dataset.hora,
    tipo: document.getElementById("tipo-consulta").value,
    notas: document.getElementById("notas").value.trim(),
    tieneSeguro:  document.getElementById("tiene-seguro")?.checked || false,
    nombreSeguro,
    numeroPoliza: document.getElementById("poliza")?.value.trim() || "",
  };


  mostrarConfirmacion(datos);
}

/* ─── Modal de confirmación ───────────────────────────────────────────── */
function mostrarConfirmacion(datos) {
  const fechaFormateada = new Date(datos.fecha + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  document.getElementById("confirm-nombre").textContent = `${datos.nombre} ${datos.apellidos}`;
  document.getElementById("confirm-especialidad").textContent = datos.especialidad;
  document.getElementById("confirm-doctor").textContent = datos.doctor;
  document.getElementById("confirm-fecha").textContent = fechaFormateada;
  document.getElementById("confirm-hora").textContent = datos.hora;
  document.getElementById("confirm-tipo").textContent = datos.tipo;

  const modal = document.getElementById("modal-confirmacion");
  modal.classList.add("activo");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  document.getElementById("btn-confirmar").onclick = () => {
    finalizarCita(datos);
  };

  document.getElementById("btn-cancelar-modal").onclick = cerrarModal;
  document.getElementById("modal-overlay").onclick = cerrarModal;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarModal();
  }, { once: true });
}

function cerrarModal() {
  const modal = document.getElementById("modal-confirmacion");
  modal.classList.remove("activo");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function finalizarCita(datos) {
  cerrarModal();
  const folio = generarFolio();
  guardarCitaEnStorage(datos, folio);
  mostrarExito(folio, datos);
  document.getElementById("form-cita").reset();
  limpiarHorarios();
  document.querySelectorAll(".card-especialidad").forEach((c) => c.classList.remove("seleccionada"));
  estado.especialidadSeleccionada = null;
  estado.doctorSeleccionado = null;
}

/* ─── Persistencia localStorage ───────────────────────────────────────── */
function guardarCitaEnStorage(datos, folio) {
  const citas = JSON.parse(localStorage.getItem("medicita_citas") || "[]");
  citas.unshift({
    folio,
    nombre: datos.nombre,
    apellidos: datos.apellidos,
    telefono: datos.telefono,
    email: datos.email,
    especialidad: datos.especialidad,
    doctor: datos.doctor,
    fecha: datos.fecha,
    hora: datos.hora,
    tipo: datos.tipo,
    notas: datos.notas,
    tieneSeguro:  datos.tieneSeguro  || false,
    nombreSeguro: datos.nombreSeguro || "",
    numeroPoliza: datos.numeroPoliza || "",
    estado: "pendiente",
    creadaEn: new Date().toISOString(),
  });
  localStorage.setItem("medicita_citas", JSON.stringify(citas));

  // M5: vincular cita con perfil de paciente
  vincularPacienteDesdeIndex(folio, datos);
}

function vincularPacienteDesdeIndex(folio, datos) {
  const KEY = "medicita_pacientes";
  const pacientes = JSON.parse(localStorage.getItem(KEY) || "[]");
  const tel = (datos.telefono || "").replace(/\s/g, "");
  const idx = pacientes.findIndex(p => p.telefono.replace(/\s/g, "") === tel);
  const ahora = new Date().toISOString();

  if (idx >= 0) {
    const actualizaciones = { actualizadoEn: ahora };
    if (!pacientes[idx].foliosCitas.includes(folio)) {
      actualizaciones.foliosCitas = [...pacientes[idx].foliosCitas, folio];
    }
    if (datos.tieneSeguro) {
      actualizaciones.tieneSeguro  = true;
      actualizaciones.nombreSeguro = datos.nombreSeguro || "";
      actualizaciones.numeroPoliza = datos.numeroPoliza || "";
    }
    pacientes[idx] = { ...pacientes[idx], ...actualizaciones };
  } else {
    const d = new Date();
    const id = `PAC-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${Math.floor(Math.random()*9000)+1000}`;
    pacientes.unshift({
      id,
      nombre: datos.nombre || "", apellidos: datos.apellidos || "",
      telefono: datos.telefono || "", email: datos.email || "",
      fechaNacimiento: "", sexo: "", estatura: "", peso: "",
      tipoSangre: "", alergias: "", enfermedadesCronicas: "", medicamentosActuales: "",
      ciudad: "", comoNosEncontro: "", ocupacion: "",
      calificacion: 1, notas: "",
      tieneSeguro:  datos.tieneSeguro  || false,
      nombreSeguro: datos.nombreSeguro || "",
      numeroPoliza: datos.numeroPoliza || "",
      foliosCitas: [folio], foliosDocs: [], respuestasNPS: [],
      creadoEn: ahora, actualizadoEn: ahora,
    });
  }
  localStorage.setItem(KEY, JSON.stringify(pacientes));
}

function mostrarExito(folio, datos) {
  document.getElementById("folio-cita").textContent = folio;

  const seccionExito = document.getElementById("seccion-exito");
  seccionExito.style.display = "block";
  seccionExito.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => {
    seccionExito.style.display = "none";
  }, 12000);
}

function generarFolio() {
  const fecha = new Date();
  const año = fecha.getFullYear().toString().slice(-2);
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `CIT-${año}${mes}${dia}-${random}`;
}

/* ─── Alertas ─────────────────────────────────────────────────────────── */
function mostrarAlerta(mensaje, tipo = "info") {
  const alerta = document.getElementById("alerta-form");
  alerta.textContent = mensaje;
  alerta.className = `alerta alerta-${tipo}`;
  alerta.style.display = "block";
  setTimeout(() => { alerta.style.display = "none"; }, 5000);
}
