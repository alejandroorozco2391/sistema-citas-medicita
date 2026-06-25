/* ─── Constantes ──────────────────────────────────────────────────────── */
const API_URL_MP = "/api/chat";
const MODELO_MP = "claude-sonnet-4-6";
const LIMITE_HISTORIAL_STORAGE = 50;
const LIMITE_HISTORIAL_VISIBLE = 10;
const LIMITE_CAPTION_VISUAL = 125;

const REDES_MP = [
  { id: "instagram", label: "Instagram", icono: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>` },
  { id: "facebook", label: "Facebook", icono: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3.5l1-4H14V7a1 1 0 0 1 1-1h3z"/></svg>` },
  { id: "google_business", label: "Google Business", icono: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>` },
  { id: "linkedin", label: "LinkedIn", icono: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v1.5A5.97 5.97 0 0 1 16 8z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>` },
];

const TIPOS_MP = [
  { id: "consejo", label: "Consejo de salud", icono: "💡" },
  { id: "presentacion", label: "Presentación de servicio/doctor", icono: "🩺" },
  { id: "recordatorio", label: "Recordatorio estacional", icono: "📅" },
  { id: "promocion", label: "Promoción o descuento", icono: "🏷️" },
  { id: "testimonio", label: "Testimonio anonimizado", icono: "💬" },
  { id: "dato_curioso", label: "Dato curioso de salud", icono: "🔎" },
];

const TONOS_MP = [
  { id: "profesional", label: "Profesional" },
  { id: "cercano", label: "Cercano" },
  { id: "educativo", label: "Educativo" },
  { id: "motivacional", label: "Motivacional" },
];

/* ─── Estado ──────────────────────────────────────────────────────────── */
const estadoMP = {
  inputs: { red: "", tipo: "", tono: "", especialidad: "", contexto: "" },
  ultimoResultado: null,
  generando: false,
};

const calEstado = {
  anio: new Date().getFullYear(),
  mes: new Date().getMonth(),
  dragPostId: null,
  popoverPostId: null,
  popoverFechaDia: null,
};

/* ─── Helpers de catálogos ────────────────────────────────────────────── */
function buscarRed(id) { return REDES_MP.find((r) => r.id === id); }
function buscarTipo(id) { return TIPOS_MP.find((t) => t.id === id); }
function buscarTono(id) { return TONOS_MP.find((t) => t.id === id); }

/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  poblarEspecialidades();
  bindSelectores();
  bindFormulario();
  renderHistorial();
  renderCalendario(calEstado.anio, calEstado.mes);
  bindCalendarioGlobal();
});

function poblarEspecialidades() {
  const datalist = document.getElementById("lista-especialidades");
  datalist.innerHTML = ESPECIALIDADES.map((e) => `<option value="${escaparHtmlMP(e.nombre)}"></option>`).join("");
}

function bindSelectores() {
  document.getElementById("selector-redes").addEventListener("click", (e) => {
    const btn = e.target.closest(".opcion-visual");
    if (!btn) return;
    seleccionarOpcion("selector-redes", btn, "red");
  });
  document.getElementById("selector-tipos").addEventListener("click", (e) => {
    const btn = e.target.closest(".opcion-visual");
    if (!btn) return;
    seleccionarOpcion("selector-tipos", btn, "tipo");
  });
  document.getElementById("selector-tonos").addEventListener("click", (e) => {
    const btn = e.target.closest(".opcion-visual");
    if (!btn) return;
    seleccionarOpcion("selector-tonos", btn, "tono");
  });
}

function seleccionarOpcion(grupoId, boton, campo) {
  const grupo = document.getElementById(grupoId);
  grupo.querySelectorAll(".opcion-visual").forEach((b) => {
    b.classList.remove("activo");
    b.setAttribute("aria-checked", "false");
  });
  boton.classList.add("activo");
  boton.setAttribute("aria-checked", "true");
  estadoMP.inputs[campo] = boton.dataset.valor;
  mostrarError("");
}

function bindFormulario() {
  document.getElementById("btn-generar").addEventListener("click", () => generarPost(false));
  document.getElementById("btn-regenerar").addEventListener("click", () => generarPost(true));

  document.getElementById("resultado-contenido").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-copiar");
    if (!btn) return;
    copiarBloque(btn);
  });

  const listaHistorial = document.getElementById("historial-lista");
  listaHistorial.addEventListener("click", (e) => {
    const eliminar = e.target.closest(".btn-historial-eliminar");
    const cargar = e.target.closest(".btn-hist-cargar");
    const programar = e.target.closest(".btn-programar-hist, .btn-reprogramar-hist");
    if (eliminar) {
      e.stopPropagation();
      eliminarDeHistorial(eliminar.dataset.id);
      return;
    }
    if (cargar) {
      e.stopPropagation();
      cargarDesdeHistorial(cargar.dataset.id);
      return;
    }
    if (programar) {
      e.stopPropagation();
      const dp = programar.closest(".historial-fila").querySelector(".hist-datepicker");
      if (dp) { dp.classList.toggle("oculto"); if (!dp.classList.contains("oculto")) dp.focus(); }
      return;
    }
    const fila = e.target.closest(".historial-fila");
    if (fila && !e.target.closest("input[type='date']")) cargarDesdeHistorial(fila.dataset.id);
  });
  listaHistorial.addEventListener("change", (e) => {
    const dp = e.target.closest(".hist-datepicker");
    if (!dp || !dp.value) return;
    actualizarFechaPost(dp.dataset.id, dp.value);
    mostrarToastMP(`Post programado para ${formatFechaLegible(dp.value)}.`, "ok");
  });
}

/* ─── Generación ──────────────────────────────────────────────────────── */
function leerInputsFormulario() {
  estadoMP.inputs.especialidad = document.getElementById("input-especialidad").value.trim();
  estadoMP.inputs.contexto = document.getElementById("input-contexto").value.trim();
}

function validarFormulario() {
  leerInputsFormulario();
  const { red, tipo, tono, especialidad } = estadoMP.inputs;
  if (!red) return { ok: false, mensaje: "Selecciona una red social." };
  if (!tipo) return { ok: false, mensaje: "Selecciona un tipo de post." };
  if (!tono) return { ok: false, mensaje: "Selecciona un tono." };
  if (!especialidad) return { ok: false, mensaje: "Indica la especialidad médica." };
  return { ok: true };
}

async function generarPost(regenerando) {
  if (estadoMP.generando) return;

  if (regenerando) {
    // Regenerar reutiliza los inputs ya guardados, no relee el formulario.
  } else {
    const validacion = validarFormulario();
    if (!validacion.ok) { mostrarError(validacion.mensaje); return; }
  }
  mostrarError("");

  estadoMP.generando = true;
  setControlesGenerando(true);
  mostrarCargando();

  try {
    let prompt = buildUserPromptMP(estadoMP.inputs);
    if (regenerando) {
      prompt += "\n\nGenera una versión alternativa, distinta a cualquier intento previo, manteniendo el mismo tema.";
    }
    const texto = await llamarClaudeMP(prompt);
    const partes = parsearResultadoMP(texto);
    estadoMP.ultimoResultado = partes;
    renderResultado(partes);
    guardarEnHistorial(partes);
  } catch (err) {
    mostrarError(`No se pudo generar el contenido: ${err.message}`);
    mostrarVacio();
  } finally {
    estadoMP.generando = false;
    setControlesGenerando(false);
  }
}

function leerConfigClinicaMP() {
  return JSON.parse(localStorage.getItem("medicita_config_clinica") || "{}");
}

function buildSystemPromptMP() {
  const cfg = leerConfigClinicaMP();
  const nombre = cfg.nombreClinica || "MediCita";
  const ciudad = cfg.ciudad || "México";
  const especialidad = cfg.especialidadPrincipal ? ` especializada en ${cfg.especialidadPrincipal}` : "";
  const medico = cfg.nombreMedico ? ` El médico representante es ${cfg.nombreMedico}.` : "";

  return `Eres el redactor de contenido para redes sociales de ${nombre}, una clínica médica${especialidad} ubicada en ${ciudad}.${medico} Escribes en español de México, claro y profesional, sin tecnicismos excesivos ni emojis en exceso.

Genera el contenido de un post para redes sociales según los datos que te da el usuario (red social, tipo de post, tono y especialidad).

Responde ÚNICAMENTE con el contenido en este formato exacto, con los marcadores tal cual y en este orden (sin texto antes ni después, sin markdown con ** ni ##):

[CAPTION]
(texto principal del post: gancho + cuerpo breve. Si la red es Instagram, intenta que la idea central quepa en menos de 125 caracteres; en Facebook, Google Business o LinkedIn puede ser un poco más extenso)

[HASHTAGS]
(5 a 8 hashtags relevantes en español, separados por espacios, sin numerar, todos empezando con #)

[SUGERENCIA_IMAGEN]
(una sola línea con dos partes separadas por el carácter | :
Parte 1: descripción visual en español para la asistente (qué tipo de imagen buscar o fotografiar)
Parte 2: prompt en inglés optimizado para generadores de imágenes IA (detallado, estilo fotográfico, iluminación, composición, técnica de cámara) — sin mencionar marcas comerciales, personas reales ni texto visible en la imagen
Ejemplo: Médico cardiólogo sonriendo en consultorio moderno | Professional cardiologist doctor smiling in modern medical clinic, warm soft lighting, white coat, friendly expression, bokeh background, Canon 85mm f/1.4, photorealistic, high detail, no text)

[LLAMADA_A_ACCION]
(una frase corta invitando a agendar cita, visitar la clínica o contactar — acorde al tono solicitado)

REGLAS:
• No inventes datos clínicos falsos, estadísticas inexistentes ni promesas médicas que no se puedan garantizar
• Si te dan información adicional, intégrala de forma natural y precisa
• El tono pedido debe notarse claramente: profesional, cercano, educativo o motivacional
• No agregues firmas, despedidas ni texto fuera de los cuatro bloques`;
}

function buildUserPromptMP(inputs) {
  const red = buscarRed(inputs.red)?.label ?? inputs.red;
  const tipo = buscarTipo(inputs.tipo)?.label ?? inputs.tipo;
  const tono = buscarTono(inputs.tono)?.label ?? inputs.tono;
  let prompt = `Genera un post con estas características:
• Red social: ${red}
• Tipo de post: ${tipo}
• Tono: ${tono}
• Especialidad médica: ${inputs.especialidad}`;
  if (inputs.contexto) {
    prompt += `\n• Información adicional: ${inputs.contexto}`;
  }
  return prompt;
}

async function llamarClaudeMP(promptUsuario) {
  const resp = await fetch(API_URL_MP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_MP,
      max_tokens: 800,
      system: buildSystemPromptMP(),
      messages: [{ role: "user", content: promptUsuario }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
}

function parsearResultadoMP(texto) {
  const marcadores = ["CAPTION", "HASHTAGS", "SUGERENCIA_IMAGEN", "LLAMADA_A_ACCION"];
  const extraer = (marcador) => {
    const otros = marcadores.filter((m) => m !== marcador).map((m) => `\\[${m}\\]`).join("|");
    const patron = new RegExp(`\\[${marcador}\\]([\\s\\S]*?)(?=${otros}|$)`, "i");
    const m = texto.match(patron);
    return m ? m[1].trim() : "";
  };
  const sugerenciaRaw = extraer("SUGERENCIA_IMAGEN");
  const pipe = sugerenciaRaw.indexOf("|");
  const descripcionImagen = pipe !== -1 ? sugerenciaRaw.slice(0, pipe).trim() : sugerenciaRaw;
  const promptIA = pipe !== -1 ? sugerenciaRaw.slice(pipe + 1).trim() : "";
  return {
    caption: extraer("CAPTION"),
    hashtags: extraer("HASHTAGS"),
    sugerenciaImagen: descripcionImagen,
    promptIA,
    llamadaAccion: extraer("LLAMADA_A_ACCION"),
  };
}

/* ─── Render resultado ────────────────────────────────────────────────── */
function mostrarVacio() {
  document.getElementById("resultado-vacio").classList.remove("oculto");
  document.getElementById("resultado-cargando").classList.add("oculto");
  document.getElementById("resultado-contenido").classList.add("oculto");
}

function mostrarCargando() {
  document.getElementById("resultado-vacio").classList.add("oculto");
  document.getElementById("resultado-cargando").classList.remove("oculto");
  document.getElementById("resultado-contenido").classList.add("oculto");
}

function renderResultado(partes) {
  document.getElementById("resultado-vacio").classList.add("oculto");
  document.getElementById("resultado-cargando").classList.add("oculto");
  document.getElementById("resultado-contenido").classList.remove("oculto");

  const red = buscarRed(estadoMP.inputs.red);
  const tipo = buscarTipo(estadoMP.inputs.tipo);
  document.getElementById("resultado-chip-red").textContent = red?.label ?? "—";
  document.getElementById("resultado-chip-tipo").textContent = tipo?.label ?? "—";

  document.getElementById("texto-caption").textContent = partes.caption;
  document.getElementById("texto-hashtags").textContent = partes.hashtags;
  document.getElementById("texto-imagen").textContent = partes.sugerenciaImagen;
  document.getElementById("texto-cta").textContent = partes.llamadaAccion;

  const promptIAEl = document.getElementById("texto-imagen-prompt");
  const promptIAZona = document.getElementById("zona-prompt-ia");
  if (partes.promptIA) {
    promptIAEl.textContent = partes.promptIA;
    document.getElementById("btn-firefly").href =
      `https://firefly.adobe.com/generate/images?prompt=${encodeURIComponent(partes.promptIA)}`;
    promptIAZona.classList.remove("oculto");
  } else {
    promptIAZona.classList.add("oculto");
  }

  const contador = document.getElementById("contador-caracteres");
  const len = partes.caption.length;
  contador.textContent = `${len} / ${LIMITE_CAPTION_VISUAL}`;
  contador.classList.toggle("excedido", len > LIMITE_CAPTION_VISUAL);
}

function setControlesGenerando(activo) {
  const btnGenerar = document.getElementById("btn-generar");
  const btnRegenerar = document.getElementById("btn-regenerar");
  btnGenerar.disabled = activo;
  btnGenerar.textContent = activo ? "Generando…" : "✨ Generar post";
  btnRegenerar.disabled = activo;
}

function mostrarError(mensaje) {
  document.getElementById("form-error").textContent = mensaje;
}

/* ─── Copiar ──────────────────────────────────────────────────────────── */
async function copiarBloque(boton) {
  const targetId = boton.dataset.target;
  const texto = document.getElementById(targetId).textContent;
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
  const textoOriginal = boton.textContent;
  boton.textContent = "✓ Copiado";
  boton.classList.add("copiado");
  setTimeout(() => {
    boton.textContent = textoOriginal;
    boton.classList.remove("copiado");
  }, 1500);
}

/* ─── Historial ───────────────────────────────────────────────────────── */
function cargarHistorialMP() {
  return JSON.parse(localStorage.getItem("medicita_posts") || "[]");
}

function guardarEnHistorial(partes) {
  const historial = cargarHistorialMP();
  const item = {
    id: generarIdPost(),
    tipo: estadoMP.inputs.tipo,
    especialidad: estadoMP.inputs.especialidad,
    red: estadoMP.inputs.red,
    tono: estadoMP.inputs.tono,
    caption: partes.caption,
    hashtags: partes.hashtags,
    sugerenciaImagen: partes.sugerenciaImagen,
    promptIA: partes.promptIA ?? "",
    llamadaAccion: partes.llamadaAccion,
    creadoEn: new Date().toISOString(),
    borrador: false,
    fechaProgramada: null,
  };
  historial.unshift(item);
  while (historial.length > LIMITE_HISTORIAL_STORAGE) historial.pop();
  localStorage.setItem("medicita_posts", JSON.stringify(historial));
  renderHistorial();
}

function eliminarDeHistorial(id) {
  const historial = cargarHistorialMP().filter((p) => p.id !== id);
  localStorage.setItem("medicita_posts", JSON.stringify(historial));
  renderHistorial();
  renderCalendario(calEstado.anio, calEstado.mes);
  mostrarToastMP("Post eliminado del historial.", "ok");
}

function cargarDesdeHistorial(id) {
  const item = cargarHistorialMP().find((p) => p.id === id);
  if (!item) return;

  estadoMP.inputs = {
    red: item.red, tipo: item.tipo, tono: item.tono,
    especialidad: item.especialidad, contexto: estadoMP.inputs.contexto,
  };

  marcarActivo("selector-redes", item.red);
  marcarActivo("selector-tipos", item.tipo);
  marcarActivo("selector-tonos", item.tono);
  document.getElementById("input-especialidad").value = item.especialidad;

  renderResultado({
    caption: item.caption,
    hashtags: item.hashtags,
    sugerenciaImagen: item.sugerenciaImagen,
    promptIA: item.promptIA ?? "",
    llamadaAccion: item.llamadaAccion,
  });
  estadoMP.ultimoResultado = item;

  window.scrollTo({ top: 0, behavior: "smooth" });
  mostrarToastMP("Post cargado desde el historial.", "ok");
}

function marcarActivo(grupoId, valor) {
  const grupo = document.getElementById(grupoId);
  grupo.querySelectorAll(".opcion-visual").forEach((b) => {
    const activo = b.dataset.valor === valor;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-checked", String(activo));
  });
}

function renderHistorial() {
  const todos = cargarHistorialMP();
  const historial = [...todos].sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
  const lista = document.getElementById("historial-lista");
  const vacio = document.getElementById("historial-vacio");
  const contador = document.getElementById("historial-contador");

  contador.textContent = `${historial.length} posts`;

  if (historial.length === 0) {
    lista.innerHTML = "";
    vacio.style.display = "block";
    return;
  }
  vacio.style.display = "none";

  const hoy = toISODate(new Date());

  lista.innerHTML = historial.map((p) => {
    const tipo = buscarTipo(p.tipo);
    const tono = buscarTono(p.tono);
    const fechaCreacion = new Date(p.creadoEn).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    const fechaProg = p.fechaProgramada || null;

    let estadoBadge, estadoClase;
    if (!fechaProg) {
      estadoBadge = "Sin fecha"; estadoClase = "badge-gris";
    } else if (fechaProg < hoy) {
      estadoBadge = "Publicado"; estadoClase = "badge-verde";
    } else {
      estadoBadge = "Programado"; estadoClase = "badge-ambar";
    }

    const tituloTexto = escaparHtmlMP(p.caption.slice(0, 50)) + (p.caption.length > 50 ? "…" : "");

    return `<div class="historial-fila" data-id="${p.id}">
      <div class="historial-fila-main">
        <div class="historial-fila-top">
          <span class="historial-fila-titulo">${tituloTexto}</span>
          <span class="badge-estado ${estadoClase}">${estadoBadge}</span>
        </div>
        <div class="historial-fila-meta">
          <span class="hist-badge hist-badge-red">${getRedAbrev(p.red)}</span>
          <span class="hist-badge hist-badge-tipo">${escaparHtmlMP(tipo?.label ?? p.tipo)}</span>
          <span class="hist-badge hist-badge-tono">${escaparHtmlMP(tono?.label ?? p.tono)}</span>
          <span class="hist-sep">·</span>
          <span class="hist-fecha-creacion">${fechaCreacion}</span>
          ${fechaProg
            ? `<span class="hist-fecha-prog">· 📅 ${formatFechaLegible(fechaProg)}</span>`
            : `<span class="hist-sin-fecha">Sin programar</span>`}
        </div>
      </div>
      <div class="historial-fila-acciones">
        ${!fechaProg
          ? `<button type="button" class="btn-programar-hist" data-id="${p.id}">📅 Programar</button>`
          : `<button type="button" class="btn-reprogramar-hist" data-id="${p.id}">📅 Reprogramar</button>`}
        <input type="date" class="hist-datepicker oculto" data-id="${p.id}" value="${fechaProg || ""}">
        <button type="button" class="btn-hist-cargar" data-id="${p.id}">Cargar</button>
        <button type="button" class="btn-historial-eliminar" data-id="${p.id}" aria-label="Eliminar">🗑</button>
      </div>
    </div>`;
  }).join("");
}

function generarIdPost() {
  return `POST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ─── Helpers de fecha y calendario ─────────────────────────────────── */
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatFechaLegible(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function getRedAbrev(red) {
  const mapa = { instagram: "📷 IG", facebook: "👥 FB", linkedin: "💼 LI", google_business: "📍 GB", twitter: "🐦 TW", tiktok: "🎵 TK" };
  return mapa[red] || red.slice(0, 4);
}

function getTipoAbrev(tipo) {
  const mapa = { consejo: "Consejo", presentacion: "Present.", recordatorio: "Record.", promocion: "Promo", testimonio: "Testi.", dato_curioso: "Dato" };
  return mapa[tipo] || tipo.slice(0, 6);
}

/* ─── Calendario ──────────────────────────────────────────────────────── */
function navegarMes(delta) {
  calEstado.mes += delta;
  if (calEstado.mes > 11) { calEstado.mes = 0; calEstado.anio++; }
  if (calEstado.mes < 0)  { calEstado.mes = 11; calEstado.anio--; }
  renderCalendario(calEstado.anio, calEstado.mes);
}

function renderCalendario(anio, mes) {
  calEstado.anio = anio;
  calEstado.mes = mes;

  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  document.getElementById("cal-titulo").textContent = `${MESES[mes]} ${anio}`;

  const hoy = toISODate(new Date());
  const historial = cargarHistorialMP();

  const primerDia = new Date(anio, mes, 1);
  const ultimoDia = new Date(anio, mes + 1, 0).getDate();
  const diaSemanaInicio = (primerDia.getDay() + 6) % 7; // Lun=0, Dom=6

  const inicioGrid = new Date(anio, mes, 1 - diaSemanaInicio);
  const totalSemanas = Math.ceil((diaSemanaInicio + ultimoDia) / 7);

  let html = "";
  for (let s = 0; s < totalSemanas; s++) {
    for (let d = 0; d < 7; d++) {
      const fecha = new Date(inicioGrid);
      fecha.setDate(inicioGrid.getDate() + s * 7 + d);
      const fechaISO = toISODate(fecha);
      const esMesActual = fecha.getMonth() === mes;
      const esHoy = fechaISO === hoy;

      const postsDelDia = historial.filter((p) => p.fechaProgramada === fechaISO);
      const visibles = postsDelDia.slice(0, 2);
      const extras = postsDelDia.length - 2;

      let clases = "cal-celda";
      if (!esMesActual) clases += " cal-celda-otro-mes";
      if (esHoy) clases += " cal-celda-hoy";

      html += `<div class="${clases}" data-fecha="${fechaISO}">`;
      html += `<span class="cal-num-dia">${fecha.getDate()}</span>`;
      html += `<div class="cal-pastillas">`;

      for (const p of visibles) {
        const esPasado = fechaISO < hoy;
        const pastillaClase = "cal-pastilla " + (esPasado ? "pastilla-publicado" : "pastilla-programado");
        const tituloPreview = escaparHtmlMP(p.caption.slice(0, 25));
        const sufijo = p.caption.length > 25 ? "…" : "";
        html += `<div class="${pastillaClase}" data-id="${escaparHtmlMP(p.id)}" draggable="true">`;
        html += `<div class="pastilla-badges"><span class="pastilla-red">${getRedAbrev(p.red)}</span><span class="pastilla-tipo">${getTipoAbrev(p.tipo)}</span></div>`;
        html += `<div class="pastilla-titulo">${tituloPreview}${sufijo}</div>`;
        html += `</div>`;
      }

      if (extras > 0) {
        html += `<span class="cal-mas">+${extras} más</span>`;
      }

      html += `</div></div>`;
    }
  }

  document.getElementById("cal-grid").innerHTML = html;

  const prefijoMes = `${anio}-${String(mes + 1).padStart(2, "0")}`;
  const postsMes = historial.filter((p) => p.fechaProgramada?.startsWith(prefijoMes));
  const publicados = postsMes.filter((p) => p.fechaProgramada < hoy).length;
  const programados = postsMes.length - publicados;
  document.getElementById("cal-footer").innerHTML =
    `<span class="cal-footer-texto">${postsMes.length} posts este mes · ${publicados} publicados · ${programados} programados</span>`;
}

function actualizarFechaPost(postId, nuevaFecha) {
  const historial = cargarHistorialMP().map((p) =>
    p.id === postId ? { ...p, fechaProgramada: nuevaFecha } : p
  );
  localStorage.setItem("medicita_posts", JSON.stringify(historial));
  renderCalendario(calEstado.anio, calEstado.mes);
  renderHistorial();
}

function bindCalendarioGlobal() {
  document.getElementById("btn-mes-anterior").addEventListener("click", () => navegarMes(-1));
  document.getElementById("btn-mes-siguiente").addEventListener("click", () => navegarMes(1));
  document.getElementById("btn-nuevo-post-cal").addEventListener("click", () => {
    cerrarPopover();
    document.getElementById("seccion-generador").scrollIntoView({ behavior: "smooth" });
  });

  const gridWrap = document.getElementById("cal-grid-wrap");

  gridWrap.addEventListener("click", (e) => {
    const pastilla = e.target.closest(".cal-pastilla");
    if (pastilla) {
      e.stopPropagation();
      mostrarPopoverPost(pastilla.dataset.id, pastilla);
      return;
    }
    const celda = e.target.closest(".cal-celda");
    if (celda) {
      cerrarPopover();
      mostrarTooltipDia(celda);
    }
  });

  gridWrap.addEventListener("dragstart", (e) => {
    const pastilla = e.target.closest(".cal-pastilla");
    if (!pastilla) return;
    calEstado.dragPostId = pastilla.dataset.id;
    pastilla.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", pastilla.dataset.id);
  });

  gridWrap.addEventListener("dragend", () => {
    gridWrap.querySelectorAll(".dragging, .drag-over").forEach((el) => {
      el.classList.remove("dragging", "drag-over");
    });
  });

  gridWrap.addEventListener("dragenter", (e) => {
    e.preventDefault();
    const celda = e.target.closest(".cal-celda");
    if (!celda) return;
    gridWrap.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    celda.classList.add("drag-over");
  });

  gridWrap.addEventListener("dragover", (e) => { e.preventDefault(); });

  gridWrap.addEventListener("drop", (e) => {
    const celda = e.target.closest(".cal-celda");
    if (!celda || !calEstado.dragPostId) return;
    e.preventDefault();
    gridWrap.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    const nuevaFecha = celda.dataset.fecha;
    const postId = calEstado.dragPostId;
    calEstado.dragPostId = null;
    actualizarFechaPost(postId, nuevaFecha);
    mostrarToastMP(`Post movido al ${formatFechaLegible(nuevaFecha)}.`, "ok");
  });

  // Popover: cerrar
  document.getElementById("cal-popover-cerrar").addEventListener("click", cerrarPopover);

  // Popover modo post: reprogramar
  document.getElementById("btn-pop-reprogramar").addEventListener("click", () => {
    const dp = document.getElementById("cal-pop-datepicker");
    dp.classList.toggle("oculto");
    if (!dp.classList.contains("oculto")) dp.focus();
  });

  document.getElementById("cal-pop-datepicker").addEventListener("change", (e) => {
    const nuevaFecha = e.target.value;
    if (!nuevaFecha || !calEstado.popoverPostId) return;
    actualizarFechaPost(calEstado.popoverPostId, nuevaFecha);
    mostrarToastMP(`Post programado para ${formatFechaLegible(nuevaFecha)}.`, "ok");
    cerrarPopover();
  });

  // Popover modo post: ver post completo
  document.getElementById("btn-pop-ver").addEventListener("click", () => {
    const postId = calEstado.popoverPostId;
    cerrarPopover();
    scrollAlHistorialYResaltar(postId);
  });

  // Popover modo día: crear nuevo
  document.getElementById("btn-pop-crear").addEventListener("click", () => {
    cerrarPopover();
    document.getElementById("seccion-generador").scrollIntoView({ behavior: "smooth" });
  });

  // Popover modo día: asignar existente
  document.getElementById("btn-pop-asignar").addEventListener("click", () => {
    const fechaDia = calEstado.popoverFechaDia;
    cerrarPopover();
    mostrarSelectorPost(fechaDia);
  });

  // Selector overlay
  document.getElementById("btn-cerrar-selector").addEventListener("click", cerrarSelectorPost);
  document.getElementById("cal-selector-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("cal-selector-overlay")) cerrarSelectorPost();
  });

  // Cerrar popover al hacer clic fuera
  document.addEventListener("click", (e) => {
    const popover = document.getElementById("cal-popover");
    if (!popover.classList.contains("oculto") && !popover.contains(e.target)) {
      cerrarPopover();
    }
  });
}

/* ─── Popover ─────────────────────────────────────────────────────────── */
function mostrarPopoverPost(postId, ancla) {
  const post = cargarHistorialMP().find((p) => p.id === postId);
  if (!post) return;

  calEstado.popoverPostId = postId;
  calEstado.popoverFechaDia = null;

  document.getElementById("cal-pop-titulo").textContent =
    post.caption.slice(0, 60) + (post.caption.length > 60 ? "…" : "");
  document.getElementById("cal-pop-meta").textContent =
    `${getRedAbrev(post.red)} · ${buscarTipo(post.tipo)?.label ?? post.tipo} · ${buscarTono(post.tono)?.label ?? post.tono} · ${post.especialidad}`;
  document.getElementById("cal-pop-fecha").textContent =
    post.fechaProgramada ? `📅 ${formatFechaLegible(post.fechaProgramada)}` : "Sin fecha";

  const dp = document.getElementById("cal-pop-datepicker");
  dp.value = post.fechaProgramada || "";
  dp.classList.add("oculto");

  document.querySelector(".popover-modo-post").classList.remove("oculto");
  document.querySelector(".popover-modo-dia").classList.add("oculto");

  posicionarPopover(ancla);
}

function mostrarTooltipDia(celda) {
  calEstado.popoverFechaDia = celda.dataset.fecha;
  calEstado.popoverPostId = null;

  document.getElementById("cal-pop-pregunta").textContent =
    `¿Programar un post para el ${formatFechaLegible(celda.dataset.fecha)}?`;

  document.querySelector(".popover-modo-post").classList.add("oculto");
  document.querySelector(".popover-modo-dia").classList.remove("oculto");

  posicionarPopover(celda);
}

function posicionarPopover(ancla) {
  const popover = document.getElementById("cal-popover");
  popover.classList.remove("oculto");

  const rect = ancla.getBoundingClientRect();
  const popW = 268;
  const popH = 180;

  let left = rect.left;
  let top = rect.bottom + 6;

  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 8) left = 8;
  if (top + popH > window.innerHeight - 12) top = rect.top - popH - 6;
  if (top < 8) top = 8;

  popover.style.left = left + "px";
  popover.style.top = top + "px";
}

function cerrarPopover() {
  const popover = document.getElementById("cal-popover");
  popover.classList.add("oculto");
  const dp = document.getElementById("cal-pop-datepicker");
  if (dp) dp.classList.add("oculto");
  calEstado.popoverPostId = null;
  calEstado.popoverFechaDia = null;
}

function scrollAlHistorialYResaltar(postId) {
  document.querySelector(".historial-card").scrollIntoView({ behavior: "smooth" });
  setTimeout(() => {
    const fila = document.querySelector(`.historial-fila[data-id="${postId}"]`);
    if (!fila) return;
    fila.classList.add("historial-fila-resaltada");
    fila.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => fila.classList.remove("historial-fila-resaltada"), 2200);
  }, 420);
}

/* ─── Selector de posts sin fecha ────────────────────────────────────── */
function mostrarSelectorPost(fechaDia) {
  const sinFecha = cargarHistorialMP().filter((p) => !p.fechaProgramada);
  const lista = document.getElementById("cal-selector-lista");

  if (sinFecha.length === 0) {
    lista.innerHTML = `<p class="selector-vacio">No hay posts sin fecha programada.</p>`;
  } else {
    lista.innerHTML = sinFecha.map((p) => {
      const tipo = buscarTipo(p.tipo);
      return `<div class="selector-item" data-id="${p.id}" data-fecha="${fechaDia}">
        <div class="selector-item-top">
          <span class="sel-red">${getRedAbrev(p.red)}</span>
          <span class="sel-tipo">${escaparHtmlMP(tipo?.label ?? p.tipo)}</span>
          <span class="sel-esp">${escaparHtmlMP(p.especialidad)}</span>
        </div>
        <div class="sel-caption">${escaparHtmlMP(p.caption.slice(0, 70))}${p.caption.length > 70 ? "…" : ""}</div>
      </div>`;
    }).join("");

    lista.querySelectorAll(".selector-item").forEach((item) => {
      item.addEventListener("click", () => {
        actualizarFechaPost(item.dataset.id, item.dataset.fecha);
        cerrarSelectorPost();
        mostrarToastMP(`Post programado para ${formatFechaLegible(item.dataset.fecha)}.`, "ok");
      });
    });
  }

  document.getElementById("cal-selector-overlay").classList.remove("oculto");
}

function cerrarSelectorPost() {
  document.getElementById("cal-selector-overlay").classList.add("oculto");
}

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function escaparHtmlMP(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimerMP = null;
function mostrarToastMP(mensaje, tipo = "ok") {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.className = `visible toast-${tipo}`;
  clearTimeout(toastTimerMP);
  toastTimerMP = setTimeout(() => { toast.className = ""; }, 3200);
}
