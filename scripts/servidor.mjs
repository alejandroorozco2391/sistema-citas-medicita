/* ═══════════════════════════════════════════════════════════════════════
   Servidor estático para desarrollo.

   Existe por una razón concreta: los archivos .mjs son módulos ES, y el
   navegador rechaza importarlos bajo file:// (origen opaco). Abrir
   login.html con doble clic hace que el <script type="module"> nunca
   corra — el formulario entonces se envía de forma nativa, la página se
   recarga y parece que "no pasa nada".

   El resto del proyecto sigue sin build step: esto solo sirve archivos
   tal cual, no compila nada.

   Uso:  npm run dev
   ═══════════════════════════════════════════════════════════════════════ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PUERTO || 5173);

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

const servidor = http.createServer((peticion, respuesta) => {
  const url = new URL(peticion.url, `http://localhost:${PUERTO}`);
  let relativa = decodeURIComponent(url.pathname);
  if (relativa === "/") relativa = "/index.html";

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
  console.log(`  Ctrl+C para detener.\n`);
});
