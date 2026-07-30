-- ═══════════════════════════════════════════════════════════════════════
-- 0016 — "Mis citas": el paciente consulta y cancela la suya
--
-- Hasta aquí, un paciente que no podía ir solo tenía dos salidas: llamar a
-- la clínica en horario de oficina, o no avisar. La segunda es gratis y es
-- la que casi todos eligen — y eso es exactamente un no-show, que la
-- pestaña de Analytics ya mide sin poder hacer nada al respecto.
--
-- Cancelar con un clic no es una comodidad: es la única forma de que ese
-- hueco vuelva a la agenda a tiempo para dárselo a alguien más. El índice
-- `citas_slot_unico` de 0012 excluye `cancelada`, así que liberar el hueco
-- ya funciona solo.
--
-- ── La credencial ──────────────────────────────────────────────────────
-- Folio Y teléfono, los dos. Ni uno solo alcanza:
--
--   · el folio viaja en cada correo, así que quien intercepte uno lo tiene;
--   · el teléfono lo sabe cualquiera que conozca al paciente, y probar
--     números al azar contra una lista de folios sería trivial.
--
-- Juntos, quien puede cancelar es quien recibió el correo Y sabe con qué
-- número se agendó. Es el mismo criterio que `responder_encuesta` con el
-- folio, subido un escalón porque esto sí modifica la agenda.
--
-- Y nunca se dice si el folio existe: un folio malo y un teléfono que no
-- corresponde dan el mismo mensaje. Distinguirlos convertiría esto en un
-- oráculo para adivinar folios.
--
-- ── Por qué estas dos devuelven el error en vez de lanzarlo ────────────
-- Porque `raise exception` aborta la transacción entera, y con ella el
-- INSERT en la bitácora de intentos. El freno de abuso quedaba escrito,
-- parecía correcto, y no podía contar nada: cada fallo se registraba y se
-- deshacía en el mismo suspiro. Lo cazó la prueba, no la lectura.
--
-- Así que el contrato es `{ ok: true, … }` o `{ ok: false, error: "…" }`.
-- Las excepciones se quedan solo para lo que no necesita dejar rastro.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Quién canceló y por qué ───────────────────────────────────────────
-- No es lo mismo que cancele el paciente que que cancele recepción, y la
-- clínica necesita distinguirlo: un paciente que cancela avisa, uno al que
-- recepción cancela por otra razón es otra conversación. Sin esta columna,
-- las dos cosas se ven idénticas en la tabla.
alter table public.citas
  add column if not exists cancelada_por text,
  add column if not exists motivo_cancelacion text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'citas_cancelada_por_valido') then
    alter table public.citas
      add constraint citas_cancelada_por_valido
        check (cancelada_por is null or cancelada_por in ('paciente', 'clinica'));
  end if;
end $$;

comment on column public.citas.cancelada_por is
  'Quién la canceló. NULL mientras no esté cancelada. Un paciente que avisa no es lo mismo que una cancelación del consultorio.';

-- ─── Freno de abuso ────────────────────────────────────────────────────
-- La anon key es pública, así que esta función se puede llamar en bucle
-- probando folios. Se registran los intentos FALLIDOS por teléfono para
-- poder cortar; los aciertos no se limitan, porque alguien consultando su
-- propia cita varias veces no está haciendo nada malo.
create table if not exists public.intentos_mis_citas (
  id         bigserial primary key,
  clinica_id uuid not null references public.clinicas(id) on delete cascade,
  tel_clave  text not null,
  creado_en  timestamptz not null default now()
);

create index if not exists intentos_mis_citas_idx
  on public.intentos_mis_citas (clinica_id, tel_clave, creado_en);

alter table public.intentos_mis_citas enable row level security;

/* Nadie tiene política: es una bitácora interna de la que solo escriben las
   funciones SECURITY DEFINER de abajo. Ni el personal necesita leerla. */

comment on table public.intentos_mis_citas is
  'Intentos fallidos de "Mis citas", para frenar el barrido de folios. Sin políticas: solo la tocan las funciones SECURITY DEFINER.';

-- ─── El resolvedor: ¿de quién es esta pareja folio + teléfono? ─────────
create or replace function public.paciente_de_folio(
  p_folio    text,
  p_telefono text,
  p_clinica  uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clave text;
  v_pac   uuid;
begin
  v_clave := public.clave_telefono(p_telefono);
  if length(v_clave) < 10 or coalesce(trim(p_folio), '') = '' then
    return null;
  end if;

  /* Se cruza por el teléfono DE LA CITA y no por el del expediente: es el
     número con el que se agendó, que es lo que el paciente recuerda. Si
     después actualizó su teléfono en el expediente, el viejo sigue
     sirviendo para el folio viejo — y eso es lo correcto. */
  select c.paciente_id into v_pac
  from public.citas c
  where c.clinica_id = p_clinica
    and upper(trim(c.folio)) = upper(trim(p_folio))
    and c.telefono_clave = v_clave;

  return v_pac;
end;
$$;

-- ═══ Consultar mis citas ═══════════════════════════════════════════════
create or replace function public.mis_citas(
  p_folio      text,
  p_telefono   text,
  p_clinica_id uuid default null
)
returns jsonb
language plpgsql
volatile                      -- escribe en la bitácora de intentos
security definer
set search_path = public
as $$
declare
  v_clinica  uuid;
  v_clave    text;
  v_pac      uuid;
  v_fallidos int;
  v_citas    jsonb;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());
  v_clave   := public.clave_telefono(p_telefono);

  if length(v_clave) < 10 then
    return jsonb_build_object('ok', false, 'error', 'El teléfono debe tener 10 dígitos.');
  end if;

  -- Diez fallos en una hora desde el mismo número es un script, no alguien
  -- que no se acuerda de su folio.
  select count(*) into v_fallidos
  from public.intentos_mis_citas
  where clinica_id = v_clinica
    and tel_clave = v_clave
    and creado_en > now() - interval '1 hour';

  if v_fallidos >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Llámanos y te ayudamos.');
  end if;

  v_pac := public.paciente_de_folio(p_folio, p_telefono, v_clinica);

  if v_pac is null then
    insert into public.intentos_mis_citas (clinica_id, tel_clave) values (v_clinica, v_clave);
    /* Se DEVUELVE, no se lanza: una excepción desharía el insert de arriba
       en la misma transacción y el freno no podría contar nada.

       Mismo mensaje para folio inexistente y teléfono que no corresponde.
       Distinguirlos volvería esto un oráculo para adivinar folios. */
    return jsonb_build_object(
      'ok', false,
      'error', 'No encontramos ninguna cita con esos datos. Revísalos, por favor.'
    );
  end if;

  /* Se devuelven las citas de ESE paciente, no solo la del folio: quien
     probó los dos factores ya demostró ser esa persona, y lo que va a
     querer ver es su próxima cita, no la del correo que abrió.

     La ventana empieza 30 días atrás para que quepa la consulta reciente
     —"¿qué me dijo el doctor el martes?"— sin volcarle el historial de
     años, que aquí no le sirve de nada. */
  select coalesce(jsonb_agg(x order by x->>'fecha', x->>'hora'), '[]'::jsonb) into v_citas
  from (
    select jsonb_build_object(
             'folio',        c.folio,
             'fecha',        c.fecha,
             'hora',         c.hora,
             'especialidad', c.especialidad,
             'doctor',       c.doctor,
             'tipo',         c.tipo,
             'estado',       c.estado,
             'cancelable',   c.estado in ('pendiente', 'confirmada')
                             and c.fecha > (now() at time zone
                                   (select zona_horaria from public.clinicas where id = v_clinica))::date
           ) as x
    from public.citas c
    where c.clinica_id = v_clinica
      and c.paciente_id = v_pac
      and c.fecha >= current_date - 30
  ) t;

  return jsonb_build_object(
    'ok', true,
    'nombre', (select nombre from public.pacientes where id = v_pac),
    'citas',  v_citas
  );
end;
$$;

comment on function public.mis_citas is
  'Citas del paciente dueño de esa pareja folio + teléfono. No revela si el folio existe.';

-- ═══ Cancelar mi cita ══════════════════════════════════════════════════
create or replace function public.cancelar_mi_cita(
  p_folio      text,
  p_telefono   text,
  p_motivo     text default '',
  p_clinica_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinica uuid;
  v_pac     uuid;
  v_c       record;
  v_hoy     date;
begin
  v_clinica := coalesce(p_clinica_id, public.clinica_unica());
  v_pac     := public.paciente_de_folio(p_folio, p_telefono, v_clinica);

  if v_pac is null then
    insert into public.intentos_mis_citas (clinica_id, tel_clave)
      values (v_clinica, public.clave_telefono(p_telefono));
    -- Se devuelve para que el insert de arriba sobreviva. Ver la nota de
    -- la cabecera del archivo.
    return jsonb_build_object(
      'ok', false,
      'error', 'No encontramos ninguna cita con esos datos. Revísalos, por favor.'
    );
  end if;

  select * into v_c
  from public.citas
  where clinica_id = v_clinica and upper(trim(folio)) = upper(trim(p_folio));

  if v_c.estado = 'cancelada' then
    /* No es un error: es alguien que le dio dos veces al botón, o que
       abrió el correo viejo. Reventar aquí lo dejaría creyendo que su
       cancelación no funcionó. */
    return jsonb_build_object('ok', true, 'folio', v_c.folio, 'yaEstaba', true);
  end if;

  if v_c.estado = 'atendida' then
    return jsonb_build_object('ok', false, 'error', 'Esa consulta ya se realizó, no se puede cancelar.');
  end if;

  v_hoy := (now() at time zone
             (select zona_horaria from public.clinicas where id = v_clinica))::date;

  /* La cita de hoy NO se cancela desde aquí, y es a propósito: a estas
     horas el consultorio ya organizó el día alrededor de ese hueco, y una
     cancelación silenciosa a las 8:55 para una cita de las 9:00 es peor que
     una llamada. Se le pide que llame. */
  if v_c.fecha <= v_hoy then
    return jsonb_build_object(
      'ok', false,
      'error', 'Tu cita es hoy o ya pasó. Llámanos para cancelarla, por favor.'
    );
  end if;

  update public.citas
    set estado = 'cancelada',
        cancelada_por = 'paciente',
        motivo_cancelacion = left(coalesce(trim(p_motivo), ''), 300)
    where id = v_c.id;

  /* El recordatorio que ya estuviera encolado se cancela: recibir "tu cita
     es mañana" después de haberla cancelado es lo que hace que nadie vuelva
     a confiar en estos correos. */
  update public.avisos_pendientes
    set estado = 'fallido', ultimo_error = 'cita cancelada por el paciente'
    where cita_id = v_c.id and estado = 'pendiente';

  return jsonb_build_object(
    'ok', true,
    'folio', v_c.folio,
    'fecha', v_c.fecha,
    'hora',  v_c.hora
  );
end;
$$;

comment on function public.cancelar_mi_cita is
  'Cancela una cita futura con folio + teléfono. Libera el hueco (citas_slot_unico excluye cancelada) y anula el recordatorio encolado.';

-- ═══ Permisos ══════════════════════════════════════════════════════════
-- Convención de 0013: revocar de los tres y conceder a quien la necesita.
revoke all on function public.paciente_de_folio(text, text, uuid) from public, anon, authenticated;
revoke all on function public.mis_citas(text, text, uuid)         from public, anon, authenticated;
revoke all on function public.cancelar_mi_cita(text, text, text, uuid) from public, anon, authenticated;

-- Las dos puertas nuevas del paciente sin cuenta. `paciente_de_folio` NO:
-- es el resolvedor interno, y ofrecerlo sería ofrecer un comprobador de
-- parejas folio+teléfono sin el freno de abuso que sí tienen las otras dos.
grant execute on function public.mis_citas(text, text, uuid)            to anon, authenticated;
grant execute on function public.cancelar_mi_cita(text, text, text, uuid) to anon, authenticated;
