/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  const folio = leerFolioDeURL();

  renderBotonesNPS();
  bindFormulario();

  if (!folio || !folioValido(folio)) {
    mostrarEstado("folio-invalido");
    return;
  }

  if (yaRespondio(folio)) {
    mostrarEstado("ya-respondido");
    return;
  }

  document.getElementById("enc-folio-display").textContent = folio;
  mostrarEstado("formulario");
});

/* ─── URL y validación ────────────────────────────────────────────────── */
function leerFolioDeURL() {
  return new URLSearchParams(window.location.search).get("folio") || "";
}

function folioValido(folio) {
  return /^CIT-\d{6}-\d{4}$/.test(folio);
}

function yaRespondio(folio) {
  const nps = JSON.parse(localStorage.getItem("medicita_nps") || "[]");
  return nps.some((r) => r.folio === folio);
}

/* ─── Botones NPS ─────────────────────────────────────────────────────── */
let puntuacion = 0;

function renderBotonesNPS() {
  const contenedor = document.getElementById("nps-botones");
  contenedor.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return `<button type="button" class="nps-btn ${claseNPS(n)}"
              data-valor="${n}" aria-label="${n} de 10">${n}</button>`;
  }).join("");

  contenedor.addEventListener("click", (e) => {
    const btn = e.target.closest(".nps-btn");
    if (!btn) return;
    seleccionarNPS(Number(btn.dataset.valor));
  });
}

function claseNPS(n) {
  if (n <= 6) return "nps-bajo";
  if (n <= 8) return "nps-medio";
  return "nps-alto";
}

function seleccionarNPS(valor) {
  puntuacion = valor;
  document.querySelectorAll(".nps-btn").forEach((b) => {
    b.classList.toggle("nps-btn-activo", Number(b.dataset.valor) === valor);
  });
  mostrarErrorEnc("");
}

/* ─── Formulario ──────────────────────────────────────────────────────── */
function bindFormulario() {
  document.getElementById("btn-enviar-encuesta").addEventListener("click", enviarEncuesta);
}

function enviarEncuesta() {
  if (puntuacion === 0) {
    mostrarErrorEnc("Por favor selecciona una calificación del 1 al 10.");
    return;
  }

  const folio = leerFolioDeURL();
  const comentario = document.getElementById("enc-comentario").value.trim();

  const respuesta = {
    id: generarIdNPS(),
    folio,
    puntuacion,
    comentario,
    fechaRespuesta: new Date().toISOString(),
  };

  guardarRespuesta(respuesta);
  mostrarGracias(puntuacion);
}

function guardarRespuesta(respuesta) {
  const nps = JSON.parse(localStorage.getItem("medicita_nps") || "[]");
  nps.unshift(respuesta);
  localStorage.setItem("medicita_nps", JSON.stringify(nps));
}

function mostrarGracias(p) {
  const icono = p >= 9 ? "⭐" : p >= 7 ? "😊" : "💙";
  const msg = p >= 9
    ? "Tu recomendación nos alegra mucho. ¡Esperamos verte pronto!"
    : p >= 7
    ? "Gracias por tu opinión. Seguiremos trabajando para mejorar."
    : "Lamentamos que tu experiencia no haya sido la esperada. Lo tendremos en cuenta.";

  document.getElementById("enc-icono-gracias").textContent = icono;
  document.getElementById("enc-mensaje-gracias").textContent = msg;
  document.getElementById("enc-puntuacion-display").textContent = `Tu calificación: ${p} / 10`;
  mostrarEstado("gracias");
}

/* ─── Estado UI ───────────────────────────────────────────────────────── */
const ESTADOS_ENC = ["validando", "folio-invalido", "ya-respondido", "formulario", "gracias"];

function mostrarEstado(estado) {
  ESTADOS_ENC.forEach((e) => {
    const el = document.getElementById(`estado-${e}`);
    if (el) el.classList.toggle("oculto", e !== estado);
  });
}

function mostrarErrorEnc(msg) {
  document.getElementById("enc-error").textContent = msg;
}

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function generarIdNPS() {
  return `NPS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
