/* ═══════════════════════════════════════════════════════════════════════
   Aritmética de la agenda — funciones puras

   Aparte de js/agenda.js por la misma razón que los adaptadores del inbox
   están aparte de su vista: esto se puede probar en node y la vista no.

   Y hace falta probarlo. Todo lo que hay aquí es cuenta de fechas y de
   horas, que es exactamente donde este proyecto ya se equivocó dos veces:
   `new Date("2026-08-04")` se interpreta como UTC y en México cae un día
   antes, y evaluar una hora sin convertir la zona horaria mandó los correos
   con seis horas de diferencia. Ninguno de los dos se ve leyendo el código.

   Export dual: globals en el navegador, module.exports en node.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Fecha local a partir de un ISO corto.
 *
 * La hora explícita no es adorno: `new Date("2026-08-04")` se parsea como
 * medianoche UTC, que en México son las 18:00 del día 3. Con `T00:00:00` se
 * parsea en la zona del navegador, que es la que le importa a la clínica.
 */
function agFecha(v) {
  return new Date(`${String(v).slice(0, 10)}T00:00:00`);
}

function agISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function agHoy() {
  return agISO(new Date());
}

function agSumarDias(v, n) {
  const d = agFecha(v);
  d.setDate(d.getDate() + n);
  return agISO(d);
}

/** Lunes de la semana que contiene esa fecha. El domingo pertenece a la semana que termina. */
function agLunesDe(v) {
  const d = agFecha(v);
  const dow = d.getDay();               // 0 domingo … 6 sábado
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return agISO(d);
}

/** Los siete días de la semana de esa fecha, de lunes a domingo. */
function agSemanaDe(v) {
  const lun = agLunesDe(v);
  return Array.from({ length: 7 }, (_, i) => agSumarDias(lun, i));
}

function agHhmm(v) {
  const m = String(v || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

function agAMin(h) {
  const t = agHhmm(h);
  if (!t) return NaN;
  const [hh, mm] = t.split(":").map(Number);
  return hh * 60 + mm;
}

function agDeMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Las franjas de media hora que cubren unos bloques de atención.
 *
 * Media hora y no una: una consulta de las 9:30 no puede caer en el renglón
 * de las 9:00 sin mentir sobre a qué hora tiene que llegar el paciente.
 *
 * Devuelve `[]` cuando no hay bloques. Quien llame tiene que distinguir eso
 * de "la clínica no tiene horario cargado" — son dos cosas distintas y
 * confundirlas deja la agenda en blanco sin explicar por qué. Es el mismo
 * cuidado que ya está documentado en app.js y en el tool de MediBot.
 */
function agFranjas(bloques, paso = 30) {
  const salida = [];
  for (const b of bloques || []) {
    const ini = agAMin(b.horaInicio);
    const fin = agAMin(b.horaFin);
    if (!Number.isFinite(ini) || !Number.isFinite(fin)) continue;
    for (let m = ini; m < fin; m += paso) salida.push(agDeMin(m));
  }
  return [...new Set(salida)].sort();
}

/** ¿Cae esta hora en la franja que empieza en `franja`? */
function agEnFranja(hora, franja, paso = 30) {
  const m = agAMin(hora);
  const ini = agAMin(franja);
  if (!Number.isFinite(m) || !Number.isFinite(ini)) return false;
  return m >= ini && m < ini + paso;
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    agFecha, agISO, agHoy, agSumarDias, agLunesDe, agSemanaDe,
    agHhmm, agAMin, agDeMin, agFranjas, agEnFranja,
  };
}
