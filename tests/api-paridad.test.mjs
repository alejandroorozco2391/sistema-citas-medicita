/* ═══════════════════════════════════════════════════════════════════════
   Paridad entre las dos implementaciones de la capa de datos.

   El sistema promete que api-local (localStorage, para la demo pública) y
   api-remoto (Supabase, para una clínica real) son intercambiables. Si una
   se desincroniza de la otra, el corte de B2 rompe la demo o el producto,
   y el error aparecería hasta que alguien lo viera fallar en pantalla.

   Alcance honesto: aquí se comprueba la SUPERFICIE de ambas y el
   COMPORTAMIENTO de la local. El comportamiento de la remota necesita un
   proyecto de Supabase vivo; lo que sí está verificado de ese lado es el
   esquema, las políticas y las funciones — en tests/db-*.test.mjs, contra
   un Postgres real.
   ═══════════════════════════════════════════════════════════════════════ */

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instalarLocalStorage } from "./stub-localstorage.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

const ls = instalarLocalStorage();
const local = await import("../js/api-local.mjs");

/**
 * Los métodos que la interfaz declara, leídos del propio api.mjs.
 *
 * Cuenta las dos vías: `impl()` (la que depende de la sesión) e
 * `implPublica()` (landing y encuesta, que ocurren sin sesión). Si solo
 * mirara la primera, los métodos públicos quedarían fuera de la
 * comprobación de paridad justo donde más duele: son los que usa un
 * paciente que no tiene cuenta.
 */
function metodosDeLaInterfaz() {
  const src = fs.readFileSync(path.join(RAIZ, "js", "api.mjs"), "utf8");
  return [...new Set([...src.matchAll(/impl(?:Publica)?\(\)\)\.(\w+)\(/g)].map(m => m[1]))];
}

/** Nombres exportados por un módulo, leídos del texto (api-remoto no se puede importar sin navegador). */
function exportadosDe(archivo) {
  const src = fs.readFileSync(path.join(RAIZ, "js", archivo), "utf8");
  return new Set([...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]));
}

/* ═══ Superficie ════════════════════════════════════════════════════════ */

test("la interfaz declara los métodos esperados", () => {
  const m = metodosDeLaInterfaz();
  assert.ok(m.length >= 35, `se esperaban al menos 35 métodos, hay ${m.length}`);
});

test("api-local implementa TODA la interfaz", () => {
  const faltan = metodosDeLaInterfaz().filter(n => typeof local[n] !== "function");
  assert.deepStrictEqual(faltan, [], `api-local no implementa: ${faltan.join(", ")}`);
});

test("api-remoto implementa TODA la interfaz", () => {
  const exportados = exportadosDe("api-remoto.mjs");
  const faltan = metodosDeLaInterfaz().filter(n => !exportados.has(n));
  assert.deepStrictEqual(faltan, [], `api-remoto no implementa: ${faltan.join(", ")}`);
});

test("ninguna implementación exporta métodos que la otra no tenga", () => {
  const iface = new Set(metodosDeLaInterfaz());
  const enLocal = exportadosDe("api-local.mjs");
  const enRemoto = exportadosDe("api-remoto.mjs");

  const soloLocal = [...enLocal].filter(n => iface.has(n) && !enRemoto.has(n));
  const soloRemoto = [...enRemoto].filter(n => iface.has(n) && !enLocal.has(n));

  assert.deepStrictEqual(soloLocal, [], `solo en local: ${soloLocal.join(", ")}`);
  assert.deepStrictEqual(soloRemoto, [], `solo en remoto: ${soloRemoto.join(", ")}`);
});

test("todos los métodos de api-local devuelven Promise", async () => {
  ls.clear();
  // Se prueban los de lectura, que no necesitan argumentos válidos.
  const lecturas = [
    "clinicaObtener", "pacientesListar", "citasListar", "conversacionesListar",
    "documentosListar", "postsListar", "npsListar", "seguimientosListar",
    "conversacionesContarPorEstado",
  ];
  for (const nombre of lecturas) {
    const r = local[nombre]();
    assert.ok(r instanceof Promise, `${nombre} debe devolver Promise en ambos modos`);
    await r;
  }
});

/* ═══ Comportamiento de la implementación local ═════════════════════════ */

test("la configuración de la clínica va y viene", async () => {
  ls.clear();
  await local.clinicaGuardar({ nombreClinica: "Consultorio Prueba", ciudad: "CDMX" });
  const cfg = await local.clinicaObtener();
  assert.strictEqual(cfg.nombreClinica, "Consultorio Prueba");
});

test("pedir cita crea el expediente y devuelve folio con el formato de siempre", async () => {
  ls.clear();
  const folio = await local.publicoSolicitarCita({
    nombre: "Ana", apellidos: "Martínez", telefono: "55 8811 2233",
    especialidad: "Cardiología", fecha: "2026-08-10", hora: "10:00", tipo: "Primera vez",
  });
  assert.match(folio, /^CIT-\d{6}-\d{4}$/);

  const pacientes = await local.pacientesListar();
  assert.strictEqual(pacientes.length, 1);
  assert.strictEqual(pacientes[0].nombre, "Ana");
});

test("el mismo teléfono en otro formato NO duplica el expediente", async () => {
  ls.clear();
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "55 8811 2233", fecha: "2026-08-10" });
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "525588112233", fecha: "2026-08-11" });
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "+52 55 8811-2233", fecha: "2026-08-12" });

  const pacientes = await local.pacientesListar();
  assert.strictEqual(pacientes.length, 1, "los tres formatos son la misma persona");

  const citas = await local.citasListar();
  assert.strictEqual(citas.length, 3);
});

test("buscar paciente por teléfono tolera el formato internacional", async () => {
  ls.clear();
  await local.publicoSolicitarCita({ nombre: "Ana", telefono: "55 8811 2233", fecha: "2026-08-10" });
  const p = await local.pacientesPorTelefono("525588112233");
  assert.ok(p, "el número de WhatsApp debe encontrar al paciente del expediente");
  assert.strictEqual(p.nombre, "Ana");
});

test("una encuesta no se puede responder dos veces", async () => {
  ls.clear();
  const folio = await local.publicoSolicitarCita({
    nombre: "Luis", telefono: "55 4040 5050", fecha: "2026-08-10",
  });
  await local.npsResponder(folio, 9, "Muy bien");
  assert.strictEqual(await local.npsYaRespondida(folio), true);
  await assert.rejects(() => local.npsResponder(folio, 2, "otra vez"), /respondida|ya/i);
});

test("conversaciones y mensajes conservan las reglas del inbox", async () => {
  ls.clear();
  const conv = await local.conversacionesUpsert({
    canal: "whatsapp", telefono: "55 8811 2233", nombreContacto: "Ana",
  });
  await local.mensajesAgregar(conv.id, { remitente: "paciente", contenido: "Buenas tardes" });
  await local.mensajesAgregar(conv.id, {
    remitente: "staff", tipo: "nota_interna", contenido: "Nota privada",
  });

  const actualizada = await local.conversacionesObtener(conv.id);
  assert.strictEqual(
    actualizada.ultimoMensaje.texto, "Buenas tardes",
    "una nota interna no debe asomarse al preview de la lista"
  );
  assert.strictEqual(actualizada.noLeidos, 1);
  assert.strictEqual((await local.mensajesListar(conv.id)).length, 2);
});

test("el upsert de conversación no duplica por formato de teléfono", async () => {
  ls.clear();
  const a = await local.conversacionesUpsert({ canal: "whatsapp", telefono: "525588112233" });
  const b = await local.conversacionesUpsert({ canal: "whatsapp", telefono: "55 8811 2233" });
  assert.strictEqual(a.id, b.id, "mismo número, mismo hilo");
  assert.strictEqual((await local.conversacionesListar()).length, 1);
});

/* ═══ Colisiones de identificadores ═════════════════════════════════════
   Los ids llevaban 4 dígitos aleatorios. Con los mensajes eso era una
   pérdida de datos silenciosa: dos creados en el mismo milisegundo
   chocaban, y como el store descarta ids repetidos por idempotencia, el
   segundo mensaje desaparecía del hilo sin ningún error. Lo cazó una
   prueba intermitente del inbox. */

test("mil mensajes seguidos no pierden ni uno por choque de id", async () => {
  ls.clear();
  const conv = await local.conversacionesUpsert({ canal: "whatsapp", telefono: "55 1000 2000" });

  for (let i = 0; i < 1000; i++) {
    await local.mensajesAgregar(conv.id, { remitente: "paciente", contenido: `msg ${i}` });
  }

  const guardados = await local.mensajesListar(conv.id);
  assert.strictEqual(
    guardados.length, 1000,
    "un mensaje descartado por choque de id es un mensaje que el paciente escribió y nadie leyó"
  );
});

test("mil citas del mismo día no repiten folio", async () => {
  ls.clear();
  const folios = new Set();

  for (let i = 0; i < 1000; i++) {
    const c = await local.citasCrear({ nombre: `P${i}`, telefono: `55 0000 ${i}`, fecha: "2026-08-10" });
    assert.ok(!folios.has(c.folio), `folio repetido: ${c.folio}`);
    folios.add(c.folio);
  }

  assert.strictEqual(folios.size, 1000);
  /* El formato visible no cambia: el paciente lo trae apuntado. */
  for (const f of folios) assert.match(f, /^CIT-\d{6}-\d{4}$/);
});

test("un localStorage corrupto no tumba la capa de datos", async () => {
  ls.clear();
  ls.setItem("medicita_pacientes", "{esto no es json");
  assert.deepStrictEqual(await local.pacientesListar(), []);
});

/* ═══ Superficie pública (landing y encuesta, sin sesión) ═══════════════ */

test("los testimonios solo exponen lo publicable", async () => {
  ls.clear();
  const folio = await local.publicoSolicitarCita({
    nombre: "María", apellidos: "González Ruiz",
    telefono: "55 1212 3434", email: "maria@correo.mx",
    fecha: "2026-08-10", notas: "Dato clínico que no debe salir de aquí",
  });
  await local.npsResponder(folio, 10, "Excelente atención");

  const [t] = await local.publicoTestimonios();
  assert.ok(t, "debe devolver el testimonio");

  assert.strictEqual(t.nombrePublico, "María G.", "nombre de pila más inicial, nunca el apellido completo");
  assert.strictEqual(t.comentario, "Excelente atención");
  assert.strictEqual(t.puntuacion, 10);

  /* Lo que importa de esta prueba: la landing es pública, así que lo que
     salga de aquí lo puede leer cualquiera. Antes se le entregaba el
     arreglo completo de citas para sacar un nombre de pila. */
  const serializado = JSON.stringify(t);
  for (const filtrado of ["55 1212 3434", "5512123434", "maria@correo.mx", "González", folio, "Dato clínico"]) {
    assert.ok(
      !serializado.includes(filtrado),
      `un testimonio público no debe incluir "${filtrado}"`
    );
  }
});

test("los testimonios respetan el umbral de puntuación", async () => {
  ls.clear();
  const malo = await local.publicoSolicitarCita({
    nombre: "Jorge", apellidos: "Pérez", telefono: "55 1111 0000", fecha: "2026-08-10",
  });
  await local.npsResponder(malo, 3, "No me gustó");

  assert.deepStrictEqual(
    await local.publicoTestimonios({ minPuntuacion: 8 }), [],
    "una calificación baja no se publica como testimonio"
  );
  assert.strictEqual(
    (await local.publicoTestimonios({ minPuntuacion: 1 })).length, 1,
    "pero sigue estando en los datos: es el umbral lo que la deja fuera"
  );
});

test("crear una cita sin folio genera uno, en las dos implementaciones", async () => {
  ls.clear();

  /* Local se comprueba ejecutándola. */
  const c = await local.citasCrear({
    nombre: "Ramón", apellidos: "Díaz", telefono: "55 3131 4141",
    fecha: "2026-08-12", especialidad: "Medicina General",
  });
  assert.match(c.folio, /^CIT-\d{6}-\d{4}$/, "la capa de datos pone el folio, no quien llama");
  assert.ok(await local.pacientesPorTelefono("55 3131 4141"), "y vincula el expediente");

  /* La remota no se puede ejecutar sin un Supabase vivo, así que se
     comprueba que su cuerpo hace las dos cosas. Es una prueba de texto y
     es fea, pero cubre una regresión que costó cara: al centralizar la
     generación de folios en B2, los módulos dejaron de mandarlo y solo
     api-local lo generaba. Contra Postgres, donde `citas.folio` es NOT
     NULL, toda cita creada desde MediBot o desde "+ Nueva cita" moría —
     mientras la landing seguía funcionando, porque va por otra ruta. */
  const src = fs.readFileSync(path.join(RAIZ, "js", "api-remoto.mjs"), "utf8");
  const cuerpo = src.slice(src.indexOf("export async function citasCrear"));
  const hasta = cuerpo.slice(0, cuerpo.indexOf("\nexport "));

  assert.match(hasta, /_folioCita\(\)/, "api-remoto debe generar folio si no viene");
  assert.match(hasta, /23505/, "y reintentar cuando el folio ya existe");
  assert.match(hasta, /pacientesPorTelefono/, "y vincular el expediente como hace la local");
});

test("responder y registrar NPS viven en superficies distintas", async () => {
  /* Se ven casi iguales y hacen casi lo mismo, pero no van por el mismo
     camino: `responder` es el paciente sin sesión (superficie pública, que
     resuelve por "¿hay backend?"), y `registrar` es el panel (superficie
     normal, que resuelve por "¿hay sesión?").
     Confundirlas hizo que sembrar la demo escribiera en el Supabase de una
     clínica real mientras las citas se quedaban en localStorage. */
  const src = fs.readFileSync(path.join(RAIZ, "js", "api.mjs"), "utf8");

  const responder = src.match(/async responder\([^)]*\)\s*\{[\s\S]*?\}/)?.[0] ?? "";
  const registrar = src.match(/async registrar\([^)]*\)\s*\{[\s\S]*?\}/)?.[0] ?? "";

  assert.match(responder, /implPublica\(\)/, "responder lo usa un paciente sin sesión");
  assert.match(registrar, /(?<!Publica)\bimpl\(\)/, "registrar lo usa el panel, con sesión");

  /* Y ambas implementaciones deben tenerla, o el modo remoto se cae al
     sembrar. */
  assert.strictEqual(typeof local.npsRegistrar, "function");
  assert.ok(exportadosDe("api-remoto.mjs").has("npsRegistrar"));
});

test("la clínica pública no expone el plan contratado", async () => {
  ls.clear();
  await local.clinicaGuardar({ nombreClinica: "Consultorio Prueba", ciudad: "León" });
  const cfg = await local.publicoClinica();
  assert.strictEqual(cfg.nombreClinica, "Consultorio Prueba");
  assert.ok(!("plan" in cfg), "el plan contratado no es dato de la landing");
});

/* ═══ El puente ═════════════════════════════════════════════════════════
   js/puente-api.js copia los namespaces de api.mjs a window.API con una
   lista escrita a mano. Si se agrega un namespace a la interfaz y se
   olvida ahí, `window.API.loQueSea` sale `undefined` y el módulo revienta
   con un TypeError que la interfaz traduce a un mensaje genérico. Pasó con
   `horarios`: el panel decía "No se pudo cargar el horario" y la causa no
   estaba ni cerca de los horarios.

   Ninguna otra prueba lo cubría: api-paridad comparaba api.mjs contra sus
   dos implementaciones, pero nadie miraba el puente.
   ═══════════════════════════════════════════════════════════════════════ */

test("el puente expone TODOS los namespaces de la interfaz", () => {
  const apiSrc = fs.readFileSync(path.join(RAIZ, "js", "api.mjs"), "utf8");
  const puenteSrc = fs.readFileSync(path.join(RAIZ, "js", "puente-api.js"), "utf8");

  const namespaces = [...apiSrc.matchAll(/^export const (\w+)\s*=/gm)].map(m => m[1]);
  assert.ok(namespaces.length >= 10, `se leyeron ${namespaces.length} namespaces de api.mjs`);

  /* Las llaves del objeto literal que el puente asigna a window.API. */
  const cuerpo = puenteSrc.match(/window\.API\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? "";
  const expuestos = new Set([...cuerpo.matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]));

  const faltan = namespaces.filter(n => !expuestos.has(n));
  assert.deepStrictEqual(faltan, [],
    `puente-api.js no publica: ${faltan.join(", ")} — window.API.${faltan[0]} saldría undefined`);

  /* Y al revés: una llave que ya no existe en la interfaz deja una
     referencia muerta que solo se descubre al usarla. */
  const sobran = [...expuestos].filter(k => k !== "modo" && !namespaces.includes(k));
  assert.deepStrictEqual(sobran, [], `puente-api.js publica algo que api.mjs ya no exporta: ${sobran.join(", ")}`);
});

test("el puente publica window.API antes de que nadie lo espere", () => {
  /* Tiene que ser script clásico: un <script type="module"> no corre antes
     de DOMContentLoaded cuando el grafo tiene un await de nivel superior,
     y supabase-client.mjs tiene uno. */
  const puenteSrc = fs.readFileSync(path.join(RAIZ, "js", "puente-api.js"), "utf8");
  assert.ok(!/^\s*import\s/m.test(puenteSrc),
    "puente-api.js no puede usar import estático: dejaría de ser un script clásico");
  assert.match(puenteSrc, /window\.APIListo\s*=/, "debe definir window.APIListo de forma síncrona");
});

/* ═══ Horario de atención ═══════════════════════════════════════════════
   Las reglas de api-local tienen que ser LAS MISMAS que las de
   0009_horarios.sql. No es simetría por gusto: la landing y el agente
   razonan con esto en los dos modos, y una demo que ofrece horas que la
   clínica real rechazaría es una demo que miente.

   Las mismas reglas están probadas contra Postgres en db-horarios.test.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

/* Lunes a viernes 9–14 y 16–19. */
const SEMANA = [1, 2, 3, 4, 5].flatMap(d => [
  { diaSemana: d, horaInicio: "09:00", horaFin: "14:00" },
  { diaSemana: d, horaInicio: "16:00", horaFin: "19:00" },
]);

const LUNES = "2026-08-03";
const MARTES = "2026-08-04";
const DOMINGO = "2026-08-09";

test("una excepción con horas reemplaza al día, no se suma", async () => {
  ls.clear();
  await local.horariosGuardarBase(SEMANA);
  await local.horariosAgregarExcepcion({ fecha: MARTES, horaInicio: "10:00", horaFin: "12:00" });

  const martes = await local.horariosDelDia(MARTES);
  assert.deepStrictEqual(martes, [{ horaInicio: "10:00", horaFin: "12:00" }]);

  const lunes = await local.horariosDelDia(LUNES);
  assert.strictEqual(lunes.length, 2, "la excepción contaminó otro día");
});

test("un cierre gana sobre cualquier bloque alternativo del mismo día", async () => {
  /* Ante la duda, "cerrado": ofrecer una cita que nadie va a atender es
     peor que no ofrecer ninguna. */
  ls.clear();
  await local.horariosGuardarBase(SEMANA);
  await local.horariosAgregarExcepcion({ fecha: MARTES, horaInicio: "10:00", horaFin: "12:00" });
  await local.horariosAgregarExcepcion({ fecha: MARTES, cerrado: true, motivo: "Congreso" });

  assert.deepStrictEqual(await local.horariosDelDia(MARTES), []);
});

test("cerrar dos veces el mismo día no duplica el cierre", async () => {
  ls.clear();
  await local.horariosAgregarExcepcion({ fecha: MARTES, cerrado: true });
  await local.horariosAgregarExcepcion({ fecha: MARTES, cerrado: true });

  const excepciones = await local.horariosExcepciones(MARTES, MARTES);
  assert.strictEqual(excepciones.filter(e => e.cerrado).length, 1);
});

test("un día sin horario no devuelve bloques", async () => {
  ls.clear();
  await local.horariosGuardarBase(SEMANA);
  assert.deepStrictEqual(await local.horariosDelDia(DOMINGO), []);
});

test("guardar la semana rechaza bloques encimados", async () => {
  ls.clear();
  await assert.rejects(
    () => local.horariosGuardarBase([
      { diaSemana: 1, horaInicio: "09:00", horaFin: "14:00" },
      { diaSemana: 1, horaInicio: "13:00", horaFin: "18:00" },
    ]),
    /enciman/
  );
});

test("guardar la semana regenera el texto del membrete agrupando días iguales", async () => {
  ls.clear();
  const texto = await local.horariosGuardarBase([
    { diaSemana: 1, horaInicio: "08:00", horaFin: "13:00" },
    { diaSemana: 2, horaInicio: "08:00", horaFin: "13:00" },
    { diaSemana: 6, horaInicio: "09:00", horaFin: "12:00" },
  ]);

  assert.match(texto, /Lun–Mar 08:00–13:00/);
  assert.match(texto, /Sáb 09:00–12:00/);

  /* Y queda escrito donde lo lee el membrete de MediDocs. */
  const cfg = await local.clinicaObtener();
  assert.strictEqual(cfg.horarioAtencion, texto);
});

test("sin horario cargado, la próxima apertura es null y no una fecha inventada", async () => {
  ls.clear();
  assert.strictEqual(await local.horariosProximaApertura(), null);
  assert.strictEqual(await local.horariosAbiertoAhora(), false);
});

test("cerrar un día reporta las citas vivas que deja plantadas", async () => {
  ls.clear();
  for (const [hora, estado] of [["09:00", "confirmada"], ["17:00", "pendiente"], ["11:00", "cancelada"]]) {
    await local.citasCrear({
      nombre: "Paciente", apellidos: "X", telefono: "5511112222",
      fecha: MARTES, hora, especialidad: "Medicina General", estado,
    });
  }

  const afectadas = await local.horariosCitasAfectadas(MARTES);
  assert.deepStrictEqual(afectadas.map(c => c.hora), ["09:00", "17:00"],
    "una cita cancelada no deja a nadie plantado");

  /* Recortar a 9–14 solo debería afectar a la de las 17:00. */
  const recorte = await local.horariosCitasAfectadas(MARTES, "09:00", "14:00");
  assert.deepStrictEqual(recorte.map(c => c.hora), ["17:00"]);
});

test("el horario público no filtra el motivo de un cierre", async () => {
  ls.clear();
  await local.horariosGuardarBase(SEMANA);
  await local.horariosAgregarExcepcion({
    fecha: MARTES, cerrado: true, motivo: "Cirugía de la Dra. Ruiz",
  });

  const dias = await local.publicoHorarioDisponible(LUNES, MARTES);
  const serializado = JSON.stringify(dias);

  assert.ok(!serializado.includes("Cirugía"), "se filtró el motivo del cierre");
  assert.ok(!serializado.includes("Ruiz"));
  assert.ok(dias.every(d => d.fecha === LUNES), "el martes cerrado no debe ofrecer horas");
});

test("el horario público frena un rango absurdo", async () => {
  ls.clear();
  await assert.rejects(
    () => local.publicoHorarioDisponible("2026-01-01", "2036-01-01"),
    /90 días/
  );
});
