/* ═══════════════════════════════════════════════════════════════════════
   Contacto proactivo — 0017_reactivacion.sql

   Es la única función del sistema que escribe a alguien que NO pidió nada.
   Todo lo demás cuelga de una cita del propio paciente; esto es publicidad
   hecha con un dato de salud, y la LFPDPPP los trata como sensibles.

   Así que lo que se prueba aquí no es que invite: es que no pueda invitar a
   quien no dijo que sí, y que no se pueda insistir.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoUsuario, comoAnonimo } from "./db-harness.mjs";

const SITIO = "https://clinica-de-prueba.example";

async function base() {
  const db = await crearBase();

  const { rows: [c] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, telefono, zona_horaria, sitio_url)
     values ('Clínica de Prueba', 'CDMX', '55 1234 5678', 'America/Mexico_City', $1)
     returning id`,
    [SITIO]
  );

  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'admin@ejemplo.mx') returning id"
  );
  await db.query(
    "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Admin', 'admin')",
    [u.id, c.id]
  );

  return { db, clinicaId: c.id, usuarioId: u.id };
}

/**
 * Paciente con una visita atendida hace `diasSinVenir` días.
 * `acepta` es el opt-in explícito, y nace apagado como en producción.
 */
async function pacienteViejo(db, clinicaId, {
  nombre = "Ana", tel = "55 1111 0000", email = "ana@ejemplo.mx",
  diasSinVenir = 200, acepta = true, conCitaFutura = false,
} = {}) {
  const { rows: [p] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono, email,
                            acepta_promociones, promociones_en)
     values ($1, 'PAC-' || substr(gen_random_uuid()::text, 1, 8), $2, 'López', $3, $4,
             $5, case when $5 then now() else null end)
     returning id`,
    [clinicaId, nombre, tel, email, acepta]
  );

  await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, doctor,
                        especialidad, fecha, hora, estado)
     values ($1, $2, 'CIT-' || substr(gen_random_uuid()::text, 1, 8), $3, $4,
             'Dra. Laura García', 'Medicina General',
             current_date - $5::int, '10:00', 'atendida')`,
    [clinicaId, p.id, nombre, tel, diasSinVenir]
  );

  if (conCitaFutura) {
    await db.query(
      `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, doctor,
                          especialidad, fecha, hora, estado)
       values ($1, $2, 'CIT-' || substr(gen_random_uuid()::text, 1, 8), $3, $4,
               'Dra. Laura García', 'Medicina General',
               current_date + 7, '11:00', 'confirmada')`,
      [clinicaId, p.id, nombre, tel]
    );
  }

  return p.id;
}

const candidatos = (db, usuarioId, dias = 180) =>
  comoUsuario(db, usuarioId, async () =>
    (await db.query("select * from pacientes_por_reactivar($1)", [dias])).rows);

const invitar = (db, usuarioId, pacienteId, mensaje = "") =>
  comoUsuario(db, usuarioId, async () =>
    (await db.query("select invitar_a_volver($1, $2) as r", [pacienteId, mensaje])).rows[0].r);

/* ═══ A quién encuentra ═════════════════════════════════════════════════ */

test("encuentra a quien vino y hace mucho que no vuelve", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { diasSinVenir: 200 });

  const c = await candidatos(db, usuarioId);
  assert.equal(c.length, 1);
  assert.equal(c[0].nombre, "Ana");
  assert.equal(c[0].dias_sin_venir, 200, "el motivo va en el dato, no en el criterio de quien mira");
  assert.equal(Number(c[0].total_visitas), 1);
  assert.equal(c[0].ya_invitado, false);
});

test("NO encuentra a quien no dio su consentimiento", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { acepta: false });

  assert.deepEqual(await candidatos(db, usuarioId), [],
    "el opt-in nace en false: es la diferencia entre servicio y publicidad");
});

test("NO encuentra a quien ya tiene cita agendada", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { conCitaFutura: true });

  assert.deepEqual(await candidatos(db, usuarioId), [],
    "a quien ya va a venir no hay que invitarlo, y recibirlo sería absurdo");
});

test("NO encuentra a quien vino hace poco", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { diasSinVenir: 30 });

  assert.deepEqual(await candidatos(db, usuarioId), []);
});

test("NO encuentra a quien nunca fue atendido", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const { rows: [p] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, telefono, email, acepta_promociones)
     values ($1, 'PAC-XX', 'Nadie', '55 0000 0000', 'x@ejemplo.mx', true) returning id`,
    [clinicaId]
  );
  /* Una cita cancelada no es una visita: invitar a "volver" a alguien que
     nunca vino es la clase de correo que delata que nadie leyó la lista. */
  await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, fecha, estado)
     values ($1, $2, 'CIT-CANCEL', 'Nadie', '55 0000 0000', current_date - 300, 'cancelada')`,
    [clinicaId, p.id]
  );

  assert.deepEqual(await candidatos(db, usuarioId), []);
});

test("NO encuentra a quien se dio de baja de los correos", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);
  await db.query("update pacientes set baja_en = now() where id = $1", [id]);

  assert.deepEqual(await candidatos(db, usuarioId), [],
    "la baja pesa más que el opt-in viejo");
});

test("NO encuentra a quien no tiene correo", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { email: "" });
  assert.deepEqual(await candidatos(db, usuarioId), []);
});

test("el umbral de días es del que consulta", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await pacienteViejo(db, clinicaId, { diasSinVenir: 120 });

  assert.equal((await candidatos(db, usuarioId, 180)).length, 0);
  assert.equal((await candidatos(db, usuarioId, 90)).length, 1);
});

test("cada clínica solo ve a los suyos", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const { rows: [otra] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, sitio_url)
     values ('Clínica Dos', 'GDL', 'https://dos.example') returning id`
  );
  await pacienteViejo(db, clinicaId,  { nombre: "Mía",  tel: "55 1111 0001" });
  await pacienteViejo(db, otra.id,    { nombre: "Ajena", tel: "55 1111 0002", email: "b@ejemplo.mx" });

  const c = await candidatos(db, usuarioId);
  assert.equal(c.length, 1);
  assert.equal(c[0].nombre, "Mía");
});

/* ═══ Invitar ═══════════════════════════════════════════════════════════ */

test("invitar encola UN correo, con enlace de baja", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);

  const r = await invitar(db, usuarioId, id);
  assert.equal(r.ok, true);

  const { rows } = await db.query("select * from avisos_pendientes where tipo = 'reactivacion'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].destinatario, "ana@ejemplo.mx");
  assert.match(rows[0].cuerpo, /baja\.html\?t=/,
    "también esto lleva su salida: si no, es un correo del que nadie puede irse");
  assert.match(rows[0].cuerpo, /clinica-de-prueba\.example/);
});

test("el mensaje de la clínica reemplaza al de fábrica", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);

  await invitar(db, usuarioId, id, "Ya está la nueva campaña de vacunación, te esperamos.");

  const { rows: [a] } = await db.query("select cuerpo from avisos_pendientes");
  assert.match(a.cuerpo, /campaña de vacunación/);
  assert.doesNotMatch(a.cuerpo, /Ha pasado un tiempo/, "no se acumulan los dos textos");
});

test("no se puede invitar a quien no aceptó, aunque se llame directo", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId, { acepta: false });

  const r = await invitar(db, usuarioId, id);
  assert.equal(r.ok, false);
  assert.match(r.error, /no aceptó/,
    "la comprobación va en la función: un botón se puede quedar pintado con datos viejos");

  const { rows } = await db.query("select * from avisos_pendientes");
  assert.equal(rows.length, 0);
});

test("una invitación por trimestre, y el freno es un índice", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);

  assert.equal((await invitar(db, usuarioId, id)).ok, true);

  const segunda = await invitar(db, usuarioId, id);
  assert.equal(segunda.ok, false);
  assert.match(segunda.error, /este trimestre/);

  const { rows } = await db.query("select count(*)::int as n from avisos_pendientes");
  assert.equal(rows[0].n, 1, "insistir es lo que hace que la gente marque el correo como spam");
});

test("quien ya fue invitado se marca en la lista, no desaparece", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);
  await invitar(db, usuarioId, id);

  const c = await candidatos(db, usuarioId);
  assert.equal(c.length, 1, "esconderlo haría creer que se pasó por alto");
  assert.equal(c[0].ya_invitado, true, "y la interfaz no debe ofrecer un botón que va a fallar");
});

test("sin sitio_url no se encola: el correo no tendría salida", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await db.query("update clinicas set sitio_url = '' where id = $1", [clinicaId]);
  const id = await pacienteViejo(db, clinicaId);

  const r = await invitar(db, usuarioId, id);
  assert.equal(r.ok, false);
  assert.match(r.error, /sitio_url/);
});

test("no se puede invitar al paciente de otra clínica", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const { rows: [otra] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, sitio_url)
     values ('Clínica Dos', 'GDL', 'https://dos.example') returning id`
  );
  void clinicaId;
  const ajeno = await pacienteViejo(db, otra.id, { tel: "55 1111 0002", email: "b@ejemplo.mx" });

  const r = await invitar(db, usuarioId, ajeno);
  assert.equal(r.ok, false);
  assert.match(r.error, /no existe en esta clínica/);
});

/* ═══ Nada de esto lo alcanza un visitante ══════════════════════════════ */

test("ni la lista ni la invitación existen sin sesión", async () => {
  const { db, clinicaId } = await base();
  const id = await pacienteViejo(db, clinicaId);

  for (const consulta of [
    () => db.query("select * from pacientes_por_reactivar(180)"),
    () => db.query("select invitar_a_volver($1, '')", [id]),
  ]) {
    await assert.rejects(() => comoAnonimo(db, consulta),
      /permission denied|does not exist|no existe/i,
      "esto es del personal: contiene correos y teléfonos de pacientes");
  }
});

/* ═══ El reloj NO manda esto ════════════════════════════════════════════ */

test("el barrido automático de 0014 no toca las reactivaciones", async () => {
  const { db, clinicaId, usuarioId } = await base();
  const id = await pacienteViejo(db, clinicaId);
  void id;

  /* Es la postura del diseño y por eso tiene prueba: encontrar candidatos es
     automático, mandar es una decisión de una persona. Un lote de "vuelve"
     que sale solo es lo que termina marcando el dominio de la clínica como
     spam, y eso se lleva también los correos que sus pacientes sí querían. */
  const { rows: [{ n }] } = await db.query("select encolar_avisos_del_dia() as n");
  assert.equal(n, 0);

  const { rows } = await db.query("select * from avisos_pendientes where tipo = 'reactivacion'");
  assert.equal(rows.length, 0,
    "si algún día se automatiza, que sea una decisión escrita y no un efecto colateral");

  /* Y por el otro lado: la lista sigue ahí para que alguien la mire. */
  assert.equal((await candidatos(db, usuarioId)).length, 1);
});
