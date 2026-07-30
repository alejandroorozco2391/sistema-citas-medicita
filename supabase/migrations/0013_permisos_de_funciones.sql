-- ═══════════════════════════════════════════════════════════════════════
-- 0013 — Las funciones que nadie debería alcanzar
--
-- Desde 0006 los permisos se escribieron así:
--
--     revoke all on function public.lo_que_sea from public;
--     grant execute on function public.lo_que_sea to authenticated;
--
-- Y no servía de nada. `revoke ... from public` quita el permiso del
-- pseudo-rol PUBLIC, pero en Supabase toda función nueva de `public` nace
-- con EXECUTE concedido DIRECTAMENTE a `anon` y `authenticated`, por las
-- default privileges del proyecto. Un permiso concedido a `anon` no se
-- quita revocándoselo a PUBLIC.
--
-- Resultado real, medido: `anon` podía ejecutar las 29 funciones del
-- esquema. La mayoría es inofensiva —son SECURITY INVOKER y RLS las
-- contiene, o solo devuelven null sin sesión— pero dos no lo eran:
--
--   · `encolar_aviso_escalacion(id, motivo)` es SECURITY DEFINER y encola
--     correo. La anon key va escrita en el HTML de la landing, así que
--     cualquiera podía llamarla en bucle y vaciar la cuota de EmailJS de
--     la clínica, mandándole basura a su propio personal.
--
--   · `promover_escalaciones()` es SECURITY DEFINER y escribe: sube
--     niveles, marca `vencida` y toca conversaciones. Es del reloj, y el
--     reloj es pg_cron.
--
-- Esta migración cierra eso y fija la convención. De aquí en adelante:
-- revocar de PUBLIC, de `anon` y de `authenticated`, y después conceder a
-- quien de verdad la necesita. tests/db-permisos.test.mjs recorre el
-- esquema entero y falla si aparece una función nueva sin decidir a qué
-- lado pertenece.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Del reloj, y de nadie más ─────────────────────────────────────────
-- pg_cron corre como dueño de la base, así que no necesita concesión: por
-- eso estas dos pueden quedarse sin un solo rol con permiso.
revoke all on function public.promover_escalaciones()          from public, anon, authenticated;
revoke all on function public.encolar_aviso_escalacion(uuid, text) from public, anon, authenticated;

-- ─── Del personal con sesión ───────────────────────────────────────────
-- Ninguna es un agujero por sí sola —son SECURITY INVOKER y RLS decide—
-- pero ofrecerle al visitante una función para reescribir el horario de la
-- clínica es exactamente el error que ya cometimos con las herramientas de
-- MediBot: que la base lo frene no vuelve correcto ofrecerlo.
revoke all on function public.guardar_horario_base(jsonb)                  from public, anon;
revoke all on function public.citas_afectadas_por_cierre(date, time, time) from public, anon;
revoke all on function public.horario_del_dia(uuid, date, uuid)            from public, anon;
revoke all on function public.en_horario(uuid, timestamptz)                from public, anon;
revoke all on function public.proxima_apertura(uuid, timestamptz)          from public, anon;
revoke all on function public.horario_texto(uuid)                          from public, anon;
revoke all on function public.escalacion_reconocer(uuid)                   from public, anon;
revoke all on function public.escalacion_resolver(uuid, text)              from public, anon;
revoke all on function public.rutear_escalacion(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.horas_ocupadas(text, date)                   from public, anon;
revoke all on function public.slot_ocupado(uuid, text, date, text, uuid)   from public, anon;

-- 0006 ya decía que estas dos eran "solo para usuarios con sesión". Ahora
-- lo es de verdad.
revoke all on function public.clinica_actual() from public, anon;
revoke all on function public.rol_actual()     from public, anon;

-- Detalle interno de las funciones SECURITY DEFINER que la llaman. Una
-- función DEFINER corre con los permisos de su dueño, así que quitarle el
-- acceso a `anon` no rompe a `solicitar_cita` ni a `escalar_a_humano`.
revoke all on function public.clinica_unica()                     from public, anon;
revoke all on function public.fecha_en_palabras(timestamptz, text) from public, anon;
revoke all on function public.generar_folio_cita()                from public, anon;
revoke all on function public.generar_codigo_paciente()           from public, anon;

-- ─── Funciones de disparador ───────────────────────────────────────────
-- Llamarlas fuera de un disparador falla de todas formas, pero no tienen
-- por qué estar ofrecidas.
revoke all on function public.tocar_actualizado_en()             from public, anon, authenticated;
revoke all on function public.sincronizar_resumen_conversacion() from public, anon, authenticated;

-- ═══ Lo que el visitante sin cuenta SÍ debe alcanzar ═══════════════════
-- Se vuelve a conceder explícitamente, para que esta lista quede escrita
-- en un solo lugar y se pueda leer de corrido. Son seis puertas y cada una
-- valida por dentro:
--
--   solicitar_cita          pedir cita desde la landing
--   responder_encuesta      contestar el NPS con el folio como credencial
--   encuesta_ya_respondida  la pantalla previa de la encuesta
--   horario_disponible      no ofrecer un día en que el consultorio cierra
--   horas_ocupadas_publico  no ofrecer una hora ya tomada
--   escalar_a_humano        pedir una persona sin tener cuenta
grant execute on function public.solicitar_cita(
  text, text, text, text, text, text, date, text, text, text, boolean, text, text, uuid
) to anon, authenticated;
grant execute on function public.responder_encuesta(text, smallint, text) to anon, authenticated;
grant execute on function public.encuesta_ya_respondida(text)             to anon, authenticated;
grant execute on function public.horario_disponible(date, date, uuid)     to anon, authenticated;
grant execute on function public.horas_ocupadas_publico(text, date, uuid) to anon, authenticated;
grant execute on function public.escalar_a_humano(
  text, text, text, text, text, text, text, uuid, uuid
) to anon, authenticated;

-- Normalizadores puros: cero acceso a datos, y los necesita el motor para
-- evaluar las columnas generadas de citas y pacientes.
grant execute on function public.clave_telefono(text) to anon, authenticated;
grant execute on function public.clave_hora(text)     to anon, authenticated;
