/* ═══════════════════════════════════════════════════════════════════════
   puente-api.mjs — De los scripts clásicos al módulo de datos

   Los 9 módulos del sistema (admin.js, app.js, chat.js, pacientes.js…)
   son scripts clásicos: se cargan con <script src> y definen funciones
   globales. api.mjs es un módulo ES. Un script clásico no puede hacer
   `import`, así que hace falta una pieza que cruce esa frontera.

   Esto es esa pieza, y es lo único que la cruza. Publica en `window`:

     window.API        — la superficie completa de api.mjs
     window.APIListo   — Promise que resuelve cuando el modo ya se sabe
     window.MODO_DATOS — "local" o "remoto", una vez resuelto APIListo

   ── Sobre el orden de carga ─────────────────────────────────────────────
   <script type="module"> es diferido: corre después de que los scripts
   clásicos se ejecutaron, pero ANTES de que se dispare DOMContentLoaded,
   que es donde los 9 módulos arrancan. Así que para cuando algo necesite
   `window.API`, ya existe.

   Aun así, cada módulo abre su rutina de arranque con:

       await window.APIListo;

   No es por desconfianza del orden: es porque saber el modo requiere
   preguntarle a Supabase si hay sesión, y eso sí es asíncrono de verdad.
   Sin ese await, un módulo podría sembrar datos de demostración creyendo
   que está en local cuando en realidad tiene una clínica de verdad
   detrás.
   ═══════════════════════════════════════════════════════════════════════ */

import * as api from "./api.mjs";

window.API = {
  clinica:        api.clinica,
  pacientes:      api.pacientes,
  citas:          api.citas,
  conversaciones: api.conversaciones,
  mensajes:       api.mensajes,
  documentos:     api.documentos,
  posts:          api.posts,
  nps:            api.nps,
  seguimientos:   api.seguimientos,
  publico:        api.publico,
  modo:           api.modo,
};

/* Se resuelve con el modo ya averiguado. Lo que importa de esperar aquí
   no es tener el objeto —ese ya está— sino saber si detrás hay una
   clínica real, porque hay decisiones que dependen de eso. */
window.APIListo = (async () => {
  try {
    window.MODO_DATOS = await api.modo();
  } catch (e) {
    /* Si averiguar el modo falla (red caída, configuración a medias), lo
       seguro es local: nunca escribir en una base que no sabemos si es
       la correcta. */
    console.warn("[puente-api] No se pudo determinar el modo, se asume local:", e);
    window.MODO_DATOS = "local";
  }
  return window.API;
})();
