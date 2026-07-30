/* ═══════════════════════════════════════════════════════════════════════
   Aritmética de la agenda — js/agenda-rejilla.js

   Todo lo que se prueba aquí es cuenta de fechas y de horas, que es donde
   este proyecto ya se equivocó dos veces y ninguna de las dos se veía
   leyendo el código:

     · `new Date("2026-08-04")` se parsea como UTC y en México cae el día 3
     · evaluar una hora sin convertir la zona mandó los correos 6 h antes

   La agenda se apoya en esto para decidir qué huecos hay libres. Si la
   cuenta se corre un día, recepción ofrece por teléfono una hora que ya
   tiene dueño — y eso solo se descubre cuando llegan dos pacientes.
   ═══════════════════════════════════════════════════════════════════════ */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  agFecha, agISO, agSumarDias, agLunesDe, agSemanaDe,
  agHhmm, agAMin, agDeMin, agFranjas, agEnFranja,
} = require("../js/agenda-rejilla.js");

/* ═══ El error del día antes ════════════════════════════════════════════ */

test("una fecha ISO se parsea en local, no en UTC", () => {
  const d = agFecha("2026-08-04");
  assert.equal(d.getDate(), 4, "con `new Date('2026-08-04')` a secas, en México saldría 3");
  assert.equal(d.getMonth(), 7);
  assert.equal(agISO(d), "2026-08-04", "y el ida y vuelta no debe mover el día");
});

test("el ida y vuelta aguanta todo un año, incluidos los cambios de horario", () => {
  /* Un `setDate` mal hecho o un parseo en UTC se delatan en el día del
     cambio de horario de verano, no en un martes cualquiera. */
  let f = "2026-01-01";
  for (let i = 0; i < 365; i++) {
    const siguiente = agSumarDias(f, 1);
    assert.match(siguiente, /^\d{4}-\d{2}-\d{2}$/, `día ${i}: ${siguiente}`);
    assert.equal(agSumarDias(siguiente, -1), f, `ida y vuelta rota en ${f}`);
    f = siguiente;
  }
  assert.equal(f, "2027-01-01", "365 días desde el 1 de enero de 2026");
});

test("sumar días cruza mes y año", () => {
  assert.equal(agSumarDias("2026-01-31", 1), "2026-02-01");
  assert.equal(agSumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(agSumarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(agSumarDias("2028-03-01", -1), "2028-02-29", "2028 es bisiesto");
});

/* ═══ La semana ═════════════════════════════════════════════════════════ */

test("el lunes de la semana, con el domingo perteneciendo a la que TERMINA", () => {
  /* 2026-08-03 es lunes. */
  assert.equal(agLunesDe("2026-08-03"), "2026-08-03", "un lunes es su propio lunes");
  assert.equal(agLunesDe("2026-08-06"), "2026-08-03", "jueves");
  assert.equal(agLunesDe("2026-08-08"), "2026-08-03", "sábado");

  /* El domingo es el caso que se equivoca solo: con `getDay()` a secas
     (domingo = 0) el cálculo salta a la semana siguiente y el panel enseña
     el lunes que viene cuando alguien abre el panel un domingo. */
  assert.equal(agLunesDe("2026-08-09"), "2026-08-03",
    "el domingo cierra la semana, no abre la siguiente");
  assert.equal(agLunesDe("2026-08-10"), "2026-08-10", "y el lunes siguiente sí avanza");
});

test("la semana son siete días de lunes a domingo", () => {
  const s = agSemanaDe("2026-08-06");
  assert.equal(s.length, 7);
  assert.equal(s[0], "2026-08-03");
  assert.equal(s[6], "2026-08-09");
  assert.deepEqual(s, [...new Set(s)], "sin repetidos");
});

test("navegar de semana en semana no se salta ni repite días", () => {
  const vistos = [];
  let ancla = "2026-08-06";
  for (let i = 0; i < 8; i++) {
    vistos.push(...agSemanaDe(ancla));
    ancla = agSumarDias(ancla, 7);
  }
  assert.equal(vistos.length, 56);
  assert.equal(new Set(vistos).size, 56, "ocho semanas seguidas cubren 56 días distintos");
});

/* ═══ Horas ═════════════════════════════════════════════════════════════ */

test("las horas se normalizan a HH:MM", () => {
  assert.equal(agHhmm("9:00"), "09:00");
  assert.equal(agHhmm("09:00"), "09:00");
  assert.equal(agHhmm("14:30:00"), "14:30", "Postgres devuelve `time` con segundos");
  assert.equal(agHhmm(""), "");
  assert.equal(agHhmm(null), "");
  assert.equal(agHhmm("mañana"), "", "texto libre no es una hora");
});

test("minutos, ida y vuelta", () => {
  assert.equal(agAMin("09:30"), 570);
  assert.equal(agDeMin(570), "09:30");
  assert.equal(agDeMin(0), "00:00");
  assert.equal(agDeMin(1439), "23:59");
  assert.ok(Number.isNaN(agAMin("")), "sin hora no hay minuto, y NaN no es 0");
});

/* ═══ Franjas: de dónde salen los huecos ════════════════════════════════ */

test("un bloque de 9 a 12 son seis franjas de media hora", () => {
  const f = agFranjas([{ horaInicio: "09:00", horaFin: "12:00" }]);
  assert.deepEqual(f, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  assert.ok(!f.includes("12:00"), "la hora de cierre no es un hueco que se pueda ofrecer");
});

test("dos bloques del mismo día no se solapan ni dejan el intermedio", () => {
  const f = agFranjas([
    { horaInicio: "09:00", horaFin: "10:00" },
    { horaInicio: "16:00", horaFin: "17:00" },
  ]);
  assert.deepEqual(f, ["09:00", "09:30", "16:00", "16:30"]);
  assert.ok(!f.includes("12:00"), "la comida no es un hueco libre");
});

test("bloques encimados no producen franjas duplicadas", () => {
  /* La base impide guardarlos encimados, pero una excepción puede quedar
     junto a un bloque base y el render no debe pintar dos veces las 10:00 —
     eso duplicaría la cita en pantalla. */
  const f = agFranjas([
    { horaInicio: "09:00", horaFin: "11:00" },
    { horaInicio: "10:00", horaFin: "12:00" },
  ]);
  assert.deepEqual(f, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
});

test("media hora suelta y bloques con horas raras no rompen la rejilla", () => {
  assert.deepEqual(agFranjas([{ horaInicio: "09:30", horaFin: "10:00" }]), ["09:30"]);
  assert.deepEqual(agFranjas([{ horaInicio: "09:00", horaFin: "09:00" }]), [],
    "un bloque de duración cero no ofrece nada");
  assert.deepEqual(agFranjas([{ horaInicio: "10:00", horaFin: "09:00" }]), [],
    "invertido tampoco, y sin colgarse en un bucle infinito");
  assert.deepEqual(agFranjas([{ horaInicio: "", horaFin: "12:00" }]), []);
  assert.deepEqual(agFranjas([]), []);
  assert.deepEqual(agFranjas(null), []);
});

test("una franja atrapa la media hora que le toca y solo esa", () => {
  assert.ok(agEnFranja("09:00", "09:00"));
  assert.ok(agEnFranja("09:29", "09:00"));
  assert.ok(!agEnFranja("09:30", "09:00"), "las 9:30 son de la franja de las 9:30");
  assert.ok(agEnFranja("09:30", "09:30"));
  assert.ok(!agEnFranja("08:59", "09:00"));
});

test("una cita a las 9:30 no cae en el renglón de las 9:00", () => {
  /* Es el motivo de que las franjas sean de media hora y no de una: en la
     rejilla por hora, el paciente de las 9:30 se leería como de las 9:00 y
     alguien le diría que llegue media hora antes. */
  assert.ok(!agEnFranja("09:30", "09:00", 30));
  assert.ok(agEnFranja("09:30", "09:00", 60), "con paso de una hora sí caería, y eso es lo que se evita");
});

test("una cita sin hora no cae en ninguna franja", () => {
  const franjas = agFranjas([{ horaInicio: "09:00", horaFin: "12:00" }]);
  assert.ok(franjas.every((f) => !agEnFranja("", f)),
    "las citas sin hora se listan aparte; si cayeran en una franja, taparían un hueco libre");
  assert.ok(franjas.every((f) => !agEnFranja(null, f)));
});
