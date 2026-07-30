/* ═══════════════════════════════════════════════════════════════════════
   Flujos sin sesión e invariantes del esquema.

   Dos cosas se prueban aquí:

   1. Que las funciones que usa un visitante sin cuenta (pedir cita,
      responder encuesta) hagan su trabajo y validen de verdad — porque la
      anon key va escrita en el HTML y cualquiera puede llamarlas.

   2. Que las reglas que en el navegador sostenía el código por buena
      voluntad (identidad por teléfono, idempotencia, espejo del último
      mensaje) ahora las garantice la base de datos.
   ═══════════════════════════════════════════════════════════════════════ */

import test from "node:test";
import assert from "node:assert";
import { crearBase, comoAnonimo, comoUsuario } from "./db-harness.mjs";

const db = await crearBase();

const { rows: [clinica] } = await db.query(
  "insert into clinicas (nombre_clinica, ciudad) values ('Consultorio Único', 'CDMX') returning id"
);
const CLINICA = clinica.id;

const { rows: [u] } = await db.query(
  "insert into auth.users (id, email) values (gen_random_uuid(), 'admin@unico.mx') returning id"
);
await db.query(
  "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Admin', 'admin')",
  [u.id, CLINICA]
);
const ADMIN = u.id;

const enDias = n => `(current_date + ${n})`;

/* Cada solicitud pide una hora distinta salvo que la prueba pida una
   concreta. Desde 0012 un médico no puede tener dos citas en el mismo
   hueco, así que un fixture con la hora fija hacía que la segunda llamada
   de cada prueba fallara por algo que la prueba no estaba midiendo.
   Las horas de doble reserva viven en tests/db-doble-reserva.test.mjs. */
let horaN = 0;
function horaLibre() {
  const i = horaN++;
  return `${String(8 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
}

async function pedirCita(extra = {}) {
  const p = {
    nombre: "Ana", apellidos: "Martínez", telefono: "55 8811 2233",
    email: "ana@ejemplo.mx", especialidad: "Cardiología", doctor: "Dr. Vega",
    dias: 5, hora: horaLibre(), tipo: "Primera vez", ...extra,
  };
  return comoAnonimo(db, async () => {
    const { rows } = await db.query(
      `select solicitar_cita(
         p_nombre => $1, p_apellidos => $2, p_telefono => $3, p_email => $4,
         p_especialidad => $5, p_doctor => $6, p_fecha => ${enDias(p.dias)},
         p_hora => $7, p_tipo => $8
       ) as folio`,
      [p.nombre, p.apellidos, p.telefono, p.email, p.especialidad, p.doctor, p.hora, p.tipo]
    );
    return rows[0].folio;
  });
}

/* ═══ Pedir cita desde la landing ═══════════════════════════════════════ */

test("un visitante sin cuenta puede pedir cita y recibe folio", async () => {
  const folio = await pedirCita();
  assert.match(folio, /^CIT-\d{6}-\d{4}$/, "el folio conserva el formato que ya usa el sistema");

  const { rows } = await db.query("select estado, origen from citas where folio = $1", [folio]);
  assert.strictEqual(rows[0].estado, "pendiente", "el estado lo fija la función, no quien llama");
  assert.strictEqual(rows[0].origen, "web");
});

test("pedir cita crea el expediente si el paciente es nuevo", async () => {
  const { rows } = await db.query(
    "select codigo, nombre from pacientes where telefono_clave = '5588112233'"
  );
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].codigo, /^PAC-\d{8}-\d{4}$/);
});

test("una segunda cita del mismo teléfono NO duplica el expediente", async () => {
  await pedirCita({ nombre: "Ana", telefono: "5588112233" });   // sin espacios
  await pedirCita({ nombre: "Ana", telefono: "+52 55 8811 2233" }); // internacional

  const { rows } = await db.query(
    "select count(*)::int as n from pacientes where telefono_clave = '5588112233'"
  );
  assert.strictEqual(rows[0].n, 1, "los tres formatos son la misma persona");
});

test("rechaza un teléfono incompleto", async () => {
  await assert.rejects(() => pedirCita({ telefono: "5588" }), /10 dígitos/);
});

test("rechaza un nombre vacío", async () => {
  await assert.rejects(() => pedirCita({ nombre: "   " }), /nombre es obligatorio/);
});

test("rechaza fechas fuera del rango que ofrece el formulario", async () => {
  await assert.rejects(() => pedirCita({ dias: -1, telefono: "55 1111 0001" }), /próximos 60 días/);
  await assert.rejects(() => pedirCita({ dias: 90, telefono: "55 1111 0002" }), /próximos 60 días/);
});

test("frena el abuso: la anon key es pública y no puede llenar la agenda", async () => {
  const tel = "55 7070 7070";
  for (let i = 0; i < 5; i++) await pedirCita({ telefono: tel, dias: i + 1 });
  await assert.rejects(() => pedirCita({ telefono: tel }), /Demasiadas solicitudes/);
});

test("muchas citas el mismo día no chocan de folio", async () => {
  // El folio son 4 dígitos aleatorios: 10 000 combinaciones por día. Con
  // un centenar de citas diarias, la probabilidad de que dos coincidan
  // ronda el 40%, y el folio es único en la base. Sin reintento, a una
  // clínica ocupada se le caería el formulario a media tarde.
  const folios = new Set();
  for (let i = 0; i < 60; i++) {
    const folio = await pedirCita({ telefono: `55 90${String(i).padStart(2, "0")} 1234`, dias: 3 });
    assert.ok(!folios.has(folio), `folio repetido en el intento ${i}: ${folio}`);
    folios.add(folio);
  }
  assert.strictEqual(folios.size, 60);
});

test("quien pide cita NO puede leer las citas ni los expedientes", async () => {
  await comoAnonimo(db, async () => {
    const { rows: citas } = await db.query("select count(*)::int as n from citas");
    assert.strictEqual(citas[0].n, 0, "pedir cita no da derecho a ver la agenda");
    const { rows: pac } = await db.query("select count(*)::int as n from pacientes");
    assert.strictEqual(pac[0].n, 0);
  });
});

test("el personal sí ve las citas que entraron por la landing", async () => {
  const n = await comoUsuario(db, ADMIN, async () => {
    const { rows } = await db.query("select count(*)::int as n from citas");
    return rows[0].n;
  });
  assert.ok(n > 0);
});

/* ═══ Encuesta de satisfacción ══════════════════════════════════════════ */

test("responder la encuesta con un folio válido funciona", async () => {
  const folio = await pedirCita({ telefono: "55 2020 3030" });

  const ok = await comoAnonimo(db, async () => {
    const { rows } = await db.query(
      "select responder_encuesta($1, $2::smallint, $3) as ok", [folio, 9, "Muy buena atención"]
    );
    return rows[0].ok;
  });
  assert.strictEqual(ok, true);

  const { rows } = await db.query(
    "select puntuacion from nps_respuestas where cita_id = (select id from citas where folio = $1)",
    [folio]
  );
  assert.strictEqual(rows[0].puntuacion, 9);
});

test("la misma cita no admite dos encuestas", async () => {
  const folio = await pedirCita({ telefono: "55 4040 5050" });
  await comoAnonimo(db, () => db.query("select responder_encuesta($1, 8::smallint, '')", [folio]));

  await assert.rejects(
    () => comoAnonimo(db, () => db.query("select responder_encuesta($1, 3::smallint, '')", [folio])),
    /ya fue respondida/
  );
});

test("un folio inventado no sirve para inyectar opiniones", async () => {
  await assert.rejects(
    () => comoAnonimo(db, () => db.query("select responder_encuesta('CIT-000000-0000', 1::smallint, '')")),
    /no encontrado/
  );
});

test("la puntuación tiene que estar entre 1 y 10", async () => {
  const folio = await pedirCita({ telefono: "55 6060 7070" });
  await assert.rejects(
    () => comoAnonimo(db, () => db.query("select responder_encuesta($1, 99::smallint, '')", [folio])),
    /entre 1 y 10/
  );
});

test("encuesta_ya_respondida informa sin exponer nada más", async () => {
  const folio = await pedirCita({ telefono: "55 8080 9090" });

  const antes = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select encuesta_ya_respondida($1) as r", [folio]);
    return rows[0].r;
  });
  assert.strictEqual(antes, false);

  await comoAnonimo(db, () => db.query("select responder_encuesta($1, 10::smallint, '')", [folio]));

  const despues = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select encuesta_ya_respondida($1) as r", [folio]);
    return rows[0].r;
  });
  assert.strictEqual(despues, true);
});

/* ═══ Invariantes del esquema ═══════════════════════════════════════════ */

test("telefono_clave iguala el formato de WhatsApp con el del expediente", async () => {
  const { rows } = await db.query(`
    select public.clave_telefono('525588112233') as wa,
           public.clave_telefono('55 8811 2233') as local,
           public.clave_telefono('+52 (55) 8811-2233') as adornado
  `);
  assert.strictEqual(rows[0].wa, "5588112233");
  assert.strictEqual(rows[0].local, "5588112233");
  assert.strictEqual(rows[0].adornado, "5588112233");
});

test("dos expedientes no pueden compartir teléfono en la misma clínica", async () => {
  await assert.rejects(
    () => db.query(
      "insert into pacientes (clinica_id, nombre, telefono) values ($1, 'Duplicado', '5588112233')",
      [CLINICA]
    ),
    /duplicate key|unique/i
  );
});

test("el mismo teléfono sí puede existir en otra clínica", async () => {
  const { rows: [otra] } = await db.query(
    "insert into clinicas (nombre_clinica) values ('Otra') returning id"
  );
  await assert.doesNotReject(() =>
    db.query("insert into pacientes (clinica_id, nombre, telefono) values ($1, 'Mismo tel', '5588112233')", [otra.id])
  );
});

test("una conversación de WhatsApp no se duplica por teléfono", async () => {
  await db.query(
    "insert into conversaciones (clinica_id, canal, telefono) values ($1, 'whatsapp', '525588112233')",
    [CLINICA]
  );
  await assert.rejects(
    () => db.query(
      "insert into conversaciones (clinica_id, canal, telefono) values ($1, 'whatsapp', '55 8811 2233')",
      [CLINICA]
    ),
    /duplicate key|unique/i,
    "mismo número en distinto formato es el mismo hilo"
  );
});

test("el mismo teléfono en otro canal sí es otra conversación", async () => {
  await assert.doesNotReject(() =>
    db.query("insert into conversaciones (clinica_id, canal, telefono) values ($1, 'voz', '5588112233')", [CLINICA])
  );
});

test("reingerir un mensaje con el mismo id de proveedor falla (idempotencia)", async () => {
  const { rows: [c] } = await db.query(
    "insert into conversaciones (clinica_id, canal, telefono, clave_externa) values ($1,'medibot','5511112222','ses_x') returning id",
    [CLINICA]
  );
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, clave_externa, remitente, contenido) values ($1,$2,'MSG-wa-abc','paciente','Hola')",
    [CLINICA, c.id]
  );
  await assert.rejects(
    () => db.query(
      "insert into mensajes (clinica_id, conversacion_id, clave_externa, remitente, contenido) values ($1,$2,'MSG-wa-abc','paciente','Hola')",
      [CLINICA, c.id]
    ),
    /duplicate key|unique/i,
    "un webhook reintentado no puede duplicar el hilo"
  );
});

/* ═══ El espejo del último mensaje ══════════════════════════════════════ */

async function nuevaConversacion(clave) {
  const { rows: [c] } = await db.query(
    "insert into conversaciones (clinica_id, canal, telefono, clave_externa) values ($1,'medibot','5500000000',$2) returning id",
    [CLINICA, clave]
  );
  return c.id;
}

test("insertar un mensaje actualiza el resumen y el contador de no leídos", async () => {
  const c = await nuevaConversacion("res_1");
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, remitente, contenido) values ($1,$2,'paciente','Buenas tardes')",
    [CLINICA, c]
  );
  const { rows } = await db.query("select ultimo_mensaje, no_leidos from conversaciones where id = $1", [c]);
  assert.strictEqual(rows[0].ultimo_mensaje.texto, "Buenas tardes");
  assert.strictEqual(rows[0].ultimo_mensaje.remitente, "paciente");
  assert.strictEqual(rows[0].no_leidos, 1);
});

test("un mensaje del staff no cuenta como no leído", async () => {
  const c = await nuevaConversacion("res_2");
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, remitente, contenido) values ($1,$2,'staff','Con gusto')",
    [CLINICA, c]
  );
  const { rows } = await db.query("select no_leidos from conversaciones where id = $1", [c]);
  assert.strictEqual(rows[0].no_leidos, 0);
});

test("una nota interna no se asoma como último mensaje del hilo", async () => {
  const c = await nuevaConversacion("res_3");
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, remitente, contenido) values ($1,$2,'paciente','¿Me confirman?')",
    [CLINICA, c]
  );
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, remitente, tipo, contenido) values ($1,$2,'staff','nota_interna','Ojo: paciente moroso')",
    [CLINICA, c]
  );
  const { rows } = await db.query("select ultimo_mensaje from conversaciones where id = $1", [c]);
  assert.strictEqual(
    rows[0].ultimo_mensaje.texto, "¿Me confirman?",
    "una nota interna en el preview sería una fuga hacia la vista de lista"
  );
});

test("un audio deja un texto legible en la lista, no un hueco", async () => {
  const c = await nuevaConversacion("res_4");
  await db.query(
    "insert into mensajes (clinica_id, conversacion_id, remitente, tipo, contenido) values ($1,$2,'paciente','audio','')",
    [CLINICA, c]
  );
  const { rows } = await db.query("select ultimo_mensaje from conversaciones where id = $1", [c]);
  assert.match(rows[0].ultimo_mensaje.texto, /voz/i);
});

test("una cita solo admite una respuesta NPS, aunque se inserte a mano", async () => {
  const { rows: [cita] } = await db.query(
    "insert into citas (clinica_id, folio, nombre, telefono, fecha) values ($1,'CIT-999999-9999','X','5512345678',current_date) returning id",
    [CLINICA]
  );
  await db.query("insert into nps_respuestas (clinica_id, cita_id, puntuacion) values ($1,$2,7)", [CLINICA, cita.id]);
  await assert.rejects(
    () => db.query("insert into nps_respuestas (clinica_id, cita_id, puntuacion) values ($1,$2,2)", [CLINICA, cita.id]),
    /duplicate key|unique/i
  );
});
