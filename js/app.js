/* ─── Estado de la aplicación ─────────────────────────────────────────── */
const estado = {
  especialidadSeleccionada: null,
  doctorSeleccionado: null,
  paso: 1,

  /* Los dos factores con que el paciente entró a "Mis citas". Se guardan
     para poder cancelar y volver a consultar sin pedírselos otra vez —y
     solo en memoria: nunca en localStorage, donde quedarían para el
     siguiente que use esa computadora. */
  misCitas: { folio: "", telefono: "" },
};

/* ─── Inicialización ──────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  await window.APIListo;

  /* La landing se pinta sin sesión. Va por API.publico, que apunta al
     backend cuando existe uno aunque nadie haya iniciado sesión: son
     datos que la clínica publica de todos modos. */
  const config = (await API.publico.clinica()) || {};
  aplicarAparienciaLanding(config);
  poblarLanding(config);
  await cargarOpinionesNPS();
  inicializarAnimaciones();
  renderEspecialidades();
  inicializarFormulario();
  inicializarNav();
  inicializarFechaMin();
  inicializarMisCitas();

  // En la demo, admin.html siembra los datos de muestra (incluido el NPS)
  // dentro de un iframe hermano. Refresca las opiniones cuando eso ocurra.
  window.addEventListener("storage", (e) => {
    if (e.key === "medicita_nps") {
      cargarOpinionesNPS();
    }
  });
});

function aplicarAparienciaLanding(cfg) {
  if (cfg.colorPrimario) {
    const darken = (hex, amt) => {
      const n = parseInt(hex.replace("#", ""), 16);
      const r = Math.max(0, Math.min(255, (n >> 16) + amt));
      const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
      const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
      return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    };
    document.documentElement.style.setProperty("--color-primary",      cfg.colorPrimario);
    document.documentElement.style.setProperty("--color-primary-dark", darken(cfg.colorPrimario, -24));
    document.documentElement.style.setProperty("--color-primary-mid",  darken(cfg.colorPrimario, -8));
  }
  if (cfg.colorAcento) {
    document.documentElement.style.setProperty("--color-accent", cfg.colorAcento);
  }
  if (cfg.tipografia) {
    const fonts = {
      inter:   "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      georgia: "Georgia, 'Times New Roman', serif",
      system:  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    };
    document.body.style.fontFamily = fonts[cfg.tipografia] || fonts.inter;
  }
}

/* ─── Landing: poblar desde config ───────────────────────────────────── */
function poblarLanding(cfg) {
  const nombreClinica = cfg.nombreClinica || "MediCita";
  const nombreMedico  = cfg.nombreMedico  || "Médico Especialista";

  // Título de página
  document.title = cfg.nombreMedico
    ? `${cfg.nombreMedico} — Citas en línea`
    : `${nombreClinica} — Citas en línea`;

  // Navbar
  setTxt("nav-nombre-clinica", nombreClinica);
  renderLogoNav(cfg);

  // Hero
  const espCiudad = [cfg.especialidadPrincipal, cfg.ciudad].filter(Boolean).join(" · ") || "Medicina General · México";
  setTxt("hero-especialidad-ciudad", espCiudad);
  setTxt("hero-nombre-medico", nombreMedico);
  setTxt("hero-frase", cfg.fraseHero || "Atención médica profesional y personalizada para ti y tu familia");

  const calif = cfg.calificacionPromedio || "4.9";
  const pacs  = cfg.totalPacientes ? `+${Number(cfg.totalPacientes).toLocaleString("es-MX")}` : "+2,000";
  const anos  = cfg.anosExperiencia ? `${cfg.anosExperiencia} años` : "20 años";
  setTxt("hero-calificacion", `★ ${calif}`);
  setTxt("hero-pacientes",    pacs);
  setTxt("hero-anos",         anos);
  renderFotoHero(cfg.fotoHero);

  // Stats bar
  setTxt("stat-pacientes",    pacs);
  setTxt("stat-anos",         cfg.anosExperiencia || "20");
  setTxt("stat-calificacion", `${calif} ★`);
  setTxt("stat-horario",      cfg.horarioAtencion || "Lun–Vie 9–18h");

  // Sección médico
  setTxt("credencial-nombre", nombreMedico);
  setTxt("credencial-esp",    cfg.especialidadPrincipal || "Especialidad");
  setTxt("credencial-cedula", cfg.cedulaProfesional ? `Cédula: ${cfg.cedulaProfesional}` : "");
  setTxt("titulo-medico",     `Sobre ${nombreMedico}`);
  setTxt("medico-bio",        cfg.bioMedico || "Médico comprometido con la salud y el bienestar de sus pacientes, con amplia experiencia en el diagnóstico y tratamiento de diversas condiciones.");
  renderFotoMedico(cfg.fotoMedico, nombreMedico);
  renderFormacion(cfg.formacionMedico);

  // Servicios
  renderServiciosGrid(cfg.serviciosClinica);

  // Contacto (columna derecha del formulario)
  setTxt("ci-dir-texto",     cfg.direccionConsultorio || "—");
  setTxt("ci-tel-texto",     cfg.telefono             || "—");
  setTxt("ci-email-texto",   cfg.email                || "—");
  setTxt("ci-horario-texto", cfg.horarioAtencion      || "—");

  // WhatsApp
  if (cfg.whatsapp) {
    const btnWa = document.getElementById("btn-whatsapp");
    if (btnWa) {
      btnWa.href = `https://wa.me/${cfg.whatsapp.replace(/\D/g, "")}`;
      btnWa.style.display = "flex";
    }
  }

  // Footer
  setTxt("footer-nombre-clinica", nombreClinica);
  setTxt("footer-nombre-bottom",  nombreClinica);
  setTxt("footer-horario",        cfg.horarioAtencion || "—");

  const footerContacto = document.getElementById("footer-contacto-list");
  if (footerContacto) {
    const items = [
      cfg.telefono             && `<li>📞 ${cfg.telefono}</li>`,
      cfg.email                && `<li>📧 ${cfg.email}</li>`,
      cfg.direccionConsultorio && `<li>📍 ${cfg.direccionConsultorio}</li>`,
    ].filter(Boolean);
    footerContacto.innerHTML = items.length ? items.join("") : "<li>—</li>";
  }

  renderRedesFooter(cfg);
}

function setTxt(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
}

function obtenerIniciales(nombre) {
  return (nombre || "MC").split(/\s+/).slice(0, 2).map(p => p[0] || "").join("").toUpperCase() || "MC";
}

function renderLogoNav(cfg) {
  const icono = document.getElementById("nav-logo-img");
  if (!icono) return;
  if (cfg.logoUrl) {
    icono.innerHTML = `<img src="${cfg.logoUrl}" alt="${cfg.nombreClinica || 'Logo'}">`;
  } else {
    icono.textContent = obtenerIniciales(cfg.nombreClinica);
  }
}

function renderFotoHero(fotoUrl) {
  const col = document.getElementById("hero-foto-col");
  if (!col) return;
  const url = fotoUrl || "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800&q=80";
  col.innerHTML = `<img src="${url}" alt="Consultorio médico" class="hero-foto-img">`;
}

function renderFotoMedico(fotoUrl, nombre) {
  const wrap = document.getElementById("medico-foto-wrap");
  if (!wrap) return;
  const url = fotoUrl || "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&q=80";
  wrap.innerHTML = `<img src="${url}" alt="${nombre || 'Foto del médico'}" class="medico-foto-img">`;
}

function renderFormacion(formacion) {
  const el = document.getElementById("medico-formacion");
  if (!el || !formacion) return;
  const lineas = formacion.split("\n").filter(l => l.trim());
  if (!lineas.length) return;
  el.innerHTML = lineas.map(l => `
    <div class="formacion-item">
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
      </svg>
      ${l.trim()}
    </div>`).join("");
}

function renderServiciosGrid(serviciosRaw) {
  const grid = document.getElementById("grid-servicios");
  if (!grid) return;

  const iconos = [
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  ];

  const DEFAULTS = [
    { nombre: "Consulta general",        descripcion: "Diagnóstico y tratamiento de enfermedades comunes" },
    { nombre: "Medicina preventiva",      descripcion: "Chequeos y vacunación para mantener tu salud" },
    { nombre: "Urgencias",               descripcion: "Atención inmediata para situaciones de emergencia" },
    { nombre: "Pediatría",               descripcion: "Atención especializada para niños y adolescentes" },
    { nombre: "Seguimiento de crónicos", descripcion: "Control continuo de diabetes, hipertensión y más" },
    { nombre: "Orientación nutricional", descripcion: "Guía personalizada para una alimentación saludable" },
  ];

  let servicios = [];
  if (serviciosRaw && serviciosRaw.trim()) {
    servicios = serviciosRaw.split("\n").filter(l => l.trim()).map(l => {
      const [nombre, descripcion] = l.split("|");
      return { nombre: (nombre || l).trim(), descripcion: (descripcion || "").trim() };
    });
  }
  if (!servicios.length) servicios = DEFAULTS;

  grid.innerHTML = servicios.map((s, i) => `
    <div class="servicio-card" role="listitem">
      <div class="servicio-icono">${iconos[i % iconos.length]}</div>
      <h3 class="servicio-nombre">${s.nombre}</h3>
      ${s.descripcion ? `<p class="servicio-desc">${s.descripcion}</p>` : ""}
    </div>`).join("");
}

function renderRedesFooter(cfg) {
  const container = document.getElementById("footer-redes");
  if (!container) return;
  const links = [];
  if (cfg.facebook) {
    links.push(`<a href="${cfg.facebook}" target="_blank" rel="noopener noreferrer" aria-label="Facebook" class="red-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg></a>`);
  }
  if (cfg.instagram) {
    links.push(`<a href="${cfg.instagram}" target="_blank" rel="noopener noreferrer" aria-label="Instagram" class="red-link">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></a>`);
  }
  if (cfg.whatsapp) {
    links.push(`<a href="https://wa.me/${cfg.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" class="red-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></a>`);
  }
  container.innerHTML = links.join("");
}

/* ─── Opiniones NPS ───────────────────────────────────────────────────── */
/**
 * Testimonios de la landing.
 *
 * Antes esto cruzaba aquí las respuestas de la encuesta con las citas
 * para sacar el nombre del paciente, lo que obligaba a cargar en una
 * página pública el arreglo completo de citas: nombres, teléfonos,
 * correos y notas de todo el mundo, para mostrar un nombre de pila.
 *
 * Ahora lo resuelve la capa de datos y devuelve solo lo publicable. En
 * remoto eso es la vista `testimonios_publicos` (migración 0007); en
 * local, el mismo recorte, para que la página no quede escrita contra un
 * contrato que solo se cumple en uno de los dos modos.
 */
async function cargarOpinionesNPS() {
  const grid = document.getElementById("grid-opiniones");
  if (!grid) return;

  let buenas = [];
  try {
    buenas = await API.publico.testimonios({ minPuntuacion: 8, limite: 3 });
  } catch {
    buenas = [];
  }

  if (!buenas.length) {
    const placeholders = [
      { texto: "Excelente atención, el médico me explicó todo con detalle. Me hizo sentir muy cómoda.", puntuacion: 10, nombre: "María G." },
      { texto: "La mejor consulta que he tenido. Muy profesional y empático. Lo recomiendo ampliamente.", puntuacion: 9,  nombre: "Roberto M." },
      { texto: "Servicio rápido y eficiente. El personal es muy amable y el médico muy dedicado.", puntuacion: 10, nombre: "Ana L." },
    ];
    grid.innerHTML = placeholders.map(p => renderOpinionCard(p.texto, p.puntuacion, p.nombre)).join("");
    return;
  }

  grid.innerHTML = buenas.map(r =>
    renderOpinionCard(
      r.comentario || "Excelente atención médica.",
      r.puntuacion,
      r.nombrePublico || "Paciente"
    )
  ).join("");
}

function renderOpinionCard(comentario, puntuacion, nombre) {
  const estrellas = Math.round(puntuacion / 2);
  const stars = "★".repeat(estrellas) + "☆".repeat(Math.max(0, 5 - estrellas));
  return `
    <div class="opinion-card" role="listitem">
      <div class="opinion-estrellas">${stars}</div>
      <p class="opinion-texto">"${comentario}"</p>
      <div class="opinion-autor">${nombre}</div>
    </div>`;
}

/* ─── Animaciones scroll ──────────────────────────────────────────────── */
function inicializarAnimaciones() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll(".seccion-reveal").forEach(el => observer.observe(el));
}

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
  if (!grid) return;
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

  selectDoc.addEventListener("change", async () => {
    const id = parseInt(selectDoc.value);
    estado.doctorSeleccionado = DOCTORES.find((d) => d.id === id) || null;
    await cargarHorarios(estado.doctorSeleccionado);
  });

  document.getElementById("form-cita").addEventListener("submit", manejarEnvio);

  document.getElementById("fecha").addEventListener("change", async () => {
    if (estado.doctorSeleccionado) await cargarHorarios(estado.doctorSeleccionado);
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

/**
 * Horario de la clínica para toda la ventana de agendamiento.
 *
 * Se pide una sola vez y se guarda: son 60 días de bloques, y volver a
 * preguntarlo cada vez que alguien cambia la fecha sería una petición de
 * red por clic.
 *
 * `null` = todavía no se preguntó. `[]` = se preguntó y no hay horario
 * cargado, que NO es lo mismo que "cerrado": una clínica que nunca
 * configuró sus horas debe seguir recibiendo citas como hasta ahora. Si
 * confundiéramos las dos cosas, el formulario se quedaría sin una sola
 * hora que ofrecer y nadie entendería por qué.
 */
let horarioClinica = null;

async function asegurarHorarioClinica() {
  if (horarioClinica) return horarioClinica;
  try {
    const input = document.getElementById("fecha");
    horarioClinica = await API.publico.horarioDisponible(input.min, input.max);
  } catch (e) {
    /* Si el horario no se puede consultar, el formulario sigue
       funcionando con los horarios del médico. Perder la cita de un
       paciente por esto sería mucho peor que ofrecer una hora de más. */
    console.warn("No se pudo consultar el horario de la clínica:", e);
    horarioClinica = [];
  }
  return horarioClinica;
}

async function cargarHorarios(doctor) {
  const contenedor = document.getElementById("horarios-container");
  const grid = document.getElementById("grid-horarios");
  const aviso = document.getElementById("horarios-cerrado");
  const fecha = document.getElementById("fecha").value;

  if (!doctor || !fecha) {
    limpiarHorarios();
    return;
  }

  const bloques = await asegurarHorarioClinica();

  let horas = doctor.horarios;
  if (bloques.length) {
    const delDia = bloques.filter((b) => b.fecha === fecha);
    horas = horas.filter((h) => delDia.some((b) => h >= b.horaInicio && h < b.horaFin));
  }

  /* Las que ya tienen dueño. Se piden por médico y fecha —no se pueden
     cachear como el horario— porque cambian cada vez que alguien agenda.
     Si la consulta falla, se ofrecen todas: la base rechazará el choque de
     todos modos, y perder la cita de un paciente por un error de red sería
     mucho peor que mandarlo a elegir otra hora. */
  let ocupadas = [];
  try {
    ocupadas = await API.publico.horasOcupadas(doctor.nombre, fecha);
  } catch (e) {
    console.warn("No se pudieron consultar las horas ocupadas:", e);
  }

  contenedor.style.display = "block";

  if (!horas.length) {
    grid.innerHTML = "";
    aviso.textContent = "Ese día el consultorio no atiende. Elige otra fecha, por favor.";
    aviso.hidden = false;
    return;
  }

  const tomada = (h) => ocupadas.includes(h);

  /* Las tomadas se muestran tachadas en vez de esconderse. Un médico con
     dos huecos visibles de nueve deja claro que está lleno; nueve huecos de
     los que solo dos responden al clic parece que la página está rota. */
  const lleno = horas.every(tomada);
  aviso.hidden = !lleno;
  if (lleno) {
    aviso.textContent = "Ese día ya está lleno con este médico. Elige otra fecha, por favor.";
  }

  grid.innerHTML = horas.map((h) => tomada(h)
    ? `<button type="button" class="btn-horario ocupado" data-hora="${h}" disabled
               aria-label="${h}, ya reservada" title="Esta hora ya está reservada">${h}</button>`
    : `<button type="button" class="btn-horario" data-hora="${h}" aria-label="Seleccionar ${h}">${h}</button>`
  ).join("");

  grid.querySelectorAll(".btn-horario:not([disabled])").forEach((btn) => {
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
  const aviso = document.getElementById("horarios-cerrado");
  if (aviso) aviso.hidden = true;
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

  /* El botón se guarda en una variable en vez de leerlo del evento.
     `e.currentTarget` solo es válido mientras el evento se está
     despachando: en cuanto el manejador cede el control en el primer
     `await`, el navegador lo pone en null. Leerlo después reventaba en el
     `finally` y, como esa línea es la que vuelve a habilitar el botón,
     quedaba deshabilitado para siempre — el paciente podía agendar una
     cita y ninguna más hasta recargar la página. */
  const btnConfirmar = document.getElementById("btn-confirmar");
  btnConfirmar.onclick = async () => {
    /* Contra el backend esto tarda. Sin bloquear el botón, dos clics
       nerviosos son dos citas para el mismo paciente a la misma hora. */
    btnConfirmar.disabled = true;
    try {
      await finalizarCita(datos);
    } finally {
      btnConfirmar.disabled = false;
    }
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

async function finalizarCita(datos) {
  cerrarModal();

  let folio;
  try {
    folio = await API.publico.solicitarCita(datos);
  } catch (e) {
    /* Contra el backend esto falla de verdad: sin red, o porque el freno
       de abuso topó (5 solicitudes por teléfono cada 24 h). Enseñarle un
       folio a alguien cuya cita no se guardó es la peor salida posible:
       se presentaría al consultorio con un número que no existe. */

    /* El hueco se ocupó entre que se pintó el formulario y que le dio
       Confirmar: alguien más agendó esa hora en el intervalo. No basta con
       avisar —hay que volver a pintar las horas—, si no el paciente ve la
       misma hora disponible, vuelve a intentar y falla otra vez. */
    if (/hora ya está ocupada|hora se acaba de ocupar/i.test(e.message)) {
      mostrarAlerta("Alguien acaba de tomar esa hora. Elige otra, por favor.", "error");
      await cargarHorarios(estado.doctorSeleccionado);
      return;
    }

    mostrarAlerta(
      /demasiadas solicitudes/i.test(e.message)
        ? "Ya se registraron varias solicitudes con este teléfono hoy. Llámanos y te agendamos de inmediato."
        : "No pudimos registrar tu solicitud. Revisa tu conexión e inténtalo de nuevo.",
      "error"
    );
    return;
  }

  mostrarExito(folio, datos);
  document.getElementById("form-cita").reset();
  limpiarHorarios();
  document.querySelectorAll(".card-especialidad").forEach((c) => c.classList.remove("seleccionada"));
  estado.especialidadSeleccionada = null;
  estado.doctorSeleccionado = null;
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

/* ─── Alertas ─────────────────────────────────────────────────────────── */
function mostrarAlerta(mensaje, tipo = "info") {
  const alerta = document.getElementById("alerta-form");
  alerta.textContent = mensaje;
  alerta.className = `alerta alerta-${tipo}`;
  alerta.style.display = "block";
  setTimeout(() => { alerta.style.display = "none"; }, 5000);
}

/* ═══════════════════════════════════════════════════════════════════════
   "Mis citas" — el paciente consulta y cancela lo suyo

   La credencial son DOS factores: folio y teléfono. El folio viaja en cada
   correo, así que quien intercepte uno lo tiene; el teléfono lo sabe
   cualquiera que conozca al paciente. Juntos, quien cancela es quien
   recibió el correo Y sabe con qué número se agendó.

   La capa de datos devuelve `{ok:false, error}` en vez de lanzar. No es
   estilo: el freno de abuso registra los intentos fallidos, y en Postgres
   una excepción desharía ese registro en la misma transacción.
   ═══════════════════════════════════════════════════════════════════════ */

function inicializarMisCitas() {
  const form = document.getElementById("form-mis-citas");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await consultarMisCitas();
  });

  /* El folio suele venir pegado del correo, a veces con espacios. Se limpia
     al salir del campo en vez de rechazarlo: no es culpa de nadie. */
  const folio = document.getElementById("mc-folio");
  folio.addEventListener("blur", () => { folio.value = folio.value.trim(); });

  /* Si llegó desde el correo con el folio en la URL, se precarga y se le
     lleva a la sección. Solo falta el teléfono. */
  const enURL = new URLSearchParams(location.search).get("folio");
  if (enURL) {
    folio.value = enURL.trim();
    document.getElementById("mis-citas")?.scrollIntoView({ behavior: "smooth" });
    document.getElementById("mc-telefono")?.focus();
  }
}

function mcError(mensaje) {
  const el = document.getElementById("mc-error");
  el.textContent = mensaje || "";
  el.hidden = !mensaje;
  if (mensaje) document.getElementById("mc-resultado").hidden = true;
}

async function consultarMisCitas() {
  const btn = document.getElementById("btn-mis-citas");
  const folio = document.getElementById("mc-folio").value.trim();
  const telefono = document.getElementById("mc-telefono").value.trim();

  if (!folio || !telefono) {
    mcError("Necesitamos el folio y el teléfono con el que agendaste.");
    return;
  }

  /* El botón se captura ANTES del await. Después, `e.currentTarget` ya es
     null — ese descuido dejó una vez el botón de Confirmar deshabilitado
     para siempre, y el paciente solo podía agendar una cita por carga. */
  const etiqueta = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  mcError("");

  let r;
  try {
    r = await API.publico.misCitas(folio, telefono);
  } catch (err) {
    console.warn("Mis citas:", err);
    r = { ok: false, error: "No pudimos consultar ahora. Revisa tu conexión." };
  } finally {
    btn.disabled = false;
    btn.textContent = etiqueta;
  }

  if (!r.ok) { mcError(r.error); return; }

  estado.misCitas = { folio, telefono };
  renderMisCitas(r);
}

function renderMisCitas(r) {
  const caja = document.getElementById("mc-resultado");
  const lista = document.getElementById("mc-lista");

  document.getElementById("mc-saludo").textContent = r.nombre
    ? `${r.nombre}, esto es lo que tenemos registrado:`
    : "Esto es lo que tenemos registrado:";

  if (!r.citas.length) {
    lista.innerHTML = `<p class="mc-vacio">No tienes citas próximas.</p>`;
    caja.hidden = false;
    return;
  }

  lista.innerHTML = r.citas.map((c) => `
    <div class="mc-cita mc-estado-${escaparHtml(c.estado)}" role="listitem">
      <div class="mc-cita-datos">
        <div class="mc-cita-fecha">${escaparHtml(fechaLargaMC(c.fecha))}${c.hora ? ` · ${escaparHtml(c.hora)}` : ""}</div>
        <div class="mc-cita-med">${escaparHtml(c.doctor || "")}${c.especialidad ? ` · ${escaparHtml(c.especialidad)}` : ""}</div>
        <div class="mc-cita-pie">
          <span class="mc-chip mc-chip-${escaparHtml(c.estado)}">${escaparHtml(etiquetaEstadoMC(c.estado))}</span>
          <span class="mc-folio">${escaparHtml(c.folio)}</span>
        </div>
      </div>
      ${c.cancelable
        ? `<button type="button" class="mc-btn-cancelar" data-folio="${escaparHtml(c.folio)}">Cancelar</button>`
        : ""}
    </div>`).join("");

  lista.querySelectorAll(".mc-btn-cancelar").forEach((b) => {
    b.addEventListener("click", () => cancelarMiCita(b.dataset.folio, b));
  });

  caja.hidden = false;
}

async function cancelarMiCita(folio, boton) {
  /* Se pregunta antes: es irreversible desde aquí —volver a agendar es otro
     trámite— y el hueco se le puede dar a alguien más en minutos. */
  if (!confirm("¿Seguro que quieres cancelar esta cita?\n\nSi luego la necesitas, tendrás que agendar de nuevo.")) {
    return;
  }

  const motivo = (prompt("¿Nos dices por qué? (opcional)") || "").trim();

  const etiqueta = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Cancelando…";
  mcError("");

  let r;
  try {
    r = await API.publico.cancelarMiCita(folio, estado.misCitas.telefono, motivo);
  } catch (err) {
    console.warn("Cancelar mi cita:", err);
    r = { ok: false, error: "No pudimos cancelar ahora. Revisa tu conexión." };
  } finally {
    boton.disabled = false;
    boton.textContent = etiqueta;
  }

  if (!r.ok) { mcError(r.error); return; }

  mostrarAlerta("Tu cita quedó cancelada. Gracias por avisarnos.", "exito");

  /* Se vuelve a consultar en vez de tachar la fila a mano: así lo que se ve
     es lo que la clínica tiene, no lo que este navegador cree. */
  const vuelta = await API.publico.misCitas(estado.misCitas.folio, estado.misCitas.telefono);
  if (vuelta.ok) renderMisCitas(vuelta);
}

const ETIQUETAS_MC = {
  pendiente: "Por confirmar",
  confirmada: "Confirmada",
  atendida: "Atendida",
  cancelada: "Cancelada",
};
const etiquetaEstadoMC = (e) => ETIQUETAS_MC[e] || e;

/** "2026-08-04" → "martes 4 de agosto". Con hora explícita: sin ella se
    interpreta como UTC y en México cae un día antes. */
function fechaLargaMC(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function escaparHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
