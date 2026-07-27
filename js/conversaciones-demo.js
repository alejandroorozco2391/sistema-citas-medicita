/* ═══════════════════════════════════════════════════════════════════════
   conversaciones-demo.js — Dataset de muestra para MediInbox

   No son mensajes escritos a mano en formato normalizado: son payloads
   CRUDOS con la forma real de cada proveedor (WhatsApp Cloud API,
   ElevenLabs Agents, Messages API de Anthropic, widget de chat web),
   pasados por los adaptadores de conversaciones-adapters.js. Así el
   dataset de demo funciona además como prueba viva de que los
   adaptadores hacen lo que dicen.

   Este archivo NO toca localStorage. Lo usa conversaciones-store.js en
   `sembrarDemoSiVacio()` para poblar el inbox la primera vez que se abre.
   ═══════════════════════════════════════════════════════════════════════ */

/* En node no hay <script src> que ya haya definido los adaptadores como
   globales, así que se importan condicionalmente. `var` es deliberado:
   deja la asignación en scope de archivo (no de bloque) igual que un
   global cargado por <script>. */
if (typeof adaptarWhatsApp === "undefined" && typeof require !== "undefined") {
  var { adaptarWhatsApp, adaptarVozElevenLabs, adaptarMediBot, adaptarChatWeb } = require("./conversaciones-adapters.js");
}

/* ─── Helper de tiempo ─────────────────────────────────────────────────── */
/** Unix en SEGUNDOS, hace N horas. WhatsApp y ElevenLabs usan segundos. */
function hace(horas) {
  return Math.floor((Date.now() - horas * 60 * 60 * 1000) / 1000);
}

/* ═══════════════════════════════════════════════════════════════════════
   WhatsApp — 3 conversaciones
   ═══════════════════════════════════════════════════════════════════════ */

/* Ana Martínez Soto — pregunta por cita y confirma horario. Termina con
   un mensaje de audio, para cubrir el caso type:"audio". */
const PAYLOAD_WA_1 = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA_10029384756",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "525591234567", phone_number_id: "1234567890" },
        contacts: [{ profile: { name: "Ana Martínez" }, wa_id: "525588112233" }],
        messages: [
          { from: "525588112233", id: "wamid.HBgNMzAxMDA=A1", timestamp: String(hace(140)), type: "text", text: { body: "Hola buenas tardes, ¿tienen espacio para consulta esta semana?" } },
          { from: "525588112233", id: "wamid.HBgNMzAxMDA=A2", timestamp: String(hace(139)), type: "text", text: { body: "Es para revisión, me han dado dolores de cabeza seguido" } },
          { from: "525588112233", id: "wamid.HBgNMzAxMDA=A3", timestamp: String(hace(136)), type: "text", text: { body: "El jueves a las 9 me queda perfecto, gracias" } },
          {
            from: "525588112233", id: "wamid.HBgNMzAxMDA=A4", timestamp: String(hace(20)), type: "audio",
            audio: { id: "MEDIA-AUDIO-91827", mime_type: "audio/ogg; codecs=opus", voice: true, duracion: 14, transcripcion: "Oiga doctor, se me olvidó preguntar si tengo que ir en ayunas para la consulta del jueves" },
          },
        ],
      },
    }],
  }],
};

/* Carlos Ramírez Luna — quiere reprogramar su cita de traumatología. */
const PAYLOAD_WA_2 = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA_10029384756",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "525591234567", phone_number_id: "1234567890" },
        contacts: [{ profile: { name: "Carlos Ramírez" }, wa_id: "525544557788" }],
        messages: [
          { from: "525544557788", id: "wamid.HBgNMzAxMDA=B1", timestamp: String(hace(70)), type: "text", text: { body: "Buenas, tengo cita el sábado con el Dr. Jiménez pero se me complicó el horario" } },
          { from: "525544557788", id: "wamid.HBgNMzAxMDA=B2", timestamp: String(hace(69)), type: "text", text: { body: "¿La podríamos mover para la próxima semana, en la tarde?" } },
          { from: "525544557788", id: "wamid.HBgNMzAxMDA=B3", timestamp: String(hace(68)), type: "text", text: { body: "Sigo con molestia en la rodilla pero ya menos que antes" } },
        ],
      },
    }],
  }],
};

/* Teléfono que NO existe en pacientes — lead nuevo sin perfil todavía. */
const PAYLOAD_WA_3 = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA_10029384756",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "525591234567", phone_number_id: "1234567890" },
        contacts: [{ profile: { name: "Fernanda Ocampo" }, wa_id: "525533011122" }],
        messages: [
          { from: "525533011122", id: "wamid.HBgNMzAxMDA=C1", timestamp: String(hace(30)), type: "text", text: { body: "Hola, vi su anuncio en Facebook. ¿Cuánto cuesta la consulta de dermatología?" } },
          { from: "525533011122", id: "wamid.HBgNMzAxMDA=C2", timestamp: String(hace(29)), type: "text", text: { body: "Es para una revisión de unos lunares, nunca he ido con ustedes" } },
        ],
      },
    }],
  }],
};

/* ═══════════════════════════════════════════════════════════════════════
   Voz (ElevenLabs Agents) — 2 conversaciones
   ═══════════════════════════════════════════════════════════════════════ */

/* Roberto García Vega — llamada exitosa, agenda seguimiento de cardiología. */
const PAYLOAD_11L_1 = {
  type: "post_call_transcription",
  event_timestamp: hace(95),
  data: {
    agent_id: "agent_recepcion_medicita",
    conversation_id: "conv_01k2hqx8p7z9a3vwe",
    status: "done",
    transcript: [
      { role: "agent", message: "Consultorio del Dr. Andrés Vega, buenas tardes, ¿en qué le puedo ayudar?", time_in_call_secs: 0 },
      { role: "user", message: "Hola, buenas tardes, quiero confirmar mi cita de seguimiento de cardiología", time_in_call_secs: 5 },
      { role: "agent", message: "Con gusto, ¿me podría dar su nombre completo para buscar su cita?", time_in_call_secs: 11 },
      { role: "user", message: "Roberto García Vega", time_in_call_secs: 16 },
      { role: "agent", message: "Encontré su cita para mañana a las 11 de la mañana con el Dr. Vega, ¿la confirmamos así?", time_in_call_secs: 22 },
      { role: "user", message: "Sí, así está bien. Oiga, y aprovechando, ¿tengo que llevar mis estudios de sangre anteriores?", time_in_call_secs: 31 },
      { role: "agent", message: "Sí, por favor lleve los resultados más recientes que tenga, eso ayuda mucho al doctor", time_in_call_secs: 40 },
      { role: "user", message: "Perfecto, muchas gracias, ahí nos vemos", time_in_call_secs: 47 },
    ],
    metadata: {
      start_time_unix_secs: hace(95),
      call_duration_secs: 132,
      phone_call: { external_number: "+525599224455" },
    },
    analysis: {
      transcript_summary: "El paciente Roberto García confirmó su cita de seguimiento de cardiología de mañana y preguntó si debe llevar estudios de sangre previos.",
      call_successful: "success",
    },
  },
};

/* Llamada fallida — el agente de voz no logró resolver la solicitud.
   El adaptador debe marcarla como requiere_atencion_humana. */
const PAYLOAD_11L_2 = {
  type: "post_call_transcription",
  event_timestamp: hace(50),
  data: {
    agent_id: "agent_recepcion_medicita",
    conversation_id: "conv_01k2hr45m2xq7dpta",
    status: "done",
    transcript: [
      { role: "agent", message: "Consultorio médico, buenas tardes, ¿en qué le ayudo?", time_in_call_secs: 0 },
      { role: "user", message: "Hola, necesito hablar con el doctor urgente, mi mamá lleva tres días con fiebre alta", time_in_call_secs: 4 },
      { role: "agent", message: "Entiendo su preocupación. Puedo agendarle una cita de urgencia, ¿me confirma el nombre de la paciente?", time_in_call_secs: 10 },
      { role: "user", message: "Es Valentina López, pero necesito que alguien la vea hoy mismo, no mañana", time_in_call_secs: 18 },
      { role: "agent", message: "Por el momento no tengo espacios disponibles hoy en el sistema, lo más pronto que veo es hasta mañana temprano", time_in_call_secs: 27 },
      { role: "user", message: "No, eso no me sirve, necesito que alguien me llame ahorita, es urgente", time_in_call_secs: 35 },
    ],
    metadata: {
      start_time_unix_secs: hace(50),
      call_duration_secs: 58,
      phone_call: { external_number: "+525566779900" },
    },
    analysis: {
      transcript_summary: "Familiar de la paciente Valentina López solicitó atención urgente por fiebre persistente. El agente no encontró espacio disponible el mismo día y el usuario colgó insatisfecho; requiere que alguien le devuelva la llamada.",
      call_successful: "failure",
    },
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   MediBot — 2 conversaciones (array `conversacion` de chat.js)
   ═══════════════════════════════════════════════════════════════════════ */

/* Lucía Torres Reyes (vía mamá) — agenda cita de pediatría con tools reales. */
const CONV_MEDIBOT_1 = [
  { role: "user", content: "Hola, quiero agendar una cita para mi hija con pediatría" },
  {
    role: "assistant",
    content: [{ type: "text", text: "¡Claro que sí! Con gusto la agendo. Déjame revisar qué doctores tenemos disponibles en pediatría." }, { type: "tool_use", id: "toolu_01_ped_a", name: "listar_doctores", input: { especialidad: "Pediatría" } }],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_01_ped_a", content: JSON.stringify([{ nombre: "Dra. Sofía Herrera", especialidadId: 3, horarios: ["09:00", "10:00", "11:00", "15:00", "16:00"] }]) }],
  },
  { role: "assistant", content: [{ type: "text", text: "Tenemos a la Dra. Sofía Herrera en pediatría. ¿Qué día le acomoda más y con qué motivo sería la consulta?" }] },
  { role: "user", content: "Sería para el jueves, es la revisión de los 12 meses de mi hija Lucía Torres Reyes" },
  {
    role: "assistant",
    content: [{ type: "text", text: "Perfecto, voy a buscar si ya tiene alguna cita registrada para no duplicarla." }, { type: "tool_use", id: "toolu_01_ped_b", name: "buscar_paciente", input: { nombre: "Lucía Torres Reyes" } }],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_01_ped_b", content: JSON.stringify({ encontrado: true, telefono: "55 3344 6677", foliosCitas: ["CIT-260602-1190"] }) }],
  },
  { role: "assistant", content: [{ type: "text", text: "Veo que ya tiene una cita registrada para hoy a las 10:00 con la Dra. Sofía Herrera, revisión de rutina de 12 meses. ¿Es correcto o necesita otra fecha distinta?" }] },
  { role: "user", content: "Ah es cierto, se me había olvidado que ya la había agendado. Está bien así, gracias" },
  { role: "assistant", content: [{ type: "text", text: "Con mucho gusto. La esperamos hoy a las 10:00 con la Dra. Herrera. Cualquier otra cosa que necesite, aquí estamos." }] },
];

/* Lead nuevo sin perfil — pregunta general de especialidades y costos, sin
   llegar a agendar. Usa listar_especialidades y buscar_citas. */
const CONV_MEDIBOT_2 = [
  { role: "user", content: "Buenas, ¿qué especialidades manejan y si tienen oftalmología?" },
  {
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_02_oft_a", name: "listar_especialidades", input: {} }],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_02_oft_a", content: JSON.stringify(["Medicina General", "Cardiología", "Pediatría", "Ginecología", "Traumatología", "Dermatología", "Oftalmología", "Neurología"]) }],
  },
  { role: "assistant", content: [{ type: "text", text: "Sí, manejamos ocho especialidades, entre ellas Oftalmología con el Dr. Miguel Ángel Flores. ¿Es primera vez que viene con nosotros?" }] },
  { role: "user", content: "Sí, es la primera vez. Tengo una cita ya con ustedes hace tiempo pero no recuerdo el folio, ¿me pueden ayudar a buscarla?" },
  {
    role: "assistant",
    content: [{ type: "text", text: "Claro, déjeme revisar si encuentro alguna cita a su nombre." }, { type: "tool_use", id: "toolu_02_oft_b", name: "buscar_citas", input: { texto: "Miguel Hernández Ríos" } }],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_02_oft_b", content: JSON.stringify([{ folio: "CIT-260603-2211", especialidad: "Oftalmología", doctor: "Dr. Miguel Ángel Flores", estado: "confirmada" }]) }],
  },
  { role: "assistant", content: [{ type: "text", text: "Encontré su cita CIT-260603-2211, control post-operatorio de cataratas con el Dr. Miguel Ángel Flores, ya confirmada. ¿Necesita algo más?" }] },
  { role: "user", content: "Perfecto, era justo esa. Muchas gracias" },
];

/* ═══════════════════════════════════════════════════════════════════════
   Chat web — 1 conversación (widget del sitio)
   ═══════════════════════════════════════════════════════════════════════ */

/* Patricia Morales Díaz — pregunta por resultados de laboratorio y receta
   de control desde el widget del sitio. */
const PAYLOAD_CHATWEB_1 = {
  sesionId: "web_9a3f7c21",
  nombre: "Patricia Morales",
  telefono: "55 1100 2233",
  url: "https://medicita-demo.symbiotiq.mx/index.html",
  mensajes: [
    { de: "visitante", texto: "Hola, ¿ya están mis resultados de laboratorio? Me los debieron mandar hace días", fecha: hace(60) * 1000 },
    { de: "agente", autor: "Recepción", texto: "Buenas tardes Patricia, permítame reviso con la Dra. Elena Castillo y le confirmo en un momento", fecha: hace(59.5) * 1000 },
    { de: "visitante", texto: "Ok gracias, también quería pedir mi receta de control, ya se me está acabando el medicamento", fecha: hace(59) * 1000 },
    { de: "agente", autor: "Recepción", texto: "Claro, la doctora puede renovarle la receta sin necesidad de consulta presencial. Se la dejamos lista para recoger mañana", fecha: hace(58) * 1000 },
    { de: "visitante", texto: "Perfecto, paso mañana en la tarde por ambas cosas entonces", fecha: hace(57.5) * 1000 },
  ],
};

/* ═══════════════════════════════════════════════════════════════════════
   Dataset final — payloads crudos pasados por sus adaptadores
   ═══════════════════════════════════════════════════════════════════════ */
const CONVERSACIONES_DEMO = [
  adaptarWhatsApp(PAYLOAD_WA_1),
  adaptarWhatsApp(PAYLOAD_WA_2),
  adaptarWhatsApp(PAYLOAD_WA_3),
  adaptarVozElevenLabs(PAYLOAD_11L_1),
  adaptarVozElevenLabs(PAYLOAD_11L_2),
  adaptarMediBot(CONV_MEDIBOT_1, { sesionId: "sess_medibot_lucia_01", telefono: "55 3344 6677", nombreContacto: "Mamá de Lucía Torres" }),
  adaptarMediBot(CONV_MEDIBOT_2, { sesionId: "sess_medibot_miguel_01", telefono: "55 7788 0011", nombreContacto: "Miguel Hernández Ríos" }),
  adaptarChatWeb(PAYLOAD_CHATWEB_1),
];

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONVERSACIONES_DEMO };
}
