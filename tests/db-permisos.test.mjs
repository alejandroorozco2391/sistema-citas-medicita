/* ═══════════════════════════════════════════════════════════════════════
   Inventario de permisos — qué alcanza la llave pública

   Esta prueba existe porque el patrón de permisos que usamos desde 0006
   no funcionaba y nadie lo notó durante cinco migraciones:

       revoke all on function ... from public;   ← no quita nada
       grant execute on function ... to authenticated;

   En Supabase, toda función nueva de `public` nace con EXECUTE concedido
   DIRECTAMENTE a `anon`, por las default privileges del proyecto. Revocarle
   a PUBLIC no le quita nada a `anon`. El resultado medido: las 29 funciones
   del esquema eran alcanzables con la llave que va escrita en el HTML,
   incluida una que manda correo con la cuenta de la clínica.

   Por eso esto no comprueba funciones una por una: recorre el esquema
   ENTERO y exige que cada función esté en un lado o en el otro. Una función
   nueva que nadie clasificó rompe la prueba, y eso es el punto — el error
   original fue de omisión, no de criterio.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearBase } from "./db-harness.mjs";

/**
 * Las seis puertas del visitante sin cuenta. Cada una valida por dentro y
 * está documentada en 0006 y 0013. Agregar algo aquí es una decisión de
 * seguridad: significa "cualquiera en internet puede llamar esto".
 */
const ANON_PUEDE = [
  "solicitar_cita",           // pedir cita desde la landing
  "responder_encuesta",       // el folio es la credencial
  "encuesta_ya_respondida",   // la pantalla previa de la encuesta
  "horario_disponible",       // no ofrecer un día cerrado
  "horas_ocupadas_publico",   // no ofrecer una hora tomada
  "escalar_a_humano",         // pedir una persona sin tener cuenta

  /* La salida de los correos automáticos (0014). Exigirle una cuenta a
     alguien para dejar de escribirle es no dejarlo irse, así que estas dos
     TIENEN que ser alcanzables sin sesión. La credencial es el token del
     propio correo, y lo único que devuelven es el nombre de pila de quien
     ya lo tenía en la mano. */
  "consultar_baja",
  "darse_de_baja",

  /* "Mis citas" (0016). Son las primeras funciones públicas que MODIFICAN
     la agenda, así que la credencial es de dos factores —folio Y teléfono—
     y llevan su propio freno de abuso. El resolvedor interno que usan,
     `paciente_de_folio`, NO se ofrece: sería un comprobador de parejas
     folio+teléfono sin ese freno. */
  "mis_citas",
  "cancelar_mi_cita",

  // Normalizadores puros: sin acceso a datos, y el motor los necesita para
  // evaluar las columnas generadas de citas y pacientes.
  "clave_telefono",
  "clave_hora",
];

/**
 * Del reloj. pg_cron corre como dueño de la base, así que no hace falta
 * concederle nada — y no debe alcanzarlas nadie más, ni con sesión.
 *
 * `encolar_aviso_escalacion` es la que importa: encola correo, y la cuota
 * de EmailJS es de la clínica.
 */
const DE_NADIE = [
  "promover_escalaciones",
  "encolar_aviso_escalacion",

  /* El productor de avisos automáticos (0014). Redacta correos y los pone
     en la cola: si el personal pudiera dispararlo, un clic mal puesto le
     manda el recordatorio a la agenda entera. */
  "encolar_avisos_del_dia",
  "encolar_recordatorios",
  "encolar_seguimientos",
  "pie_de_aviso",

  "tocar_actualizado_en",             // solo tiene sentido dentro de un disparador
  "sincronizar_resumen_conversacion",
];

async function inventario(db, rol) {
  const { rows } = await db.query(
    `select p.proname as nombre,
            p.prosecdef as definer,
            has_function_privilege($1, p.oid, 'execute') as puede
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by p.proname`,
    [rol]
  );
  return rows;
}

/* ═══ Funciones ════════════════════════════════════════════════════════ */

test("la llave pública alcanza exactamente las seis puertas, y nada más", async () => {
  const db = await crearBase();
  const funciones = await inventario(db, "anon");

  const alcanza = funciones.filter(f => f.puede).map(f => f.nombre).sort();
  const esperado = [...ANON_PUEDE].sort();

  const extra = alcanza.filter(n => !esperado.includes(n));
  assert.deepEqual(extra, [],
    `anon alcanza funciones que nadie autorizó: ${extra.join(", ")}.\n` +
    `Si es a propósito, agrégala a ANON_PUEDE con un comentario de por qué. ` +
    `Si no, revócala en una migración nueva — y ojo: "revoke from public" NO ` +
    `le quita nada a anon.`);

  const faltan = esperado.filter(n => !alcanza.includes(n));
  assert.deepEqual(faltan, [],
    `estas deberían ser alcanzables sin sesión y no lo son: ${faltan.join(", ")}. ` +
    `La landing o la encuesta se romperían.`);
});

test("las funciones del reloj no las alcanza nadie, ni con sesión", async () => {
  const db = await crearBase();

  for (const rol of ["anon", "authenticated"]) {
    const funciones = await inventario(db, rol);
    for (const nombre of DE_NADIE) {
      const f = funciones.find(x => x.nombre === nombre);
      assert.ok(f, `${nombre} no existe en el esquema`);
      assert.equal(f.puede, false,
        `${rol} puede ejecutar ${nombre}. Es del reloj (pg_cron corre como ` +
        `dueño y no necesita concesión) o de un disparador.`);
    }
  }
});

test("el personal con sesión sigue alcanzando lo que el panel usa", async () => {
  const db = await crearBase();
  const funciones = await inventario(db, "authenticated");

  /* El otro lado del mismo error. Apretar los permisos de más rompe el
     panel entero, y de una forma que no se ve en el código: el botón está
     ahí, el manejador corre, y Postgres contesta "permission denied" en
     un console.error que nadie mira. */
  const PANEL_NECESITA = [
    "guardar_horario_base", "citas_afectadas_por_cierre", "horario_del_dia",
    "en_horario", "proxima_apertura", "horario_texto",
    "escalacion_reconocer", "escalacion_resolver", "rutear_escalacion",
    "horas_ocupadas", "slot_ocupado",
    "clinica_actual", "rol_actual",
  ];

  const sinPermiso = PANEL_NECESITA.filter(
    n => !funciones.find(f => f.nombre === n && f.puede)
  );
  assert.deepEqual(sinPermiso, [],
    `el personal con sesión no puede ejecutar: ${sinPermiso.join(", ")} — ` +
    `alguna revocación se pasó de largo.`);
});

test("toda función SECURITY DEFINER alcanzable sin sesión está en la lista", async () => {
  const db = await crearBase();
  const funciones = await inventario(db, "anon");

  /* Una función SECURITY DEFINER se salta RLS por completo: corre con los
     permisos de su dueño. Que anon pueda llamar una es una decisión de
     seguridad deliberada, nunca un descuido heredado de las default
     privileges. */
  const definerAbiertas = funciones
    .filter(f => f.definer && f.puede)
    .map(f => f.nombre)
    .filter(n => !ANON_PUEDE.includes(n));

  assert.deepEqual(definerAbiertas, [],
    `funciones DEFINER abiertas sin autorización: ${definerAbiertas.join(", ")} — ` +
    `se saltan RLS.`);
});

/* ═══ Vistas ═══════════════════════════════════════════════════════════ */

test("la llave pública solo lee las dos vistas recortadas", async () => {
  const db = await crearBase();

  const { rows } = await db.query(`
    select c.relname as nombre,
           has_table_privilege('anon', c.oid, 'select') as puede
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
    order by c.relname
  `);

  const alcanza = rows.filter(v => v.puede).map(v => v.nombre).sort();

  /* Las dos existen justamente para que la página pública no tenga que
     cargar las tablas completas: `clinica_publica` no expone el plan
     contratado, y `testimonios_publicos` da nombre de pila más inicial en
     vez de nombres, teléfonos y correos de todos los pacientes. */
  assert.deepEqual(alcanza, ["clinica_publica", "testimonios_publicos"],
    "una vista nueva legible sin sesión es una fuga hasta que se demuestre lo contrario");
});
