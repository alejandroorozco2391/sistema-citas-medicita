-- ═══════════════════════════════════════════════════════════════════════
-- 0011 — La hora que se le dice al paciente, ya escrita
--
-- `escalar_a_humano` devolvía `atencionEn` como timestamptz crudo:
--   2026-07-30T15:00:00+00:00
--
-- Que son las 09:00 en México. Pero quien redacta la respuesta es un
-- modelo de lenguaje, y para decir "a las nueve" tenía que convertir de
-- UTC a la zona de la clínica él mismo. En la primera prueba contra un
-- proyecto real dijo "a las 10 am".
--
-- Nadie lo habría notado: suena razonable, y el paciente se presenta una
-- hora tarde o espera una llamada que ya ocurrió. Es la misma clase de
-- error silencioso que esta fase lleva corrigiendo desde la zona horaria
-- incrustada en 0006.
--
-- La corrección no es afinar el prompt, es quitarle el cálculo: la base
-- ya sabe la zona de la clínica, así que devuelve la frase hecha y el
-- modelo solo la repite.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Fecha y hora en español, en la zona de la clínica ─────────────────
-- Con arreglos y no con to_char(..., 'TMDay'): el formato TM depende de
-- la configuración regional del servidor, que en Supabase es inglesa. Un
-- "Thursday 30 of July" no sirve, y peor: funcionaría en la máquina de
-- alguien y no en producción.
create or replace function public.fecha_en_palabras(
  p_momento timestamptz,
  p_tz      text default 'America/Mexico_City'
)
returns text
language plpgsql
immutable
as $$
declare
  DIAS  constant text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  MESES constant text[] := array['enero','febrero','marzo','abril','mayo','junio',
                                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  v_local timestamp;
begin
  if p_momento is null then return null; end if;

  v_local := p_momento at time zone coalesce(p_tz, 'America/Mexico_City');

  return DIAS[extract(dow from v_local)::int + 1]
      || ' ' || extract(day from v_local)::int
      || ' de ' || MESES[extract(month from v_local)::int]
      || ' a las ' || to_char(v_local, 'HH24:MI');
end;
$$;

comment on function public.fecha_en_palabras is
  'Fecha y hora en español, ya convertida a la zona de la clínica. Existe para que quien redacte no tenga que calcularla.';

-- ─── escalar_a_humano devuelve la frase, no el cálculo ─────────────────
-- Mismo cuerpo que en 0010 salvo el bloque de salida.
create or replace function public.escalar_a_humano(
  p_motivo          text,
  p_resumen         text,
  p_urgencia        text default 'normal',
  p_nombre          text default '',
  p_telefono        text default '',
  p_email           text default '',
  p_canal           text default 'medibot',
  p_conversacion_id uuid default null,
  p_clinica_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinica   uuid := coalesce(p_clinica_id, public.clinica_unica());
  v_tel_clave text := public.clave_telefono(p_telefono);
  v_recientes int;
  v_ruta      record;
  v_id        uuid;
  v_abierto   boolean;
  v_prox      timestamptz;
  v_paciente  uuid;
  v_tz        text;
begin
  if p_motivo is null or p_motivo = '' then
    raise exception 'Falta el motivo de la escalación';
  end if;

  -- Freno de abuso, igual que en solicitar_cita: la anon key es pública.
  -- El tope es más bajo que el de citas (3 contra 5) porque cada
  -- escalación le suena el teléfono a una persona de verdad.
  if v_tel_clave <> '' then
    select count(*) into v_recientes
    from public.escalaciones
    where clinica_id = v_clinica
      and telefono_clave = v_tel_clave
      and creado_en > now() - interval '24 hours';

    if v_recientes >= 3 then
      raise exception 'Ya hay varias solicitudes de contacto desde este teléfono. Alguien de la clínica te va a llamar.';
    end if;

    select id into v_paciente
    from public.pacientes
    where clinica_id = v_clinica and telefono_clave = v_tel_clave
    limit 1;
  end if;

  select r.destino_rol, r.vence_en into v_ruta
  from public.rutear_escalacion(v_clinica, p_motivo, coalesce(p_urgencia, 'normal')) r;

  insert into public.escalaciones (
    clinica_id, conversacion_id, paciente_id, canal_origen,
    contacto_nombre, contacto_telefono, contacto_email,
    motivo, urgencia, resumen, destino_rol, vence_en
  ) values (
    v_clinica, p_conversacion_id, v_paciente, coalesce(p_canal, 'medibot'),
    coalesce(p_nombre, ''), coalesce(p_telefono, ''), coalesce(p_email, ''),
    p_motivo, coalesce(p_urgencia, 'normal'), coalesce(p_resumen, ''),
    v_ruta.destino_rol, v_ruta.vence_en
  )
  returning id into v_id;

  if p_conversacion_id is not null then
    update public.conversaciones
       set estado = 'requiere_atencion_humana'
     where id = p_conversacion_id and clinica_id = v_clinica;
  end if;

  select zona_horaria into v_tz from public.clinicas where id = v_clinica;
  v_abierto := public.en_horario(v_clinica);
  v_prox    := public.proxima_apertura(v_clinica);

  return jsonb_build_object(
    'id',            v_id,
    'destino',       v_ruta.destino_rol,
    'urgencia',      coalesce(p_urgencia, 'normal'),
    'abiertoAhora',  v_abierto,
    'atencionEn',    case when v_abierto then null else v_prox end,

    -- Lo que de verdad se le dice al paciente. Ya en la zona de la
    -- clínica y en palabras, para que nadie tenga que convertirlo.
    'atencionEnTexto',
      case when v_abierto then null
           else public.fecha_en_palabras(v_prox, v_tz) end,

    'esEmergencia',  p_motivo = 'urgencia_medica',
    'instruccion',
      case
        when p_motivo = 'urgencia_medica' then
          'ANTES QUE NADA dile que si es una emergencia llame al 911 o vaya a urgencias AHORA, sin esperar respuesta. Después confirma que ya avisaste a la clínica.'
        when v_abierto then
          'Confirma que ya avisaste y que en unos minutos lo contactan.'
        when v_prox is not null then
          'Confirma que ya avisaste y di que lo contactan el ' ||
          public.fecha_en_palabras(v_prox, v_tz) ||
          '. Copia esa hora TAL CUAL, en el campo atencionEnTexto. No la conviertas, no la redondees y no le sumes margen: ya viene en la hora local de la clínica.'
        else
          'Confirma que ya avisaste. NO prometas una hora: el consultorio no tiene horario cargado y sería inventarla.'
      end
  );
end;
$$;

revoke all on function public.escalar_a_humano   from public;
revoke all on function public.fecha_en_palabras  from public;
grant execute on function public.escalar_a_humano  to anon, authenticated;
grant execute on function public.fecha_en_palabras to authenticated;
