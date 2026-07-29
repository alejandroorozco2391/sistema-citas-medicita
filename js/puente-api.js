/* ═══════════════════════════════════════════════════════════════════════
   puente-api.js — De los scripts clásicos al módulo de datos

   Los 9 módulos del sistema (admin.js, app.js, chat.js, pacientes.js…)
   son scripts clásicos: se cargan con <script src> y definen funciones
   globales. api.mjs es un módulo ES. Un script clásico no puede hacer
   `import`, así que hace falta una pieza que cruce esa frontera.

   Esto es esa pieza, y es lo único que la cruza. Publica en `window`:

     window.APIListo   — Promise que resuelve cuando la capa está lista
     window.API        — la superficie completa de api.mjs
     window.MODO_DATOS — "local" o "remoto", una vez resuelto APIListo

   ── Por qué es un script clásico y no un módulo ─────────────────────────
   Este archivo fue primero `puente-api.mjs`, con <script type="module">.
   Parecía correcto: los módulos son diferidos y corren antes de que se
   dispare DOMContentLoaded, que es donde arrancan los 9 módulos.

   Pero eso solo vale para módulos SIN `await` de nivel superior.
   supabase-client.mjs tiene uno —el que intenta cargar config-local.mjs—
   y un módulo suspendido en un await de nivel superior NO retrasa
   DOMContentLoaded: el evento se dispara sin esperarlo. El resultado era
   que cada módulo arrancaba con `window.API` todavía sin definir y
   reventaba con "API is not defined", dejando la página a medio pintar y
   sin un solo manejador de eventos registrado.

   Y la guardia `await window.APIListo` tampoco ayudaba: en ese instante
   `window.APIListo` era `undefined`, y `await undefined` resuelve de
   inmediato. La red de seguridad tenía el hueco justo donde hacía falta.

   Siendo un script clásico y sin `defer`, este archivo se ejecuta de
   forma síncrona durante el parseo, ANTES que admin.js y compañía. Eso
   garantiza que `window.APIListo` ya sea una Promise de verdad cuando
   alguien la espere. La carga del módulo se hace con `import()` dinámico,
   que sí está permitido desde un script clásico.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  /* La ruta se resuelve contra este archivo, no contra el documento, para
     que el sistema siga funcionando si algún día se despliega bajo un
     subdirectorio en vez de la raíz del dominio. */
  var base = document.currentScript.src;

  window.APIListo = import(new URL("./api.mjs", base).href)
    .then(function (api) {
      /* La lista es explícita a propósito: es la superficie que el sistema
         expone a los scripts clásicos, y se lee de un vistazo.
         Su precio es que se puede olvidar un namespace nuevo, y entonces
         `window.API.loQueSea` sale `undefined` y el módulo revienta con un
         mensaje que no dice nada ("No se pudo cargar el horario"). Ya pasó.
         Por eso hay una prueba que compara esta lista contra los `export
         const` de api.mjs y falla si alguna se queda fuera. */
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
        horarios:       api.horarios,
        escalaciones:   api.escalaciones,
        publico:        api.publico,
        modo:           api.modo,
      };

      /* Lo que de verdad importa de esperar aquí no es tener el objeto
         —ese ya está— sino saber si detrás hay una clínica real, porque
         hay decisiones que dependen de eso. La siembra de datos de
         demostración es la principal: contra una base de producción
         metería pacientes inventados a un expediente de verdad. */
      return api.modo().then(function (m) {
        window.MODO_DATOS = m;
        return window.API;
      });
    })
    .catch(function (e) {
      /* Si averiguar el modo falla (red caída, configuración a medias), lo
         seguro es local: nunca escribir en una base que no sabemos si es
         la correcta. */
      console.error("[puente-api] No se pudo cargar la capa de datos:", e);
      window.MODO_DATOS = "local";
      return window.API;
    });
})();
