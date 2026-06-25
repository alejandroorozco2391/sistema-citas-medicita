/* ─── Constantes ──────────────────────────────────────────────────────── */
const API_URL_MD = "/api/chat";
const MODELO_MD  = "claude-sonnet-4-6";
const LIMITE_HISTORIAL_MD = 100;

const TIPOS_DOC_MD = [
  {
    id: "soap", label: "Nota de consulta", icono: "📋", subtitulo: "Formato SOAP",
    campos: [
      { id: "motivo",    label: "Motivo de consulta",            tipo: "textarea", placeholder: "Dolor de cabeza, fiebre, mareos…",                              required: true  },
      { id: "subjetivo", label: "Subjetivo — síntomas referidos", tipo: "textarea", placeholder: "El paciente refiere haber iniciado con…"                                      },
      { id: "objetivo",  label: "Objetivo — exploración física",  tipo: "textarea", placeholder: "TA: 120/80 mmHg. Temp: 36.5°C. FC: 72 lpm…"                                   },
      { id: "analisis",  label: "Análisis / Diagnóstico",         tipo: "input",    placeholder: "Diagnóstico presuntivo o definitivo",                          required: true  },
      { id: "plan",      label: "Plan de tratamiento",            tipo: "textarea", placeholder: "Medicamentos, estudios indicados, indicaciones generales…",     required: true  },
    ],
  },
  {
    id: "receta", label: "Receta médica", icono: "💊", subtitulo: "Con membrete",
    campos: [
      { id: "diagnostico",   label: "Diagnóstico",              tipo: "input",    placeholder: "Diagnóstico del paciente",                                       required: true  },
      { id: "medicamentos",  label: "Medicamentos y dosis",     tipo: "textarea", placeholder: "1. Paracetamol 500mg — 1 tab c/8h por 5 días\n2. …",            required: true  },
      { id: "instrucciones", label: "Instrucciones generales",  tipo: "textarea", placeholder: "Tomar con alimentos, hidratación, reposo relativo…"                              },
      { id: "observaciones", label: "Observaciones (opcional)", tipo: "textarea", placeholder: "Cita de seguimiento en 7 días si los síntomas persisten…"                       },
    ],
  },
  {
    id: "referencia", label: "Carta de referencia", icono: "📨", subtitulo: "A especialista",
    campos: [
      { id: "especialidad_destino", label: "Especialidad destino",          tipo: "input",    placeholder: "Cardiología, Neurología, Ortopedia…",    required: true },
      { id: "medico_destino",       label: "Médico destinatario (opcional)", tipo: "input",    placeholder: "Dr. Nombre Apellido"                                  },
      { id: "motivo",               label: "Motivo de referencia",           tipo: "textarea", placeholder: "Se envía a valoración por cuadro de…", required: true },
      { id: "hallazgos",            label: "Hallazgos relevantes",           tipo: "textarea", placeholder: "Signos vitales, estudios previos, antecedentes…"     },
      { id: "solicitud",            label: "Solicitud específica",           tipo: "textarea", placeholder: "Se solicita valoración integral…",      required: true },
    ],
  },
  {
    id: "constancia_atencion", label: "Constancia de atención", icono: "📄", subtitulo: "Constancia médica",
    campos: [
      { id: "diagnostico",   label: "Diagnóstico / Motivo de atención", tipo: "input",    placeholder: "Diagnóstico o causa de consulta",          required: true },
      { id: "tipo_atencion", label: "Tipo de atención recibida",        tipo: "input",    placeholder: "Primera vez, urgencia, seguimiento…"                      },
      { id: "observaciones", label: "Indicaciones / Observaciones",     tipo: "textarea", placeholder: "El paciente debe guardar reposo, próxima cita el…"        },
    ],
  },
  {
    id: "incapacidad", label: "Constancia de incapacidad", icono: "🏥", subtitulo: "Incapacidad temporal",
    campos: [
      { id: "diagnostico",  label: "Diagnóstico",              tipo: "input",    placeholder: "Diagnóstico que justifica la incapacidad", required: true },
      { id: "dias",         label: "Días de incapacidad",      tipo: "input",    placeholder: "3, 5, 7…",                                required: true },
      { id: "fecha_inicio", label: "Fecha de inicio",          tipo: "date",                                                            required: true },
      { id: "fecha_fin",    label: "Fecha de fin",             tipo: "date",                                                            required: true },
      { id: "indicaciones", label: "Indicaciones de reposo",   tipo: "textarea", placeholder: "Reposo en cama, evitar actividad física…"               },
    ],
  },
  {
    id: "consentimiento", label: "Consentimiento informado", icono: "✍️", subtitulo: "Genérico",
    campos: [
      { id: "procedimiento", label: "Procedimiento / Tratamiento",        tipo: "input",    placeholder: "Nombre del procedimiento",                      required: true },
      { id: "descripcion",   label: "Descripción del procedimiento",       tipo: "textarea", placeholder: "En qué consiste, cómo se realiza, duración…",  required: true },
      { id: "riesgos",       label: "Riesgos y posibles complicaciones",   tipo: "textarea", placeholder: "Posibles efectos adversos, complicaciones…",    required: true },
      { id: "beneficios",    label: "Beneficios esperados",               tipo: "textarea", placeholder: "Resultado esperado, mejoría anticipada…"                        },
      { id: "alternativas",  label: "Alternativas de tratamiento",        tipo: "textarea", placeholder: "Otras opciones disponibles y por qué no…"                       },
    ],
  },
];

/* ─── Íconos SVG inline ───────────────────────────────────────────────── */
const SVG_PERSON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const SVG_PIN    = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const SVG_PHONE  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-5.99-5.99 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.8 2.48h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const SVG_HOUSE  = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

const ONDA_SVG = [
  '<svg viewBox="0 0 680 60" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;" preserveAspectRatio="none">',
  '<path d="M0,40 C120,10 240,60 360,30 C480,0 600,50 680,25 L680,60 L0,60 Z" fill="#1a56a0" opacity="0.15"/>',
  '<path d="M0,48 C100,20 220,55 360,38 C500,20 600,52 680,35 L680,60 L0,60 Z" fill="#1a56a0" opacity="0.5"/>',
  '<path d="M0,54 C150,38 280,58 400,50 C520,42 620,56 680,48 L680,60 L0,60 Z" fill="#1a56a0"/>',
  '</svg>',
].join('');

const TITULO_TIPOS_MD = {
  soap:                "Nota de Consulta (SOAP)",
  receta:              "Prescripción / Rx",
  referencia:          "Carta de Referencia",
  constancia_atencion: "Constancia de Atención",
  incapacidad:         "Incapacidad Temporal",
  consentimiento:      "Consentimiento Informado",
};

/* ─── Estado ──────────────────────────────────────────────────────────── */
const estadoMD = {
  tipoDoc: "",
  citaSeleccionada: null,
  docGenerado: null,
  generando: false,
};

let ejsServiceIdMD  = "";
let ejsTemplateIdMD = "";
let ejsPublicKeyMD  = "";

/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  poblarDatalistFolios();
  bindSelectorTipos();
  bindFolioInput();
  bindBtnGenerar();
  bindBtnImprimir();
  bindBtnEmail();
  bindEmailConfigModal();
  document.getElementById("md-historial-lista").addEventListener("click", manejarClicHistorial);
  renderHistorial();

  const folio = new URLSearchParams(window.location.search).get("folio");
  if (folio) {
    document.getElementById("input-folio").value = folio;
    seleccionarCita(folio.toUpperCase());
  }
});

/* ─── Datos ───────────────────────────────────────────────────────────── */
function leerCitas() {
  return JSON.parse(localStorage.getItem("medicita_citas") || "[]");
}

function leerConfigClinica() {
  return JSON.parse(localStorage.getItem("medicita_config_clinica") || "{}");
}

function poblarDatalistFolios() {
  const dl = document.getElementById("lista-folios");
  dl.innerHTML = leerCitas().map(function (c) {
    return `<option value="${escaparHtmlMD(c.folio)}">${escaparHtmlMD(c.folio)} — ${escaparHtmlMD(c.nombre)} ${escaparHtmlMD(c.apellidos)}</option>`;
  }).join("");
}

/* ─── Selector de tipo de documento ──────────────────────────────────── */
function bindSelectorTipos() {
  document.getElementById("selector-tipo-doc").addEventListener("click", function (e) {
    const btn = e.target.closest(".tipo-doc-btn");
    if (!btn) return;
    document.querySelectorAll(".tipo-doc-btn").forEach(function (b) { b.classList.remove("activo"); });
    btn.classList.add("activo");
    estadoMD.tipoDoc = btn.dataset.tipo;
    renderCamposDinamicos(estadoMD.tipoDoc);
    mostrarErrorMD("");
  });
}

function renderCamposDinamicos(tipoId) {
  const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === tipoId; });
  const contenedor = document.getElementById("campos-dinamicos");
  if (!tipo) { contenedor.innerHTML = ""; return; }

  contenedor.innerHTML = tipo.campos.map(function (campo) {
    const req = campo.required ? '<span class="req-mark">*</span>' : "";
    const labelHtml = `<label for="campo-${escaparHtmlMD(campo.id)}">${escaparHtmlMD(campo.label)}${req}</label>`;

    if (campo.tipo === "textarea") {
      return `<div class="form-grupo-md">${labelHtml}
        <textarea id="campo-${escaparHtmlMD(campo.id)}" class="campo-doc" rows="3"
          placeholder="${escaparHtmlMD(campo.placeholder || "")}"
          data-campo="${escaparHtmlMD(campo.id)}"></textarea></div>`;
    }
    if (campo.tipo === "date") {
      return `<div class="form-grupo-md">${labelHtml}
        <input type="date" id="campo-${escaparHtmlMD(campo.id)}" class="campo-doc input-md"
          data-campo="${escaparHtmlMD(campo.id)}"></div>`;
    }
    return `<div class="form-grupo-md">${labelHtml}
      <input type="text" id="campo-${escaparHtmlMD(campo.id)}" class="campo-doc input-md"
        placeholder="${escaparHtmlMD(campo.placeholder || "")}"
        data-campo="${escaparHtmlMD(campo.id)}"></div>`;
  }).join("");
}

function leerInputsCampos() {
  const inputs = {};
  document.querySelectorAll(".campo-doc").forEach(function (el) {
    inputs[el.dataset.campo] = el.value.trim();
  });
  return inputs;
}

/* ─── Búsqueda de cita por folio ──────────────────────────────────────── */
function bindFolioInput() {
  document.getElementById("input-folio").addEventListener("change", function () {
    const folio = this.value.trim().toUpperCase();
    if (folio) seleccionarCita(folio);
  });
  document.getElementById("btn-buscar-folio").addEventListener("click", function () {
    const folio = document.getElementById("input-folio").value.trim().toUpperCase();
    if (folio) seleccionarCita(folio);
    else mostrarErrorMD("Ingresa el folio de la cita.");
  });
}

function seleccionarCita(folio) {
  const cita = leerCitas().find(function (c) { return c.folio === folio; });
  const infoEl = document.getElementById("cita-info");

  if (!cita) {
    infoEl.innerHTML = `<p class="cita-no-encontrada">No se encontró la cita ${escaparHtmlMD(folio)}.</p>`;
    infoEl.classList.remove("oculto");
    estadoMD.citaSeleccionada = null;
    return;
  }

  estadoMD.citaSeleccionada = cita;
  const fechaFmt = cita.fecha
    ? new Date(cita.fecha + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "—";

  infoEl.innerHTML = `<div class="cita-chip">
    <span class="cita-chip-folio">${escaparHtmlMD(cita.folio)}</span>
    <span class="cita-chip-paciente">${escaparHtmlMD(cita.nombre)} ${escaparHtmlMD(cita.apellidos)}</span>
    <span class="cita-chip-detalle">${escaparHtmlMD(cita.doctor)} · ${fechaFmt}</span>
  </div>`;
  infoEl.classList.remove("oculto");
}

/* ─── Generación del documento ────────────────────────────────────────── */
function bindBtnGenerar() {
  document.getElementById("btn-generar-doc").addEventListener("click", generarDocumento);
}

function validarFormularioMD() {
  if (!estadoMD.tipoDoc) return { ok: false, mensaje: "Selecciona el tipo de documento." };
  if (!estadoMD.citaSeleccionada) return { ok: false, mensaje: "Busca y selecciona una cita antes de generar." };
  const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === estadoMD.tipoDoc; });
  const inputs = leerInputsCampos();
  const faltante = tipo.campos.find(function (c) { return c.required && !inputs[c.id]; });
  if (faltante) return { ok: false, mensaje: `Completa el campo: ${faltante.label}` };
  return { ok: true };
}

async function generarDocumento() {
  if (estadoMD.generando) return;
  const validacion = validarFormularioMD();
  if (!validacion.ok) { mostrarErrorMD(validacion.mensaje); return; }
  mostrarErrorMD("");

  estadoMD.generando = true;
  setBtnGenerarEstado(true);
  mostrarPreviewCargando();

  try {
    const inputs = leerInputsCampos();
    const htmlDoc = await llamarClaudeMD(inputs);
    estadoMD.docGenerado = htmlDoc;
    const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === estadoMD.tipoDoc; });
    renderPreview(htmlDoc, tipo, inputs);
    habilitarAccionesDoc(true);
    guardarEnHistorial(estadoMD.tipoDoc, estadoMD.citaSeleccionada.folio, inputs);
    renderHistorial();
    mostrarToastMD("Documento generado correctamente.", "ok");
  } catch (err) {
    document.getElementById("preview-vacio").classList.remove("oculto");
    document.getElementById("preview-cargando").classList.add("oculto");
    document.getElementById("preview-doc").classList.add("oculto");
    mostrarErrorMD("No se pudo generar: " + err.message);
  } finally {
    estadoMD.generando = false;
    setBtnGenerarEstado(false);
  }
}

function setBtnGenerarEstado(activo) {
  const btn = document.getElementById("btn-generar-doc");
  btn.disabled = activo;
  btn.textContent = activo ? "Generando…" : "✨ Generar documento";
}

/* ─── Prompts ─────────────────────────────────────────────────────────── */
function buildSystemPromptMD() {
  return `Eres un experto en documentación clínica médica en México. Redactas documentos médicos formales, completos y con lenguaje profesional apropiado para cada tipo de documento.

Responde ÚNICAMENTE con el contenido HTML del cuerpo clínico del documento. El membrete (datos del médico, clínica, paciente) y el bloque de firma ya están pre-generados por el sistema — NO los incluyas.

No incluyas <!DOCTYPE>, <html>, <head>, <body>, <style> ni <script>. Solo usa etiquetas HTML semánticas simples: <h3>, <h4>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <hr>, <br>.

Usa exactamente los datos proporcionados sin inventar información clínica. Redacta en español de México.`;
}

function buildUserPromptMD(inputs) {
  const cita = estadoMD.citaSeleccionada;
  const cfg  = leerConfigClinica();
  const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === estadoMD.tipoDoc; });

  const fechaFmt = cita.fecha
    ? new Date(cita.fecha + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : cita.fecha || "No especificada";

  const clinicaInfo = [
    "Clínica: " + (cfg.nombreClinica || "MediCita"),
    cfg.nombreMedico          ? "Médico: "        + cfg.nombreMedico          : "",
    cfg.especialidadPrincipal ? "Especialidad: "  + cfg.especialidadPrincipal : "",
    cfg.ciudad                ? "Ciudad: "        + cfg.ciudad                : "",
    cfg.telefono              ? "Teléfono: "      + cfg.telefono              : "",
    cfg.email                 ? "Email: "         + cfg.email                 : "",
  ].filter(Boolean).join("\n");

  const camposTexto = tipo.campos.map(function (c) {
    return c.label + ": " + (inputs[c.id] || "(no especificado)");
  }).join("\n");

  return `Genera un(a) ${tipo.label} con los siguientes datos:

DATOS DE LA CLÍNICA:
${clinicaInfo}

DATOS DEL PACIENTE:
Nombre: ${cita.nombre} ${cita.apellidos}
Folio: ${cita.folio}
Fecha de atención: ${fechaFmt}
Hora: ${cita.hora || "No especificada"}
Tipo de consulta: ${cita.tipo || "Consulta"}
Especialidad: ${cita.especialidad || "No especificada"}
Médico tratante: ${cita.doctor || cfg.nombreMedico || "No especificado"}

DATOS ESPECÍFICOS DEL DOCUMENTO:
${camposTexto}

Genera el documento completo y profesional.`;
}

async function llamarClaudeMD(inputs) {
  const resp = await fetch(API_URL_MD, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_MD,
      max_tokens: 1500,
      system: buildSystemPromptMD(),
      messages: [{ role: "user", content: buildUserPromptMD(inputs) }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(function () { return {}; });
    throw new Error(err.error?.message || "HTTP " + resp.status);
  }

  const data = await resp.json();
  return data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n\n");
}

/* ─── Render preview ──────────────────────────────────────────────────── */
function mostrarPreviewCargando() {
  document.getElementById("preview-vacio").classList.add("oculto");
  document.getElementById("preview-cargando").classList.remove("oculto");
  document.getElementById("preview-doc").classList.add("oculto");
}

function renderPreview(htmlDoc, tipo, inputs) {
  const cfg  = leerConfigClinica();
  const cita = estadoMD.citaSeleccionada;
  const pac  = obtenerPacienteByCita(cita.folio);
  const esc  = escaparHtmlMD;

  const fechaFmt = cita.fecha
    ? new Date(cita.fecha + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
    : "—";

  const edad     = pac ? calcularEdad(pac.fechaNacimiento) : "—";
  const peso     = (pac && pac.peso)     ? esc(pac.peso)     + " kg"  : "—";
  const estatura = (pac && pac.estatura) ? esc(pac.estatura) + " cm"  : "—";
  const diagBanda = inputs
    ? esc(inputs.diagnostico || inputs.analisis || inputs.motivo || inputs.procedimiento || "—")
    : "—";
  const tituloClin = TITULO_TIPOS_MD[estadoMD.tipoDoc] || tipo.label;

  const sublinea = [
    cfg.especialidadPrincipal,
    cfg.cedulaProfesional ? "Cédula Prof. " + cfg.cedulaProfesional : "",
  ].filter(Boolean).join(" · ");

  const firmaSublinea = [
    cfg.especialidadPrincipal,
    cfg.cedulaProfesional ? "Ced. " + cfg.cedulaProfesional : "",
  ].filter(Boolean).join(" · ");

  const logoHtml = cfg.logoUrl
    ? `<img src="${esc(cfg.logoUrl)}" alt="Logo" class="mbr-logo-img" onerror="this.style.display='none'">`
    : `<div class="mbr-logo-fallback">${SVG_HOUSE}</div>`;

  const membreteHTML = [
    '<div class="mbr-header">',
    '  <div class="mbr-header-izq">',
    '    <div class="mbr-avatar">' + SVG_PERSON + '</div>',
    '    <div class="mbr-medico-info">',
    '      <div class="mbr-medico-nombre">' + esc(cfg.nombreMedico || "Médico tratante") + '</div>',
    sublinea ? '      <div class="mbr-medico-sub">' + esc(sublinea) + '</div>' : '',
    cfg.direccionConsultorio ? '      <div class="mbr-medico-dir">' + SVG_PIN + ' ' + esc(cfg.direccionConsultorio) + '</div>' : '',
    (cfg.telefono || cfg.email) ? '      <div class="mbr-medico-contacto">' + SVG_PHONE + ' ' + [cfg.telefono, cfg.email].filter(Boolean).map(esc).join(' · ') + '</div>' : '',
    '    </div>',
    '  </div>',
    '  <div class="mbr-header-der">',
    '    ' + logoHtml,
    '    <div class="mbr-clinica-nombre">' + esc(cfg.nombreClinica || "MediCita") + '</div>',
    '  </div>',
    '</div>',
    '<div class="mbr-sep"></div>',
    '<div class="mbr-banda-pac">',
    '  <div class="mbr-pac-fila mbr-pac-fila--2-1-1">',
    '    <div class="mbr-campo"><span class="mbr-campo-label">PACIENTE</span><span class="mbr-campo-valor">' + esc(cita.nombre + " " + cita.apellidos) + '</span></div>',
    '    <div class="mbr-campo"><span class="mbr-campo-label">EDAD</span><span class="mbr-campo-valor">' + edad + '</span></div>',
    '    <div class="mbr-campo"><span class="mbr-campo-label">FECHA</span><span class="mbr-campo-valor">' + esc(fechaFmt) + '</span></div>',
    '  </div>',
    '  <div class="mbr-pac-fila mbr-pac-fila--1-1-2">',
    '    <div class="mbr-campo"><span class="mbr-campo-label">PESO</span><span class="mbr-campo-valor">' + peso + '</span></div>',
    '    <div class="mbr-campo"><span class="mbr-campo-label">ESTATURA</span><span class="mbr-campo-valor">' + estatura + '</span></div>',
    '    <div class="mbr-campo"><span class="mbr-campo-label">DIAGNÓSTICO / OBSERVACIONES</span><span class="mbr-campo-valor">' + diagBanda + '</span></div>',
    '  </div>',
    '</div>',
    '<div class="mbr-contenido">',
    '  <div class="mbr-doc-titulo-wrap">',
    '    <span class="mbr-doc-titulo-acento"></span>',
    '    <span class="mbr-doc-titulo-txt">' + esc(tituloClin.toUpperCase()) + '</span>',
    '  </div>',
    '  <div class="mbr-doc-cuerpo" id="md-cuerpo-doc"></div>',
    '</div>',
    '<div class="mbr-footer">',
    '  <div class="mbr-onda">' + ONDA_SVG + '</div>',
    '  <div class="mbr-footer-banda">',
    '    <div class="mbr-footer-col">',
    '      <span class="mbr-footer-label">Horarios</span>',
    '      <span class="mbr-footer-val">' + esc(cfg.horarioAtencion || "—") + '</span>',
    '    </div>',
    '    <div class="mbr-footer-col">',
    '      <span class="mbr-footer-label">Consultorio</span>',
    '      <span class="mbr-footer-val">' + esc(cfg.direccionConsultorio || "—") + '</span>',
    '    </div>',
    '    <div class="mbr-footer-col">',
    '      <span class="mbr-footer-label">Contacto</span>',
    cfg.telefono ? '      <span class="mbr-footer-val">' + esc(cfg.telefono) + '</span>' : '',
    cfg.email    ? '      <span class="mbr-footer-val">' + esc(cfg.email)    + '</span>' : '',
    (!cfg.telefono && !cfg.email) ? '      <span class="mbr-footer-val">—</span>' : '',
    '    </div>',
    '    <div class="mbr-footer-col mbr-footer-firma">',
    '      <div class="mbr-firma-linea"></div>',
    '      <span class="mbr-footer-val">' + esc(cfg.nombreMedico || "Médico tratante") + '</span>',
    firmaSublinea ? '      <span class="mbr-footer-val-sub">' + esc(firmaSublinea) + '</span>' : '',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');

  document.getElementById("md-membrete-completo").innerHTML = membreteHTML;
  document.getElementById("md-cuerpo-doc").innerHTML = sanitizarHtmlDoc(htmlDoc);

  document.getElementById("preview-vacio").classList.add("oculto");
  document.getElementById("preview-cargando").classList.add("oculto");
  document.getElementById("preview-doc").classList.remove("oculto");
}

/* ─── Sanitizar HTML de Claude ────────────────────────────────────────── */
function sanitizarHtmlDoc(html) {
  const TAGS = new Set([
    "p", "br", "hr", "h3", "h4", "h5", "strong", "em", "b", "i",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
    "div", "span", "blockquote",
  ]);
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    function limpiar(node) {
      if (node.nodeType === Node.TEXT_NODE) return true;
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (!TAGS.has(node.tagName.toLowerCase())) return false;
      Array.from(node.attributes).forEach(function (a) {
        if (a.name.startsWith("on") || a.name === "href" || a.name === "src") {
          node.removeAttribute(a.name);
        }
      });
      Array.from(node.childNodes).forEach(function (child) {
        if (!limpiar(child)) node.removeChild(child);
      });
      return true;
    }

    Array.from(doc.body.childNodes).forEach(function (child) {
      if (!limpiar(child)) doc.body.removeChild(child);
    });

    return doc.body.innerHTML;
  } catch (_) {
    return escaparHtmlMD(html);
  }
}

/* ─── Imprimir ────────────────────────────────────────────────────────── */
function bindBtnImprimir() {
  document.getElementById("btn-imprimir").addEventListener("click", function () {
    if (!estadoMD.docGenerado) return;
    window.print();
  });
}

/* ─── Enviar por email ────────────────────────────────────────────────── */
function bindBtnEmail() {
  document.getElementById("btn-enviar-email").addEventListener("click", async function () {
    if (!estadoMD.docGenerado || !estadoMD.citaSeleccionada) return;
    const cita = estadoMD.citaSeleccionada;

    if (!cita.email) {
      mostrarToastMD("Este paciente no tiene email registrado.", "error");
      return;
    }
    if (!ejsPublicKeyMD || !ejsServiceIdMD || !ejsTemplateIdMD) {
      mostrarToastMD("Configura EmailJS con el botón ⚙️ antes de enviar.", "error");
      return;
    }

    const btn = document.getElementById("btn-enviar-email");
    btn.disabled = true;
    btn.textContent = "Enviando…";

    try {
      const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === estadoMD.tipoDoc; });
      await emailjs.send(ejsServiceIdMD, ejsTemplateIdMD, {
        to_email:   cita.email,
        to_name:    cita.nombre + " " + cita.apellidos,
        asunto:     "Documento clínico: " + tipo.label + " — " + cita.folio,
        html_email: buildEmailDocHTML(tipo),
      });
      mostrarToastMD("✉️ Documento enviado a " + cita.email, "ok");
    } catch (err) {
      mostrarToastMD("Error al enviar: " + (err?.text || "Error desconocido"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "✉️ Enviar por email";
    }
  });
}

function buildEmailDocHTML(tipo) {
  const cfg  = leerConfigClinica();
  const cita = estadoMD.citaSeleccionada;
  const esc  = function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:700px;margin:0 auto;padding:24px;color:#1e293b">
    <div style="border-bottom:2px solid #1a6eb5;padding-bottom:16px;margin-bottom:20px">
      <h2 style="margin:0;color:#1a6eb5;font-size:20px">${esc(cfg.nombreClinica || "MediCita")}</h2>
      ${cfg.nombreMedico ? `<p style="margin:4px 0;color:#334155;font-size:14px">${esc(cfg.nombreMedico)}${cfg.especialidadPrincipal ? " — " + esc(cfg.especialidadPrincipal) : ""}</p>` : ""}
      <p style="margin:4px 0;color:#64748b;font-size:13px">${[cfg.ciudad, cfg.telefono, cfg.email].filter(Boolean).map(esc).join(" · ")}</p>
    </div>
    <h3 style="color:#0f172a;font-size:16px;text-transform:uppercase;letter-spacing:.03em">${esc(tipo.label)}</h3>
    <p style="font-size:13px;color:#64748b">Folio: <strong>${esc(cita.folio)}</strong> &nbsp;·&nbsp; Paciente: <strong>${esc(cita.nombre)} ${esc(cita.apellidos)}</strong></p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
    ${estadoMD.docGenerado}
  </body></html>`;
}

/* ─── EmailJS config modal ────────────────────────────────────────────── */
function bindEmailConfigModal() {
  const modal = document.getElementById("modal-email-config");

  document.getElementById("btn-config-email").addEventListener("click", function () {
    document.getElementById("md-ejs-service").value  = ejsServiceIdMD;
    document.getElementById("md-ejs-template").value = ejsTemplateIdMD;
    document.getElementById("md-ejs-key").value      = ejsPublicKeyMD;
    modal.classList.remove("oculto");
    document.body.style.overflow = "hidden";
  });

  function cerrarModal() {
    modal.classList.add("oculto");
    document.body.style.overflow = "";
  }

  document.getElementById("btn-cancelar-email").addEventListener("click", cerrarModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) cerrarModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.classList.contains("oculto")) cerrarModal();
  });

  document.getElementById("btn-guardar-email").addEventListener("click", function () {
    ejsServiceIdMD  = document.getElementById("md-ejs-service").value.trim();
    ejsTemplateIdMD = document.getElementById("md-ejs-template").value.trim();
    ejsPublicKeyMD  = document.getElementById("md-ejs-key").value.trim();
    if (ejsPublicKeyMD) emailjs.init({ publicKey: ejsPublicKeyMD });
    cerrarModal();
    mostrarToastMD("Configuración EmailJS guardada para esta sesión.", "ok");
  });
}

function habilitarAccionesDoc(habilitar) {
  document.getElementById("btn-imprimir").disabled    = !habilitar;
  document.getElementById("btn-enviar-email").disabled = !habilitar;
}

/* ─── localStorage: historial ─────────────────────────────────────────── */
function leerHistorial() {
  return JSON.parse(localStorage.getItem("medicita_docs") || "[]");
}

function guardarEnHistorial(tipoId, folio, inputs) {
  const docId = Date.now().toString();
  let h = leerHistorial();
  h.unshift({ id: docId, tipodoc: tipoId, folio, inputs, creadoEn: new Date().toISOString() });
  if (h.length > LIMITE_HISTORIAL_MD) h = h.slice(0, LIMITE_HISTORIAL_MD);
  localStorage.setItem("medicita_docs", JSON.stringify(h));

  // M5: vincular documento con perfil de paciente
  vincularDocConPacienteMD(folio, docId);
}

function vincularDocConPacienteMD(citaFolio, docId) {
  if (!citaFolio) return;
  const KEY = "medicita_pacientes";
  const pacientes = JSON.parse(localStorage.getItem(KEY) || "[]");
  const idx = pacientes.findIndex(p => p.foliosCitas && p.foliosCitas.includes(citaFolio));
  if (idx === -1) return;
  if (!pacientes[idx].foliosDocs.includes(docId)) {
    pacientes[idx] = {
      ...pacientes[idx],
      foliosDocs: [...pacientes[idx].foliosDocs, docId],
      actualizadoEn: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(pacientes));
  }
}

function renderHistorial() {
  const historial = leerHistorial();
  const lista = document.getElementById("md-historial-lista");
  const cont  = document.getElementById("historial-contador");

  cont.textContent = historial.length === 1 ? "1 documento guardado" : historial.length + " documentos guardados";

  if (historial.length === 0) {
    lista.innerHTML = '<p class="historial-vacio-md">No hay documentos generados aún. Genera tu primer documento arriba.</p>';
    return;
  }

  lista.innerHTML = historial.slice(0, 10).map(function (doc) {
    const tipo = TIPOS_DOC_MD.find(function (t) { return t.id === doc.tipodoc; });
    const icono = tipo ? tipo.icono : "📄";
    const label = tipo ? tipo.label : doc.tipodoc;
    const fecha = doc.creadoEn
      ? new Date(doc.creadoEn).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    return `<div class="historial-item-md" data-id="${escaparHtmlMD(doc.id)}">
      <span class="hist-icono-md">${icono}</span>
      <div class="hist-info-md">
        <span class="hist-tipo-md">${escaparHtmlMD(label)}</span>
        <span class="hist-folio-md">${escaparHtmlMD(doc.folio)}</span>
      </div>
      <span class="hist-fecha-md">${escaparHtmlMD(fecha)}</span>
      <button class="btn-hist-regen" data-id="${escaparHtmlMD(doc.id)}" title="Regenerar este documento">↻ Regenerar</button>
    </div>`;
  }).join("");
}

function manejarClicHistorial(e) {
  const btn = e.target.closest(".btn-hist-regen");
  if (!btn) return;
  const doc = leerHistorial().find(function (d) { return d.id === btn.dataset.id; });
  if (doc) cargarDesdeHistorial(doc);
}

async function cargarDesdeHistorial(doc) {
  const btnTipo = document.querySelector(`.tipo-doc-btn[data-tipo="${doc.tipodoc}"]`);
  if (btnTipo) {
    document.querySelectorAll(".tipo-doc-btn").forEach(function (b) { b.classList.remove("activo"); });
    btnTipo.classList.add("activo");
    estadoMD.tipoDoc = doc.tipodoc;
    renderCamposDinamicos(doc.tipodoc);
  }

  document.getElementById("input-folio").value = doc.folio;
  seleccionarCita(doc.folio);

  Object.entries(doc.inputs).forEach(function ([key, val]) {
    const el = document.getElementById("campo-" + key);
    if (el) el.value = val;
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
  await generarDocumento();
}

/* ─── Helpers de paciente y edad ─────────────────────────────────────── */
function obtenerPacienteByCita(folio) {
  const pacientes = JSON.parse(localStorage.getItem("medicita_pacientes") || "[]");
  return pacientes.find(function (p) { return p.foliosCitas && p.foliosCitas.includes(folio); }) || null;
}

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return "—";
  const hoy = new Date();
  const nac = new Date(fechaNacimiento + "T12:00:00");
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return isNaN(edad) ? "—" : edad + " años";
}

/* ─── Toast ───────────────────────────────────────────────────────────── */
function mostrarToastMD(mensaje, tipo) {
  const toast = document.getElementById("md-toast");
  toast.textContent = mensaje;
  toast.className = "md-toast md-toast--" + tipo;
  void toast.offsetWidth;
  toast.classList.add("visible");
  setTimeout(function () { toast.classList.remove("visible"); }, 3500);
}

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function mostrarErrorMD(mensaje) {
  const el = document.getElementById("form-error-md");
  el.textContent = mensaje;
  el.style.display = mensaje ? "block" : "none";
}

function escaparHtmlMD(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
