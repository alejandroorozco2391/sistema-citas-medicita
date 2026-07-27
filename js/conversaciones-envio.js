/* ═══════════════════════════════════════════════════════════════════════
   conversaciones-envio.js — Dispatcher de salida por canal

   Regla que ordena todo este archivo: la UI nunca miente sobre si un
   mensaje salió o no.

   Hoy el único canal con salida viva es el correo (EmailJS ya vive en el
   sistema). WhatsApp necesita la Business API, y para eso hace falta un
   backend que reciba y emita — no existe todavía. Un agente de voz no
   recibe texto por definición.

   Entonces: los mensajes a esos canales se guardan en el hilo marcados
   como `pendiente`, con el motivo explícito. No se inventa un ✓ enviado.
   Cuando exista el backend, se rellena el cuerpo de la función del canal
   y el resto del sistema no cambia.

   ⚠️ Las credenciales de EmailJS viven SOLO en memoria durante la sesión.
   Nunca en localStorage — convención del proyecto.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Credenciales en memoria ─────────────────────────────────────────── */
let _ejsServiceId = "";
let _ejsTemplateId = "";
let _ejsPublicKey = "";

function configurarEmailJS(serviceId, templateId, publicKey) {
  _ejsServiceId = (serviceId || "").trim();
  _ejsTemplateId = (templateId || "").trim();
  _ejsPublicKey = (publicKey || "").trim();
  if (_ejsPublicKey && typeof emailjs !== "undefined") {
    emailjs.init({ publicKey: _ejsPublicKey });
  }
  return emailjsListo();
}

function emailjsListo() {
  return Boolean(_ejsServiceId && _ejsTemplateId && _ejsPublicKey && typeof emailjs !== "undefined");
}

/* ─── Capacidades por canal ───────────────────────────────────────────── */
/**
 * Qué puede hacer realmente cada canal hoy. La UI lee esto para decidir
 * qué mostrar, en vez de tener el conocimiento regado por la vista.
 */
const CAPACIDADES = {
  medibot: {
    salidaViva: false,
    motivo: "La sesión de chat del visitante ya terminó; no hay a dónde entregar el mensaje.",
  },
  whatsapp: {
    salidaViva: false,
    motivo: "Requiere WhatsApp Business API conectada a un backend.",
  },
  voz: {
    salidaViva: false,
    motivo: "Un agente de voz no recibe mensajes de texto; hay que devolver la llamada.",
  },
  chat_web: {
    salidaViva: false,
    motivo: "El widget del sitio no mantiene la sesión abierta tras cerrarse.",
  },
  email: {
    salidaViva: true,
    motivo: "",
  },
};

function capacidadCanal(canal) {
  return CAPACIDADES[canal] || { salidaViva: false, motivo: "Canal desconocido." };
}

/* ─── Salida por correo (real) ────────────────────────────────────────── */
async function enviarPorEmail(destinatario, asunto, cuerpoHTML) {
  if (!emailjsListo()) {
    return { estado: "pendiente", detalle: "EmailJS no está configurado en esta sesión." };
  }
  if (!destinatario) {
    return { estado: "fallido", detalle: "El paciente no tiene correo registrado." };
  }
  try {
    await emailjs.send(_ejsServiceId, _ejsTemplateId, {
      to_email: destinatario,
      subject: asunto,
      message_html: cuerpoHTML,
      message: cuerpoHTML.replace(/<[^>]+>/g, ""),
    });
    return { estado: "enviado", detalle: `Enviado por correo a ${destinatario}` };
  } catch (e) {
    return { estado: "fallido", detalle: `Error de EmailJS: ${e?.text || e?.message || e}` };
  }
}

/* ─── Dispatcher ──────────────────────────────────────────────────────── */
/**
 * Intenta entregar `texto` al paciente por el canal de la conversación.
 *
 * @param {Object} conv       la conversación
 * @param {string} texto      el mensaje del staff
 * @param {Object} opciones   { forzarEmail, emailPaciente, nombreClinica }
 * @returns {Promise<{estado, detalle, via}>}
 *          estado ∈ enviado | pendiente | fallido
 */
async function enviarMensaje(conv, texto, opciones = {}) {
  const { forzarEmail = false, emailPaciente = "", nombreClinica = "tu clínica" } = opciones;

  if (forzarEmail) {
    const r = await enviarPorEmail(
      emailPaciente,
      `Mensaje de ${nombreClinica}`,
      _plantillaEmail(texto, conv, nombreClinica)
    );
    return { ...r, via: "email" };
  }

  const cap = capacidadCanal(conv.canal);
  if (cap.salidaViva) {
    // Ningún canal nativo tiene salida viva todavía; rama lista para cuando
    // se conecte el primero.
    return { estado: "enviado", detalle: "", via: conv.canal };
  }

  return { estado: "pendiente", detalle: cap.motivo, via: conv.canal };
}

function _plantillaEmail(texto, conv, nombreClinica) {
  const seguro = String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
      <p style="font-size:15px;line-height:1.6">Hola ${conv.nombreContacto || ""},</p>
      <p style="font-size:15px;line-height:1.6">${seguro}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">${nombreClinica}</p>
    </div>`;
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    configurarEmailJS, emailjsListo, capacidadCanal, CAPACIDADES,
    enviarPorEmail, enviarMensaje,
  };
}
