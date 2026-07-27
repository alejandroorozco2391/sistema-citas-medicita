/* Pruebas de los normalizadores por canal.
   Son funciones puras, así que no necesitan DOM ni localStorage. */

const test = require("node:test");
const assert = require("node:assert");

const {
  adaptarMediBot,
  adaptarWhatsApp,
  adaptarVozElevenLabs,
  adaptarChatWeb,
  adaptar,
} = require("../js/conversaciones-adapters.js");

/* ═══ MediBot ═══════════════════════════════════════════════════════════ */

test("MediBot: los tool_result no se cuelan al hilo como mensajes del paciente", () => {
  const conversacion = [
    { role: "user", content: "Hola, quiero una cita" },
    { role: "assistant", content: [{ type: "text", text: "¡Claro! ¿Qué especialidad?" }] },
    { role: "user", content: "Dermatología" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "listar_doctores", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "[...]" }] },
    { role: "assistant", content: [{ type: "text", text: "Tenemos a la Dra. Isabel Torres." }] },
  ];

  const { mensajes } = adaptarMediBot(conversacion, { telefono: "5588112233" });

  const dePaciente = mensajes.filter(m => m.remitente === "paciente");
  assert.strictEqual(dePaciente.length, 2, "solo los 2 turnos de texto real del paciente");
  assert.deepStrictEqual(
    dePaciente.map(m => m.contenido),
    ["Hola, quiero una cita", "Dermatología"]
  );
  assert.ok(
    !mensajes.some(m => m.contenido.includes("tool_result")),
    "ningún mensaje debe contener fontanería de tool use"
  );
});

test("MediBot: un turno que solo usa herramientas deja rastro de sistema", () => {
  const { mensajes } = adaptarMediBot([
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "buscar_citas", input: {} }] },
  ]);

  assert.strictEqual(mensajes.length, 1);
  assert.strictEqual(mensajes[0].remitente, "sistema");
  assert.strictEqual(mensajes[0].tipo, "sistema");
  assert.deepStrictEqual(mensajes[0].metadata.herramientas, ["buscar_citas"]);
});

test("MediBot: las herramientas usadas se guardan como metadata del mensaje del agente", () => {
  const { mensajes } = adaptarMediBot([
    {
      role: "assistant",
      content: [
        { type: "text", text: "Ya la agendé." },
        { type: "tool_use", id: "t1", name: "crear_cita", input: {} },
      ],
    },
  ]);

  const agente = mensajes.find(m => m.remitente === "agente");
  assert.strictEqual(agente.contenido, "Ya la agendé.");
  assert.deepStrictEqual(agente.metadata.herramientas, ["crear_cita"]);
});

test("MediBot: el asunto sale del primer mensaje del paciente", () => {
  const { conversacion } = adaptarMediBot(
    [{ role: "user", content: "Necesito reprogramar mi cita del jueves" }],
    { sesionId: "ses_1" }
  );
  assert.match(conversacion.asunto, /reprogramar/);
  assert.strictEqual(conversacion.claveExterna, "ses_1");
  assert.strictEqual(conversacion.canal, "medibot");
});

/* ═══ WhatsApp ══════════════════════════════════════════════════════════ */

const PAYLOAD_WA = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5255000011", phone_number_id: "999" },
            contacts: [{ profile: { name: "Ana Martínez" }, wa_id: "525588112233" }],
            messages: [
              {
                from: "525588112233",
                id: "wamid.AAA",
                timestamp: "1719420000",
                type: "text",
                text: { body: "¿Tienen consulta mañana?" },
              },
              {
                from: "525588112233",
                id: "wamid.BBB",
                timestamp: "1719420060",
                type: "audio",
                audio: { id: "media_1", mime_type: "audio/ogg; codecs=opus", voice: true, duracion: 14 },
              },
            ],
          },
        },
      ],
    },
  ],
};

test("WhatsApp: extrae teléfono, nombre y ambos mensajes", () => {
  const { conversacion, mensajes } = adaptarWhatsApp(PAYLOAD_WA);

  assert.strictEqual(conversacion.canal, "whatsapp");
  assert.strictEqual(conversacion.telefono, "525588112233");
  assert.strictEqual(conversacion.nombreContacto, "Ana Martínez");
  assert.strictEqual(conversacion.canalMeta.phoneNumberId, "999");
  assert.strictEqual(mensajes.length, 2);
});

test("WhatsApp: el hilo es continuo, sin claveExterna (upsert por canal+teléfono)", () => {
  const { conversacion } = adaptarWhatsApp(PAYLOAD_WA);
  assert.strictEqual(conversacion.claveExterna, null);
});

test("WhatsApp: el mensaje de voz se marca como audio y conserva la duración", () => {
  const { mensajes } = adaptarWhatsApp(PAYLOAD_WA);
  const audio = mensajes.find(m => m.tipo === "audio");
  assert.ok(audio, "debe existir un mensaje de tipo audio");
  assert.strictEqual(audio.duracionSeg, 14);
  assert.match(audio.audioUrl, /media_1/);
});

test("WhatsApp: los ids del proveedor se preservan para idempotencia", () => {
  const { mensajes } = adaptarWhatsApp(PAYLOAD_WA);
  assert.strictEqual(mensajes[0].id, "MSG-wa-wamid.AAA");
  assert.strictEqual(mensajes[0].metadata.waMessageId, "wamid.AAA");
});

test("WhatsApp: el timestamp unix en segundos se convierte bien a ISO", () => {
  const { mensajes } = adaptarWhatsApp(PAYLOAD_WA);
  assert.strictEqual(mensajes[0].fecha, new Date(1719420000 * 1000).toISOString());
});

/* ═══ Voz — ElevenLabs ══════════════════════════════════════════════════ */

function payloadVoz(resultado) {
  return {
    type: "post_call_transcription",
    event_timestamp: 1719420000,
    data: {
      agent_id: "agent_1",
      conversation_id: "conv_abc",
      status: "done",
      transcript: [
        { role: "agent", message: "Consultorio, ¿en qué le ayudo?", time_in_call_secs: 0 },
        { role: "user", message: "Quiero agendar con cardiología", time_in_call_secs: 6 },
        { role: "agent", message: "", time_in_call_secs: 9 },
      ],
      metadata: {
        start_time_unix_secs: 1719420000,
        call_duration_secs: 132,
        phone_call: { external_number: "+525599224455" },
      },
      analysis: { transcript_summary: "El paciente pidió cita de cardiología.", call_successful: resultado },
    },
  };
}

test("Voz: mapea los roles de ElevenLabs a remitentes del inbox", () => {
  const { mensajes } = adaptarVozElevenLabs(payloadVoz("success"));
  assert.strictEqual(mensajes[0].remitente, "agente");
  assert.strictEqual(mensajes[1].remitente, "paciente");
  assert.ok(mensajes.every(m => m.tipo === "transcripcion"));
});

test("Voz: descarta entradas de transcripción vacías", () => {
  const { mensajes } = adaptarVozElevenLabs(payloadVoz("success"));
  assert.strictEqual(mensajes.length, 2, "la tercera entrada venía vacía");
});

test("Voz: una llamada fallida entra como requiere_atencion_humana", () => {
  const { conversacion } = adaptarVozElevenLabs(payloadVoz("failure"));
  assert.strictEqual(conversacion.estado, "requiere_atencion_humana");
});

test("Voz: una llamada exitosa entra como resuelta", () => {
  const { conversacion } = adaptarVozElevenLabs(payloadVoz("success"));
  assert.strictEqual(conversacion.estado, "resuelta");
});

test("Voz: identidad por conversation_id y metadatos de la llamada", () => {
  const { conversacion } = adaptarVozElevenLabs(payloadVoz("success"));
  assert.strictEqual(conversacion.claveExterna, "conv_abc");
  assert.strictEqual(conversacion.canalMeta.proveedor, "elevenlabs");
  assert.strictEqual(conversacion.canalMeta.duracionSeg, 132);
  assert.strictEqual(conversacion.telefono, "+525599224455");
  assert.match(conversacion.asunto, /cardiología/);
});

test("Voz: la fecha de cada línea se desplaza por time_in_call_secs", () => {
  const { mensajes } = adaptarVozElevenLabs(payloadVoz("success"));
  const t0 = new Date(mensajes[0].fecha).getTime();
  const t1 = new Date(mensajes[1].fecha).getTime();
  assert.strictEqual((t1 - t0) / 1000, 6);
});

/* ═══ Chat web ══════════════════════════════════════════════════════════ */

test("Chat web: distingue visitante de agente", () => {
  const { conversacion, mensajes } = adaptarChatWeb({
    sesionId: "web_1",
    nombre: "Carlos",
    telefono: "5544557788",
    mensajes: [
      { de: "visitante", texto: "¿Cuánto cuesta la consulta?", fecha: 1719420000 },
      { de: "agente", autor: "Recepción", texto: "Con gusto le informo.", fecha: 1719420030 },
    ],
  });

  assert.strictEqual(conversacion.canal, "chat_web");
  assert.strictEqual(mensajes[0].remitente, "paciente");
  assert.strictEqual(mensajes[1].remitente, "agente");
  assert.strictEqual(mensajes[1].autorNombre, "Recepción");
});

/* ═══ Registro ══════════════════════════════════════════════════════════ */

test("adaptar() despacha al adaptador correcto por canal", () => {
  const r = adaptar("whatsapp", PAYLOAD_WA);
  assert.strictEqual(r.conversacion.canal, "whatsapp");
});

test("adaptar() falla claro ante un canal sin adaptador", () => {
  assert.throws(() => adaptar("telegram", {}), /Canal sin adaptador/);
});

test("los adaptadores no truenan con payloads vacíos", () => {
  assert.doesNotThrow(() => adaptarWhatsApp({}));
  assert.doesNotThrow(() => adaptarVozElevenLabs({}));
  assert.doesNotThrow(() => adaptarChatWeb({}));
  assert.doesNotThrow(() => adaptarMediBot([]));
});
