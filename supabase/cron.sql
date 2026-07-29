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
--
-- SOLO SE EDITA EL BLOQUE "DATOS A LLENAR". Correrlo dos veces es inocuo:
-- desprograma antes de programar.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  DATOS A LLENAR — cambia solo estas dos líneas                    ║
  -- ╚═══════════════════════════════════════════════════════════════════╝

  -- La URL de ESTE despliegue, con /api/avisar al final.
  v_url_avisar text := 'https://TU-CLINICA.vercel.app/api/avisar';

  -- El MISMO valor que pusiste en ESCALACIONES_TOKEN en Vercel.
  -- Si no coinciden, /api/avisar contesta 401 y los correos nunca salen.
  v_token      text := 'EL_MISMO_ESCALACIONES_TOKEN_DE_VERCEL';

  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  De aquí para abajo no se toca                                    ║
  -- ╚═══════════════════════════════════════════════════════════════════╝
begin

  if v_url_avisar like '%TU-CLINICA%' or v_token like 'EL_MISMO_%' then
    raise exception 'Falta llenar el bloque DATOS A LLENAR de arriba';
  end if;

  -- Desprogramar primero hace que correr esto dos veces sea inocuo, y que
  -- cambiar la URL o el token sea volver a pegarlo en vez de acordarse de
  -- borrar el trabajo viejo a mano.
  perform cron.unschedule('medicita-promover-escalaciones')
    where exists (select 1 from cron.job where jobname = 'medicita-promover-escalaciones');
  perform cron.unschedule('medicita-vaciar-avisos')
    where exists (select 1 from cron.job where jobname = 'medicita-vaciar-avisos');

  -- ─── 1. La escalera ──────────────────────────────────────────────────
  -- Cada minuto. Es barato: recorre solo las que ya vencieron, con un
  -- índice parcial hecho para eso.
  perform cron.schedule(
    'medicita-promover-escalaciones',
    '* * * * *',
    'select public.promover_escalaciones();'
  );

  -- ─── 2. Vaciar la bandeja de avisos ──────────────────────────────────
  -- pg_net solo toca el timbre: manda el token y nada más. Toda la lógica
  -- de armar y enviar el correo vive en api/avisar.js, donde se puede leer
  -- y arreglar sin migrar la base.
  perform cron.schedule(
    'medicita-vaciar-avisos',
    '* * * * *',
    format(
      'select net.http_post(url := %L, headers := %L::jsonb);',
      v_url_avisar,
      json_build_object(
        'Content-Type',     'application/json',
        'x-medicita-token', v_token
      )::text
    )
  );

  raise notice 'Listo. Los dos trabajos quedaron programados cada minuto.';
end $$;


-- ─── Comprobación 1: ¿están programados? ───────────────────────────────
-- Deben salir DOS renglones, los dos con active = true.
select jobname, schedule, active
from cron.job
where jobname like 'medicita-%';


-- ─── Comprobación 2: ¿corrieron sin error? ─────────────────────────────
-- Espera un minuto y corre esto. `status` debe decir 'succeeded'.
-- Si dice 'failed', el mensaje explica por qué.
select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname like 'medicita-%'
order by r.start_time desc
limit 10;


-- ─── Para desactivarlos ────────────────────────────────────────────────
-- select cron.unschedule('medicita-promover-escalaciones');
-- select cron.unschedule('medicita-vaciar-avisos');
