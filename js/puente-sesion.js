/* ═══════════════════════════════════════════════════════════════════════
   puente-sesion.js — De los scripts clásicos a la sesión

   Mismo papel que puente-api.js, pero para js/sesion.mjs. Existe porque
   conversaciones.js es un script clásico y no puede hacer `import`.

   Publica `window.Sesion` con la superficie que el inbox necesita, y
   `window.SesionLista`, que resuelve con el perfil ya averiguado —
   averiguarlo requiere preguntarle a Supabase, y eso es asíncrono.

   Es un script clásico por la misma razón que puente-api.js: así
   `window.SesionLista` ya es una Promise de verdad cuando el manejador de
   DOMContentLoaded del inbox la espera. Ver el comentario largo de aquel
   archivo — el problema del `await` de nivel superior es idéntico.

   Ojo con una diferencia de forma respecto al viejo js/sesion.js: allá
   `sesionRolActual()` devolvía el rol de inmediato porque salía de
   localStorage. Aquí devuelve una Promise. Quien lo llame tiene que
   esperarla.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  var base = document.currentScript.src;

  window.SesionLista = import(new URL("./sesion.mjs", base).href)
    .then(function (s) {
      window.Sesion = {
        ROLES:        s.ROLES,
        perfil:       s.sesionPerfil,
        rolActual:    s.sesionRolActual,
        nombreActual: s.sesionNombreActual,
        clinicaId:    s.sesionClinicaId,
        requiereRol:  s.sesionRequiereRol,
        iniciarDemo:  s.sesionIniciarDemo,
        cerrar:       s.sesionCerrar,
        esDemo:       s.sesionEsDemo,
        avisoDemo:    s.sesionAvisoDemo,
        roles:        s.sesionRoles,
        exigirAcceso: s.sesionExigirAcceso,
      };

      return s.sesionPerfil().then(function (p) {
        window.PERFIL_ACTUAL = p;
        return p;
      });
    })
    .catch(function (e) {
      console.error("[puente-sesion] No se pudo resolver el perfil:", e);
      window.PERFIL_ACTUAL = null;
      return null;
    });
})();
