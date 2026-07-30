/* ═══════════════════════════════════════════════════════════════════════
   El reloj puesto a trabajar — 0014_avisos_automaticos.sql

   Lo que se prueba aquí no es que el correo salga: eso lo hace
   api/avisar.js y ya estaba probado en producción. Es que el PRODUCTOR no
   mande de más.

   Un productor que se equivoca hacia el otro lado no molesta a nadie: se
   pierde un recordatorio. Uno que se equivoca hacia este manda el mismo
   correo cada hora durante un día entero, a gente que confía en su médico,
   y termina con el dominio de la clínica marcado como spam — arrastrando
   los correos que sí querían recibir.

   De ahí que la prueba central sea la idempotencia, y que se corra el
   barrido tres veces en vez de una.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoAnonimo } from "./db-harness.mjs";

const SITIO = "https://clinica-de-prueba.example";

/**
 * Zona horaria en la que AHORA MISMO son las `horaLocal`.
 *
 * Se calcula en vez de escribir "Asia/Tokyo": una lista fija de zonas pasa
 * o falla según la hora a la que se corra la prueba. Y el guardia inverso
 * —"si estamos fuera de la ventana, no compruebes nada"— es peor todavía:
 * a las 3 de la mañana la mitad de la suite no probaría nada y diría que
 * pasó. Así, toda la suite corre en una clínica donde es mediodía.
 *
 * Ojo con el signo: en las zonas POSIX `Etc/GMT+5` es UTC−5, al revés de
 * lo que parece.
 */
function zonaDondeSon(horaLocal) {
  const utc = new Date().getUTCHours();
  let o = (horaLocal - utc + 24) % 24;
  if (o > 14) o -= 24;                       // Etc/GMT va de +12 (oeste) a −14 (este)
  if (o === 0) return "Etc/GMT";
  return o > 0 ? `Etc/GMT-${o}` : `Etc/GMT+${-o}`;
}

/** Clínica con personal. Por omisión, una donde ahora mismo es mediodía. */
async function base({ zona = zonaDondeSon(12), sitio = SITIO } = {}) {
  const db = await crearBase();

  const { rows: [c] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, telefono, zona_horaria, sitio_url)
     values ('Clínica de Prueba', 'CDMX', '55 1234 5678', $1, $2) returning id`,
    [zona, sitio]
  );

  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'admin@ejemplo.mx') returning id"
  );
  await db.query(
    "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Admin', 'admin')",
    [u.id, c.id]
  );

  return { db, clinicaId: c.id };
}

/** Paciente + cita, en la fecha local de la clínica que se indique. */
async function conCita(db, clinicaId, { dias = 1, estado = "pendiente", email = "ana@ejemplo.mx",
                                       tel = "55 2222 3333" } = {}) {
  const { rows: [p] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono, email)
     values ($1, 'PAC-' || substr(gen_random_uuid()::text, 1, 8), 'Ana', 'López', $2, $3)
     returning id, baja_token`,
    [clinicaId, tel, email]
  );

  const { rows: [c] } = await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, email,
                        doctor, especialidad, fecha, hora, estado)
     values ($1, $2, 'CIT-' || substr(gen_random_uuid()::text, 1, 8), 'Ana', $3, $4,
             'Dra. Laura García', 'Medicina General',
             ((now() at time zone (select zona_horaria from clinicas where id = $1))::date + $5::int),
             '09:00', $6)
     returning id, folio, fecha`,
    [clinicaId, p.id, tel, email, dias, estado]
  );

  return { pacienteId: p.id, token: p.baja_token, citaId: c.id, folio: c.folio };
}

const barrer = async (db) =>
  (await db.query("select encolar_avisos_del_dia() as n")).rows[0].n;

const cola = async (db, tipo = null) => (await db.query(
  tipo ? "select * from avisos_pendientes where tipo = $1 order by creado_en" : "select * from avisos_pendientes order by creado_en",
  tipo ? [tipo] : []
)).rows;

/** ¿Está la clínica dentro de la ventana de 8 a 20 locales ahora mismo? */
async function enVentana(db, clinicaId) {
  const { rows: [r] } = await db.query(
    `select extract(hour from (now() at time zone zona_horaria))::int as h
     from clinicas where id = $1`, [clinicaId]);
  return r.h >= 8 && r.h <= 20;
}

/* ═══ Recordatorio de la víspera ═══════════════════════════════════════ */

test("la cita de mañana genera un recordatorio con folio, fecha y salida", async () => {
  const { db, clinicaId } = await base();
  const { folio, token } = await conCita(db, clinicaId, { dias: 1 });


  assert.equal(await barrer(db), 1);

  const [a] = await cola(db, "recordatorio_cita");
  assert.equal(a.destinatario, "ana@ejemplo.mx");
  assert.match(a.asunto, /mañana/);
  assert.ok(a.cuerpo.includes(folio), "el recordatorio debe traer el folio");
  assert.ok(a.cuerpo.includes("Dra. Laura García"));
  assert.ok(a.cuerpo.includes(`${SITIO}/baja.html?t=${token}`),
    "todo correo automático lleva su enlace de baja");
});

test("el barrido es idempotente: correrlo tres veces encola UNA vez", async () => {
  const { db, clinicaId } = await base();
  await conCita(db, clinicaId, { dias: 1 });

  await barrer(db);
  await barrer(db);
  await barrer(db);

  assert.equal((await cola(db, "recordatorio_cita")).length, 1,
    "el índice único es lo que sostiene esto, no la puntualidad del cron");
});

test("no se recuerda una cita cancelada, ni una de pasado mañana, ni una sin correo", async () => {
  const { db, clinicaId } = await base();
  await conCita(db, clinicaId, { dias: 1, estado: "cancelada", tel: "55 1111 0001" });
  await conCita(db, clinicaId, { dias: 3, tel: "55 1111 0002" });
  await conCita(db, clinicaId, { dias: 1, email: "", tel: "55 1111 0003" });

  assert.equal(await barrer(db), 0);
  assert.equal((await cola(db)).length, 0);
});

/* ═══ Seguimientos ═════════════════════════════════════════════════════ */

async function conSeguimiento(db, clinicaId, diasDesde, opciones = {}) {
  const s = await conCita(db, clinicaId, { dias: -diasDesde, estado: "atendida", ...opciones });
  await db.query(
    `insert into seguimientos (clinica_id, cita_id, fecha_atendida)
     values ($1, $2, ((now() at time zone (select zona_horaria from clinicas where id = $1))::date - $3::int))`,
    [clinicaId, s.citaId, diasDesde]
  );
  return s;
}

test("a los 3 días sale el seguimiento con el enlace de la encuesta", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conSeguimiento(db, clinicaId, 3);

  assert.equal(await barrer(db), 1);

  const [a] = await cola(db, "seguimiento_3d");
  assert.ok(a.cuerpo.includes(`${SITIO}/encuesta.html?folio=${folio}`),
    "el seguimiento es lo que lleva al paciente a la encuesta");

  const { rows: [s] } = await db.query("select email_enviado_3d, email_enviado_30d from seguimientos");
  assert.equal(s.email_enviado_3d, true, "se marca al encolar, no al entregar");
  assert.equal(s.email_enviado_30d, false, "el de 30 días sigue pendiente");
});

test("a los 30 días sale el otro, y el de 3 días ya no se repite", async () => {
  const { db, clinicaId } = await base();
  await conSeguimiento(db, clinicaId, 30);

  await barrer(db);
  await barrer(db);

  const c = await cola(db);
  assert.equal(c.length, 1);
  assert.equal(c[0].tipo, "seguimiento_30d");
  assert.match(c[0].asunto, /un mes/);
});

test("a los 10 días no sale nada: son fechas exactas, no rangos", async () => {
  const { db, clinicaId } = await base();
  await conSeguimiento(db, clinicaId, 10);

  assert.equal(await barrer(db), 0,
    "con un rango, una clínica que activa esto meses después inundaría a su histórico entero");
});

/* ═══ La ventana horaria ═══════════════════════════════════════════════ */

test("nadie recibe correos de madrugada, y la hora es la de SU clínica", async () => {
  /* Es el bug que ya nos costó una vez, con el horario: el servidor está en
     UTC, y evaluar la hora sin convertir le manda los correos a un
     consultorio de Tijuana a las 2 de la mañana. */
  const deNoche = zonaDondeSon(3);
  const deDia   = zonaDondeSon(12);

  const noche = await base({ zona: deNoche });
  await conCita(noche.db, noche.clinicaId, { dias: 1 });
  assert.equal(await enVentana(noche.db, noche.clinicaId), false,
    `en ${deNoche} deberían ser las 3 de la mañana`);
  assert.equal(await barrer(noche.db), 0,
    "a las 3 de la mañana no se le escribe a nadie");

  const dia = await base({ zona: deDia });
  await conCita(dia.db, dia.clinicaId, { dias: 1 });
  assert.equal(await enVentana(dia.db, dia.clinicaId), true,
    `en ${deDia} debería ser mediodía`);
  assert.equal(await barrer(dia.db), 1,
    "al mediodía sí, y la fecha de 'mañana' también es la local");
});

/* ═══ Consentimiento, tope y baja ══════════════════════════════════════ */

test("apagar el recordatorio no apaga el seguimiento, y al revés", async () => {
  const { db, clinicaId } = await base();
  const a = await conCita(db, clinicaId, { dias: 1, tel: "55 1111 0001" });
  await db.query("update pacientes set avisa_recordatorios = false where id = $1", [a.pacienteId]);

  const b = await conSeguimiento(db, clinicaId, 3, { tel: "55 1111 0002", email: "b@ejemplo.mx" });
  await db.query("update pacientes set avisa_seguimientos = false where id = $1", [b.pacienteId]);

  assert.equal(await barrer(db), 0, "cada interruptor apaga solo lo suyo");
});

test("sin sitio_url no se encola nada: sería un correo sin salida", async () => {
  const { db, clinicaId } = await base({ sitio: "" });
  await conCita(db, clinicaId, { dias: 1 });

  assert.equal(await barrer(db), 0,
    "un correo automático del que no se puede bajar nadie no debe salir");
});

test("el tope corta al cuarto aviso de la semana", async () => {
  const { db, clinicaId } = await base();
  const { pacienteId } = await conCita(db, clinicaId, { dias: 1 });

  const { rows: [antes] } = await db.query("select puede_recibir_aviso($1) as v", [pacienteId]);
  assert.equal(antes.v, true);

  for (let i = 0; i < 3; i++) {
    await db.query(
      `insert into avisos_pendientes (clinica_id, tipo, paciente_id, destinatario, asunto, cuerpo)
       values ($1, 'recordatorio_cita', $2, 'ana@ejemplo.mx', 'x', 'y')`,
      [clinicaId, pacienteId]
    );
  }

  const { rows: [despues] } = await db.query("select puede_recibir_aviso($1) as v", [pacienteId]);
  assert.equal(despues.v, false, "tres en siete días ya es ruido; el cuarto es una queja de spam");
});

test("la baja funciona sin sesión, con el token del correo", async () => {
  const { db, clinicaId } = await base();
  const { token } = await conCita(db, clinicaId, { dias: 1 });

  const { rows: [previo] } = await comoAnonimo(db, () =>
    db.query("select consultar_baja($1) as r", [token]));
  assert.equal(previo.r.valido, true);
  assert.equal(previo.r.nombre, "Ana");
  assert.equal(previo.r.recordatorios, true);

  const { rows: [tras] } = await comoAnonimo(db, () =>
    db.query("select darse_de_baja($1, 'todo') as r", [token]));
  assert.equal(tras.r.dadoDeBaja, true);
  assert.equal(tras.r.recordatorios, false);

  assert.equal(await barrer(db), 0, "dado de baja, no vuelve a recibir nada");
});

test("bajarse solo de los seguimientos conserva el recordatorio", async () => {
  const { db, clinicaId } = await base();
  const { token } = await conCita(db, clinicaId, { dias: 1 });

  const { rows: [r] } = await comoAnonimo(db, () =>
    db.query("select darse_de_baja($1, 'seguimientos') as r", [token]));
  assert.equal(r.r.recordatorios, true, "es lo que la mayoría quiere seguir recibiendo");
  assert.equal(r.r.seguimientos, false);

  assert.equal(await barrer(db), 1, "el recordatorio de su cita sigue saliendo");
});

test("darse de baja cancela lo que ya estaba encolado y no ha salido", async () => {
  const { db, clinicaId } = await base();
  const { token, pacienteId } = await conCita(db, clinicaId, { dias: 1 });

  await barrer(db);
  assert.equal((await cola(db)).length, 1);

  await comoAnonimo(db, () => db.query("select darse_de_baja($1, 'todo')", [token]));

  const { rows: [a] } = await db.query(
    "select estado, ultimo_error from avisos_pendientes where paciente_id = $1", [pacienteId]);
  assert.equal(a.estado, "fallido");
  assert.match(a.ultimo_error, /baja del paciente/,
    "darse de baja y recibir un correo al minuto es lo que hace que nadie le crea al enlace");
});

test("un token inventado no dice si existe o no, y no revienta", async () => {
  const { db } = await base();

  const { rows: [r] } = await comoAnonimo(db, () =>
    db.query("select consultar_baja('noexiste') as r"));
  assert.deepEqual(r.r, { valido: false }, "no se filtra nada sobre tokens ajenos");

  await assert.rejects(
    () => comoAnonimo(db, () => db.query("select darse_de_baja('noexiste', 'todo')")),
    /ya no es válido/
  );
});

/* ═══ Aislamiento ══════════════════════════════════════════════════════ */

test("el barrido de una clínica no toca los datos de la otra", async () => {
  const { db, clinicaId: a } = await base();

  const { rows: [otra] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, zona_horaria, sitio_url)
     values ('Clínica Dos', 'GDL', 'America/Mexico_City', $1) returning id`,
    ["https://dos.example"]
  );
  await conCita(db, a, { dias: 1, tel: "55 1111 0001" });
  await conCita(db, otra.id, { dias: 1, tel: "55 1111 0002", email: "b@ejemplo.mx" });


  await db.query("select encolar_recordatorios($1)", [a]);

  const c = await cola(db);
  assert.equal(c.length, 1);
  assert.equal(c[0].clinica_id, a, "encolar_recordatorios recibe una clínica y solo trabaja esa");
});

test("la cola de avisos no la lee la llave pública", async () => {
  const { db, clinicaId } = await base();
  const { pacienteId } = await conCita(db, clinicaId, { dias: 1 });
  await db.query(
    `insert into avisos_pendientes (clinica_id, tipo, paciente_id, destinatario, asunto, cuerpo)
     values ($1, 'recordatorio_cita', $2, 'ana@ejemplo.mx', 'Asunto privado', 'Cuerpo privado')`,
    [clinicaId, pacienteId]
  );

  const { rows } = await comoAnonimo(db, () =>
    db.query("select * from avisos_pendientes"));
  assert.equal(rows.length, 0,
    "la bandeja trae correos y teléfonos de pacientes; RLS es lo único que la tapa");
});
