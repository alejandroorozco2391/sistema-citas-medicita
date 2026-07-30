/* ─── Estado ──────────────────────────────────────────────────────────── */
const API_URL = "/api/chat";
let apiKey = "";
let modelo = "claude-sonnet-4-6";
let conversacion = [];
let procesando = false;
let ejsServiceId = "";
let ejsTemplateId = "";
let ejsPublicKey = "";

/* ─── Registro en MediInbox ───────────────────────────────────────────── */
/* La sesión de chat se vuelca al inbox tras cada turno para que quede
   historial consultable. Antes de esto, todo lo que decía un paciente se
   perdía al recargar la página.

   Es idempotente: adaptarMediBot genera ids deterministas a partir de
   sesionInboxId + posición, así que volcar la conversación completa en
   cada turno agrega solo lo nuevo. */
let sesionInboxId = null;
let inicioSesionInbox = null;
let contactoInbox = { telefono: "", nombre: "" };

function nuevaSesionInbox() {
  sesionInboxId = `mb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  inicioSesionInbox = new Date().toISOString();
  contactoInbox = { telefono: "", nombre: "" };
}

async function registrarEnInbox() {
  // El inbox es opcional: si sus scripts no están cargados, el chat sigue igual.
  if (typeof adaptarMediBot !== "function" || typeof ingerir !== "function") return;
  if (!conversacion.length) return;
  if (!sesionInboxId) nuevaSesionInbox();

  try {
    await ingerir(
      adaptarMediBot(conversacion, {
        sesionId: sesionInboxId,
        inicioEn: inicioSesionInbox,
        telefono: contactoInbox.telefono,
        nombreContacto: contactoInbox.nombre,
      })
    );
  } catch (e) {
    console.warn("MediInbox: no se pudo registrar la conversación —", e);
  }
}

/* ─── System prompt ───────────────────────────────────────────────────── */
function buildSystemPrompt() {
  const ahora = new Date().toLocaleString("es-MX", {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Eres MediBot, el asistente virtual de MediCita, una clínica médica en México. Hablas únicamente en español de México, con tono amigable, empático y profesional. Usas lenguaje claro y accesible, sin tecnicismos innecesarios.

Fecha y hora actual: ${ahora}

${perfilBot === "personal" ? `CON QUIÉN HABLAS: personal de la clínica, con sesión iniciada. Puedes consultar y modificar expedientes.

HERRAMIENTAS DISPONIBLES:
• listar_especialidades — Lista todas las especialidades de la clínica con descripción
• listar_doctores — Lista médicos disponibles con horarios; filtrable por especialidad_id
• leer_todas_las_citas — Lee todas las citas del sistema
• buscar_citas — Busca citas por nombre, folio, fecha, médico o estado
• crear_cita — Registra una nueva cita (solo tras confirmar datos con el usuario)
• actualizar_estado_cita — Cambia estado: pendiente | confirmada | atendida | cancelada
• eliminar_cita — Elimina permanentemente una cita (solo tras confirmación explícita)
• ver_satisfaccion_pacientes — Muestra promedio NPS, últimas opiniones y seguimientos pendientes

También tienes acceso al expediente completo:
• buscar_paciente — busca por nombre o teléfono
• ver_documentos_paciente — recetas, notas SOAP, constancias y otros docs de MediDocs
• ver_notas_paciente — notas internas del perfil del paciente
• ver_nps_paciente — encuestas de satisfacción de un paciente específico

Y el horario del consultorio:
• ver_horario_atencion — el horario real, con cierres y cambios ya aplicados
• ver_horas_libres — qué horas de un médico quedan libres en una fecha
• cambiar_horario_base — reemplaza la semana habitual COMPLETA (confirma antes)
• agregar_excepcion_horario — cierra un día suelto o le pone otro horario

• escalar_a_humano — pasa el asunto a QUIEN CORRESPONDE, con acuse y re-alerta.
  Que quien te habla sea del personal no quiere decir que sea la persona
  indicada: recepción no resuelve una duda clínica. Úsala cuando te pidan
  avisarle al médico, cuando la pregunta necesite criterio clínico, o ante
  una queja. Deja rastro y alguien tiene que hacerse cargo — no es lo mismo
  que gritar por el pasillo y que se olvide.

Úsalas proactivamente cuando el contexto lo requiera sin pedir permiso.` : `CON QUIÉN HABLAS: un paciente o alguien del público. No tiene sesión.

HERRAMIENTAS DISPONIBLES:
• listar_especialidades — Lista todas las especialidades de la clínica con descripción
• listar_doctores — Lista médicos disponibles con horarios; filtrable por especialidad_id
• ver_horario_atencion — el horario real del consultorio, con cierres ya aplicados
• ver_horas_libres — qué horas quedan libres con un médico en una fecha
• buscar_citas — Busca la cita de ESTA persona. Pide su folio o su teléfono primero.
• crear_cita — Registra una nueva cita (solo tras confirmar datos con el paciente)
• enviar_email_paciente — Confirmación por correo tras agendar
• escalar_a_humano — Avisa a una persona de la clínica para que lo contacte

LO QUE NO PUEDES HACER, y cómo responder si lo piden:
• No listas ni consultas las citas de otras personas
• No cancelas ni eliminas citas: eso lo hace la clínica. Ofrece comunicarlo con alguien
• No lees notas internas, documentos clínicos ni encuestas del expediente
• No cambias el horario del consultorio
Si te piden algo de esto, dilo con naturalidad y ofrece pasar con una persona. No lo intentes.`}

HORARIO — no inventes disponibilidad:
Antes de proponer una fecha, consulta ver_horario_atencion. Si ese día está
cerrado, dilo y ofrece el siguiente día abierto. Nunca ofrezcas una hora en
un día sin horario: el paciente se presentaría a un consultorio cerrado.

Y antes de proponer una HORA, consulta ver_horas_libres. Un médico no puede
recibir a dos personas a la vez, así que las horas ya tomadas no existen para
ti: no las menciones ni las ofrezcas "por si se libera". Si crear_cita te
contesta que la hora se ocupó, discúlpate y ofrece las alternativas que te
devuelve — no vuelvas a intentar la misma hora.

SEÑALES DE URGENCIA — esta regla está por encima de todas las demás:
Ante dolor en el pecho, dificultad para respirar, sangrado que no para,
pérdida de conciencia, convulsiones, debilidad súbita de un lado del cuerpo,
pensamientos de hacerse daño, o cualquier cosa que suene a emergencia:
1. PRIMERO dile que llame al 911 o vaya a urgencias AHORA, sin esperarte.
2. Después llama a escalar_a_humano con motivo "urgencia_medica".
Nunca al revés, nunca solo lo segundo, y nunca "déjame consultarlo". Ante la
duda, trátalo como urgencia: equivocarte hacia ese lado no le cuesta nada a
nadie, y hacia el otro sí.

No diagnostiques, no interpretes estudios y no sugieras medicamentos ni
dosis. Eso es del médico. Si te lo piden, ofrece escalar.

CUANDO ESCALAS — solo prometes lo que el horario sostiene:
escalar_a_humano devuelve una \`instruccion\`: síguela literalmente.

Si trae \`atencionEnTexto\`, cópialo TAL CUAL. Ya viene en español y en la
hora local del consultorio. NO lo conviertas, NO lo redondees y NO le sumes
margen de cortesía: ese campo existe justo para que no tengas que calcular
nada. (\`atencionEn\` es el mismo dato en UTC, para uso interno — no lo uses
para hablarle al paciente.)

Si la instrucción dice que no prometas una hora, no la prometas. "En breve
te contactamos" un domingo a las 11 de la noche es mentira, y el paciente
se queda esperando junto al teléfono.

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

/* ─── Utilidades de texto compartidas ────────────────────────────────── */
function normalizarTexto(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
    name: "ver_satisfaccion_pacientes",
    description: "Lee las respuestas de satisfacción NPS de los pacientes y la cantidad de seguimientos post-consulta pendientes. Usar para responder preguntas sobre satisfacción, calificaciones o seguimientos.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "buscar_paciente",
    description: "Busca un paciente en el directorio por nombre, apellidos o teléfono. Usar cuando pregunten por datos de un paciente, su historial, o quieran saber si está registrado.",
    input_schema: {
      type: "object",
      properties: {
        nombre:   { type: "string", description: "Nombre o apellidos del paciente (parcial)" },
        telefono: { type: "string", description: "Teléfono del paciente" },
      },
      required: [],
    },
  },
  {
    name: "ver_documentos_paciente",
    description: "Muestra los documentos clínicos generados para un paciente. Usar cuando pregunten por recetas, notas, constancias, incapacidades o cualquier documento generado en MediDocs.",
    input_schema: {
      type: "object",
      properties: {
        id_paciente: { type: "string", description: "ID del paciente (PAC-...)" },
        folio_cita:  { type: "string", description: "Folio de cita (CIT-...)" },
      },
      required: [],
    },
  },
  {
    name: "ver_notas_paciente",
    description: "Muestra las notas internas del expediente de un paciente. Usar cuando pregunten por observaciones, comentarios internos o el historial de notas de un paciente.",
    input_schema: {
      type: "object",
      properties: {
        id_paciente: { type: "string", description: "ID del paciente (PAC-...)" },
        nombre:      { type: "string", description: "Nombre o teléfono si no se tiene el ID" },
      },
      required: [],
    },
  },
  {
    name: "ver_nps_paciente",
    description: "Muestra las respuestas NPS (encuestas de satisfacción) de un paciente. Usar cuando pregunten por la opinión, calificación o experiencia de un paciente.",
    input_schema: {
      type: "object",
      properties: {
        folio_cita: { type: "string", description: "Folio de cita del paciente" },
        nombre:     { type: "string", description: "Nombre del paciente para buscar todos sus folios primero" },
      },
      required: [],
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
  {
    name: "ver_horario_atencion",
    description: "Consulta el horario real del consultorio en un rango de fechas, ya con los cierres y cambios aplicados. Úsala antes de proponer una fecha y siempre que pregunten a qué hora abren.",
    input_schema: {
      type: "object",
      properties: {
        fecha_desde: { type: "string", description: "YYYY-MM-DD. Por omisión, hoy." },
        fecha_hasta: { type: "string", description: "YYYY-MM-DD. Por omisión, 14 días después." },
      },
      required: [],
    },
  },
  {
    name: "ver_horas_libres",
    description: "Horas en las que un médico SÍ puede recibir a alguien en una fecha: ya descontadas las que están ocupadas y las que caen fuera del horario del consultorio. Úsala siempre antes de proponer una hora o de llamar a crear_cita — nunca ofrezcas una hora que no venga de aquí.",
    input_schema: {
      type: "object",
      properties: {
        doctor: { type: "string", description: "Nombre exacto del médico, tal como lo devuelve listar_doctores." },
        fecha:  { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["doctor", "fecha"],
    },
  },
  {
    name: "cambiar_horario_base",
    description: "Reemplaza el horario semanal habitual del consultorio. Solo para cambios permanentes; para un día suelto usa agregar_excepcion_horario. Confirma con la persona antes de llamarla: reemplaza la semana COMPLETA.",
    input_schema: {
      type: "object",
      properties: {
        bloques: {
          type: "array",
          description: "Semana completa. Cada bloque es un tramo continuo de un día.",
          items: {
            type: "object",
            properties: {
              dia_semana:  { type: "number", description: "0 domingo … 6 sábado" },
              hora_inicio: { type: "string", description: "HH:MM" },
              hora_fin:    { type: "string", description: "HH:MM" },
            },
            required: ["dia_semana", "hora_inicio", "hora_fin"],
          },
        },
      },
      required: ["bloques"],
    },
  },
  {
    name: "agregar_excepcion_horario",
    description: "Cierra un día concreto o le pone un horario distinto, sin tocar la semana habitual. Devuelve las citas que quedan fuera: MENCIÓNALAS SIEMPRE, porque el sistema no cancela ni avisa a nadie por su cuenta.",
    input_schema: {
      type: "object",
      properties: {
        fecha:       { type: "string", description: "YYYY-MM-DD" },
        cerrado:     { type: "boolean", description: "true cierra el día completo" },
        hora_inicio: { type: "string", description: "HH:MM, solo si cerrado es false" },
        hora_fin:    { type: "string", description: "HH:MM, solo si cerrado es false" },
        motivo:      { type: "string", description: "Uso interno; nunca se muestra al paciente" },
      },
      required: ["fecha", "cerrado"],
    },
  },
  {
    name: "escalar_a_humano",
    description: "Avisa a una persona de la clínica para que contacte al paciente. Úsala cuando te lo pidan, cuando la pregunta necesite criterio médico, ante una queja, o cuando no puedas resolver algo. Pide nombre y teléfono ANTES de llamarla: sin teléfono nadie puede devolver el contacto. Devuelve una `instruccion`: síguela al pie de la letra al redactar tu respuesta.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["urgencia_medica", "duda_clinica", "queja", "agenda",
                 "administrativo", "peticion_explicita", "bot_no_pudo"],
          description: "urgencia_medica ante cualquier señal de emergencia, aunque no estés seguro",
        },
        urgencia: { type: "string", enum: ["alta", "normal", "baja"] },
        resumen:  { type: "string", description: "Qué necesita, para que no tengan que volver a preguntárselo" },
        nombre:   { type: "string" },
        telefono: { type: "string" },
        email:    { type: "string" },
      },
      required: ["motivo", "resumen"],
    },
  },
];

/* ─── Perfiles: quién está del otro lado ──────────────────────────────────
   MediBot le habla al paciente, y el inbox registra sus turnos como
   `remitente: "paciente"`. Pero hasta aquí tenía además eliminar_cita,
   leer_todas_las_citas y ver_notas_paciente: poderes de personal.

   Contra el backend, RLS ya le devolvería cero renglones a quien no tiene
   sesión. Aun así, ofrecerle borrar citas o leer notas internas a un
   paciente es un error aunque la base lo frene — y en la demo sin backend
   no hay nada que lo frene.

   Se resuelve por sesión, no por parámetro de URL: un ?perfil=personal
   sería una reja que se abre escribiéndola.                             */
const TOOLS_PACIENTE = [
  "listar_especialidades", "listar_doctores", "ver_horario_atencion", "ver_horas_libres",
  "buscar_citas", "crear_cita", "enviar_email_paciente",
];

let perfilBot = "paciente";

/**
 * El personal las tiene todas, incluida `escalar_a_humano`.
 *
 * Al principio se la quitamos, con el argumento de que "ya eres el
 * humano". El argumento estaba mal: confunde *ser un humano* con *ser el
 * humano correcto*. Recepción no es el médico, y que recepción le pase
 * una duda clínica al doctor —con acuse y re-alerta, no con un grito por
 * el pasillo que se olvida— es justo el ruteo que esto viene a resolver.
 */
function toolsDelPerfil() {
  return perfilBot === "personal"
    ? TOOLS
    : TOOLS.filter(t => TOOLS_PACIENTE.includes(t.name) || t.name === "escalar_a_humano");
}

/**
 * Decide el perfil al arrancar.
 *
 * Con backend manda la sesión, y nada más: es la única fuente que un
 * visitante no puede falsificar.
 *
 * Sin backend —la demo pública— no hay frontera que defender: los datos
 * son de mentira y viven en este navegador. Ahí el perfil por omisión es
 * `personal`, porque a chat.html se llega desde el panel, y `?perfil=`
 * permite enseñar el otro lado en una demostración de ventas. Ese
 * parámetro se IGNORA en cuanto hay backend.
 */
async function resolverPerfilBot() {
  let esDemo = true;
  let hayPerfil = false;

  try {
    await window.SesionLista;
    esDemo = window.Sesion.esDemo();
    hayPerfil = Boolean(await window.Sesion.perfil());
  } catch (e) {
    /* Sin puente de sesión no se puede saber quién es: se asume el perfil
       con menos poderes, no el más cómodo. */
    console.warn("[chat] No se pudo resolver la sesión:", e);
    perfilBot = "paciente";
    return;
  }

  if (!esDemo) {
    perfilBot = hayPerfil ? "personal" : "paciente";
    return;
  }

  const pedido = new URLSearchParams(location.search).get("perfil");
  perfilBot = pedido === "paciente" ? "paciente" : "personal";
}

/* ─── Ejecución de herramientas (vía js/api.mjs) ──────────────────────── */
async function ejecutarHerramienta(nombre, p) {
  try {
    /* Segunda reja, además de no ofrecer la herramienta. No ofrecerla
       basta para que el modelo no la use, pero un prompt inyectado en un
       mensaje del paciente puede pedirla por su nombre. */
    if (perfilBot !== "personal" && !TOOLS_PACIENTE.includes(nombre) && nombre !== "escalar_a_humano") {
      return JSON.stringify({
        error: "Esa acción es del personal de la clínica. Ofrece comunicarlo con una persona.",
      });
    }

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
        return JSON.stringify(await API.citas.listar());

      case "buscar_citas": {
        const todas = await API.citas.listar();
        return JSON.stringify(todas.filter(c => {
          if (p.folio  && c.folio !== p.folio) return false;
          if (p.fecha  && c.fecha !== p.fecha) return false;
          if (p.estado && c.estado !== p.estado) return false;
          if (p.doctor && !normalizarTexto(c.doctor).includes(normalizarTexto(p.doctor))) return false;
          if (p.nombre) {
            const full = normalizarTexto(`${c.nombre} ${c.apellidos}`);
            if (!full.includes(normalizarTexto(p.nombre))) return false;
          }
          return true;
        }));
      }

      case "ver_horas_libres": {
        /* La resta la hace la herramienta, no el modelo. Es la lección del
           bug de la zona horaria: cuando el dato ya viene calculado, el
           modelo solo puede leerlo mal en voz alta; cuando le pasamos los
           insumos, puede equivocarse en la aritmética y sonar convincente.

           Aquí se cruzan tres cosas: las horas que ese médico atiende
           (data.js), el horario real del consultorio ese día (que puede
           estar cerrado), y las horas ya tomadas. */
        const doctor = DOCTORES.find(d => d.nombre === p.doctor);
        if (!doctor) {
          return JSON.stringify({ exito: false, error: `No existe el médico "${p.doctor}". Usa listar_doctores.` });
        }

        /* Se pregunta por una VENTANA de dos semanas, no por la fecha suelta.
           Para un solo día, una respuesta vacía significa dos cosas
           distintas —ese día está cerrado, o esta clínica nunca cargó su
           horario— y confundirlas hace que una clínica sin horario salga
           "cerrada" todos los días. Con la ventana se distinguen: si en
           catorce días no hay un solo bloque, es que no hay horario cargado,
           y entonces valen los horarios del médico como hasta antes. */
        const hasta = new Date(`${p.fecha}T00:00:00`);
        hasta.setDate(hasta.getDate() + 13);
        const ventana = (await API.publico.horarioDisponible(
          p.fecha, hasta.toISOString().slice(0, 10)
        )) || [];

        const hayHorarioCargado = ventana.length > 0;
        const delDia = ventana.filter(b => b.fecha === p.fecha);

        let horas = doctor.horarios || [];
        if (hayHorarioCargado) {
          horas = horas.filter(h => delDia.some(b => h >= b.horaInicio && h < b.horaFin));
        }

        const cerrado = hayHorarioCargado && delDia.length === 0;
        const ocupadas = await API.publico.horasOcupadas(p.doctor, p.fecha);
        const libres = horas.filter(h => !ocupadas.includes(h));

        return JSON.stringify({
          exito: true, doctor: p.doctor, fecha: p.fecha,
          horas_libres: libres,
          horas_ocupadas: ocupadas,
          consultorio_cerrado: cerrado,
          nota: cerrado
            ? "Ese día el consultorio no atiende. Ofrece otra fecha."
            : libres.length
              ? "Ofrece SOLO estas horas."
              : "Ese día ya está lleno con ese médico. Propón otra fecha u otro médico; no inventes horarios.",
        });
      }

      case "crear_cita": {
        /* El folio y el vínculo con el expediente los pone la capa de
           datos: en Postgres el folio lleva índice único y hay reintento
           por si dos solicitudes chocan el mismo día.

           El hueco ocupado se devuelve como resultado, no como excepción:
           así el modelo lo lee, se disculpa y ofrece otra hora en el mismo
           turno. Si lo dejáramos reventar, la conversación se cortaría con
           un error genérico y el paciente se quedaría sin cita. */
        let cita;
        try {
          cita = await API.citas.crear({
            estado: "pendiente",
            nombre: p.nombre, apellidos: p.apellidos, telefono: p.telefono,
            email: p.email ?? "", especialidad: p.especialidad, doctor: p.doctor,
            fecha: p.fecha, hora: p.hora, tipo: p.tipo, notas: p.notas ?? "",
          });
        } catch (e) {
          if (/hora ya está ocupada|hora se acaba de ocupar/i.test(e.message)) {
            const libres = await ejecutarHerramienta("ver_horas_libres", { doctor: p.doctor, fecha: p.fecha });
            return JSON.stringify({
              exito: false,
              error: "Esa hora ya está ocupada con ese médico.",
              instruccion: "Discúlpate, dile qué horas SÍ quedan y pídele que elija una.",
              alternativas: JSON.parse(libres).horas_libres ?? [],
            });
          }
          throw e;
        }
        const folio = cita.folio;

        // En cuanto sabemos quién es, la conversación deja de ser anónima:
        // el siguiente volcado al inbox la vincula con su expediente.
        contactoInbox = {
          telefono: p.telefono || contactoInbox.telefono,
          nombre: `${p.nombre || ""} ${p.apellidos || ""}`.trim() || contactoInbox.nombre,
        };

        return JSON.stringify({ exito: true, folio });
      }

      case "actualizar_estado_cita": {
        const cita = await API.citas.porFolio(p.folio);
        if (!cita) return JSON.stringify({ exito: false, error: "Cita no encontrada" });
        await API.citas.actualizar(cita.id ?? p.folio, { estado: p.nuevo_estado });
        return JSON.stringify({ exito: true, folio: p.folio, nuevo_estado: p.nuevo_estado });
      }

      case "eliminar_cita": {
        const cita = await API.citas.porFolio(p.folio);
        if (!cita) return JSON.stringify({ exito: false, error: "Cita no encontrada" });
        await API.citas.eliminar(cita.id ?? p.folio);
        return JSON.stringify({ exito: true, folio: p.folio });
      }

      case "ver_satisfaccion_pacientes": {
        const nps          = await API.nps.listar();
        const seguimientos = await API.seguimientos.listar();
        const citasAll     = await API.citas.listar();
        const pendientes   = seguimientos.filter((s) => !s.emailEnviado_3d || !s.emailEnviado_30d);
        const promedio     = nps.length > 0
          ? (nps.reduce((sum, r) => sum + r.puntuacion, 0) / nps.length).toFixed(1)
          : null;
        const ultimas5 = nps.slice(0, 5).map((r) => {
          const cita = citasAll.find((c) => c.folio === r.folio);
          return {
            folio: r.folio,
            puntuacion: r.puntuacion,
            comentario: r.comentario || "",
            fechaRespuesta: r.fechaRespuesta,
            paciente: cita ? `${cita.nombre} ${cita.apellidos}` : "Paciente desconocido",
          };
        });
        return JSON.stringify({
          promedioNPS: promedio,
          totalRespuestas: nps.length,
          ultimas5Opiniones: ultimas5,
          seguimientosPendientes: pendientes.length,
        });
      }

      case "buscar_paciente": {
        const pacientes = await API.pacientes.listar();
        const citasAll  = await API.citas.listar();
        const resultados = pacientes.filter(pac => {
          if (p.telefono && normalizarTexto(pac.telefono).includes(normalizarTexto(p.telefono))) return true;
          if (p.nombre) {
            const full = normalizarTexto(`${pac.nombre} ${pac.apellidos}`);
            if (full.includes(normalizarTexto(p.nombre))) return true;
          }
          return false;
        });
        if (resultados.length === 0) {
          return JSON.stringify({ encontrado: false, mensaje: "No se encontró ningún paciente con esos datos" });
        }
        return JSON.stringify(resultados.map(pac => {
          const foliosCitas = pac.foliosCitas ?? [];
          const citasPac    = citasAll.filter(c => foliosCitas.includes(c.folio));
          const ultima      = citasPac[0] ?? null;
          return {
            id: pac.id, nombre: pac.nombre, apellidos: pac.apellidos,
            telefono: pac.telefono, email: pac.email,
            calificacionVIP: pac.calificacion === 3 ? "VIP Oro ⭐⭐⭐" : pac.calificacion === 2 ? "VIP Plata ⭐⭐" : "Regular ⭐",
            tieneSeguro: pac.tieneSeguro, nombreSeguro: pac.nombreSeguro,
            datosMedicos: {
              peso: pac.peso || null,
              estatura: pac.estatura || null,
              tipoSangre: pac.tipoSangre || null,
              alergias: pac.alergias || null,
              enfermedadesCronicas: pac.enfermedadesCronicas || null,
              medicamentosActuales: pac.medicamentosActuales || null,
              ocupacion: pac.ocupacion || null,
              ciudad: pac.ciudad || null,
            },
            totalCitas: foliosCitas.length,
            ultimaCita: ultima ? { fecha: ultima.fecha, medico: ultima.doctor, estado: ultima.estado } : null,
            foliosCitas,
          };
        }));
      }

      case "ver_documentos_paciente": {
        const docs      = await API.documentos.listar();
        const pacientes = await API.pacientes.listar();
        let filtrados   = [];
        if (p.id_paciente) {
          const pac      = pacientes.find(p2 => p2.id === p.id_paciente);
          const idsDocs  = pac?.foliosDocs ?? [];
          filtrados = docs.filter(d => idsDocs.includes(d.id));
        } else if (p.folio_cita) {
          filtrados = docs.filter(d => d.folio === p.folio_cita);
        } else {
          filtrados = docs;
        }
        if (filtrados.length === 0) {
          return JSON.stringify({ encontrado: false, mensaje: "No se encontraron documentos para este paciente o cita" });
        }
        return JSON.stringify(filtrados.map(d => ({
          tipo: d.tipodoc, folioCita: d.folio, fecha: d.creadoEn,
          resumenInputs: JSON.stringify(d.inputs ?? {}).slice(0, 100),
        })));
      }

      case "ver_notas_paciente": {
        const pacientes = await API.pacientes.listar();
        let pac = null;
        if (p.id_paciente) {
          pac = pacientes.find(p2 => p2.id === p.id_paciente);
        } else if (p.nombre) {
          const q = normalizarTexto(p.nombre);
          pac = pacientes.find(p2 =>
            normalizarTexto(`${p2.nombre} ${p2.apellidos}`).includes(q) ||
            normalizarTexto(p2.telefono).includes(q)
          );
        }
        if (!pac) return JSON.stringify({ encontrado: false, mensaje: "No se encontró al paciente" });
        return JSON.stringify({
          paciente: `${pac.nombre} ${pac.apellidos}`,
          notas: pac.notas || "Sin notas registradas",
          historialNotas: pac.historialNotas ?? [],
        });
      }

      case "ver_nps_paciente": {
        const nps       = await API.nps.listar();
        const pacientes = await API.pacientes.listar();
        let folios = [];
        if (p.folio_cita) {
          folios = [p.folio_cita];
        } else if (p.nombre) {
          const q   = normalizarTexto(p.nombre);
          const pac = pacientes.find(p2 =>
            normalizarTexto(`${p2.nombre} ${p2.apellidos}`).includes(q) ||
            normalizarTexto(p2.telefono).includes(q)
          );
          folios = pac?.foliosCitas ?? [];
        }
        const respuestas = nps.filter(r => folios.includes(r.folio));
        if (respuestas.length === 0) {
          return JSON.stringify({ encontrado: false, mensaje: "No se encontraron respuestas NPS para este paciente" });
        }
        return JSON.stringify(respuestas.map(r => ({
          folio: r.folio, puntuacion: r.puntuacion,
          comentario: r.comentario || "", fecha: r.fechaRespuesta,
        })));
      }

      case "enviar_email_paciente":
        return JSON.stringify(await sendEmailToPatient(p));

      /* ─── Horario de atención ─────────────────────────────────────── */

      case "ver_horario_atencion": {
        const hoy = new Date();
        const iso = d => d.toISOString().slice(0, 10);
        const desde = p.fecha_desde || iso(hoy);
        const hasta = p.fecha_hasta ||
          iso(new Date(hoy.getTime() + 14 * 86400000));

        const bloques = await API.publico.horarioDisponible(desde, hasta);

        /* Agrupado por fecha: un arreglo plano de bloques hace que el
           modelo tenga que deducir qué días faltan, y ahí se equivoca. */
        const porFecha = {};
        for (const b of bloques) {
          (porFecha[b.fecha] ||= []).push(`${b.horaInicio}–${b.horaFin}`);
        }

        const dias = [];
        for (let d = new Date(`${desde}T00:00:00`); iso(d) <= hasta; d.setDate(d.getDate() + 1)) {
          const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          dias.push({ fecha, abierto: !!porFecha[fecha], horarios: porFecha[fecha] || [] });
        }

        return JSON.stringify({
          dias,
          nota: "Los días sin horarios están cerrados. No ofrezcas citas en ellos.",
        });
      }

      case "cambiar_horario_base": {
        const texto = await API.horarios.guardarBase(
          (p.bloques || []).map(b => ({
            diaSemana: Number(b.dia_semana),
            horaInicio: b.hora_inicio,
            horaFin: b.hora_fin,
          }))
        );
        return JSON.stringify({ ok: true, horarioResultante: texto });
      }

      case "agregar_excepcion_horario": {
        const cerrado = Boolean(p.cerrado);

        /* Se consulta ANTES de guardar: si el cambio falla, no queremos
           haberle dicho al usuario a quién iba a dejar plantado. */
        const afectadas = await API.horarios.citasAfectadas(
          p.fecha,
          cerrado ? null : p.hora_inicio,
          cerrado ? null : p.hora_fin
        );

        await API.horarios.agregarExcepcion({
          fecha: p.fecha,
          cerrado,
          horaInicio: p.hora_inicio,
          horaFin: p.hora_fin,
          motivo: p.motivo || "",
        });

        return JSON.stringify({
          ok: true,
          citasAfectadas: afectadas.map(c => ({
            folio: c.folio,
            paciente: `${c.nombre} ${c.apellidos || ""}`.trim(),
            hora: c.hora,
            telefono: c.telefono,
            email: c.email,
          })),
          advertencia: afectadas.length
            ? "El sistema NO canceló ni avisó a estos pacientes. Dile a la persona que hay que reagendarlos o llamarlos."
            : "No había citas agendadas ese día.",
        });
      }

      case "escalar_a_humano": {
        const r = await API.publico.escalarAHumano({
          motivo: p.motivo,
          urgencia: p.urgencia || "normal",
          resumen: p.resumen || "",
          nombre: p.nombre || contactoInbox.nombre || "",
          telefono: p.telefono || contactoInbox.telefono || "",
          email: p.email || "",
          canalOrigen: "medibot",
        });

        /* Se guarda el contacto por si la conversación sigue: quien vuelva
           a escalar no debería tener que volver a pedir el teléfono. */
        if (p.telefono) contactoInbox.telefono = p.telefono;
        if (p.nombre) contactoInbox.nombre = p.nombre;

        return JSON.stringify(r);
      }

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
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 1024,
          system: buildSystemPrompt(),
          tools: toolsDelPerfil(),
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
    registrarEnInbox();
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

function labelHerramienta(nombre) {
  return {
    listar_especialidades:    "Consultando especialidades…",
    listar_doctores:          "Buscando médicos disponibles…",
    leer_todas_las_citas:     "Leyendo citas del sistema…",
    buscar_citas:             "Buscando citas…",
    crear_cita:               "Guardando la cita en el sistema…",
    actualizar_estado_cita:   "Actualizando estado de la cita…",
    eliminar_cita:            "Eliminando la cita…",
    enviar_email_paciente:    "Enviando email al paciente…",
    buscar_paciente:          "Buscando en expediente…",
    ver_documentos_paciente:  "Buscando en expediente…",
    ver_notas_paciente:       "Buscando en expediente…",
    ver_nps_paciente:         "Buscando en expediente…",
    ver_horario_atencion:     "Consultando el horario del consultorio…",
    ver_horas_libres:         "Revisando qué horas quedan libres…",
    cambiar_horario_base:     "Actualizando el horario semanal…",
    agregar_excepcion_horario: "Programando el cambio de horario…",
    escalar_a_humano:         "Avisando a una persona de la clínica…",
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
document.addEventListener("DOMContentLoaded", async () => {
  await window.APIListo;

  await resolverPerfilBot();

  /* ── Demo: inicio automático con credenciales precargadas ── */
  apiKey        = document.getElementById("api-key-input").value.trim();
  modelo        = document.getElementById("sel-modelo").value;
  ejsServiceId  = document.getElementById("ejs-service-id").value.trim();
  ejsTemplateId = document.getElementById("ejs-template-id").value.trim();
  ejsPublicKey  = document.getElementById("ejs-public-key").value.trim();
  if (ejsPublicKey) emailjs.init({ publicKey: ejsPublicKey });
  document.getElementById("pantalla-inicio").classList.add("oculto");
  document.getElementById("pantalla-chat").classList.remove("oculto");
  agregarBienvenida();
  document.getElementById("input-mensaje").focus();

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
    nuevaSesionInbox(); // el inbox trata esto como un hilo nuevo, no como el mismo
    document.getElementById("area-mensajes").innerHTML = "";
    agregarBienvenida();
  });

  document.getElementById("btn-salir").addEventListener("click", () => {
    if (!confirm("¿Salir y cambiar la API Key?")) return;
    apiKey = ""; conversacion = [];
    nuevaSesionInbox();
    document.getElementById("area-mensajes").innerHTML = "";
    document.getElementById("pantalla-chat").classList.add("oculto");
    document.getElementById("pantalla-inicio").classList.remove("oculto");
    keyInp.focus();
  });
});
