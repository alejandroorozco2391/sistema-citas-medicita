/* ═══════════════════════════════════════════════════════════════════════
   MediHorario — 0009_horarios.sql

   Lo que se prueba aquí no es "guarda y lee". Es la aritmética de la que
   van a colgar dos cosas que el usuario ve: qué días ofrece la landing, y
   la hora que el agente le promete a un paciente que pidió un humano.

   Si proxima_apertura() se equivoca un día, el bot promete un lunes que
   no existe. Nadie lo notaría revisando el código.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoUsuario, comoAnonimo } from "./db-harness.mjs";

/* ─── Utilidades ──────────────────────────────────────────────────────── */

const LUN = 1, MAR = 2, JUE = 4, VIE = 5, SAB = 6;

async function baseConClinica({ zona = "America/Mexico_City" } = {}) {
  const db = await crearBase();

  const { rows: [c] } = await db.query(
    "insert into clinicas (nombre_clinica, ciudad, zona_horaria) values ($1, $2, $3) returning id",
    ["Clínica de Prueba", "CDMX", zona]
  );

  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    ["admin@ejemplo.mx"]
  );
  await db.query(
    "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Admin', 'admin')",
    [u.id, c.id]
  );

  return { db, clinicaId: c.id, usuarioId: u.id };
}

/** Semana normal: lunes a viernes, 9–14 y 16–19. */
async function semanaNormal(db, clinicaId) {
  for (const dia of [LUN, MAR, 3, JUE, VIE]) {
    await db.query(
      `insert into horarios_base (clinica_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, '09:00', '14:00'), ($1, $2, '16:00', '19:00')`,
      [clinicaId, dia]
    );
  }
}

/** Un lunes concreto, para que las pruebas no dependan de qué día se corran. */
const LUNES = "2026-08-03";      // lunes
const MARTES = "2026-08-04";
const SABADO = "2026-08-08";
const DOMINGO = "2026-08-09";

const bloques = async (db, clinicaId, fecha) =>
  (await db.query("select * from horario_del_dia($1, $2)", [clinicaId, fecha])).rows;

/* ═══ La semana normal ═════════════════════════════════════════════════ */

test("un día laboral devuelve sus dos bloques en orden", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const r = await bloques(db, clinicaId, LUNES);
  assert.equal(r.length, 2);
  assert.equal(r[0].hora_inicio, "09:00:00");
  assert.equal(r[1].hora_inicio, "16:00:00");
  await db.close();
});

test("un día sin horario cargado no devuelve nada", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  assert.equal((await bloques(db, clinicaId, DOMINGO)).length, 0);
  await db.close();
});

/* ═══ Las excepciones pisan a la base ══════════════════════════════════ */

test("una excepción con horas reemplaza al día completo, no se suma", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, hora_inicio, hora_fin, motivo)
     values ($1, $2, false, '10:00', '12:00', 'Sale temprano')`,
    [clinicaId, MARTES]
  );

  const r = await bloques(db, clinicaId, MARTES);
  assert.equal(r.length, 1, "los bloques de la semana normal siguieron apareciendo");
  assert.equal(r[0].hora_inicio, "10:00:00");
  assert.equal(r[0].hora_fin, "12:00:00");

  /* Y no contaminó al resto de la semana. */
  assert.equal((await bloques(db, clinicaId, LUNES)).length, 2);
  await db.close();
});

test("un cierre deja el día sin un solo bloque", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, motivo)
     values ($1, $2, true, 'Congreso')`,
    [clinicaId, MARTES]
  );

  assert.equal((await bloques(db, clinicaId, MARTES)).length, 0);
  await db.close();
});

test("un cierre gana aunque haya además bloques alternativos ese día", async () => {
  /* Puede pasar por dos clics seguidos en la interfaz. Ante la duda, la
     respuesta segura es "cerrado": ofrecer una cita que nadie va a
     atender es peor que no ofrecer ninguna. */
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, hora_inicio, hora_fin)
     values ($1, $2, false, '10:00', '12:00')`,
    [clinicaId, MARTES]
  );
  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado) values ($1, $2, true)`,
    [clinicaId, MARTES]
  );

  assert.equal((await bloques(db, clinicaId, MARTES)).length, 0);
  await db.close();
});

test("no se puede registrar un cierre con horas: no significa nada", async () => {
  const { db, clinicaId } = await baseConClinica();

  await assert.rejects(
    () => db.query(
      `insert into horarios_excepciones (clinica_id, fecha, cerrado, hora_inicio, hora_fin)
       values ($1, $2, true, '09:00', '14:00')`,
      [clinicaId, MARTES]
    ),
    /horarios_excepciones_coherente/
  );
  await db.close();
});

test("el mismo día no se puede cerrar dos veces", async () => {
  const { db, clinicaId } = await baseConClinica();

  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado) values ($1, $2, true)`,
    [clinicaId, MARTES]
  );
  await assert.rejects(
    () => db.query(
      `insert into horarios_excepciones (clinica_id, fecha, cerrado) values ($1, $2, true)`,
      [clinicaId, MARTES]
    ),
    /horarios_excepciones_cierre_unico/
  );
  await db.close();
});

/* ═══ Zona horaria ═════════════════════════════════════════════════════ */

test("el mismo instante está abierto en CDMX y cerrado en Tijuana", async () => {
  /* Es EL error latente que este módulo viene a arreglar: el servidor
     corre en UTC y sin conversión explícita todo se evalúa seis horas
     corrido. Dos clínicas idénticas salvo la zona lo demuestran. */
  const a = await baseConClinica({ zona: "America/Mexico_City" });
  await semanaNormal(a.db, a.clinicaId);

  const b = await baseConClinica({ zona: "America/Tijuana" });
  await semanaNormal(b.db, b.clinicaId);

  /* 2026-08-03 16:00Z = 10:00 en CDMX (abierto) y 09:00 en Tijuana...
     ambas abiertas. Se toma un instante que separe: 15:00Z = 09:00 CDMX
     (abierto) y 08:00 Tijuana (todavía cerrado). */
  const momento = "2026-08-03T15:00:00Z";

  const abiertoCdmx = (await a.db.query("select en_horario($1, $2::timestamptz) as v", [a.clinicaId, momento])).rows[0].v;
  const abiertoTij  = (await b.db.query("select en_horario($1, $2::timestamptz) as v", [b.clinicaId, momento])).rows[0].v;

  assert.equal(abiertoCdmx, true,  "CDMX debería estar abierto a las 09:00 local");
  assert.equal(abiertoTij,  false, "Tijuana no abre hasta las 09:00 local, y ahí son las 08:00");

  await a.db.close();
  await b.db.close();
});

test("en_horario respeta el borde: abierto a la hora de apertura, cerrado a la de cierre", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const enHorario = async iso =>
    (await db.query("select en_horario($1, $2::timestamptz) as v", [clinicaId, iso])).rows[0].v;

  assert.equal(await enHorario("2026-08-03T15:00:00Z"), true,  "09:00 local: acaba de abrir");
  assert.equal(await enHorario("2026-08-03T19:59:00Z"), true,  "13:59 local: sigue abierto");
  assert.equal(await enHorario("2026-08-03T20:00:00Z"), false, "14:00 local: ya cerró");
  assert.equal(await enHorario("2026-08-03T21:00:00Z"), false, "15:00 local: hueco de comida");
  assert.equal(await enHorario("2026-08-03T22:00:00Z"), true,  "16:00 local: abrió la tarde");
  await db.close();
});

test("una clínica sin horario cargado nunca está abierta", async () => {
  const { db, clinicaId } = await baseConClinica();
  const { rows } = await db.query("select en_horario($1, now()) as v", [clinicaId]);
  assert.equal(rows[0].v, false);
  await db.close();
});

/* ═══ Próxima apertura — de aquí sale la promesa al paciente ═══════════ */

const proxima = async (db, clinicaId, iso) =>
  (await db.query("select proxima_apertura($1, $2::timestamptz) as v", [clinicaId, iso])).rows[0].v;

test("si ya está abierto, la próxima apertura es ahora mismo", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const ahora = "2026-08-03T16:00:00Z";          // 10:00 CDMX, abierto
  const v = await proxima(db, clinicaId, ahora);
  assert.equal(new Date(v).toISOString(), new Date(ahora).toISOString());
  await db.close();
});

test("en el hueco de la comida devuelve la apertura de la tarde, no la de mañana", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const v = await proxima(db, clinicaId, "2026-08-03T21:00:00Z");   // 15:00 CDMX
  /* 16:00 CDMX = 22:00Z */
  assert.equal(new Date(v).toISOString(), "2026-08-03T22:00:00.000Z");
  await db.close();
});

test("un sábado por la noche la próxima apertura salta al lunes", async () => {
  /* Es la promesa que el bot le hace al paciente. Si esto se equivoca,
     le dice "mañana a las 9" un sábado y el domingo no hay nadie. */
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const v = await proxima(db, clinicaId, `${SABADO}T23:00:00Z`);     // sábado 17:00 CDMX
  /* Lunes 10 de agosto, 09:00 CDMX = 15:00Z */
  assert.equal(new Date(v).toISOString(), "2026-08-10T15:00:00.000Z");
  await db.close();
});

test("la próxima apertura salta un día cerrado por excepción", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);
  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, motivo)
     values ($1, $2, true, 'Puente')`,
    [clinicaId, MARTES]
  );

  /* Lunes ya cerrado (21:00 CDMX): lo siguiente sería el martes, pero
     está cerrado, así que toca miércoles. */
  const v = await proxima(db, clinicaId, "2026-08-04T03:00:00Z");    // lunes 21:00 CDMX
  assert.equal(new Date(v).toISOString(), "2026-08-05T15:00:00.000Z");
  await db.close();
});

test("sin horario en 14 días devuelve NULL en vez de inventar una fecha", async () => {
  const { db, clinicaId } = await baseConClinica();
  const v = await proxima(db, clinicaId, `${LUNES}T15:00:00Z`);
  assert.equal(v, null, "devolver una fecha cualquiera haría que el bot prometiera algo falso");
  await db.close();
});

/* ═══ Guardar la semana ════════════════════════════════════════════════ */

test("guardar_horario_base reemplaza la semana y regenera el texto del membrete", async () => {
  const { db, clinicaId, usuarioId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  const texto = await comoUsuario(db, usuarioId, async () => {
    const { rows } = await db.query("select guardar_horario_base($1::jsonb) as t", [
      JSON.stringify([
        { diaSemana: LUN, horaInicio: "08:00", horaFin: "13:00" },
        { diaSemana: MAR, horaInicio: "08:00", horaFin: "13:00" },
        { diaSemana: SAB, horaInicio: "09:00", horaFin: "12:00" },
      ]),
    ]);
    return rows[0].t;
  });

  /* Los bloques viejos se fueron completos. */
  assert.equal((await bloques(db, clinicaId, LUNES)).length, 1);
  assert.equal((await bloques(db, clinicaId, "2026-08-06")).length, 0, "el jueves debió quedar vacío");

  /* Y agrupa días consecutivos iguales. */
  assert.match(texto, /Lun–Mar 08:00–13:00/);
  assert.match(texto, /Sáb 09:00–12:00/);

  const { rows } = await db.query("select horario_atencion from clinicas where id = $1", [clinicaId]);
  assert.equal(rows[0].horario_atencion, texto, "el membrete quedó desincronizado del horario real");
  await db.close();
});

test("guardar_horario_base rechaza bloques encimados y no deja nada a medias", async () => {
  const { db, clinicaId, usuarioId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  await assert.rejects(
    () => comoUsuario(db, usuarioId, () =>
      db.query("select guardar_horario_base($1::jsonb)", [
        JSON.stringify([
          { diaSemana: LUN, horaInicio: "09:00", horaFin: "14:00" },
          { diaSemana: LUN, horaInicio: "13:00", horaFin: "18:00" },
        ]),
      ])),
    /se enciman/
  );

  /* La transacción se deshizo: la semana anterior sigue intacta. */
  assert.equal((await bloques(db, clinicaId, LUNES)).length, 2);
  await db.close();
});

/* ═══ Citas que quedan fuera ═══════════════════════════════════════════ */

test("cerrar un día reporta las citas vivas que deja plantadas", async () => {
  const { db, clinicaId, usuarioId } = await baseConClinica();

  for (const [folio, hora, estado] of [
    ["CIT-A", "09:00", "confirmada"],
    ["CIT-B", "17:00", "pendiente"],
    ["CIT-C", "11:00", "cancelada"],
  ]) {
    await db.query(
      `insert into citas (clinica_id, folio, nombre, telefono, fecha, hora, especialidad, estado)
       values ($1, $2, 'Paciente', '5511112222', $3, $4, 'Medicina General', $5)`,
      [clinicaId, folio, MARTES, hora, estado]
    );
  }

  const filas = await comoUsuario(db, usuarioId, async () =>
    (await db.query("select * from citas_afectadas_por_cierre($1)", [MARTES])).rows);

  assert.deepEqual(filas.map(f => f.folio), ["CIT-A", "CIT-B"], "una cita cancelada no deja a nadie plantado");
  await db.close();
});

test("recortar el horario solo reporta las citas que quedan fuera del nuevo rango", async () => {
  const { db, clinicaId, usuarioId } = await baseConClinica();

  for (const [folio, hora] of [["CIT-A", "09:30"], ["CIT-B", "17:00"]]) {
    await db.query(
      `insert into citas (clinica_id, folio, nombre, telefono, fecha, hora, especialidad, estado)
       values ($1, $2, 'Paciente', '5511112222', $3, $4, 'Medicina General', 'confirmada')`,
      [clinicaId, folio, MARTES, hora]
    );
  }

  const filas = await comoUsuario(db, usuarioId, async () =>
    (await db.query("select * from citas_afectadas_por_cierre($1, '09:00', '14:00')", [MARTES])).rows);

  assert.deepEqual(filas.map(f => f.folio), ["CIT-B"]);
  await db.close();
});

/* ═══ La superficie pública ════════════════════════════════════════════ */

test("la landing lee el horario sin sesión, ya resuelto por fecha", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);
  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, motivo)
     values ($1, $2, true, 'Cirugía de la Dra. Ruiz')`,
    [clinicaId, MARTES]
  );

  const filas = await comoAnonimo(db, async () =>
    (await db.query("select * from horario_disponible($1, $2)", [LUNES, MARTES])).rows);

  assert.equal(filas.length, 2, "el martes cerrado no debe ofrecer horas");

  /* pglite devuelve `date` como objeto Date, así que se normaliza antes
     de comparar en vez de confiar en cómo lo serialice. */
  const soloFecha = d => new Date(d).toISOString().slice(0, 10);
  assert.deepEqual([...new Set(filas.map(f => soloFecha(f.fecha)))], [LUNES]);
  await db.close();
});

test("el motivo de un cierre NO sale por la superficie pública", async () => {
  /* Que el consultorio esté cerrado es público. Que sea por la cirugía
     de alguien, no. */
  const { db, clinicaId } = await baseConClinica();
  await db.query(
    `insert into horarios_excepciones (clinica_id, fecha, cerrado, motivo)
     values ($1, $2, true, 'Cirugía de la Dra. Ruiz')`,
    [clinicaId, MARTES]
  );

  const filas = await comoAnonimo(db, async () =>
    (await db.query("select * from horario_disponible($1, $2)", [LUNES, MARTES])).rows);

  assert.ok(!JSON.stringify(filas).includes("Cirugía"), "se filtró el motivo del cierre");
  assert.ok(!JSON.stringify(filas).includes("Ruiz"));
  await db.close();
});

test("un anónimo no puede leer las tablas de horario directamente", async () => {
  const { db, clinicaId } = await baseConClinica();
  await semanaNormal(db, clinicaId);

  await comoAnonimo(db, async () => {
    for (const tabla of ["horarios_base", "horarios_excepciones"]) {
      const { rows } = await db.query(`select * from ${tabla}`);
      assert.equal(rows.length, 0, `${tabla} quedó legible para el rol anónimo`);
    }
  });
  await db.close();
});

test("la superficie pública frena un rango absurdo", async () => {
  const { db } = await baseConClinica();
  await assert.rejects(
    () => comoAnonimo(db, () =>
      db.query("select * from horario_disponible($1, $2)", ["2026-01-01", "2036-01-01"])),
    /90 días/
  );
  await db.close();
});

/* ═══ Aislamiento entre clínicas ═══════════════════════════════════════ */

test("una clínica no ve ni escribe el horario de otra", async () => {
  const db = await crearBase();

  const ids = [];
  for (const nombre of ["Norte", "Sur"]) {
    const { rows: [c] } = await db.query(
      "insert into clinicas (nombre_clinica, zona_horaria) values ($1, 'America/Mexico_City') returning id",
      [nombre]
    );
    const { rows: [u] } = await db.query(
      "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
      [`admin-${nombre}@ejemplo.mx`]
    );
    await db.query(
      "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, $3, 'admin')",
      [u.id, c.id, nombre]
    );
    await db.query(
      `insert into horarios_base (clinica_id, dia_semana, hora_inicio, hora_fin)
       values ($1, 1, '09:00', '14:00')`,
      [c.id]
    );
    ids.push({ clinicaId: c.id, usuarioId: u.id });
  }

  const [norte, sur] = ids;

  await comoUsuario(db, norte.usuarioId, async () => {
    const { rows } = await db.query("select clinica_id from horarios_base");
    assert.equal(rows.length, 1, "Norte alcanzó el horario de Sur");
    assert.equal(rows[0].clinica_id, norte.clinicaId);

    await assert.rejects(
      () => db.query(
        `insert into horarios_excepciones (clinica_id, fecha, cerrado) values ($1, $2, true)`,
        [sur.clinicaId, MARTES]
      ),
      /row-level security|violates/i,
      "Norte pudo cerrarle el consultorio a Sur"
    );
  });

  await db.close();
});
