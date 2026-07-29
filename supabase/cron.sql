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
  v_url_avisar text := 'https://sistema-citas-medicita.vercel.app/api/avisar';

  -- El MISMO valor que pusiste en ESCALACIONES_TOKEN en Vercel.
  -- Si no coinciden, /api/avisar contesta 401 y los correos nunca salen.
  v_token      text := '2d0e84ea1a4e49fabcd3a3c4dbbeb31f2ce452ae589a4ef497fc1393c2d387d1';

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

  -- ─── 3. Barrer la bitácora del propio cron ───────────────────────────
  -- pg_cron escribe un renglón en cron.job_run_details por CADA corrida y
  -- no los borra nunca. Dos trabajos cada minuto son 2,880 renglones al
  -- día y cerca de un millón al año. En un proyecto chico eso se nota, y
  -- el síntoma aparecería meses después sin relación aparente con nada.
  --
  -- Se conservan 7 días: suficiente para diagnosticar "¿por qué no salió
  -- el aviso del martes?" y nada más.
  perform cron.unschedule('medicita-barrer-bitacora')
    where exists (select 1 from cron.job where jobname = 'medicita-barrer-bitacora');

  perform cron.schedule(
    'medicita-barrer-bitacora',
    '17 3 * * *',   -- 3:17 de la mañana; a esa hora no compite con nada
    $limpia$
      delete from cron.job_run_details
      where end_time < now() - interval '7 days';
    $limpia$
  );

  raise notice 'Listo. Los tres trabajos quedaron programados.';
end $$;


-- ─── Comprobación 1: ¿están programados? ───────────────────────────────
-- Deben salir TRES renglones, todos con active = true.
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


-- ─── Cuánto ha crecido la bitácora ─────────────────────────────────────
-- Si esto pasa de unos 20 mil renglones, el barrido no está corriendo.
select count(*) as renglones_de_bitacora from cron.job_run_details;


-- ─── Para desactivarlos ────────────────────────────────────────────────
-- select cron.unschedule('medicita-promover-escalaciones');
-- select cron.unschedule('medicita-vaciar-avisos');
-- select cron.unschedule('medicita-barrer-bitacora');
