/* ═══════════════════════════════════════════════════════════════════════
   Servidor estático para desarrollo.

   Existe por una razón concreta: los archivos .mjs son módulos ES, y el
   navegador rechaza importarlos bajo file:// (origen opaco). Abrir
   login.html con doble clic hace que el <script type="module"> nunca
   corra — el formulario entonces se envía de forma nativa, la página se
   recarga y parece que "no pasa nada".

   El resto del proyecto sigue sin build step: esto solo sirve archivos
   tal cual, no compila nada.

   Con una excepción: `/api/chat`. En producción eso es una función
   serverless de Vercel (api/chat.js) que hace de proxy hacia Anthropic
   para que la API key no viaje al navegador. Aquí no hay Vercel, así que
   sin esto MediPost, MediDocs y los insights de Analytics daban 404 en
   local — es decir, tres módulos que no se podían probar sin desplegar.

   La llave se lee de ANTHROPIC_API_KEY del entorno. Si no está, se
   responde con un mensaje que lo dice, no con un 404 que confunde.

   Uso:  npm run dev
   ═══════════════════════════════════════════════════════════════════════ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PUERTO || 5173);

/* .env.local es el mismo archivo que ya se usa para desplegar, y está en
   .gitignore. Se carga aquí para no tener que exportar la variable a mano
   cada vez que se levanta el servidor. */
const ENV_LOCAL = path.join(RAIZ, ".env.local");
if (fs.existsSync(ENV_LOCAL) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(ENV_LOCAL);
  } catch {
    /* Un .env.local con formato raro no debe impedir levantar el sitio. */
  }
}

const LLAVE_ANTHROPIC = process.env.ANTHROPIC_API_KEY || "";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(respuesta, estado, cuerpo) {
  respuesta.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" });
  respuesta.end(JSON.stringify(cuerpo));
}

/** Espeja lo que hace api/chat.js en Vercel: proxy hacia Anthropic. */
async function proxyChat(peticion, respuesta) {
  if (peticion.method !== "POST") return json(respuesta, 405, { error: "Method not allowed" });

  if (!LLAVE_ANTHROPIC) {
    return json(respuesta, 500, {
      error:
        "Falta ANTHROPIC_API_KEY en el entorno. En producción la pone Vercel; " +
        "para desarrollo, ponla en .env.local y arranca con: npm run dev",
    });
  }

  const trozos = [];
  for await (const t of peticion) trozos.push(t);

  try {
    const arriba = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": LLAVE_ANTHROPIC,
        "anthropic-version": "2023-06-01",
      },
      body: Buffer.concat(trozos).toString("utf8"),
    });
    json(respuesta, arriba.status, await arriba.json());
  } catch (e) {
    json(respuesta, 502, { error: e.message });
  }
}

/**
 * Espeja api/avisar.js, que vacía la cola de avisos de escalaciones.
 *
 * En producción la despierta pg_cron cada minuto vía pg_net. En local no
 * hay quien la despierte, así que se llama a mano para probar el envío:
 *
 *   curl -X POST "http://localhost:5173/api/avisar?token=$ESCALACIONES_TOKEN"
 *
 * Se importa en cada llamada, sin cachear, para poder editar la función y
 * volver a probar sin reiniciar el servidor.
 */
async function proxyAvisar(peticion, respuesta) {
  const url = new URL(peticion.url, `http://localhost:${PUERTO}`);

  try {
    const modulo = await import(
      `${pathToFileURL(path.join(RAIZ, "api", "avisar.js")).href}?v=${Date.now()}`
    );

    /* La función está escrita contra la forma de Vercel (req/res de
       Express). Se le arma esa forma encima del http de node. */
    await modulo.default(
      {
        method: peticion.method,
        headers: peticion.headers,
        query: Object.fromEntries(url.searchParams),
      },
      {
        status(codigo) { this._codigo = codigo; return this; },
        json(cuerpo) { json(respuesta, this._codigo || 200, cuerpo); },
        end() { respuesta.writeHead(this._codigo || 200); respuesta.end(); },
        setHeader() {},
      }
    );
  } catch (e) {
    json(respuesta, 500, { error: e.message });
  }
}

const servidor = http.createServer((peticion, respuesta) => {
  const url = new URL(peticion.url, `http://localhost:${PUERTO}`);
  let relativa = decodeURIComponent(url.pathname);
  if (relativa === "/") relativa = "/index.html";

  if (relativa === "/api/chat") {
    proxyChat(peticion, respuesta);
    return;
  }

  if (relativa === "/api/avisar") {
    proxyAvisar(peticion, respuesta);
    return;
  }

  /* Nada fuera de la raíz del proyecto, por si acaso: es un servidor de
     desarrollo, pero un ".." en la ruta no tiene por qué funcionar. */
  const destino = path.join(RAIZ, relativa);
  if (!destino.startsWith(RAIZ)) {
    respuesta.writeHead(403).end("Prohibido");
    return;
  }

  fs.readFile(destino, (error, contenido) => {
    if (error) {
      respuesta.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      respuesta.end(`<h1>404</h1><p>No existe <code>${relativa}</code></p>`);
      return;
    }
    respuesta.writeHead(200, {
      "Content-Type": TIPOS[path.extname(destino).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    respuesta.end(contenido);
  });
});

servidor.listen(PUERTO, () => {
  console.log(`\n  MediCita corriendo en  http://localhost:${PUERTO}\n`);
  console.log(`  Panel:   http://localhost:${PUERTO}/admin.html`);
  console.log(`  Acceso:  http://localhost:${PUERTO}/login.html`);
  console.log(`  Landing: http://localhost:${PUERTO}/index.html\n`);
  console.log(
    LLAVE_ANTHROPIC
      ? "  /api/chat: activo (MediPost, MediDocs e insights de Analytics)"
      : "  /api/chat: SIN LLAVE — pon ANTHROPIC_API_KEY en .env.local"
  );
  console.log(
    process.env.ESCALACIONES_TOKEN
      ? "  /api/avisar: activo — llámalo a mano para vaciar la cola de escalaciones\n"
      : "  /api/avisar: SIN TOKEN — pon ESCALACIONES_TOKEN en .env.local\n"
  );
  console.log(`  Ctrl+C para detener.\n`);
});
