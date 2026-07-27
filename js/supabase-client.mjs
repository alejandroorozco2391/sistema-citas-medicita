/* ═══════════════════════════════════════════════════════════════════════
   supabase-client.js — Conexión con el backend

   Se carga por CDN como módulo ES, así que el proyecto sigue sin build
   step: ni npm ni bundler para el frontend, igual que hasta ahora.

   Sobre la anon key: es pública por diseño y va escrita en el HTML. No
   es un secreto y no protege nada — lo que protege son las políticas de
   RLS de la base de datos, que ya están probadas en tests/db-*.test.mjs.
   La que NUNCA debe aparecer aquí es la service role key: esa vive solo
   en variables de entorno de Vercel.

   Si no hay configuración, el sistema no truena: corre en modo local
   (localStorage), que es como funciona la demo pública.
   ═══════════════════════════════════════════════════════════════════════ */

const CDN_SUPABASE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ─── Configuración local de desarrollo (opcional, fuera del repo) ─────
   js/config-local.mjs está en .gitignore. Sirve para trabajar contra un
   proyecto real de Supabase desde la máquina propia sin que sus
   credenciales entren al repositorio.

   No es por ocultar la anon key —es pública por diseño y va escrita en
   el HTML de cualquier despliegue—. Es para que el repositorio, que
   además es la plantilla de la siguiente clínica, no venga apuntando a
   la base de datos de una clínica anterior. Ese error no sería una fuga:
   sería una clínica escribiendo en el expediente de otra.

   Solo se intenta en localhost, para que ningún despliegue real pida un
   archivo que nunca va a existir. */
let _configLocal = null;
if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  try {
    _configLocal = (await import("./config-local.mjs")).default ?? null;
  } catch {
    /* No existe, que es lo normal. Se sigue con las etiquetas <meta>. */
  }
}

/* ─── Configuración ───────────────────────────────────────────────────── */
/* En un despliegue se lee de <meta> en el HTML, para no tener que tocar
   JS al dar de alta una clínica nueva:

     <meta name="supabase-url"      content="https://xxxx.supabase.co">
     <meta name="supabase-anon-key" content="sb_publishable_...">

   Mientras las etiquetas traigan los valores de marcador (TU_...), el
   sistema corre en modo local — que es como debe seguir funcionando la
   demo pública de ventas.
*/
function leerConfig() {
  if (_configLocal?.url && _configLocal?.anonKey) return _configLocal;

  const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || "";
  const url = meta("supabase-url");
  const anonKey = meta("supabase-anon-key");

  /* Los marcadores no cuentan como configuración: si contaran, el
     cliente intentaría hablar con un host inventado y fallaría con un
     error de red en vez de caer limpiamente en modo local. */
  if (url.startsWith("TU_") || anonKey.startsWith("TU_")) return { url: "", anonKey: "" };

  return { url, anonKey };
}

export function hayBackendConfigurado() {
  const { url, anonKey } = leerConfig();
  return Boolean(url && anonKey);
}

/* ─── Cliente perezoso ────────────────────────────────────────────────── */
let _cliente = null;
let _cargando = null;

/**
 * Devuelve el cliente de Supabase, o null si este despliegue no tiene
 * backend configurado (caso de la demo pública).
 */
export async function obtenerCliente() {
  if (_cliente) return _cliente;
  if (!hayBackendConfigurado()) return null;
  if (_cargando) return _cargando;

  _cargando = (async () => {
    const { url, anonKey } = leerConfig();
    const { createClient } = await import(/* @vite-ignore */ CDN_SUPABASE);
    _cliente = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "medicita_auth",
      },
    });
    return _cliente;
  })();

  return _cargando;
}

/* ─── Modo de operación ───────────────────────────────────────────────── */
/**
 * "remoto" si hay backend Y sesión iniciada; "local" en cualquier otro
 * caso. Es el interruptor entre la demo pública y una clínica real.
 *
 * Que un visitante sin sesión caiga en modo local no es una laguna: sin
 * sesión, RLS no le daría un solo renglón de todas formas.
 */
export async function modoActual() {
  const cliente = await obtenerCliente();
  if (!cliente) return "local";
  const { data } = await cliente.auth.getSession();
  return data?.session ? "remoto" : "local";
}

export async function usuarioActual() {
  const cliente = await obtenerCliente();
  if (!cliente) return null;
  const { data } = await cliente.auth.getUser();
  return data?.user ?? null;
}
