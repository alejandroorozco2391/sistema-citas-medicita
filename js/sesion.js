/* ═══════════════════════════════════════════════════════════════════════
   sesion.js — Gate de rol de MediCita

   ⚠️  ESTO NO ES SEGURIDAD.

   Es un control de acceso *de demostración*: el rol vive en localStorage,
   así que cualquiera con la consola del navegador abierta lo cambia en
   dos segundos. No protege datos.

   Su razón de existir es otra: crear la costura donde el auth real se va
   a enchufar cuando exista backend. El día que haya sesiones de verdad,
   se reescribe el cuerpo de estas funciones (leer una cookie httpOnly,
   validar un JWT contra el servidor) y quien las llama no se entera.

   Hasta entonces, toda página que llame a sesionRequiereRol() debe
   mostrar el aviso de sesionAvisoDemo() para no mentirle al usuario.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Constantes ──────────────────────────────────────────────────────── */
const CLAVE_SESION = "medicita_sesion";

const ROLES = {
  doctor: { id: "doctor", label: "Doctor(a)", icono: "🩺", desc: "Acceso clínico completo" },
  recepcionista: { id: "recepcionista", label: "Recepción", icono: "💁", desc: "Agenda y contacto con pacientes" },
  admin: { id: "admin", label: "Administrador", icono: "⚙️", desc: "Acceso total al sistema" },
};

const AVISO_DEMO =
  "Control de acceso de demostración: el rol se guarda en este navegador y " +
  "no protege información. La validación real llega con el backend.";

/* ─── Lectura / escritura ─────────────────────────────────────────────── */
function sesionActual() {
  try {
    const raw = localStorage.getItem(CLAVE_SESION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !ROLES[s.rol]) return null;
    return s;
  } catch {
    return null;
  }
}

function sesionRolActual() {
  const s = sesionActual();
  return s ? s.rol : null;
}

function sesionNombreActual() {
  const s = sesionActual();
  return s && s.nombre ? s.nombre : "";
}

/**
 * Inicia sesión con un rol. `nombre` es opcional y solo sirve para firmar
 * los mensajes que el staff envía desde el inbox.
 */
function sesionIniciar(rol, nombre) {
  if (!ROLES[rol]) throw new Error(`Rol desconocido: ${rol}`);
  const sesion = {
    rol,
    nombre: (nombre || "").trim() || ROLES[rol].label,
    iniciadaEn: new Date().toISOString(),
  };
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  return sesion;
}

function sesionCerrar() {
  localStorage.removeItem(CLAVE_SESION);
}

/* ─── Gate ────────────────────────────────────────────────────────────── */
/**
 * ¿El rol actual está en la lista permitida?
 * Sin sesión → false. La página decide qué hacer (mostrar el selector).
 */
function sesionRequiereRol(rolesPermitidos) {
  const rol = sesionRolActual();
  if (!rol) return false;
  return rolesPermitidos.includes(rol);
}

function sesionAvisoDemo() {
  return AVISO_DEMO;
}

function sesionRoles() {
  return Object.values(ROLES);
}

/* ─── Export dual: navegador (globals) + node (tests) ─────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CLAVE_SESION, ROLES, AVISO_DEMO,
    sesionActual, sesionRolActual, sesionNombreActual,
    sesionIniciar, sesionCerrar, sesionRequiereRol,
    sesionAvisoDemo, sesionRoles,
  };
}
