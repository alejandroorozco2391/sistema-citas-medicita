/* ─── Estado ──────────────────────────────────────────────────────────── */
const API_URL = "https://api.anthropic.com/v1/messages";
let apiKey = "";
let modelo = "claude-sonnet-4-6";
let conversacion = [];
let procesando = false;
let ejsServiceId = "";
let ejsTemplateId = "";
let ejsPublicKey = "";

/* ─── System prompt ───────────────────────────────────────────────────── */
function buildSystemPrompt() {
  const ahora = new Date().toLocaleString("es-MX", {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Eres MediBot, el asistente virtual de MediCita, una clínica médica en México. Hablas únicamente en español de México, con tono amigable, empático y profesional. Usas lenguaje claro y accesible, sin tecnicismos innecesarios.

Fecha y hora actual: ${ahora}

HERRAMIENTAS DISPONIBLES:
• listar_especialidades — Lista todas las especialidades de la clínica con descripción
• listar_doctores — Lista médicos disponibles con horarios; filtrable por especialidad_id
• leer_todas_las_citas — Lee todas las citas del sistema
• buscar_citas — Busca citas por nombre, folio, fecha, médico o estado
• crear_cita — Registra una nueva cita (solo tras confirmar datos con el usuario)
• actualizar_estado_cita — Cambia estado: pendiente | confirmada | atendida | cancelada
• eliminar_cita — Elimina permanentemente una cita (solo tras confirmación explícita)

FLUJO PARA AGENDAR CITA (sigue este orden exacto):
1. Obtén: nombre completo y teléfono del paciente
2. Especialidad — si no sabe cuál, oriéntalo según sus síntomas
3. Llama a listar_doctores para mostrar opciones con horarios disponibles
4. Médico, fecha (YYYY-MM-DD) y hora (HH:MM — debe ser un horario del médico)
5. Tipo: Primera vez | Seguimiento | Urgencia | Revisión preventiva
6. Motivo / notas (opcional)
7. Presenta un resumen claro y pide confirmación explícita antes de llamar a crear_cita
8. Tras crear la cita, muestra el folio como: [FOLIO: CIT-XXXXXX-XXXX]

ESTRUCTURA DE UNA CITA:
{ folio, nombre, apellidos, telefono, email, especialidad, doctor,
  fecha (YYYY-MM-DD), hora (HH:MM), tipo, notas,
  estado: pendiente|confirmada|atendida|cancelada, creadaEn }

REGLAS:
• Siempre confirma antes de crear, modificar o eliminar citas
• Si el usuario menciona síntomas, sugiere la especialidad adecuada
• Para consultar citas de un paciente, pide el nombre si no lo proporciona
• Si no hay citas o médicos que coincidan, infórmalo con claridad

ENVÍO AUTOMÁTICO DE EMAIL:
Tienes la herramienta enviar_email_paciente. Úsala DESPUÉS de (y solo si el paciente tiene email registrado):
• Crear una cita exitosa → accion = "creada"
• Confirmar una cita → accion = "confirmada"
• Cancelar una cita → accion = "cancelada"
• Cambiar cualquier estado → usa el nuevo estado como accion
Si el resultado indica que EmailJS no está configurado, ignóralo y continúa sin mencionarlo al usuario.
Si el envío es exitoso, informa brevemente: "✉️ Se envió un email de confirmación a [email]."

FORMATO:
• Texto plano con saltos de línea — sin markdown con ** ni ##
• Listas con el símbolo •
• Datos de citas de forma organizada y legible`;
}

/* ─── Definición de herramientas ──────────────────────────────────────── */
const TOOLS = [
  {
    name: "listar_especialidades",
    description: "Devuelve todas las especialidades médicas de la clínica.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "listar_doctores",
    description: "Devuelve médicos disponibles con sus horarios. Filtrable por especialidad.",
    input_schema: {
      type: "object",
      properties: {
        especialidad_id: { type: "number", description: "ID de la especialidad (opcional)" },
      },
      required: [],
    },
  },
  {
    name: "leer_todas_las_citas",
    description: "Lee y devuelve todas las citas guardadas en el sistema.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "buscar_citas",
    description: "Busca citas con filtros opcionales.",
    input_schema: {
      type: "object",
      properties: {
        nombre:  { type: "string", description: "Nombre o apellido (búsqueda parcial)" },
        folio:   { type: "string", description: "Folio exacto de la cita" },
        fecha:   { type: "string", description: "Fecha YYYY-MM-DD" },
        doctor:  { type: "string", description: "Nombre parcial del médico" },
        estado:  { type: "string", enum: ["pendiente", "confirmada", "atendida", "cancelada"] },
      },
      required: [],
    },
  },
  {
    name: "crear_cita",
    description: "Crea una nueva cita. Llamar SOLO después de confirmar datos con el usuario.",
    input_schema: {
      type: "object",
      properties: {
        nombre:      { type: "string" },
        apellidos:   { type: "string" },
        telefono:    { type: "string" },
        email:       { type: "string" },
        especialidad:{ type: "string" },
        doctor:      { type: "string", description: "Nombre completo del médico" },
        fecha:       { type: "string", description: "Fecha YYYY-MM-DD" },
        hora:        { type: "string", description: "Hora HH:MM del horario del médico" },
        tipo:        { type: "string", enum: ["Primera vez","Seguimiento","Urgencia","Revisión preventiva"] },
        notas:       { type: "string" },
      },
      required: ["nombre","apellidos","telefono","especialidad","doctor","fecha","hora","tipo"],
    },
  },
  {
    name: "actualizar_estado_cita",
    description: "Cambia el estado de una cita existente.",
    input_schema: {
      type: "object",
      properties: {
        folio:        { type: "string" },
        nuevo_estado: { type: "string", enum: ["pendiente","confirmada","atendida","cancelada"] },
      },
      required: ["folio","nuevo_estado"],
    },
  },
  {
    name: "eliminar_cita",
    description: "Elimina permanentemente una cita. Llamar solo con confirmación explícita del usuario.",
    input_schema: {
      type: "object",
      properties: {
        folio: { type: "string" },
      },
      required: ["folio"],
    },
  },
  {
    name: "enviar_email_paciente",
    description: "Envía un email HTML automático al paciente notificando el estado de su cita. Llamar después de crear, confirmar, cancelar o modificar una cita, solo si el paciente tiene email.",
    input_schema: {
      type: "object",
      properties: {
        folio:           { type: "string", description: "Folio de la cita" },
        nombre_paciente: { type: "string", description: "Nombre completo del paciente" },
        email_paciente:  { type: "string", description: "Dirección de email del paciente" },
        accion:          { type: "string", enum: ["creada","confirmada","cancelada","pendiente","atendida"], description: "Acción realizada sobre la cita" },
        detalles_cita: {
          type: "object",
          description: "Datos completos de la cita para incluir en el email",
          properties: {
            especialidad: { type: "string" },
            doctor:       { type: "string" },
            fecha:        { type: "string", description: "YYYY-MM-DD" },
            hora:         { type: "string" },
            tipo:         { type: "string" },
            notas:        { type: "string" },
          },
        },
      },
      required: ["folio","nombre_paciente","email_paciente","accion","detalles_cita"],
    },
  },
];

/* ─── Ejecución de herramientas (localStorage) ────────────────────────── */
async function ejecutarHerramienta(nombre, p) {
  try {
    switch (nombre) {
      case "listar_especialidades":
        return JSON.stringify(
          ESPECIALIDADES.map(({ id, nombre, descripcion, icono }) => ({ id, nombre, descripcion, icono }))
        );

      case "listar_doctores": {
        const docs = p.especialidad_id
          ? DOCTORES.filter(d => d.especialidadId === Number(p.especialidad_id))
          : DOCTORES;
        return JSON.stringify(docs.map(d => ({
          id: d.id, nombre: d.nombre,
          especialidad: ESPECIALIDADES.find(e => e.id === d.especialidadId)?.nombre ?? "",
          horarios: d.horarios,
        })));
      }

      case "leer_todas_las_citas":
        return localStorage.getItem("medicita_citas") ?? "[]";

      case "buscar_citas": {
        const todas = JSON.parse(localStorage.getItem("medicita_citas") ?? "[]");
        return JSON.stringify(todas.filter(c => {
          if (p.folio  && c.folio !== p.folio) return false;
          if (p.fecha  && c.fecha !== p.fecha) return false;
          if (p.estado && c.estado !== p.estado) return false;
          if (p.doctor && !c.doctor.toLowerCase().includes(p.doctor.toLowerCase())) return false;
          if (p.nombre) {
            const full = `${c.nombre} ${c.apellidos}`.toLowerCase();
            if (!full.includes(p.nombre.toLowerCase())) return false;
          }
          return true;
        }));
      }

      case "crear_cita": {
        const citas = JSON.parse(localStorage.getItem("medicita_citas") ?? "[]");
        const folio = generarFolio();
        citas.unshift({
          folio, estado: "pendiente", creadaEn: new Date().toISOString(),
          nombre: p.nombre, apellidos: p.apellidos, telefono: p.telefono,
          email: p.email ?? "", especialidad: p.especialidad, doctor: p.doctor,
          fecha: p.fecha, hora: p.hora, tipo: p.tipo, notas: p.notas ?? "",
        });
        localStorage.setItem("medicita_citas", JSON.stringify(citas));
        return JSON.stringify({ exito: true, folio });
      }

      case "actualizar_estado_cita": {
        const citas = JSON.parse(localStorage.getItem("medicita_citas") ?? "[]");
        const idx = citas.findIndex(c => c.folio === p.folio);
        if (idx === -1) return JSON.stringify({ exito: false, error: "Cita no encontrada" });
        citas[idx].estado = p.nuevo_estado;
        localStorage.setItem("medicita_citas", JSON.stringify(citas));
        return JSON.stringify({ exito: true, folio: p.folio, nuevo_estado: p.nuevo_estado });
      }

      case "eliminar_cita": {
        const citas = JSON.parse(localStorage.getItem("medicita_citas") ?? "[]");
        const nuevas = citas.filter(c => c.folio !== p.folio);
        if (nuevas.length === citas.length) return JSON.stringify({ exito: false, error: "Cita no encontrada" });
        localStorage.setItem("medicita_citas", JSON.stringify(nuevas));
        return JSON.stringify({ exito: true, folio: p.folio });
      }

      case "enviar_email_paciente":
        return JSON.stringify(await sendEmailToPatient(p));

      default:
        return JSON.stringify({ error: `Herramienta desconocida: ${nombre}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

/* ─── Loop agéntico ───────────────────────────────────────────────────── */
async function procesarMensaje(texto) {
  if (!texto.trim() || procesando) return;
  procesando = true;

  conversacion.push({ role: "user", content: texto });
  agregarBurbuja(texto, "enviado");
  setInput("");
  setInputHabilitado(false);
  setEscribiendo(true, "Escribiendo");

  try {
    for (let i = 0; i < 12; i++) {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 1024,
          system: buildSystemPrompt(),
          tools: TOOLS,
          messages: conversacion,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message ?? `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      conversacion.push({ role: "assistant", content: data.content });

      if (data.stop_reason === "end_turn") {
        const respText = data.content
          .filter(b => b.type === "text")
          .map(b => b.text)
          .join("\n\n");
        setEscribiendo(false);
        agregarBurbuja(respText, "recibido");
        break;
      }

      if (data.stop_reason === "tool_use") {
        const resultados = [];
        for (const bloque of data.content) {
          if (bloque.type !== "tool_use") continue;
          setEscribiendo(true, labelHerramienta(bloque.name));
          const resultado = await ejecutarHerramienta(bloque.name, bloque.input);
          resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
        }
        conversacion.push({ role: "user", content: resultados });
        setEscribiendo(true, "Escribiendo");
      }
    }
  } catch (err) {
    setEscribiendo(false);
    const esAuth = err.message.includes("401") || err.message.toLowerCase().includes("authentication");
    agregarBurbuja(
      esAuth
        ? "API Key inválida o sin permisos. Verifica tu clave de Anthropic."
        : `Error de conexión: ${err.message}`,
      "error"
    );
  } finally {
    procesando = false;
    setEscribiendo(false);
    setInputHabilitado(true);
    document.getElementById("input-mensaje").focus();
  }
}

/* ─── UI ──────────────────────────────────────────────────────────────── */
function agregarBurbuja(texto, tipo) {
  const area = document.getElementById("area-mensajes");
  const wrapper = document.createElement("div");

  if (tipo === "enviado") {
    wrapper.className = "msg-w enviado";
    wrapper.innerHTML = `<div class="burbuja b-out">${esc(texto)}<div class="burbuja-ts">${hora()}</div></div>`;
  } else if (tipo === "recibido") {
    wrapper.className = "msg-w recibido";
    wrapper.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">🤖</div>
      <div class="burbuja b-in">${fmt(texto)}<div class="burbuja-ts">${hora()}</div></div>`;
  } else {
    wrapper.className = "msg-w recibido";
    wrapper.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">⚠️</div>
      <div class="burbuja b-err">⚠️ ${esc(texto)}<div class="burbuja-ts">${hora()}</div></div>`;
  }

  area.appendChild(wrapper);
  scrollAbajo();
}

function agregarBienvenida() {
  const area = document.getElementById("area-mensajes");

  const sep = document.createElement("div");
  sep.className = "sep-fecha";
  sep.innerHTML = `<span>Hoy · ${new Date().toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}</span>`;
  area.appendChild(sep);

  const CHIPS = [
    "¿Qué especialidades tienen?",
    "Quiero agendar una cita",
    "Ver mis citas pendientes",
    "¿Qué médicos hay disponibles?",
    "Necesito cancelar una cita",
    "¿Cuándo es mi próxima cita?",
  ];

  const wrapper = document.createElement("div");
  wrapper.className = "msg-w recibido";
  wrapper.innerHTML = `
    <div class="msg-avatar" aria-hidden="true">🤖</div>
    <div class="burbuja b-in">
      ¡Hola! Soy MediBot, el asistente virtual de MediCita 👋<br><br>
      Puedo ayudarte a <strong>consultar, agendar, modificar o cancelar citas</strong> médicas. También puedo darte información sobre nuestros especialistas y horarios disponibles.<br><br>
      ¿En qué puedo ayudarte hoy?
      <div class="sugerencias" id="chips-bienvenida">
        ${CHIPS.map(q => `<button class="chip">${esc(q)}</button>`).join("")}
      </div>
      <div class="burbuja-ts">${hora()}</div>
    </div>`;

  area.appendChild(wrapper);

  wrapper.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("chips-bienvenida")?.remove();
      procesarMensaje(btn.textContent);
    });
  });

  scrollAbajo();
}

function setEscribiendo(visible, texto) {
  const el = document.getElementById("typing-indicator");
  el.classList.toggle("oculto", !visible);
  if (texto) document.getElementById("typing-estado-texto").textContent = texto;
  if (visible) scrollAbajo();
}

function scrollAbajo() {
  const area = document.getElementById("area-mensajes");
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

function setInputHabilitado(ok) {
  const inp = document.getElementById("input-mensaje");
  const btn = document.getElementById("btn-enviar");
  inp.disabled = !ok;
  btn.disabled = !ok || inp.value.trim() === "";
}

function setInput(val) {
  const inp = document.getElementById("input-mensaje");
  inp.value = val;
  inp.style.height = "auto";
  actualizarBtn();
}

function actualizarBtn() {
  const btn = document.getElementById("btn-enviar");
  btn.disabled = procesando || document.getElementById("input-mensaje").value.trim() === "";
}

/* ─── Utilidades de texto ─────────────────────────────────────────────── */
function fmt(texto) {
  return esc(texto)
    .replace(/\n/g, "<br>")
    .replace(/• /g, '<span class="bullet">•</span> ')
    .replace(/(CIT-\d{6}-\d{4})/g, '<span class="folio-chip-msg">$1</span>');
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function hora() {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function generarFolio() {
  const d = new Date();
  return `CIT-${String(d.getFullYear()).slice(-2)}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${Math.floor(Math.random()*9000)+1000}`;
}

function labelHerramienta(nombre) {
  return {
    listar_especialidades:   "Consultando especialidades…",
    listar_doctores:         "Buscando médicos disponibles…",
    leer_todas_las_citas:    "Leyendo citas del sistema…",
    buscar_citas:            "Buscando citas…",
    crear_cita:              "Guardando la cita en el sistema…",
    actualizar_estado_cita:  "Actualizando estado de la cita…",
    eliminar_cita:           "Eliminando la cita…",
    enviar_email_paciente:   "Enviando email al paciente…",
  }[nombre] ?? "Procesando…";
}

/* ─── Email (EmailJS) ─────────────────────────────────────────────────── */
async function sendEmailToPatient(p) {
  if (!ejsPublicKey || !ejsServiceId || !ejsTemplateId) {
    return { exito: false, razon: "EmailJS no configurado — envío omitido." };
  }
  if (!p.email_paciente) {
    return { exito: false, razon: "El paciente no tiene email registrado." };
  }
  try {
    await emailjs.send(ejsServiceId, ejsTemplateId, {
      to_email:   p.email_paciente,
      to_name:    p.nombre_paciente,
      asunto:     asuntoEmail(p.accion, p.folio),
      html_email: buildEmailHTML(p),
    });
    return { exito: true, email_enviado_a: p.email_paciente };
  } catch (err) {
    return { exito: false, razon: err?.text ?? err?.message ?? "Error desconocido en EmailJS" };
  }
}

function asuntoEmail(accion, folio) {
  const t = {
    creada:     "Cita agendada exitosamente",
    confirmada: "Tu cita ha sido confirmada",
    cancelada:  "Aviso: tu cita ha sido cancelada",
    pendiente:  "Tu cita está pendiente de confirmación",
    atendida:   "Gracias por tu visita a MediCita",
  };
  return `${t[accion] ?? "Actualización de cita"} — ${folio}`;
}

function buildEmailHTML(p) {
  const EST = {
    creada:     { color:"#10b981", bg:"#d1fae5", text:"#065f46", icon:"📅", titulo:"¡Cita agendada!",     msg:"Tu cita ha sido <strong>registrada exitosamente</strong>. Guarda este correo como comprobante." },
    confirmada: { color:"#10b981", bg:"#d1fae5", text:"#065f46", icon:"✅", titulo:"Cita confirmada",      msg:"Tu cita ha sido <strong>confirmada</strong>. Por favor preséntate 15 minutos antes con identificación oficial." },
    cancelada:  { color:"#ef4444", bg:"#fee2e2", text:"#991b1b", icon:"✕",  titulo:"Cita cancelada",      msg:"Tu cita ha sido <strong>cancelada</strong>. Si deseas reagendar, visita nuestro sitio o llámanos." },
    pendiente:  { color:"#f59e0b", bg:"#fef3c7", text:"#92400e", icon:"⏳", titulo:"Cita pendiente",      msg:"Tu cita está <strong>pendiente de confirmación</strong>. Te contactaremos a la brevedad." },
    atendida:   { color:"#1a6eb5", bg:"#e8f2fc", text:"#0f4c8a", icon:"🩺", titulo:"Consulta atendida",   msg:"Tu consulta fue registrada como <strong>atendida</strong>. ¡Gracias por preferirnos!" },
  };
  const e  = EST[p.accion] ?? { color:"#6366f1", bg:"#ede9fe", text:"#3730a3", icon:"📋", titulo:"Actualización de cita", msg:"Los datos de tu cita han sido actualizados." };
  const d  = p.detalles_cita ?? {};
  const fq = d.fecha ? new Date(d.fecha + "T12:00:00").toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : "—";

  const notas = d.notas ? `
    <tr style="border-top:1px solid #e2e8f0;">
      <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">📝 Notas</td>
      <td style="padding:8px 0;font-size:13px;color:#374151;font-style:italic;">${d.notas}</td>
    </tr>` : "";

  const instr = (p.accion === "creada" || p.accion === "confirmada") ? `
    <div style="background:#f0f9ff;border-left:3px solid #1a6eb5;padding:12px 16px;margin:20px 0;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1a6eb5;text-transform:uppercase;letter-spacing:.06em;">Recuerda</p>
      <ul style="margin:0;padding-left:16px;color:#374151;font-size:13px;line-height:1.9;">
        <li>Llega 15 minutos antes de tu cita</li>
        <li>Trae una identificación oficial vigente</li>
        <li>Para cancelar, avísanos con al menos 24 h de anticipación</li>
      </ul>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px 10px;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;">

  <div style="background:linear-gradient(135deg,#0f4c8a 0%,#1a6eb5 100%);padding:32px 28px;border-radius:14px 14px 0 0;text-align:center;">
    <div style="font-size:40px;margin-bottom:12px;">🏥</div>
    <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em;">MediCita</h1>
    <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px;">Clínica Médica · Atención de calidad</p>
  </div>

  <div style="background:${e.bg};padding:20px 28px;text-align:center;border:1px solid rgba(0,0,0,.05);border-top:none;border-bottom:none;">
    <div style="font-size:30px;margin-bottom:8px;">${e.icon}</div>
    <h2 style="color:${e.text};margin:0;font-size:20px;font-weight:700;">${e.titulo}</h2>
  </div>

  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;">
    <p style="color:#374151;margin:0 0 14px;font-size:15px;">
      Estimado/a <strong>${p.nombre_paciente}</strong>,
    </p>
    <p style="color:#4b5563;margin:0 0 22px;font-size:14px;line-height:1.65;">${e.msg}</p>

    <div style="background:#f8fafc;border-radius:10px;padding:20px;border:1px solid #e2e8f0;">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;">Detalles de la cita</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#64748b;width:38%;">📋 Folio</td>
          <td style="padding:8px 0;font-family:'Courier New',monospace;font-size:13px;font-weight:800;color:#1a6eb5;">${p.folio}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">🩺 Especialidad</td>
          <td style="padding:8px 0;font-size:13px;font-weight:600;color:#374151;">${d.especialidad ?? "—"}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">👨‍⚕️ Médico</td>
          <td style="padding:8px 0;font-size:13px;color:#374151;">${d.doctor ?? "—"}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">📅 Fecha</td>
          <td style="padding:8px 0;font-size:13px;color:#374151;">${fq}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">⏰ Hora</td>
          <td style="padding:8px 0;font-size:13px;color:#374151;">${d.hora ?? "—"} hrs</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">📋 Tipo</td>
          <td style="padding:8px 0;font-size:13px;color:#374151;">${d.tipo ?? "—"}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:8px 0;font-size:13px;color:#64748b;">📊 Estado</td>
          <td style="padding:8px 0;">
            <span style="background:${e.bg};color:${e.text};padding:3px 12px;border-radius:50px;font-size:12px;font-weight:700;border:1px solid ${e.color}55;">${e.titulo}</span>
          </td>
        </tr>
        ${notas}
      </table>
    </div>

    ${instr}

    <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #f1f5f9;font-size:13px;color:#6b7280;line-height:1.6;">
      Cualquier duda, llámanos al <strong style="color:#374151;">55 1234 5678</strong> o escríbenos a
      <a href="mailto:contacto@medicita.mx" style="color:#1a6eb5;text-decoration:none;">contacto@medicita.mx</a>
    </p>
  </div>

  <div style="background:#0f172a;padding:18px 28px;border-radius:0 0 14px 14px;text-align:center;">
    <p style="color:rgba(255,255,255,.5);font-size:12px;margin:0;">MediCita · 55 1234 5678 · contacto@medicita.mx</p>
    <p style="color:rgba(255,255,255,.3);font-size:11px;margin:6px 0 0;">Lunes a Viernes 8:00–20:00 · Sábado 9:00–14:00</p>
    <p style="color:rgba(255,255,255,.18);font-size:10px;margin:10px 0 0;">Correo automático — por favor no respondas directamente a este mensaje.</p>
  </div>

</div>
</body>
</html>`;
}

/* ─── Inicialización ──────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  /* ── Pantalla de inicio ── */
  const keyInp   = document.getElementById("api-key-input");
  const btnToggle = document.getElementById("btn-toggle-key");
  const btnInicio = document.getElementById("btn-iniciar");
  const errorEl   = document.getElementById("inicio-error");
  const selMod    = document.getElementById("sel-modelo");

  btnToggle.addEventListener("click", () => {
    const show = keyInp.type === "password";
    keyInp.type = show ? "text" : "password";
  });

  keyInp.addEventListener("keydown", e => { if (e.key === "Enter") btnInicio.click(); });

  btnInicio.addEventListener("click", () => {
    const key = keyInp.value.trim();
    if (!key.startsWith("sk-ant-")) {
      errorEl.textContent = 'La clave debe comenzar con "sk-ant-". Verifica que sea válida.';
      keyInp.focus();
      return;
    }
    apiKey = key;
    modelo = selMod.value;
    ejsServiceId  = document.getElementById("ejs-service-id")?.value.trim() ?? "";
    ejsTemplateId = document.getElementById("ejs-template-id")?.value.trim() ?? "";
    ejsPublicKey  = document.getElementById("ejs-public-key")?.value.trim() ?? "";
    if (ejsPublicKey) emailjs.init({ publicKey: ejsPublicKey });
    errorEl.textContent = "";
    document.getElementById("pantalla-inicio").classList.add("oculto");
    document.getElementById("pantalla-chat").classList.remove("oculto");
    agregarBienvenida();
    document.getElementById("input-mensaje").focus();
  });

  /* ── Chat ── */
  const inputMsg  = document.getElementById("input-mensaje");
  const btnEnviar = document.getElementById("btn-enviar");

  inputMsg.addEventListener("input", () => {
    inputMsg.style.height = "auto";
    inputMsg.style.height = Math.min(inputMsg.scrollHeight, 140) + "px";
    actualizarBtn();
  });

  inputMsg.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!btnEnviar.disabled) procesarMensaje(inputMsg.value.trim());
    }
  });

  btnEnviar.addEventListener("click", () => {
    if (!btnEnviar.disabled) procesarMensaje(inputMsg.value.trim());
  });

  document.getElementById("btn-nueva-conv").addEventListener("click", () => {
    if (!confirm("¿Comenzar una nueva conversación? El historial del chat se borrará (las citas en el sistema se conservan).")) return;
    conversacion = [];
    document.getElementById("area-mensajes").innerHTML = "";
    agregarBienvenida();
  });

  document.getElementById("btn-salir").addEventListener("click", () => {
    if (!confirm("¿Salir y cambiar la API Key?")) return;
    apiKey = ""; conversacion = [];
    document.getElementById("area-mensajes").innerHTML = "";
    document.getElementById("pantalla-chat").classList.add("oculto");
    document.getElementById("pantalla-inicio").classList.remove("oculto");
    keyInp.value = ""; keyInp.focus();
  });
});
