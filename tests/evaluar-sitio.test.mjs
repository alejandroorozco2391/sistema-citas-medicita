/* ═══════════════════════════════════════════════════════════════════════
   A dónde llevan de verdad los enlaces de los correos

   Esta prueba existe porque la primera versión de la comprobación daba un
   ✖ por algo que estaba bien: en localhost las etiquetas <meta> están en
   marcador A PROPÓSITO —las credenciales salen de `js/config-local.mjs`,
   que se carga en tiempo de ejecución y solo ahí— y mirar el HTML estático
   no puede ver eso.

   El caso que de verdad importa es el último: que `sitio_url` apunte al
   despliegue de OTRA clínica. No da error en ninguna parte, y termina con
   los pacientes de una dándose de baja en la base de la otra. Reproducirlo
   a mano necesitaría dos proyectos de Supabase reales, así que la única
   forma honesta de saber que la comprobación lo caza es esta.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarSitio } from "../scripts/evaluar-sitio.mjs";

const HOST = "qmvfqvauqvxhqkwzjknb.supabase.co";

const htmlCon = url =>
  `<html><head><meta name="supabase-url" content="${url}">` +
  `<meta name="supabase-anon-key" content="sb_publishable_x"></head></html>`;

const HTML_MARCADOR = htmlCon("TU_PROYECTO.supabase.co");
const CONFIG_BUENO  = `export default { url: "https://${HOST}", anonKey: "sb_publishable_x" };`;

const niveles = r => r.map(x => x.nivel);
const texto   = r => r.map(x => [x.mensaje, ...(x.detalle || [])].join(" ")).join(" ");

/* ═══ Un despliegue real, bien configurado ═════════════════════════════ */

test("un despliegue con sus credenciales y apuntando aquí: todo bien", () => {
  const r = evaluarSitio({
    sitioUrl: "https://clinica-lomas.vercel.app",
    host: HOST,
    html: htmlCon(`https://${HOST}`),
    configServido: null,
  });

  assert.deepEqual(niveles(r), ["ok"]);
});

test("da igual que la meta traiga o no el https://", () => {
  const r = evaluarSitio({
    sitioUrl: "https://clinica-lomas.vercel.app",
    host: HOST,
    html: htmlCon(HOST),          // sin esquema
    configServido: null,
  });
  assert.deepEqual(niveles(r), ["ok"]);
});

/* ═══ El error que cometimos de verdad ═════════════════════════════════ */

test("un despliegue con las etiquetas en marcador corre en modo local", () => {
  const r = evaluarSitio({
    sitioUrl: "https://sistema-citas-medicita.vercel.app",
    host: HOST,
    html: HTML_MARCADOR,
    configServido: null,
  });

  assert.deepEqual(niveles(r), ["mal"]);
  assert.match(texto(r), /MODO LOCAL/);
  assert.match(texto(r), /enlace no válido/,
    "hay que decir QUÉ va a ver el paciente, no solo que está mal configurado");
});

test("y no se le sugiere config-local.mjs, que allí no carga", () => {
  const r = evaluarSitio({
    sitioUrl: "https://clinica-lomas.vercel.app",
    host: HOST,
    html: HTML_MARCADOR,
    configServido: null,
  });
  assert.match(texto(r), /solo carga en localhost/);
});

/* ═══ El caso peor: apuntar a la base de otra clínica ══════════════════ */

test("un despliegue que apunta a OTRO proyecto de Supabase", () => {
  const r = evaluarSitio({
    sitioUrl: "https://clinica-lomas.vercel.app",
    host: HOST,
    html: htmlCon("https://otraclinica.supabase.co"),
    configServido: null,
  });

  assert.deepEqual(niveles(r), ["mal"]);
  assert.match(texto(r), /otraclinica\.supabase\.co/,
    "hay que nombrar el proyecto ajeno, o no se sabe qué corregir");
  assert.match(texto(r), /cruce de clínicas/);
});

/* ═══ Localhost: correcto para probar, no para entregar ════════════════ */

test("localhost con config-local.mjs sirviéndose y apuntando aquí", () => {
  const r = evaluarSitio({
    sitioUrl: "http://localhost:5173",
    host: HOST,
    html: HTML_MARCADOR,          // en localhost las metas SÍ van en marcador
    configServido: CONFIG_BUENO,
  });

  assert.deepEqual(niveles(r), ["ok", "aviso"],
    "las credenciales están bien; lo que no sirve es entregar un localhost");
  assert.match(texto(r), /config-local\.mjs/);
  assert.match(texto(r), /no puede abrir tu localhost/);
});

test("localhost sin config-local.mjs sí es un problema de verdad", () => {
  const r = evaluarSitio({
    sitioUrl: "http://localhost:5173",
    host: HOST,
    html: HTML_MARCADOR,
    configServido: null,
  });

  assert.deepEqual(niveles(r), ["mal", "aviso"]);
  assert.match(texto(r), /modo local/i);
  assert.match(texto(r), /config-local\.ejemplo\.mjs/, "hay que decir cómo arreglarlo");
});

test("localhost sirviendo un config-local.mjs de otro proyecto", () => {
  const r = evaluarSitio({
    sitioUrl: "http://localhost:5173",
    host: HOST,
    html: HTML_MARCADOR,
    configServido: `export default { url: "https://otraclinica.supabase.co" };`,
  });

  assert.deepEqual(niveles(r), ["mal", "aviso"]);
  assert.match(texto(r), /NO apunta a/);
});

test("127.0.0.1 y el puerto que sea cuentan como local", () => {
  for (const url of ["http://127.0.0.1:8080", "http://localhost:3000", "http://localhost"]) {
    const r = evaluarSitio({ sitioUrl: url, host: HOST, html: HTML_MARCADOR, configServido: CONFIG_BUENO });
    assert.deepEqual(niveles(r), ["ok", "aviso"], `${url} debería tratarse como local`);
  }
});

test("un dominio que solo CONTIENE 'localhost' no es local", () => {
  /* `localhost.clinica-mala.com` resuelve a un servidor de internet, y con
     las metas en marcador es el caso de modo local en producción — no el de
     desarrollo. Tratarlo como local dejaría pasar el error de verdad. */
  const r = evaluarSitio({
    sitioUrl: "https://localhost.ejemplo.com",
    host: HOST,
    html: HTML_MARCADOR,
    configServido: null,
  });
  assert.deepEqual(niveles(r), ["mal"]);
  assert.match(texto(r), /MODO LOCAL/);
});
