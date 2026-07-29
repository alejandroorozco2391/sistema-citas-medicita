/* ═══════════════════════════════════════════════════════════════════════
   Escalación a humano — 0010_escalaciones.sql

   La promesa de esta función es una sola: que nada se traspapele. Un
   paciente pidió un humano, y o alguien lo atiende o el sistema sigue
   gritando. Las dos cosas que hay que demostrar son opuestas y ninguna se
   ve leyendo el SQL:

     · que la escalera SUBA sola cuando nadie acusa recibo
     · que se DETENGA en seco cuando alguien la toma

   Y una tercera que es la que sostiene todo: que `vencida` no se cierre
   jamás por su cuenta. Si un día alguien le agrega un "limpiar viejas",
   la función entera deja de significar algo y la prueba tiene que caerse.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase, comoUsuario, comoAnonimo } from "./db-harness.mjs";

/* ─── Escenario ───────────────────────────────────────────────────────── */

/**
 * Clínica con los tres roles y horario de lunes a viernes, 9–14 y 16–19.
 * El horario importa: el ruteo lo consulta, y sin él todo caería siempre
 * en la rama de "cerrado".
 */
async function clinicaConEquipo(db, { nombre = "Clínica Central", sufijo = "1", conHorario = true } = {}) {
  const { rows: [c] } = await db.query(
    "insert into clinicas (nombre_clinica, zona_horaria, email) values ($1, 'America/Mexico_City', $2) returning id",
    [nombre, `contacto${sufijo}@ejemplo.mx`]
  );

  const staff = {};
  for (const rol of ["doctor", "recepcionista", "admin"]) {
    const { rows: [u] } = await db.query(
      "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
      [`${rol}${sufijo}@ejemplo.mx`]
    );
    const { rows: [p] } = await db.query(
      `insert into perfiles_staff (usuario_id, clinica_id, nombre, rol)
       values ($1, $2, $3, $4) returning id`,
      [u.id, c.id, `${rol} ${sufijo}`, rol]
    );
    staff[rol] = { usuarioId: u.id, perfilId: p.id };
  }

  if (conHorario) {
    for (const dia of [1, 2, 3, 4, 5]) {
      await db.query(
        `insert into horarios_base (clinica_id, dia_semana, hora_inicio, hora_fin)
         values ($1, $2, '09:00', '14:00'), ($1, $2, '16:00', '19:00')`,
        [c.id, dia]
      );
    }
  }

  return { clinicaId: c.id, staff };
}

/* Momentos fijos, para que las pruebas no dependan del día en que corran. */
const LUNES_10AM = "2026-08-03T16:00:00Z";   // 10:00 CDMX — abierto
const DOMINGO_11PM = "2026-08-10T05:00:00Z"; // domingo 23:00 CDMX — cerrado

const rutear = async (db, clinicaId, motivo, urgencia, momento) =>
  (await db.query(
    "select * from rutear_escalacion($1, $2, $3, $4::timestamptz)",
    [clinicaId, motivo, urgencia, momento]
  )).rows[0];

async function escalar(db, extra = {}) {
  return comoAnonimo(db, async () => {
    const { rows } = await db.query(
      `select escalar_a_humano(
         p_motivo => $1, p_resumen => $2, p_urgencia => $3,
         p_nombre => $4, p_telefono => $5, p_conversacion_id => $6
       ) as r`,
      [
        extra.motivo ?? "peticion_explicita",
        extra.resumen ?? "Quiere hablar con alguien",
        extra.urgencia ?? "normal",
        extra.nombre ?? "Ana López",
        extra.telefono ?? "55 1111 2222",
        extra.conversacionId ?? null,
      ]
    );
    return rows[0].r;
  });
}

/** Empuja el reloj: deja la escalación vencida sin esperar de verdad. */
const vencerYa = (db, id) =>
  db.query("update escalaciones set vence_en = now() - interval '1 minute' where id = $1", [id]);

const leer = async (db, id) =>
  (await db.query("select * from escalaciones where id = $1", [id])).rows[0];

const promover = async (db) =>
  (await db.query("select promover_escalaciones() as n")).rows[0].n;

/* ═══ Ruteo ════════════════════════════════════════════════════════════ */

test("los motivos clínicos van al doctor y los logísticos a recepción", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const destino = async (motivo) =>
    (await rutear(db, clinicaId, motivo, "normal", LUNES_10AM)).destino_rol;

  assert.equal(await destino("urgencia_medica"), "doctor");
  assert.equal(await destino("duda_clinica"), "doctor");
  assert.equal(await destino("queja"), "admin");
  assert.equal(await destino("agenda"), "recepcionista");
  assert.equal(await destino("administrativo"), "recepcionista");
  assert.equal(await destino("peticion_explicita"), "recepcionista");
  assert.equal(await destino("bot_no_pudo"), "recepcionista");

  await db.close();
});

test("si no hay nadie con el rol destino, no se enruta al vacío", async () => {
  /* Enrutar a un rol que no existe es enrutar a nadie: el hoyo negro
     otra vez, pero disfrazado de escalación bien formada. */
  const db = await crearBase();
  const { rows: [c] } = await db.query(
    "insert into clinicas (nombre_clinica, zona_horaria) values ('Solo Recepción', 'America/Mexico_City') returning id"
  );
  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'recep@ejemplo.mx') returning id"
  );
  await db.query(
    "insert into perfiles_staff (usuario_id, clinica_id, nombre, rol) values ($1, $2, 'Recepción', 'recepcionista')",
    [u.id, c.id]
  );

  /* No hay doctor ni admin: una duda clínica tiene que caer en alguien. */
  assert.equal((await rutear(db, c.id, "duda_clinica", "normal", LUNES_10AM)).destino_rol, "recepcionista");
  await db.close();
});

test("dentro de horario el plazo depende de la urgencia", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const minutos = async (urgencia) => {
    const r = await rutear(db, clinicaId, "agenda", urgencia, LUNES_10AM);
    return Math.round((new Date(r.vence_en) - new Date(LUNES_10AM)) / 60000);
  };

  assert.equal(await minutos("alta"), 5);
  assert.equal(await minutos("normal"), 15);
  assert.equal(await minutos("baja"), 60);
  await db.close();
});

test("fuera de horario el reloj empieza cuando abren, no a las 3 de la mañana", async () => {
  /* Vencer una escalación de madrugada solo produce alertas que nadie
     puede atender, y enseña al personal a ignorarlas. */
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const r = await rutear(db, clinicaId, "agenda", "normal", DOMINGO_11PM);
  const vence = new Date(r.vence_en);

  /* El domingo 9 a las 23:00 CDMX, la siguiente apertura es el lunes 10 a
     las 09:00 CDMX = 15:00Z. Más los 15 minutos de urgencia normal. */
  assert.equal(vence.toISOString(), "2026-08-10T15:15:00.000Z");
  await db.close();
});

test("una posible urgencia médica NO espera a que abran", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const r = await rutear(db, clinicaId, "urgencia_medica", "normal", DOMINGO_11PM);
  const minutos = Math.round((new Date(r.vence_en) - new Date(DOMINGO_11PM)) / 60000);

  assert.equal(r.destino_rol, "doctor");
  assert.equal(minutos, 15, "una urgencia no puede quedarse en cola hasta el lunes");
  await db.close();
});

/* ═══ Pedir un humano sin cuenta ═══════════════════════════════════════ */

test("un paciente sin sesión puede pedir un humano y queda registrado", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const r = await escalar(db, { resumen: "Lleva tres días con fiebre" });

  assert.ok(r.id);
  assert.equal(r.destino, "recepcionista");
  assert.equal(r.esEmergencia, false);

  const fila = await leer(db, r.id);
  assert.equal(fila.estado, "pendiente");
  assert.equal(fila.nivel, 0);
  assert.equal(fila.clinica_id, clinicaId);
  assert.equal(fila.resumen, "Lleva tres días con fiebre");
  await db.close();
});

test("ante una urgencia médica la instrucción manda al 911 antes que nada", async () => {
  /* Un agente de IA no retiene una posible emergencia en una cola. Esta
     aserción es sobre seguridad del paciente, no sobre redacción. */
  const db = await crearBase();
  await clinicaConEquipo(db);

  const r = await escalar(db, { motivo: "urgencia_medica", resumen: "Dolor en el pecho" });

  assert.equal(r.esEmergencia, true);
  assert.match(r.instruccion, /911/);
  assert.match(r.instruccion, /ANTES QUE NADA/);
  await db.close();
});

test("cerrado y sin horario cargado, la instrucción prohíbe prometer una hora", async () => {
  const db = await crearBase();
  await clinicaConEquipo(db, { conHorario: false });

  const r = await escalar(db);

  assert.equal(r.abiertoAhora, false);
  assert.equal(r.atencionEn, null);
  assert.match(r.instruccion, /NO prometas una hora/);
  await db.close();
});

test("el teléfono vincula la escalación con el expediente que ya existía", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const { rows: [pac] } = await db.query(
    `insert into pacientes (clinica_id, codigo, nombre, apellidos, telefono)
     values ($1, 'PAC-X', 'Ana', 'López', '5511112222') returning id`,
    [clinicaId]
  );

  /* Escrito con espacios, como lo teclea una persona. */
  const r = await escalar(db, { telefono: "55 1111 2222" });
  assert.equal((await leer(db, r.id)).paciente_id, pac.id);
  await db.close();
});

test("el freno de abuso corta a la cuarta desde el mismo teléfono", async () => {
  /* Cada escalación le suena el teléfono a una persona de verdad, por eso
     el tope es más bajo que el de las citas. */
  const db = await crearBase();
  await clinicaConEquipo(db);

  for (let i = 0; i < 3; i++) await escalar(db);

  await assert.rejects(() => escalar(db), /varias solicitudes/);

  /* Y desde otro número sigue funcionando. */
  const otro = await escalar(db, { telefono: "55 9999 8888" });
  assert.ok(otro.id);
  await db.close();
});

test("quien pide un humano no puede leer las escalaciones ni los expedientes", async () => {
  const db = await crearBase();
  await clinicaConEquipo(db);
  await escalar(db);

  await comoAnonimo(db, async () => {
    for (const tabla of ["escalaciones", "avisos_pendientes", "pacientes", "citas"]) {
      const { rows } = await db.query(`select * from ${tabla}`);
      assert.equal(rows.length, 0, `${tabla} quedó legible para el rol anónimo`);
    }
  });
  await db.close();
});

/* ═══ La escalera ══════════════════════════════════════════════════════ */

test("sin acuse, la escalación sube de nivel sola", async () => {
  const db = await crearBase();
  await clinicaConEquipo(db);
  const r = await escalar(db);

  assert.equal((await leer(db, r.id)).nivel, 0);

  await vencerYa(db, r.id);
  assert.equal(await promover(db), 1);
  assert.equal((await leer(db, r.id)).nivel, 1, "no pasó de ser del rol destino a ser de todos");

  await vencerYa(db, r.id);
  await promover(db);
  assert.equal((await leer(db, r.id)).nivel, 2);

  await db.close();
});

test("en el nivel 2 se encola el aviso por correo al personal", async () => {
  const db = await crearBase();
  await clinicaConEquipo(db);
  const r = await escalar(db);

  for (let i = 0; i < 2; i++) { await vencerYa(db, r.id); await promover(db); }

  const { rows } = await db.query(
    "select * from avisos_pendientes where escalacion_id = $1", [r.id]
  );
  assert.ok(rows.length > 0, "nadie se iba a enterar fuera del panel");
  assert.ok(rows.every(a => a.estado === "pendiente"));

  /* Va a quien decide, y el cuerpo trae con quién hay que hablar. */
  const destinatarios = rows.map(a => a.destinatario).sort();
  assert.deepEqual(destinatarios, ["admin1@ejemplo.mx", "doctor1@ejemplo.mx"]);
  assert.match(rows[0].cuerpo, /Ana López/);
  assert.match(rows[0].cuerpo, /55 1111 2222/);

  await db.close();
});

test("al final de la escalera queda VENCIDA y marca su conversación", async () => {
  const db = await crearBase();
  const { clinicaId } = await clinicaConEquipo(db);

  const { rows: [conv] } = await db.query(
    `insert into conversaciones (clinica_id, canal, telefono, nombre_contacto)
     values ($1, 'whatsapp', '5511112222', 'Ana') returning id`,
    [clinicaId]
  );

  const r = await escalar(db, { conversacionId: conv.id });

  for (let i = 0; i < 3; i++) { await vencerYa(db, r.id); await promover(db); }

  const fila = await leer(db, r.id);
  assert.equal(fila.estado, "vencida");
  assert.equal(fila.nivel, 3);

  const { rows: [c] } = await db.query("select estado from conversaciones where id = $1", [conv.id]);
  assert.equal(c.estado, "requiere_atencion_humana");

  await db.close();
});

test("una escalación VENCIDA no se cierra sola por más que pase el tiempo", async () => {
  /* Es la garantía entera de la función. Si alguien agrega un barrido de
     "limpiar viejas", esta prueba tiene que caerse. */
  const db = await crearBase();
  await clinicaConEquipo(db);
  const r = await escalar(db);

  for (let i = 0; i < 3; i++) { await vencerYa(db, r.id); await promover(db); }
  assert.equal((await leer(db, r.id)).estado, "vencida");

  /* Diez vueltas más del reloj. */
  for (let i = 0; i < 10; i++) await promover(db);

  const fila = await leer(db, r.id);
  assert.equal(fila.estado, "vencida", "se cerró sola: el paciente quedó sin atender y sin rastro");
  assert.equal(fila.nivel, 3, "no hay nivel 4");
  await db.close();
});

test("promover no toca las que todavía están en plazo", async () => {
  const db = await crearBase();
  await clinicaConEquipo(db);
  const r = await escalar(db, { urgencia: "baja" });   // 60 minutos

  assert.equal(await promover(db), 0);
  assert.equal((await leer(db, r.id)).nivel, 0);
  await db.close();
});

/* ═══ Acuse ════════════════════════════════════════════════════════════ */

test('"La tomo" detiene la escalera en seco', async () => {
  const db = await crearBase();
  const { staff } = await clinicaConEquipo(db);
  const r = await escalar(db);

  await comoUsuario(db, staff.recepcionista.usuarioId, () =>
    db.query("select escalacion_reconocer($1)", [r.id]));

  const fila = await leer(db, r.id);
  assert.equal(fila.estado, "reconocida");
  assert.equal(fila.reconocida_por, staff.recepcionista.perfilId);
  assert.ok(fila.reconocida_en);

  /* Y ya no sube por más vueltas que dé el reloj. */
  await vencerYa(db, r.id);
  for (let i = 0; i < 5; i++) await promover(db);

  const despues = await leer(db, r.id);
  assert.equal(despues.estado, "reconocida");
  assert.equal(despues.nivel, 0, "siguió escalando pese a que alguien se hizo responsable");

  const { rows: avisos } = await db.query(
    "select * from avisos_pendientes where escalacion_id = $1", [r.id]);
  assert.equal(avisos.length, 0, "se mandaron correos de una escalación ya tomada");

  await db.close();
});

test("una vencida se puede rescatar: tomarla la reactiva", async () => {
  const db = await crearBase();
  const { staff } = await clinicaConEquipo(db);
  const r = await escalar(db);

  for (let i = 0; i < 3; i++) { await vencerYa(db, r.id); await promover(db); }
  assert.equal((await leer(db, r.id)).estado, "vencida");

  await comoUsuario(db, staff.doctor.usuarioId, () =>
    db.query("select escalacion_reconocer($1)", [r.id]));

  assert.equal((await leer(db, r.id)).estado, "reconocida");
  await db.close();
});

test("cerrar exige decir qué se hizo", async () => {
  /* Un cierre sin nota es indistinguible de alguien limpiando la lista
     para que deje de parpadear. */
  const db = await crearBase();
  const { staff } = await clinicaConEquipo(db);
  const r = await escalar(db);

  await assert.rejects(
    () => comoUsuario(db, staff.doctor.usuarioId, () =>
      db.query("select escalacion_resolver($1, $2)", [r.id, "   "])),
    /qué se hizo/
  );
  assert.equal((await leer(db, r.id)).estado, "pendiente");

  await comoUsuario(db, staff.doctor.usuarioId, () =>
    db.query("select escalacion_resolver($1, $2)", [r.id, "Le llamé, ya quedó agendada"]));

  const fila = await leer(db, r.id);
  assert.equal(fila.estado, "resuelta");
  assert.equal(fila.nota_cierre, "Le llamé, ya quedó agendada");
  assert.equal(fila.resuelta_por, staff.doctor.perfilId);
  /* Resolver sin haberla tomado deja igual el acuse: alguien se hizo cargo. */
  assert.ok(fila.reconocida_en);
  await db.close();
});

test("no se puede cerrar dos veces", async () => {
  const db = await crearBase();
  const { staff } = await clinicaConEquipo(db);
  const r = await escalar(db);

  await comoUsuario(db, staff.admin.usuarioId, () =>
    db.query("select escalacion_resolver($1, 'Atendida')", [r.id]));

  await assert.rejects(
    () => comoUsuario(db, staff.admin.usuarioId, () =>
      db.query("select escalacion_resolver($1, 'Otra vez')", [r.id])),
    /ya estaba cerrada/
  );
  await db.close();
});

/* ═══ Aislamiento ══════════════════════════════════════════════════════ */

test("una clínica no ve ni toca las escalaciones de otra", async () => {
  const db = await crearBase();
  const norte = await clinicaConEquipo(db, { nombre: "Norte", sufijo: "1" });
  const sur   = await clinicaConEquipo(db, { nombre: "Sur",   sufijo: "2" });

  /* Con dos clínicas activas, clinica_unica() ya no resuelve sola: hay que
     decir cuál, que es justo lo que hace el parámetro. */
  const { rows: [e] } = await db.query(
    `select escalar_a_humano(
       p_motivo => 'queja', p_resumen => 'Secreto de Sur',
       p_telefono => '55 3333 4444', p_clinica_id => $1) as r`,
    [sur.clinicaId]
  );
  const idSur = e.r.id;

  await comoUsuario(db, norte.staff.admin.usuarioId, async () => {
    const { rows } = await db.query("select * from escalaciones");
    assert.equal(rows.length, 0, "Norte alcanzó las escalaciones de Sur");

    await assert.rejects(
      () => db.query("select escalacion_reconocer($1)", [idSur]),
      /ya no está abierta/,
      "Norte pudo acusar recibo de una escalación de Sur"
    );
  });

  /* Y Sur sí la ve. */
  await comoUsuario(db, sur.staff.admin.usuarioId, async () => {
    const { rows } = await db.query("select resumen from escalaciones");
    assert.deepEqual(rows.map(r => r.resumen), ["Secreto de Sur"]);
  });

  await db.close();
});

test("el personal no puede escribir en la bandeja de salida", async () => {
  /* La escribe la escalera y la vacía la función de Vercel. Si el panel
     pudiera insertar ahí, cualquiera con sesión podría mandar correos
     desde la clínica. */
  const db = await crearBase();
  const { clinicaId, staff } = await clinicaConEquipo(db);
  const r = await escalar(db);

  await comoUsuario(db, staff.admin.usuarioId, async () => {
    await assert.rejects(
      () => db.query(
        `insert into avisos_pendientes (clinica_id, escalacion_id, destinatario, asunto)
         values ($1, $2, 'quien@sea.mx', 'Hola')`,
        [clinicaId, r.id]
      ),
      /row-level security|violates/i
    );
  });
  await db.close();
});
