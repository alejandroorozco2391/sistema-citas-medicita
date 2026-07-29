/* ═══════════════════════════════════════════════════════════════════════
   sesion.mjs — Autenticación real contra Supabase Auth

   Sustituye a js/sesion.js, que era deliberadamente teatro: guardaba el
   rol en localStorage y cualquiera lo cambiaba desde la consola.

   Conserva a propósito los mismos nombres de función que aquel
   (sesionRolActual, sesionRequiereRol…). Esa costura se dejó puesta
   justo para este momento: quien las llama no tiene que enterarse de que
   ahora hay un backend detrás.

   Diferencia de fondo: aquí el rol ya no es una preferencia del
   navegador, es una fila de perfiles_staff protegida por RLS. Mentir
   sobre el rol en el cliente no sirve de nada — la base no le cree.

   ── Modo demostración ───────────────────────────────────────────────────
   Cuando el despliegue no tiene backend configurado —la demo pública de
   ventas— no hay contra qué autenticarse, pero el sistema tiene que
   seguir siendo clicable por cualquiera. En ese caso estas funciones
   caen en un perfil de demostración que se guarda en localStorage, y
   todo lo que dependa de él queda marcado con `esDemo: true`.

   Eso es lo que antes hacía js/sesion.js por su cuenta, y por eso aquel
   archivo ya no existe: había dos sistemas de sesión conviviendo, que es
   exactamente el estado híbrido que B2 vino a eliminar.

   El aviso de sesionAvisoDemo() debe seguir visible mientras `esDemo`
   sea verdadero. No es decoración: sin backend, el rol es una
   preferencia del navegador y no protege absolutamente nada.
   ═══════════════════════════════════════════════════════════════════════ */

import { obtenerCliente, hayBackendConfigurado } from "./supabase-client.mjs";

export const ROLES = {
  doctor: { id: "doctor", label: "Doctor(a)", icono: "🩺", desc: "Acceso clínico completo" },
  recepcionista: { id: "recepcionista", label: "Recepción", icono: "💁", desc: "Agenda y contacto con pacientes" },
  admin: { id: "admin", label: "Administrador", icono: "⚙️", desc: "Acceso total al sistema" },
};

const CLAVE_SESION_DEMO = "medicita_sesion";

const AVISO_DEMO =
  "Control de acceso de demostración: el rol se guarda en este navegador y " +
  "no protege información. La validación real llega con el backend.";

/** ¿Este despliegue corre sin backend? Entonces la sesión es de mentiras. */
export function sesionEsDemo() {
  return !hayBackendConfigurado();
}

export function sesionAvisoDemo() {
  return AVISO_DEMO;
}

/* ─── Sesión de demostración ──────────────────────────────────────────── */
function perfilDemoGuardado() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION_DEMO) || "null");
    if (!s || !ROLES[s.rol]) return null;
    return {
      id: `DEMO-${s.rol}`,
      usuarioId: `DEMO-${s.rol}`,
      clinicaId: null,
      nombre: s.nombre || ROLES[s.rol].label,
      rol: s.rol,
      email: "",
      esDemo: true,
    };
  } catch {
    return null;
  }
}

/**
 * Elige rol en modo demostración. Falla a propósito si hay backend: ahí
 * la única forma de entrar es sesionIniciar() con credenciales de verdad.
 */
export function sesionIniciarDemo(rol, nombre) {
  if (!sesionEsDemo()) {
    throw new Error("Este despliegue tiene backend: hay que iniciar sesión desde login.html");
  }
  if (!ROLES[rol]) throw new Error(`Rol desconocido: ${rol}`);

  const sesion = {
    rol,
    nombre: String(nombre || "").trim() || ROLES[rol].label,
    iniciadaEn: new Date().toISOString(),
  };
  localStorage.setItem(CLAVE_SESION_DEMO, JSON.stringify(sesion));
  _perfil = null;
  return perfilDemoGuardado();
}

/* ─── Perfil en memoria ───────────────────────────────────────────────── */
/* No se cachea en localStorage: el rol tiene que venir de la base en cada
   carga. Guardarlo en el navegador sería reinventar el problema anterior. */
let _perfil = null;

/**
 * Perfil del usuario autenticado, o null si no hay sesión.
 * { id, usuarioId, clinicaId, nombre, rol, email }
 */
export async function sesionPerfil() {
  if (_perfil) return _perfil;

  /* Sin backend, el perfil sale de la elección de rol de la demo. Puede
     ser null si el visitante todavía no eligió: la página muestra el
     selector, igual que antes. */
  if (sesionEsDemo()) {
    _perfil = perfilDemoGuardado();
    return _perfil;
  }

  const cliente = await obtenerCliente();
  const { data: sesion } = await cliente.auth.getSession();
  if (!sesion?.session) return null;

  const { data, error } = await cliente
    .from("perfiles_staff")
    .select("id, usuario_id, clinica_id, nombre, rol, activo")
    .eq("usuario_id", sesion.session.user.id)
    .maybeSingle();

  if (error || !data || !data.activo) return null;

  _perfil = {
    id: data.id,
    usuarioId: data.usuario_id,
    clinicaId: data.clinica_id,
    nombre: data.nombre,
    rol: data.rol,
    email: sesion.session.user.email,
  };
  return _perfil;
}

export async function sesionRolActual() {
  return (await sesionPerfil())?.rol ?? null;
}

export async function sesionNombreActual() {
  return (await sesionPerfil())?.nombre ?? "";
}

export async function sesionClinicaId() {
  return (await sesionPerfil())?.clinicaId ?? null;
}

/**
 * ¿El usuario tiene alguno de estos roles?
 *
 * Ojo con lo que esto es y lo que no: sirve para decidir qué mostrar. La
 * protección de verdad son las políticas de RLS. Si alguien manipula el
 * cliente para saltarse esta comprobación, la base le sigue negando los
 * datos — eso es lo que prueba tests/db-aislamiento.test.mjs.
 */
export async function sesionRequiereRol(rolesPermitidos) {
  const rol = await sesionRolActual();
  return rol ? rolesPermitidos.includes(rol) : false;
}

/* ─── Traducción de errores de autenticación ──────────────────────────── */
/* Supabase responde en inglés y con jerga. Recepción no tiene por qué
   descifrar "Email not confirmed": ese caso concreto no se arregla
   cambiando la contraseña, sino confirmando la cuenta, y si el mensaje
   no lo dice, la persona va a intentar lo que no es. */
function traducirErrorAuth(error) {
  const codigo = error?.code || error?.error_code || "";
  const texto = error?.message || "";

  if (codigo === "invalid_credentials" || /invalid login|credentials/i.test(texto)) {
    return "Correo o contraseña incorrectos.";
  }
  if (codigo === "email_not_confirmed" || /not confirmed/i.test(texto)) {
    return "Tu cuenta existe pero el correo no está confirmado. Pide al administrador que la confirme.";
  }
  if (codigo === "over_request_rate_limit" || /rate limit/i.test(texto)) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  }
  if (codigo === "same_password" || /should be different/i.test(texto)) {
    return "La contraseña nueva tiene que ser distinta de la actual.";
  }
  if (codigo === "weak_password" || /at least|password should be/i.test(texto)) {
    return "La contraseña es demasiado corta. Usa al menos 6 caracteres.";
  }
  if (/expired|invalid.*token/i.test(texto)) {
    return "El enlace ya venció. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.";
  }
  return `No se pudo completar la operación: ${texto}`;
}

/* ─── Entrar y salir ──────────────────────────────────────────────────── */
export async function sesionIniciar(email, contrasena) {
  const cliente = await obtenerCliente();
  if (!cliente) throw new Error("Este despliegue no tiene backend configurado");

  const { data, error } = await cliente.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: contrasena,
  });

  if (error) throw new Error(traducirErrorAuth(error));

  _perfil = null;
  const perfil = await sesionPerfil();

  if (!perfil) {
    // Cuenta válida sin perfil activo: no debe quedarse a medias dentro.
    await cliente.auth.signOut();
    throw new Error(
      "Tu cuenta no tiene acceso a ninguna clínica. Pide al administrador que te dé de alta."
    );
  }

  return perfil;
}

export async function sesionCerrar() {
  _perfil = null;

  if (sesionEsDemo()) {
    localStorage.removeItem(CLAVE_SESION_DEMO);
    return;
  }

  const cliente = await obtenerCliente();
  if (cliente) await cliente.auth.signOut();
}

export async function sesionRecuperarContrasena(email, urlRetorno) {
  const cliente = await obtenerCliente();
  if (!cliente) throw new Error("Este despliegue no tiene backend configurado");
  const { error } = await cliente.auth.resetPasswordForEmail(String(email || "").trim(), {
    redirectTo: urlRetorno || `${location.origin}/login.html`,
  });
  if (error) throw new Error(traducirErrorAuth(error));
  return true;
}

/**
 * Fija una contraseña nueva para la sesión en curso.
 *
 * Se usa en dos momentos: al volver del enlace de recuperación (donde el
 * propio enlace ya dejó una sesión abierta) y desde el panel, si algún
 * día se agrega "cambiar mi contraseña".
 */
export async function sesionCambiarContrasena(nueva) {
  const cliente = await obtenerCliente();
  if (!cliente) throw new Error("Este despliegue no tiene backend configurado");

  if (String(nueva || "").length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

  const { error } = await cliente.auth.updateUser({ password: nueva });
  if (error) throw new Error(traducirErrorAuth(error));

  _perfil = null;
  return true;
}

/**
 * Redirige a login.html si no hay sesión con alguno de los roles pedidos.
 * Devuelve el perfil si sí la hay.
 */
export async function sesionProtegerPagina(rolesPermitidos = ["doctor", "recepcionista", "admin"]) {
  const perfil = await sesionPerfil();
  if (!perfil || !rolesPermitidos.includes(perfil.rol)) {
    const destino = encodeURIComponent(location.pathname + location.search);
    location.replace(`login.html?destino=${destino}`);
    return null;
  }
  return perfil;
}

export function sesionRoles() {
  return Object.values(ROLES);
}

/**
 * Guardia para las páginas de personal (panel, MediPost, MediDocs, inbox).
 *
 * La diferencia con `sesionProtegerPagina()` es el modo demostración: allá
 * la ausencia de perfil siempre manda a login, y aquí no, porque la demo
 * pública tiene que seguir siendo clicable sin registrarse.
 *
 * Lo que cierra es un hueco real: sin esto, alguien de recepción que abra
 * el panel sin haber iniciado sesión en una clínica de verdad lo ve
 * arrancar en modo local. La pantalla se ve completa y vacía, y todo lo
 * que capture se guarda en su navegador en vez de en la clínica. Pensaría
 * que perdió los expedientes.
 *
 * Devuelve `true` si se puede seguir; si redirige, devuelve `false` y
 * quien llama debe abortar su arranque.
 */
export async function sesionExigirAcceso() {
  if (sesionEsDemo()) return true;

  const perfil = await sesionPerfil();
  if (perfil) return true;

  const destino = encodeURIComponent(location.pathname.split("/").pop() + location.search);
  location.replace(`login.html?destino=${destino}`);
  return false;
}
