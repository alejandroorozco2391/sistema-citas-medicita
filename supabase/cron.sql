-- ═══════════════════════════════════════════════════════════════════════
-- El reloj de las escalaciones
--
-- Esto es lo que hace que la re-alerta signifique algo: la única pieza
-- del sistema que trabaja con todos los navegadores cerrados. Un paciente
-- que pidió un humano a las 11 de la noche no puede depender de que
-- alguien tenga el panel abierto.
--
-- Va aparte de las migraciones a propósito. `pg_cron` y `pg_net` son
-- extensiones que hay que habilitar a mano en el panel de Supabase, y una
-- migración que las diera por hechas no se podría probar contra un
-- Postgres pelón — que es como corren tests/db-*.test.mjs.
--
-- ── Antes de pegar esto ────────────────────────────────────────────────
-- 1. Panel de Supabase → Database → Extensions → habilita `pg_cron` y
--    `pg_net`.
-- 2. Despliega la clínica en Vercel con estas variables de entorno:
--       ESCALACIONES_TOKEN            (invéntala, larga y al azar)
--       SUPABASE_URL
--       SUPABASE_SERVICE_ROLE_KEY     (la sb_secret_…, solo aquí)
--       EMAILJS_SERVICE_ID
--       EMAILJS_TEMPLATE_ID_ESCALACION
--       EMAILJS_PUBLIC_KEY
--       EMAILJS_PRIVATE_KEY
-- 3. Cambia las DOS líneas de abajo y pega todo en el editor SQL.
-- ═══════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  DATOS A LLENAR — cambia solo estas dos líneas                    ║
-- ╚═══════════════════════════════════════════════════════════════════╝
\set url_avisar  'https://TU-CLINICA.vercel.app/api/avisar'
\set token       'EL_MISMO_ESCALACIONES_TOKEN_DE_VERCEL'

-- ── Si el editor del panel no soporta \set (es psql), usa esta variante:
--    borra las dos líneas de arriba y sustituye a mano las dos apariciones
--    marcadas con «⟵ AQUÍ» más abajo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── 1. La escalera ────────────────────────────────────────────────────
-- Cada minuto. Es barato: recorre solo las que ya vencieron, con un
-- índice parcial hecho para eso.
select cron.schedule(
  'medicita-promover-escalaciones',
  '* * * * *',
  $$ select public.promover_escalaciones(); $$
);

-- ─── 2. Vaciar la bandeja de avisos ────────────────────────────────────
-- pg_net solo toca el timbre: manda el token y nada más. Toda la lógica
-- de armar y enviar el correo vive en api/avisar.js, donde se puede leer
-- y arreglar sin migrar la base.
select cron.schedule(
  'medicita-vaciar-avisos',
  '* * * * *',
  format(
    $$ select net.http_post(
         url     := %L,
         headers := jsonb_build_object(
                      'Content-Type',     'application/json',
                      'x-medicita-token', %L)
       ); $$,
    :'url_avisar',   -- ⟵ AQUÍ: 'https://TU-CLINICA.vercel.app/api/avisar'
    :'token'         -- ⟵ AQUÍ: 'EL_MISMO_ESCALACIONES_TOKEN_DE_VERCEL'
  )
);


-- ─── Comprobación ──────────────────────────────────────────────────────
-- Deben aparecer los dos, con active = true.
select jobname, schedule, active from cron.job
where jobname like 'medicita-%';

-- Y después de un minuto, que hayan corrido sin error:
select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname like 'medicita-%'
order by r.start_time desc
limit 10;


-- ─── Para desactivarlos ────────────────────────────────────────────────
-- select cron.unschedule('medicita-promover-escalaciones');
-- select cron.unschedule('medicita-vaciar-avisos');
