/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  await window.APIListo;

  const folio = leerFolioDeURL();

  renderBotonesNPS();
  bindFormulario();

  if (!folio || !folioValido(folio)) {
    mostrarEstado("folio-invalido");
    return;
  }

  if (await yaRespondio(folio)) {
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

async function yaRespondio(folio) {
  return API.nps.yaRespondida(folio);
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

async function enviarEncuesta() {
  if (puntuacion === 0) {
    mostrarErrorEnc("Por favor selecciona una calificación del 1 al 10.");
    return;
  }

  const folio = leerFolioDeURL();
  const comentario = document.getElementById("enc-comentario").value.trim();
  const boton = document.getElementById("btn-enviar-encuesta");

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Enviando…";

  try {
    await API.nps.responder(folio, puntuacion, comentario);
    mostrarGracias(puntuacion);
  } catch (e) {
    /* Con backend, esto puede fallar de verdad: sin red, o porque la
       encuesta ya se había respondido desde otro dispositivo. Decirle
       "gracias" a alguien cuya opinión no se guardó es peor que
       admitirlo — no la volvería a escribir. */
    mostrarErrorEnc(
      /ya tiene una respuesta|ya fue respondida|duplicate|unique/i.test(e.message)
        ? "Esta encuesta ya fue respondida antes. ¡Gracias de todas formas!"
        : "No pudimos guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo."
    );
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
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
