/* ═══════════════════════════════════════════════════════════════════════
   "Mis citas" — 0016_mis_citas.sql

   Esto le da a alguien sin cuenta la capacidad de MODIFICAR la agenda de
   una clínica. Es la primera función pública que escribe algo que el
   personal no pidió, así que lo que se prueba aquí no es que cancele: es
   que no se pueda cancelar la cita de otro, ni averiguar qué folios existen
   probando.

   La credencial son dos factores, folio Y teléfono, y ninguno alcanza solo:
   el folio viaja en cada correo, y el teléfono lo sabe cualquiera que
   conozca al paciente.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoAnonimo, comoUsuario } from "./db-harness.mjs";

const TEL_ANA  = "55 1111 2222";
const TEL_BETO = "55 3333 4444";

async function base() {
  const db = await crearBase();

  const { rows: [c] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad, zona_horaria)
     values ('Clínica de Prueba', 'CDMX', 'America/Mexico_City') returning id`
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

/** Paciente con una cita. `dias` relativo a hoy. */
async function conCita(db, clinicaId, { nombre = "Ana", tel = TEL_ANA, dias = 5,
                                        hora = "10:00", estado = "pendiente", folio } = {}) {
  const { rows: [p] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono, email)
     values ($1, 'PAC-' || substr(gen_random_uuid()::text, 1, 8), $2, 'López', $3, 'x@ejemplo.mx')
     on conflict do nothing
     returning id`,
    [clinicaId, nombre, tel]
  );

  const pacienteId = p?.id ?? (await db.query(
    "select id from pacientes where clinica_id = $1 and telefono_clave = clave_telefono($2)",
    [clinicaId, tel]
  )).rows[0].id;

  const { rows: [c] } = await db.query(
    `insert into citas (clinica_id, paciente_id, folio, nombre, telefono, doctor,
                        especialidad, fecha, hora, tipo, estado)
     values ($1, $2, $3, $4, $5, 'Dra. Laura García', 'Medicina General',
             current_date + $6::int, $7, 'Primera vez', $8)
     returning id, folio`,
    [clinicaId, pacienteId, folio || `CIT-${Math.random().toString(36).slice(2, 10)}`,
     nombre, tel, dias, hora, estado]
  );

  return { pacienteId, citaId: c.id, folio: c.folio };
}

const consultar = (db, folio, tel, clinicaId) =>
  comoAnonimo(db, () => db.query("select mis_citas($1, $2, $3) as r", [folio, tel, clinicaId]));

const cancelar = (db, folio, tel, clinicaId, motivo = "") =>
  comoAnonimo(db, () =>
    db.query("select cancelar_mi_cita($1, $2, $3, $4) as r", [folio, tel, motivo, clinicaId]));

/* Las dos funciones devuelven `{ok:false, error}` en vez de lanzar, y eso no
   es un capricho de estilo: `raise exception` aborta la transacción y con
   ella el INSERT en la bitácora de intentos, así que el freno de abuso
   quedaba escrito y no podía contar nada. Lo cazó la prueba de más abajo. */
async function debeFallar(promesa, patron, mensaje) {
  const { rows: [{ r }] } = await promesa;
  assert.equal(r.ok, false, mensaje || "debía fallar y no falló");
  assert.match(r.error, patron);
  return r;
}

async function debeLograr(promesa) {
  const { rows: [{ r }] } = await promesa;
  assert.equal(r.ok, true, `falló: ${r.error || "(sin mensaje)"}`);
  return r;
}

/* ═══ Consultar ═════════════════════════════════════════════════════════ */

test("con folio y teléfono correctos, el paciente ve su cita", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId);

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));

  assert.equal(r.nombre, "Ana");
  assert.equal(r.citas.length, 1);
  assert.equal(r.citas[0].folio, folio);
  assert.equal(r.citas[0].doctor, "Dra. Laura García");
  assert.equal(r.citas[0].cancelable, true);
});

test("el teléfono se cruza sin importar cómo esté escrito", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { tel: "55 1111 2222" });

  for (const forma of ["5511112222", "+52 55 1111 2222", "55-1111-2222"]) {
    const r = await debeLograr(consultar(db, folio, forma, clinicaId));
    assert.equal(r.citas.length, 1, `no cruzó con "${forma}"`);
  }
});

test("el folio no distingue mayúsculas ni espacios de sobra", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { folio: "CIT-260805-1234" });

  const r = await debeLograr(consultar(db, "  cit-260805-1234 ", TEL_ANA, clinicaId));
  assert.equal(r.citas[0].folio, folio, "lo copian del correo y a veces con espacios");
});

test("ve TODAS sus citas, no solo la del folio con que entró", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5, hora: "10:00" });
  await conCita(db, clinicaId, { dias: 20, hora: "11:00" });

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));
  assert.equal(r.citas.length, 2, "lo que quiere ver es su próxima cita, no la del correo que abrió");
});

test("no le vuelca el historial de años", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5 });
  await conCita(db, clinicaId, { dias: -400, hora: "09:00", estado: "atendida" });

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));
  assert.equal(r.citas.length, 1, "la ventana es de 30 días atrás en adelante");
});

/* ═══ Lo que NO puede ver ═══════════════════════════════════════════════ */

test("el folio de Ana con el teléfono de Beto no abre nada", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { nombre: "Ana", tel: TEL_ANA });
  await conCita(db, clinicaId, { nombre: "Beto", tel: TEL_BETO, hora: "12:00" });

  await debeFallar(consultar(db, folio, TEL_BETO, clinicaId),
    /No encontramos ninguna cita/, "hacen falta LOS DOS factores");
});

test("un folio inexistente y un teléfono que no corresponde dan el MISMO mensaje", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId);

  const mensajes = [];
  for (const [f, t] of [["CIT-NO-EXISTE", TEL_ANA], [folio, "55 9999 9999"]]) {
    const { rows: [{ r }] } = await consultar(db, f, t, clinicaId);
    mensajes.push(r.error);
  }

  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0], mensajes[1],
    "si los mensajes difirieran, esto sería un oráculo para adivinar folios");
});

test("las citas de otra clínica no se alcanzan ni con folio y teléfono buenos", async () => {
  const { db, clinicaId } = await base();
  const { rows: [otra] } = await db.query(
    `insert into clinicas (nombre_clinica, ciudad) values ('Clínica Dos', 'GDL') returning id`
  );
  const { folio } = await conCita(db, otra.id, { nombre: "Ana", tel: TEL_ANA });

  await debeFallar(consultar(db, folio, TEL_ANA, clinicaId), /No encontramos ninguna cita/);
});

test("mis_citas no devuelve teléfono, correo ni notas", async () => {
  const { db, clinicaId } = await base();
  const { folio, citaId } = await conCita(db, clinicaId);
  await db.query("update citas set notas = 'NOTA INTERNA CONFIDENCIAL' where id = $1", [citaId]);

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));
  const texto = JSON.stringify(r);

  assert.ok(!texto.includes("NOTA INTERNA"), "las notas son de la clínica, no del paciente");
  assert.ok(!texto.includes("x@ejemplo.mx"));
  assert.ok(!texto.includes("1111"), "el teléfono ya lo sabe; devolverlo solo agranda la superficie");
});

/* ═══ Freno de abuso ════════════════════════════════════════════════════ */

test("diez fallos en una hora cortan el barrido de folios", async () => {
  const { db, clinicaId } = await base();
  await conCita(db, clinicaId);

  for (let i = 0; i < 10; i++) {
    await debeFallar(consultar(db, `CIT-FALSO-${i}`, TEL_ANA, clinicaId), /No encontramos/);
  }

  await debeFallar(consultar(db, "CIT-FALSO-11", TEL_ANA, clinicaId), /Demasiados intentos/);
});

test("los aciertos no gastan intentos", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId);

  for (let i = 0; i < 15; i++) await consultar(db, folio, TEL_ANA, clinicaId);

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));
  assert.equal(r.citas.length, 1, "consultar su propia cita quince veces no es abuso");
});

test("la bitácora de intentos no la lee nadie, ni el personal", async () => {
  const { db, clinicaId, usuarioId } = await base();
  await conCita(db, clinicaId);
  await debeFallar(consultar(db, "CIT-FALSO", TEL_ANA, clinicaId), /No encontramos/);

  for (const quien of [
    () => comoAnonimo(db, () => db.query("select * from intentos_mis_citas")),
    () => comoUsuario(db, usuarioId, () => db.query("select * from intentos_mis_citas")),
  ]) {
    const { rows } = await quien();
    assert.equal(rows.length, 0, "es una bitácora interna: sin políticas, RLS la tapa entera");
  }
});

/* ═══ Cancelar ══════════════════════════════════════════════════════════ */

test("cancelar libera el hueco, y queda registrado que fue el paciente", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5, hora: "10:00" });

  await debeLograr(cancelar(db, folio, TEL_ANA, clinicaId, "Me salió un viaje"));

  const { rows: [c] } = await db.query(
    "select estado, cancelada_por, motivo_cancelacion from citas where folio = $1", [folio]);
  assert.equal(c.estado, "cancelada");
  assert.equal(c.cancelada_por, "paciente",
    "que cancele el paciente no es lo mismo que que cancele recepción");
  assert.match(c.motivo_cancelacion, /viaje/);

  /* Lo que hace que cancelar valga la pena: el hueco vuelve a la agenda. */
  const { rows: [libre] } = await db.query(
    "select slot_ocupado($1, 'Dra. Laura García', current_date + 5, '10:00') as v", [clinicaId]);
  assert.equal(libre.v, false, "citas_slot_unico excluye cancelada, así que el hueco se libera");
});

test("no se puede cancelar la cita de otro", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { nombre: "Ana", tel: TEL_ANA });
  await conCita(db, clinicaId, { nombre: "Beto", tel: TEL_BETO, hora: "12:00" });

  await debeFallar(cancelar(db, folio, TEL_BETO, clinicaId), /No encontramos/);

  const { rows: [c] } = await db.query("select estado from citas where folio = $1", [folio]);
  assert.equal(c.estado, "pendiente", "sigue en pie");
});

test("la cita de HOY no se cancela desde aquí: hay que llamar", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 0 });

  await debeFallar(cancelar(db, folio, TEL_ANA, clinicaId), /Llámanos/,
    "a estas horas el consultorio ya organizó el día alrededor de ese hueco");
});

test("una cita ya pasada tampoco", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: -3 });
  await debeFallar(cancelar(db, folio, TEL_ANA, clinicaId), /Llámanos|ya pasó/);
});

test("una consulta ya atendida no se puede cancelar", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5, estado: "atendida" });

  await debeFallar(cancelar(db, folio, TEL_ANA, clinicaId), /ya se realizó/);
});

test("cancelar dos veces no es un error", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5 });

  await debeLograr(cancelar(db, folio, TEL_ANA, clinicaId));
  const r = await debeLograr(cancelar(db, folio, TEL_ANA, clinicaId));

  assert.equal(r.yaEstaba, true,
    "reventar dejaría al paciente creyendo que su cancelación no funcionó");
});

test("cancelar anula el recordatorio que ya estuviera encolado", async () => {
  const { db, clinicaId } = await base();
  const { folio, citaId, pacienteId } = await conCita(db, clinicaId, { dias: 5 });

  await db.query(
    `insert into avisos_pendientes (clinica_id, tipo, cita_id, paciente_id,
                                    destinatario, asunto, cuerpo)
     values ($1, 'recordatorio_cita', $2, $3, 'x@ejemplo.mx', 'Tu cita es mañana', 'y')`,
    [clinicaId, citaId, pacienteId]
  );

  await cancelar(db, folio, TEL_ANA, clinicaId);

  const { rows: [a] } = await db.query(
    "select estado, ultimo_error from avisos_pendientes where cita_id = $1", [citaId]);
  assert.equal(a.estado, "fallido");
  assert.match(a.ultimo_error, /cancelada por el paciente/,
    'recibir "tu cita es mañana" después de cancelarla es lo que hace que nadie crea en estos correos');
});

test("una cita cancelada por el paciente ya no cuenta como cancelable", async () => {
  const { db, clinicaId } = await base();
  const { folio } = await conCita(db, clinicaId, { dias: 5 });
  await cancelar(db, folio, TEL_ANA, clinicaId);

  const r = await debeLograr(consultar(db, folio, TEL_ANA, clinicaId));
  assert.equal(r.citas[0].estado, "cancelada");
  assert.equal(r.citas[0].cancelable, false, "la interfaz no debe ofrecer un botón que va a fallar");
});

/* ═══ El resolvedor interno no se ofrece ════════════════════════════════ */

test("paciente_de_folio no la alcanza nadie sin sesión", async () => {
  const { db, clinicaId } = await base();
  await conCita(db, clinicaId);

  /* Ofrecerla sería ofrecer un comprobador de parejas folio+teléfono SIN el
     freno de abuso que sí tienen mis_citas y cancelar_mi_cita. */
  await assert.rejects(
    () => comoAnonimo(db, () =>
      db.query("select paciente_de_folio('x', $1, $2)", [TEL_ANA, clinicaId])),
    /permission denied|does not exist|no existe/i
  );
});
