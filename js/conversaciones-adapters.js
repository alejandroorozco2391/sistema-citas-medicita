/* ═══════════════════════════════════════════════════════════════════════
   conversaciones-adapters.js — Normalizadores por canal

   Cada adaptador es una función PURA: (payload) → {conversacion, mensajes[]}
   Sin DOM, sin localStorage, sin fetch. Por eso se pueden probar en node.

   Están escritos contra la forma REAL del payload de cada proveedor, no
   contra un formato inventado. Hoy los alimentamos a mano o con datos de
   muestra porque no hay backend que reciba webhooks; el día que lo haya,
   el webhook llama al mismo adaptador con el mismo payload y ya.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function _iso(valor) {
  if (!valor) return new Date().toISOString();
  if (typeof valor === "number") {
    // Unix en segundos o milisegundos
    return new Date(valor < 1e12 ? valor * 1000 : valor).toISOString();
  }
  if (/^\d+$/.test(String(valor))) {
    const n = Number(valor);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(valor);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

function _resumen(texto, max = 70) {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/* ═══════════════════════════════════════════════════════════════════════
   MediBot — formato Messages API de Anthropic
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * Traduce el array `conversacion` de chat.js a un hilo legible.
 *
 * El reto: ese array mezcla conversación real con fontanería de tool use.
 * Un mensaje role:"user" cuyo content es un array de bloques tool_result
 * NO es algo que dijo el paciente — es el resultado de una herramienta que
 * el propio sistema le devolvió al modelo. Meterlo en el hilo sería basura.
 *
 * Criterio: los bloques `text` son el hilo; los `tool_use` se registran
 * como metadata del mensaje del agente; los `tool_result` se descartan.
 *
 * @param {Array} conversacion  el array tal cual de chat.js
 * @param {Object} ctx  { sesionId, telefono, nombreContacto }
 */
function adaptarMediBot(conversacion, ctx = {}) {
  const mensajes = [];
  const base = ctx.inicioEn ? new Date(ctx.inicioEn).getTime() : Date.now();
  let orden = 0;

  // Id determinista por posición. Es lo que permite que chat.js vuelque la
  // conversación completa en cada turno sin duplicar el hilo: los mensajes
  // ya guardados traen el mismo id y el store los ignora.
  const idDe = i => (ctx.sesionId ? `MSG-mb-${ctx.sesionId}-${i}` : undefined);

  for (const turno of conversacion || []) {
    const fecha = new Date(base + orden * 1000).toISOString();

    if (turno.role === "user") {
      if (typeof turno.content === "string") {
        mensajes.push({
          id: idDe(orden),
          remitente: "paciente",
          autorNombre: ctx.nombreContacto || "Paciente",
          tipo: "texto",
          contenido: turno.content,
          estadoEnvio: "recibido",
          fecha,
        });
        orden++;
      }
      // content array = bloques tool_result → fontanería, se descarta
      continue;
    }

    if (turno.role === "assistant") {
      const bloques = Array.isArray(turno.content) ? turno.content : [];
      const texto = bloques
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n\n")
        .trim();
      const herramientas = bloques.filter(b => b.type === "tool_use").map(b => b.name);

      if (texto) {
        mensajes.push({
          id: idDe(orden),
          remitente: "agente",
          autorNombre: "MediBot",
          tipo: "texto",
          contenido: texto,
          estadoEnvio: "enviado",
          metadata: herramientas.length ? { herramientas } : {},
          fecha,
        });
        orden++;
      } else if (herramientas.length) {
        // Turno que solo usó herramientas: se deja rastro de sistema para
        // que la asistente vea qué hizo el bot, sin ensuciar el hilo.
        mensajes.push({
          id: idDe(orden),
          remitente: "sistema",
          autorNombre: "MediBot",
          tipo: "sistema",
          contenido: `Consultó: ${herramientas.join(", ")}`,
          metadata: { herramientas },
          fecha,
        });
        orden++;
      }
    }
  }

  const primerPaciente = mensajes.find(m => m.remitente === "paciente");

  return {
    conversacion: {
      claveExterna: ctx.sesionId || null,
      canal: "medibot",
      telefono: ctx.telefono || "",
      nombreContacto: ctx.nombreContacto || "",
      canalMeta: { proveedor: "medicita", sesionId: ctx.sesionId || null },
      estado: "abierta",
      asunto: primerPaciente ? _resumen(primerPaciente.contenido) : "Conversación con MediBot",
    },
    mensajes,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   WhatsApp — webhook de WhatsApp Cloud API (Meta)
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * Payload real: entry[].changes[].value con `contacts[]` y `messages[]`.
 * El hilo de WhatsApp con un contacto es continuo y no tiene fin natural,
 * así que no se usa claveExterna: el upsert cae en canal+teléfono.
 */
function adaptarWhatsApp(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value || {};
  const contacto = value.contacts?.[0] || {};
  const entrantes = value.messages || [];

  const telefono = contacto.wa_id || entrantes[0]?.from || "";
  const nombre = contacto.profile?.name || "";

  const mensajes = entrantes.map(m => {
    const fecha = _iso(m.timestamp);

    if (m.type === "audio") {
      return {
        id: m.id ? `MSG-wa-${m.id}` : undefined,
        remitente: "paciente",
        autorNombre: nombre || telefono,
        tipo: "audio",
        contenido: m.audio?.transcripcion || "(mensaje de voz)",
        audioUrl: m.audio?.id ? `wa-media://${m.audio.id}` : null,
        duracionSeg: m.audio?.duracion ?? null,
        estadoEnvio: "recibido",
        metadata: { waMessageId: m.id, mimeType: m.audio?.mime_type },
        fecha,
      };
    }

    const contenido =
      m.text?.body ||
      m.button?.text ||
      m.interactive?.list_reply?.title ||
      m.interactive?.button_reply?.title ||
      `(mensaje de tipo ${m.type})`;

    return {
      id: m.id ? `MSG-wa-${m.id}` : undefined,
      remitente: "paciente",
      autorNombre: nombre || telefono,
      tipo: "texto",
      contenido,
      estadoEnvio: "recibido",
      metadata: { waMessageId: m.id, tipoWa: m.type },
      fecha,
    };
  });

  return {
    conversacion: {
      claveExterna: null,
      canal: "whatsapp",
      telefono,
      nombreContacto: nombre || "",
      canalMeta: {
        proveedor: "whatsapp_cloud_api",
        waId: telefono,
        phoneNumberId: value.metadata?.phone_number_id || null,
        numeroClinica: value.metadata?.display_phone_number || null,
      },
      estado: "abierta",
      asunto: mensajes.length ? _resumen(mensajes[0].contenido) : "Conversación de WhatsApp",
    },
    mensajes,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Voz — webhook post-call de ElevenLabs Agents
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * Payload real: { type:"post_call_transcription", data:{ transcript[],
 * metadata{}, analysis{} } }. Cada llamada es una conversación cerrada y
 * distinta, así que la identidad es `conversation_id` (claveExterna).
 *
 * Señal aprovechada: si analysis.call_successful !== "success", la
 * conversación entra al inbox marcada como requiere_atencion_humana. Eso
 * es exactamente el caso de uso: el agente de voz no pudo resolverlo y
 * alguien tiene que llamar de vuelta.
 */
function adaptarVozElevenLabs(payload) {
  const data = payload?.data || payload || {};
  const meta = data.metadata || {};
  const analysis = data.analysis || {};
  const transcript = data.transcript || [];

  const inicioUnix = meta.start_time_unix_secs || payload?.event_timestamp || null;
  const inicioMs = inicioUnix ? inicioUnix * 1000 : Date.now();

  const telefono =
    meta.phone_call?.external_number || meta.phone_call?.from_number || data.from_number || "";

  const mensajes = transcript
    .filter(t => (t.message || "").trim())
    .map((t, i) => ({
      id: data.conversation_id ? `MSG-11l-${data.conversation_id}-${i}` : undefined,
      remitente: t.role === "user" ? "paciente" : "agente",
      autorNombre: t.role === "user" ? "Paciente" : "Agente de voz",
      tipo: "transcripcion",
      contenido: t.message,
      duracionSeg: t.time_in_call_secs ?? null,
      estadoEnvio: t.role === "user" ? "recibido" : "enviado",
      metadata: { segundoEnLlamada: t.time_in_call_secs ?? null },
      fecha: new Date(inicioMs + (t.time_in_call_secs || 0) * 1000).toISOString(),
    }));

  const exitosa = analysis.call_successful === "success";

  return {
    conversacion: {
      claveExterna: data.conversation_id || null,
      canal: "voz",
      telefono,
      // Vacío = no lo sabemos. No se inventa un nombre: si el teléfono está
      // en el expediente, el store lo rellena; si no, la UI pone el genérico.
      nombreContacto: meta.phone_call?.nombre || "",
      canalMeta: {
        proveedor: "elevenlabs",
        agentId: data.agent_id || null,
        conversationId: data.conversation_id || null,
        duracionSeg: meta.call_duration_secs ?? null,
        resultado: analysis.call_successful || null,
      },
      estado: exitosa ? "resuelta" : "requiere_atencion_humana",
      asunto:
        analysis.transcript_summary
          ? _resumen(analysis.transcript_summary, 90)
          : "Llamada telefónica",
    },
    mensajes,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Chat web genérico — widget del sitio
   ═══════════════════════════════════════════════════════════════════════ */
function adaptarChatWeb(payload) {
  const mensajes = (payload?.mensajes || []).map((m, i) => ({
    id: payload?.sesionId ? `MSG-web-${payload.sesionId}-${i}` : undefined,
    remitente: m.de === "visitante" ? "paciente" : "agente",
    autorNombre: m.de === "visitante" ? payload.nombre || "Visitante" : m.autor || "Agente web",
    tipo: "texto",
    contenido: m.texto || "",
    estadoEnvio: m.de === "visitante" ? "recibido" : "enviado",
    fecha: _iso(m.fecha),
  }));

  return {
    conversacion: {
      claveExterna: payload?.sesionId || null,
      canal: "chat_web",
      telefono: payload?.telefono || "",
      nombreContacto: payload?.nombre || "",
      canalMeta: { proveedor: "widget_web", url: payload?.url || null },
      estado: "abierta",
      asunto: mensajes.length ? _resumen(mensajes[0].contenido) : "Chat del sitio web",
    },
    mensajes,
  };
}

/* ─── Registro de canales ─────────────────────────────────────────────── */
const ADAPTADORES = {
  medibot: adaptarMediBot,
  whatsapp: adaptarWhatsApp,
  voz: adaptarVozElevenLabs,
  chat_web: adaptarChatWeb,
};

function adaptar(canal, payload, ctx) {
  const fn = ADAPTADORES[canal];
  if (!fn) throw new Error(`Canal sin adaptador: ${canal}`);
  return fn(payload, ctx);
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    adaptarMediBot, adaptarWhatsApp, adaptarVozElevenLabs, adaptarChatWeb,
    ADAPTADORES, adaptar,
  };
}
