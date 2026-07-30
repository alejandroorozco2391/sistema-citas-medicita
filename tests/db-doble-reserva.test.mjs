/* ═══════════════════════════════════════════════════════════════════════
   Una hora, un paciente — 0012_doble_reserva.sql

   Lo que se prueba aquí no es que el índice exista, sino que la cerradura
   cierre para los casos que la vida trae: la misma hora escrita distinto,
   el mismo médico escrito distinto, y la cancelación que sí debe liberar
   el hueco.

   Las dos primeras son las importantes. Un índice sobre `hora` a secas
   habría dejado pasar '9:00' contra '09:00' y nadie lo habría notado
   revisando el código — es el mismo error que los teléfonos con guiones ya
   nos costó una vez.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoUsuario, comoAnonimo, sembrarClinica } from "./db-harness.mjs";

const DOCTOR = "Dra. Laura García";
const MANANA = "2026-08-03";

async function base() {
  const db = await crearBase();
  const a = await sembrarClinica(db, { nombre: "Clínica Uno", sufijo: "1" });
  return { db, ...a };
}

/** Inserta una cita directa, sin pasar por la RPC. Devuelve el error o null. */
async function agendar(db, clinicaId, { doctor = DOCTOR, fecha = MANANA, hora = "09:00",
                                       estado = "pendiente", folio, telefono = "5511110000" } = {}) {
  try {
    await db.query(
      `insert into citas (clinica_id, folio, nombre, telefono, doctor, fecha, hora, estado)
       values ($1, $2, 'Paciente', $3, $4, $5, $6, $7)`,
      [clinicaId, folio || `CIT-${Math.random().toString(36).slice(2, 10)}`, telefono, doctor, fecha, hora, estado]
    );
    return null;
  } catch (e) {
    return e.message;
  }
}

/* ═══ La cerradura ═════════════════════════════════════════════════════ */

test("dos citas en el mismo hueco: la segunda no entra", async () => {
  const { db, clinicaId } = await base();

  assert.equal(await agendar(db, clinicaId, { hora: "09:00" }), null);

  const error = await agendar(db, clinicaId, { hora: "09:00" });
  assert.match(String(error), /citas_slot_unico/,
    "el índice debería frenar la segunda cita en la misma hora");
});

test("'9:00' y '09:00' son la MISMA hora", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "09:00" });

  const error = await agendar(db, clinicaId, { hora: "9:00" });
  assert.match(String(error), /citas_slot_unico/,
    "sin normalizar la hora, el índice dejaría pasar el duplicado");
});

test("el mismo médico escrito distinto es el mismo médico", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { doctor: "Dra. Laura García" });

  const error = await agendar(db, clinicaId, { doctor: "  dra. laura garcía " });
  assert.match(String(error), /citas_slot_unico/,
    "el índice normaliza el nombre del médico");
});

/* ═══ Lo que SÍ debe pasar ═════════════════════════════════════════════ */

test("cancelar libera el hueco", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "10:00", folio: "CIT-CANCELA" });
  await db.query("update citas set estado = 'cancelada' where folio = 'CIT-CANCELA'");

  assert.equal(await agendar(db, clinicaId, { hora: "10:00" }), null,
    "una cita cancelada no debe seguir reservando la hora");
});

test("una cita atendida no reserva el pasado", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "11:00", estado: "atendida" });

  assert.equal(await agendar(db, clinicaId, { hora: "11:00" }), null);
});

test("dos médicos distintos pueden atender a la misma hora", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { doctor: "Dra. Laura García" });
  assert.equal(await agendar(db, clinicaId, { doctor: "Dr. Miguel Ríos" }), null);
});

test("una solicitud sin hora no reserva nada, y varias conviven", async () => {
  const { db, clinicaId } = await base();

  assert.equal(await agendar(db, clinicaId, { hora: "" }), null);
  assert.equal(await agendar(db, clinicaId, { hora: "" }), null,
    "sin hora asignada no hay hueco que reservar");
});

test("el hueco es de cada clínica: dos clínicas no se estorban", async () => {
  const db = await crearBase();
  const a = await sembrarClinica(db, { nombre: "Clínica Uno", sufijo: "1" });
  const b = await sembrarClinica(db, { nombre: "Clínica Dos", sufijo: "2" });

  await agendar(db, a.clinicaId, { hora: "09:00" });
  assert.equal(await agendar(db, b.clinicaId, { hora: "09:00" }), null,
    "el mismo nombre de médico en otra clínica es otra persona");
});

/* ═══ slot_ocupado ═════════════════════════════════════════════════════ */

test("reagendar una cita a su propia hora no choca consigo misma", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "09:00", folio: "CIT-MIA" });
  const { rows: [mia] } = await db.query("select id from citas where folio = 'CIT-MIA'");

  const { rows: [sin] } = await db.query(
    "select slot_ocupado($1, $2, $3, '09:00') as v", [clinicaId, DOCTOR, MANANA]);
  assert.equal(sin.v, true);

  const { rows: [con] } = await db.query(
    "select slot_ocupado($1, $2, $3, '09:00', $4) as v", [clinicaId, DOCTOR, MANANA, mia.id]);
  assert.equal(con.v, false,
    "excluyéndose a sí misma, la cita no debe verse como obstáculo");
});

/* ═══ solicitar_cita: el error que ve el paciente ══════════════════════ */

test("solicitar_cita devuelve un mensaje legible, no el del índice", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "09:00" });

  await assert.rejects(
    () => db.query(
      `select solicitar_cita('Ana', 'López', '55 2222 3333', '', 'Medicina General',
                             $1, $2, '09:00', 'primera', '', false, '', '', $3)`,
      [DOCTOR, MANANA, clinicaId]
    ),
    (e) => {
      assert.match(e.message, /ya está ocupada/,
        `el paciente no debe ver "citas_slot_unico"; vio: ${e.message}`);
      assert.doesNotMatch(e.message, /folio disponible/,
        "reintentar el folio doce veces no es lo que pasó");
      return true;
    }
  );
});

test("solicitar_cita sí agenda cuando el hueco está libre", async () => {
  const { db, clinicaId } = await base();

  await agendar(db, clinicaId, { hora: "09:00" });

  const { rows: [r] } = await db.query(
    `select solicitar_cita('Ana', 'López', '55 2222 3333', '', 'Medicina General',
                           $1, $2, '10:00', 'primera', '', false, '', '', $3) as folio`,
    [DOCTOR, MANANA, clinicaId]
  );
  assert.match(r.folio, /^CIT-\d{6}-\d{4}$/);
});

/* ═══ Qué horas están tomadas ══════════════════════════════════════════ */

test("horas_ocupadas_publico devuelve las horas y nada más", async () => {
  const { db, clinicaId } = await base();
  const fecha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  await agendar(db, clinicaId, { fecha, hora: "9:00" });
  await agendar(db, clinicaId, { fecha, hora: "13:30", estado: "confirmada" });
  await agendar(db, clinicaId, { fecha, hora: "16:00", estado: "cancelada" });

  const { rows: [r] } = await comoAnonimo(db, () =>
    db.query("select horas_ocupadas_publico($1, $2, $3) as h", [DOCTOR, fecha, clinicaId]));

  assert.deepEqual(r.h, ["09:00", "13:30"],
    "normalizadas, sin la cancelada, y en orden");
});

test("horas_ocupadas_publico no acepta fechas fuera de la ventana de agendamiento", async () => {
  const { db, clinicaId } = await base();

  const { rows: [lejos] } = await comoAnonimo(db, () =>
    db.query("select horas_ocupadas_publico($1, current_date + 400, $2) as h", [DOCTOR, clinicaId]));
  assert.deepEqual(lejos.h, [], "sin tope, se podría barrer la agenda de un año día por día");

  const { rows: [antes] } = await comoAnonimo(db, () =>
    db.query("select horas_ocupadas_publico($1, current_date - 30, $2) as h", [DOCTOR, clinicaId]));
  assert.deepEqual(antes.h, []);
});

test("horas_ocupadas es solo del personal; el visitante no la alcanza", async () => {
  const { db, clinicaId, usuarios } = await base();
  const fecha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await agendar(db, clinicaId, { fecha, hora: "09:00" });

  const { rows: [dentro] } = await comoUsuario(db, usuarios.recepcionista, () =>
    db.query("select horas_ocupadas($1, $2) as h", [DOCTOR, fecha]));
  assert.deepEqual(dentro.h, ["09:00"]);

  await assert.rejects(
    () => comoAnonimo(db, () => db.query("select horas_ocupadas($1, $2)", [DOCTOR, fecha])),
    /permission denied|no existe|does not exist/i,
    "la versión del personal no debe estar concedida a anon"
  );
});
