/* ═══════════════════════════════════════════════════════════════════════
   Cancelar un bloque, y el consentimiento con evidencia — 0018

   El caso que lo motivó: "cancela mis citas del jueves de 3 a 6, tengo una
   cirugía de emergencia". Hasta aquí el sistema enseñaba a quiénes dejaba
   plantados y no hacía nada más.

   Lo que se prueba aquí no es que cancele. Es que **nadie se quede sin
   enterarse**: quien no tiene correo tiene que salir en la respuesta, con
   su teléfono, para que alguien lo llame. Si solo se contaran los avisados,
   esa persona se presentaría a un consultorio cerrado y nadie sabría que
   faltó avisarle — que es exactamente el silencio que este proyecto lleva
   meses cazando.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoUsuario, comoAnonimo } from "./db-harness.mjs";

const SITIO = "https://clinica-de-prueba.example";
const TEXTO_CONSENT =
  "Acepto recibir invitaciones para volver a consulta por correo electrónico.";

async function base({ sms = false } = {}) {
  const db = await crearBase();

  const { rows: [c] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, telefono, zona_horaria, sitio_url, sms_activo)
     values ('Clínica de Prueba', 'CDMX', '55 1234 5678', 'America/Mexico_City', $1, $2)
     returning id`,
    [SITIO, sms]
  );

  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'doc@ejemplo.mx') returning id"
  );
  await db.query(
    "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Doctor', 'doctor')",
    [u.id, c.id]
  );

  return { db, clinicaId: c.id, usuarioId: u.id };
}

async function cita(db, clinicaId, { nombre = "Ana", tel = "55 1111 0001",
                                     email = "ana@ejemplo.mx", hora = "15:00",
                                     dias = 3, doctor = "Dra. Laura García",
                                     estado = "pendiente" } = {}) {
  const { rows: [p] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono, email)
     values ($1, 'PAC-' || substr(gen_random_uuid()::text, 1, 8), $2, 'López', $3, $4)
     returning id`,
    [clinicaId, nombre, tel, email]
  );
  const { rows: [c] } = await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, apellidos, telefono, email,
                        doctor, especialidad, fecha, hora, estado)
     values ($1, $2, 'CIT-' || substr(gen_random_uuid()::text, 1, 8), $3, 'López', $4, $5,
             $6, 'Medicina General', current_date + $7::int, $8, $9)
     returning id, folio, fecha`,
    [clinicaId, p.id, nombre, tel, email, doctor, dias, hora, estado]
  );
  return { pacienteId: p.id, citaId: c.id, folio: c.folio, fecha: c.fecha };
}

const cancelar = (db, usuarioId, args) =>
  comoUsuario(db, usuarioId, async () =>
    (await db.query(
      `select cancelar_bloque(
         (current_date + $1::int)::date, $2::time, $3::time, $4, $5, $6) as r`,
      [args.dias ?? 3, args.desde ?? null, args.hasta ?? null,
       args.motivo ?? "", args.doctor ?? null, args.avisar ?? true]
    )).rows[0].r);

const avisos = async (db, canal = null) => (await db.query(
  canal
    ? "select * from avisos_pendientes where tipo = 'cita_cancelada' and canal = $1 order by creado_en"
    : "select * from avisos_pendientes where tipo = 'cita_cancelada' order by creado_en",
  canal ? [canal] : []
)).rows;

/* ═══ Cancelar el rango correcto ════════════════════════════════════════ */

test("cancela solo las del rango, y deja en pie las demás", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const dentro  = await cita(db, clinicaId, { hora: "15:00", tel: "55 1111 0001" });
  const dentro2 = await cita(db, clinicaId, { hora: "17:30", tel: "55 1111 0002" });
  const fuera   = await cita(db, clinicaId, { hora: "09:00", tel: "55 1111 0003" });

  const r = await cancelar(db, usuarioId, { desde: "15:00", hasta: "18:00" });
  assert.equal(r.canceladas, 2);

  const estado = async (folio) =>
    (await db.query("select estado, cancelada_por from citas where folio = $1", [folio])).rows[0];

  assert.equal((await estado(dentro.folio)).estado, "cancelada");
  assert.equal((await estado(dentro2.folio)).estado, "cancelada");
  assert.equal((await estado(fuera.folio)).estado, "pendiente", "las 9 de la mañana no entran");

  assert.equal((await estado(dentro.folio)).cancelada_por, "clinica",
    "que cancele el consultorio no es lo mismo que que cancele el paciente");
});

test("sin horas, cancela el día entero", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, { hora: "09:00", tel: "55 1111 0001" });
  await cita(db, clinicaId, { hora: "19:00", tel: "55 1111 0002" });

  const r = await cancelar(db, usuarioId, {});
  assert.equal(r.canceladas, 2);
});

test("una cita SIN hora entra en el rango: ante la duda, que la vea un humano", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, { hora: "", tel: "55 1111 0001" });

  const r = await cancelar(db, usuarioId, { desde: "15:00", hasta: "18:00" });
  assert.equal(r.canceladas, 1,
    "dejarla en pie haría que alguien se presentara a un consultorio cerrado");
});

test("se puede acotar a un médico: el otro sigue atendiendo", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, { doctor: "Dra. Laura García", tel: "55 1111 0001" });
  const otro = await cita(db, clinicaId, { doctor: "Dr. Miguel Ríos", tel: "55 1111 0002", hora: "15:30" });

  const r = await cancelar(db, usuarioId, { doctor: "  dra. laura garcía " });
  assert.equal(r.canceladas, 1, "el nombre se normaliza igual que en el índice de huecos");

  const { rows: [c] } = await db.query("select estado from citas where folio = $1", [otro.folio]);
  assert.equal(c.estado, "pendiente");
});

test("no toca las que ya estaban canceladas ni las atendidas", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, { estado: "cancelada", tel: "55 1111 0001" });
  await cita(db, clinicaId, { estado: "atendida",  tel: "55 1111 0002", hora: "15:30" });

  const r = await cancelar(db, usuarioId, {});
  assert.equal(r.canceladas, 0);
  assert.equal((await avisos(db)).length, 0, "y no le escribe a nadie por una cita que ya pasó");
});

/* ═══ Que nadie se quede sin enterarse ══════════════════════════════════ */

test("el correo dice qué cita era, por qué, y cómo reagendar", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const c = await cita(db, clinicaId, { hora: "15:00" });

  const r = await cancelar(db, usuarioId, { motivo: "Cirugía de emergencia" });
  assert.equal(r.avisados, 1);

  const [a] = await avisos(db);
  assert.equal(a.destinatario, "ana@ejemplo.mx");
  assert.ok(a.cuerpo.includes(c.folio), "sin el folio no puede identificar cuál cita era");
  assert.match(a.cuerpo, /Cirugía de emergencia/);
  assert.match(a.cuerpo, /15:00/);
  assert.ok(a.cuerpo.includes(SITIO), "hay que ofrecerle reagendar, no solo avisarle");
  assert.match(a.cuerpo, /55 1234 5678/, "y el teléfono, para quien prefiera llamar");
});

test("quien NO tiene correo sale en la respuesta con su teléfono", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, { nombre: "Ana",  email: "ana@ejemplo.mx", tel: "55 1111 0001" });
  await cita(db, clinicaId, { nombre: "Beto", email: "", tel: "55 3333 4444", hora: "16:00" });

  const r = await cancelar(db, usuarioId, {});

  assert.equal(r.canceladas, 2);
  assert.equal(r.avisados, 1);
  assert.equal(r.sinCorreo.length, 1);
  assert.equal(r.sinCorreo[0].nombre, "Beto López");
  assert.equal(r.sinCorreo[0].telefono, "55 3333 4444",
    "hay que poder llamarlo: si solo se contaran los avisados, se presentaría al consultorio");
});

test("se puede cancelar SIN avisar, y entonces no sale ningún correo", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, {});

  const r = await cancelar(db, usuarioId, { avisar: false });
  assert.equal(r.canceladas, 1);
  assert.equal(r.avisados, 0);
  assert.equal((await avisos(db)).length, 0);
});

test("el aviso lleva el enlace de baja cuando se puede, y sale igual cuando no", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await cita(db, clinicaId, {});
  await cancelar(db, usuarioId, {});
  assert.match((await avisos(db))[0].cuerpo, /baja\.html\?t=/);

  /* Sin sitio_url no hay enlace de baja, y aun así este correo SALE: no es
     publicidad, es avisarle que la cita que pidió ya no va. Callarlo sería
     lo indefendible. */
  const otra = await base();
  await otra.db.query("update clinicas set sitio_url = '' where id = $1", [otra.clinicaId]);
  await cita(otra.db, otra.clinicaId, {});
  const r = await cancelar(otra.db, otra.usuarioId, {});
  assert.equal(r.avisados, 1);
  assert.equal((await avisos(otra.db)).length, 1);
});

/* ═══ SMS ═══════════════════════════════════════════════════════════════ */

test("con SMS encendido salen DOS avisos: correo y mensaje", async () => {
  const { db, clinicaId, usuarioId } = await base({ sms: true });
  await cita(db, clinicaId, { hora: "15:00" });

  const r = await cancelar(db, usuarioId, {});
  assert.equal(r.porSms, true);

  const correos = await avisos(db, "email");
  const sms = await avisos(db, "sms");
  assert.equal(correos.length, 1);
  assert.equal(sms.length, 1, "una cancelación de mañana no puede depender de que abra el correo");
  assert.equal(sms[0].destinatario, "55 1111 0001");
  assert.ok(sms[0].cuerpo.length < 320, "un SMS largo se parte en varios y se cobra por cada uno");
  assert.match(sms[0].cuerpo, /cancelamos tu cita/);
});

test("con SMS apagado solo sale el correo", async () => {
  const { db, clinicaId, usuarioId } = await base({ sms: false });
  await cita(db, clinicaId, {});
  await cancelar(db, usuarioId, {});

  assert.equal((await avisos(db, "email")).length, 1);
  assert.equal((await avisos(db, "sms")).length, 0);
});

/* ═══ Quién puede ══════════════════════════════════════════════════════ */

test("cancelar un bloque exige sesión", async () => {
  const { db } = await base();
  await assert.rejects(
    () => comoAnonimo(db, () =>
      db.query("select cancelar_bloque(current_date + 3, null, null, '', null, true)")),
    /permission denied|does not exist|no existe/i
  );
});

test("no alcanza las citas de otra clínica", async () => {
  const { db, clinicaId, usuarioId } = await base();
  void clinicaId;
  const { rows: [otra] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad) values ('Clínica Dos', 'GDL') returning id`
  );
  const ajena = await cita(db, otra.id, { tel: "55 9999 0000" });

  const r = await cancelar(db, usuarioId, {});
  assert.equal(r.canceladas, 0);

  const { rows: [c] } = await db.query("select estado from citas where folio = $1", [ajena.folio]);
  assert.equal(c.estado, "pendiente");
});

/* ═══ Consentimiento con evidencia ══════════════════════════════════════ */

const pedirCita = (db, clinicaId, { acepta = false, texto = "", tel = "55 7777 8888" } = {}) =>
  comoAnonimo(db, async () =>
    (await db.query(
      `select solicitar_cita('Ana', 'López', $1, 'ana@ejemplo.mx', 'Medicina General',
                             'Dra. Laura García', current_date + 5, '10:00', 'Primera vez',
                             '', false, '', '', $2, $3, $4) as folio`,
      [tel, clinicaId, acepta, texto]
    )).rows[0].folio);

test("sin marcar la casilla, el paciente NO queda con consentimiento", async () => {
  const { db, clinicaId } = await base();
  await pedirCita(db, clinicaId);

  const { rows: [p] } = await db.query(
    "select acepta_promociones, consentimiento_origen from pacientes limit 1");
  assert.equal(p.acepta_promociones, false, "la casilla nace desmarcada y así se queda");
  assert.equal(p.consentimiento_origen, null);
});

test("al marcarla se guarda el TEXTO que aceptó y de dónde vino", async () => {
  const { db, clinicaId } = await base();
  await pedirCita(db, clinicaId, { acepta: true, texto: TEXTO_CONSENT });

  const { rows: [p] } = await db.query(
    "select acepta_promociones, consentimiento_texto, consentimiento_origen, promociones_en from pacientes limit 1");

  assert.equal(p.acepta_promociones, true);
  assert.equal(p.consentimiento_texto, TEXTO_CONSENT,
    'sin el texto, "consentimiento expreso" no se puede demostrar y por lo tanto no existe');
  assert.equal(p.consentimiento_origen, "paciente_web",
    "lo marcó él, no el personal por él: es la diferencia entre evidencia y afirmación");
  assert.ok(p.promociones_en, "y cuándo lo dijo");
});

test("no marcarla en la SEGUNDA cita no revoca lo que aceptó en la primera", async () => {
  const { db, clinicaId } = await base();
  await pedirCita(db, clinicaId, { acepta: true, texto: TEXTO_CONSENT });
  await db.query("update citas set hora = '08:00'");     // libera el hueco de las 10
  await pedirCita(db, clinicaId, { acepta: false });

  const { rows: [p] } = await db.query("select acepta_promociones from pacientes limit 1");
  assert.equal(p.acepta_promociones, true,
    "revocar es un acto explícito, y para eso está el enlace de baja");
});

test("pedir cita sigue funcionando exactamente igual que antes", async () => {
  const { db, clinicaId } = await base();
  const folio = await pedirCita(db, clinicaId);
  assert.match(folio, /^CIT-\d{6}-\d{4}$/);

  const { rows: [c] } = await db.query("select estado, origen from citas where folio = $1", [folio]);
  assert.equal(c.estado, "pendiente");
  assert.equal(c.origen, "web");
});

test("y sigue rechazando el hueco ocupado y el teléfono corto", async () => {
  const { db, clinicaId } = await base();
  await pedirCita(db, clinicaId);

  await assert.rejects(() => pedirCita(db, clinicaId, { tel: "55 0000 1111" }), /ya está ocupada/);
  await assert.rejects(() => pedirCita(db, clinicaId, { tel: "5588" }), /10 dígitos/);
});
