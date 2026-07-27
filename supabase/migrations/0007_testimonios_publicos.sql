-- ═══════════════════════════════════════════════════════════════════════
-- 0007 — Testimonios públicos para la landing
--
-- La sección de opiniones de index.html se armaba cruzando en el
-- navegador las respuestas de la encuesta con las citas, para sacar el
-- nombre del paciente. Eso tenía dos problemas.
--
-- El de privacidad, que existía ya en modo local: la página pública
-- cargaba el arreglo COMPLETO de citas —nombres, teléfonos, correos,
-- notas de todos los pacientes— nada más para extraer un nombre de pila.
--
-- El de funcionamiento, que aparece con backend: `nps_respuestas` y
-- `citas` están protegidas por RLS y el rol anónimo no tiene política
-- sobre ninguna de las dos, así que un visitante recibiría cero
-- renglones y la sección saldría vacía.
--
-- La solución es la misma que ya se usó para `clinica_publica`: una
-- vista que expone exactamente lo que la clínica publicaría de todos
-- modos, y nada más. RLS filtra renglones, no columnas — por eso darle
-- a anon una política sobre `nps_respuestas` sería peor: podría leer el
-- comentario junto con el cita_id y de ahí tirar del hilo.
-- ═══════════════════════════════════════════════════════════════════════

create view public.testimonios_publicos
with (security_invoker = false)
as
  select
    n.id,
    n.clinica_id,

    -- "María G." — nombre de pila más la inicial del apellido, que es lo
    -- que la landing ya mostraba. El apellido completo no sale nunca.
    btrim(
      split_part(btrim(c.nombre), ' ', 1) ||
      case
        when btrim(coalesce(c.apellidos, '')) <> ''
          then ' ' || left(btrim(c.apellidos), 1) || '.'
        else ''
      end
    ) as nombre_publico,

    n.puntuacion,
    n.comentario,
    n.creado_en
  from public.nps_respuestas n
  join public.citas    c  on c.id  = n.cita_id
  join public.clinicas cl on cl.id = n.clinica_id
  where cl.activa
    and n.puntuacion >= 8;   -- mismo umbral que ya aplicaba la landing

comment on view public.testimonios_publicos is
  'Opiniones de pacientes legibles sin autenticación, para la landing. '
  'Solo nombre de pila e inicial, puntuación, comentario y fecha: nunca '
  'teléfono, correo, folio ni identificador de cita.';

-- La landing la lee sin sesión.
grant select on public.testimonios_publicos to anon;
grant select on public.testimonios_publicos to authenticated;
