-- ═══════════════════════════════════════════════════════════════════════
-- 0015 — `sitio_url` sale por la vista pública
--
-- Para que `npm run db:verificar` pueda comprobar algo que 0014 no puede
-- ver desde dentro de la base: que la URL a la que apuntan los correos
-- automáticos sea un despliegue con las credenciales puestas.
--
-- El caso real que lo motivó: `sitio_url` estaba bien escrita y apuntaba a
-- un despliegue que existía y respondía… pero con las etiquetas <meta> en
-- marcador, así que ese despliegue corre en modo local. El enlace de baja
-- de cada correo abría una página que buscaba al paciente en el
-- localStorage del visitante y contestaba "enlace no válido".
--
-- Nada de eso se ve leyendo el SQL ni el HTML por separado. Solo aparece
-- cuando un paciente hace clic — y ahí ya es tarde.
--
-- Y hay un caso peor que la misma comprobación caza: que `sitio_url`
-- apunte al despliegue de OTRA clínica. Eso no da error en ninguna parte;
-- simplemente los pacientes de una acaban dándose de baja en la base de la
-- otra.
--
-- Exponerla no filtra nada: es la dirección del sitio público, y quien lee
-- la vista con la llave pública está justamente ahí.
-- ═══════════════════════════════════════════════════════════════════════

create or replace view public.clinica_publica
with (security_invoker = false)
as
  select
    id, nombre_clinica, nombre_medico, especialidad_principal, ciudad,
    telefono, email, whatsapp, cedula_profesional, horario_atencion,
    direccion_consultorio, logo_url, frase_hero, foto_hero, foto_medico,
    bio_medico, formacion_medico, servicios_clinica, total_pacientes,
    anos_experiencia, calificacion_promedio, facebook, instagram,
    color_primario, color_acento, tipografia,
    zona_horaria, sitio_url
  from public.clinicas
  where activa;

grant select on public.clinica_publica to anon;
