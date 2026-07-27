/* ═══════════════════════════════════════════════════════════════════════
   puente-sesion.mjs — De los scripts clásicos a la sesión

   Mismo papel que puente-api.mjs, pero para js/sesion.mjs. Existe porque
   conversaciones.js es un script clásico y no puede hacer `import`.

   Publica `window.Sesion` con la superficie que el inbox necesita, y
   `window.SesionLista`, que resuelve con el perfil ya averiguado —
   averiguarlo requiere preguntarle a Supabase, y eso es asíncrono.

   Ojo con una diferencia de forma respecto al viejo js/sesion.js: allá
   `sesionRolActual()` devolvía el rol de inmediato porque salía de
   localStorage. Aquí devuelve una Promise. Quien lo llame tiene que
   esperarla.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  ROLES,
  sesionPerfil,
  sesionRolActual,
  sesionNombreActual,
  sesionClinicaId,
  sesionRequiereRol,
  sesionIniciarDemo,
  sesionCerrar,
  sesionEsDemo,
  sesionAvisoDemo,
  sesionRoles,
} from "./sesion.mjs";

window.Sesion = {
  ROLES,
  perfil: sesionPerfil,
  rolActual: sesionRolActual,
  nombreActual: sesionNombreActual,
  clinicaId: sesionClinicaId,
  requiereRol: sesionRequiereRol,
  iniciarDemo: sesionIniciarDemo,
  cerrar: sesionCerrar,
  esDemo: sesionEsDemo,
  avisoDemo: sesionAvisoDemo,
  roles: sesionRoles,
};

window.SesionLista = (async () => {
  try {
    window.PERFIL_ACTUAL = await sesionPerfil();
  } catch (e) {
    console.warn("[puente-sesion] No se pudo resolver el perfil:", e);
    window.PERFIL_ACTUAL = null;
  }
  return window.PERFIL_ACTUAL;
})();
