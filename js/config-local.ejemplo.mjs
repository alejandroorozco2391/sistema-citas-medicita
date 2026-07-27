/* ═══════════════════════════════════════════════════════════════════════
   Plantilla de configuración local.

   Cópiala como  js/config-local.mjs  (ese nombre está en .gitignore) y
   pon las credenciales del proyecto de Supabase contra el que quieras
   trabajar desde tu máquina.

   Solo se carga en localhost. Un despliegue real toma sus credenciales
   de las etiquetas <meta> del HTML — ver docs/nueva-clinica.md, paso 5.

   Si este archivo no existe, el sistema corre en modo local
   (localStorage), que es exactamente como debe funcionar la demo
   pública. No es un error.

   Sobre la llave: va la PUBLISHABLE (sb_publishable_…), que es pública
   por diseño. La SECRET (sb_secret_…) jamás — se salta RLS por completo
   y vive únicamente en variables de entorno de Vercel.
   ═══════════════════════════════════════════════════════════════════════ */

export default {
  url: "https://TU_PROYECTO.supabase.co",
  anonKey: "sb_publishable_TU_LLAVE",
};
