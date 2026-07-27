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

   ⚠️ js/sesion.js sigue existiendo mientras el inbox no migre a esta
   capa. Cuando eso pase (B2), aquel archivo se borra.
   ═══════════════════════════════════════════════════════════════════════ */

import { obtenerCliente, hayBackendConfigurado } from "./supabase-client.mjs";

export const ROLES = {
  doctor: { id: "doctor", label: "Doctor(a)", icono: "🩺", desc: "Acceso clínico completo" },
  recepcionista: { id: "recepcionista", label: "Recepción", icono: "💁", desc: "Agenda y contacto con pacientes" },
  admin: { id: "admin", label: "Administrador", icono: "⚙️", desc: "Acceso total al sistema" },
};

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
  if (!hayBackendConfigurado()) return null;

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
  const cliente = await obtenerCliente();
  _perfil = null;
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
