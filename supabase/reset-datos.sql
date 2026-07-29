-- ═══════════════════════════════════════════════════════════════════════
-- Vaciar los datos de una clínica
--
-- Para qué sirve: dejar limpio un proyecto en el que se estuvo probando,
-- antes de que lo empiece a usar una clínica de verdad. Borra expedientes,
-- citas, conversaciones y todo lo que se haya capturado; NO toca el
-- esquema, las políticas de RLS ni las funciones.
--
-- Se pega en el editor SQL del panel de Supabase, igual que las
-- migraciones y que seed-clinica.sql.
--
-- ⚠ Esto no se puede deshacer. En Supabase no hay papelera: lo que se
--   borra aquí se fue. Si el proyecto ya tiene expedientes reales, haz
--   respaldo antes (Database → Backups) o simplemente no corras esto.
--
-- SOLO SE EDITA EL BLOQUE "QUÉ BORRAR" de abajo.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  QUÉ BORRAR — cambia solo estas dos líneas                        ║
  -- ╚═══════════════════════════════════════════════════════════════════╝

  -- Nombre EXACTO de la clínica, tal como aparece en la tabla `clinicas`.
  -- Es a propósito que haya que escribirlo: obliga a mirar qué se está
  -- borrando en vez de correr el script a ciegas.
  v_nombre_clinica  text := 'Consultorio Dr. Ejemplo';

  -- false → borra los datos y deja viva la clínica y su personal.
  --         Es lo que quieres para reutilizar el proyecto tal cual.
  -- true  → borra también la clínica y los perfiles de personal, y el
  --         proyecto queda como recién migrado. Las cuentas de
  --         Authentication → Users NO se borran: eso se hace desde el
  --         panel, y conviene, porque si borras el perfil pero dejas la
  --         cuenta, esa persona puede entrar a un sistema sin clínica.
  v_borrar_clinica  boolean := false;

  -- ╔═══════════════════════════════════════════════════════════════════╗
  -- ║  De aquí para abajo no se toca                                    ║
  -- ╚═══════════════════════════════════════════════════════════════════╝
  v_clinica_id  uuid;
  n_pac  int; n_cit  int; n_con  int; n_msg int;
  n_doc  int; n_post int; n_nps  int; n_seg int; n_not int;
begin

  select id into v_clinica_id
  from public.clinicas
  where nombre_clinica = v_nombre_clinica;

  -- Un nombre que no existe borraría cero renglones y el script diría
  -- "listo". Mejor reventar: casi siempre es un dedazo, y creer que
  -- limpiaste algo que sigue ahí es peor que el error.
  if v_clinica_id is null then
    raise exception 'No hay ninguna clínica llamada "%". Revisa el nombre con:  select nombre_clinica from public.clinicas;', v_nombre_clinica;
  end if;

  raise notice 'Clínica: % (%)', v_nombre_clinica, v_clinica_id;

  -- ─── Datos operativos ────────────────────────────────────────────────
  -- El orden respeta las llaves foráneas aunque casi todas tengan
  -- `on delete cascade`. Se hace explícito para que el script sirva
  -- también de inventario de qué guarda el sistema por clínica.

  delete from public.mensajes        where clinica_id = v_clinica_id;  get diagnostics n_msg  = row_count;
  delete from public.conversaciones  where clinica_id = v_clinica_id;  get diagnostics n_con  = row_count;
  delete from public.notas_paciente  where clinica_id = v_clinica_id;  get diagnostics n_not  = row_count;
  delete from public.documentos      where clinica_id = v_clinica_id;  get diagnostics n_doc  = row_count;
  delete from public.nps_respuestas  where clinica_id = v_clinica_id;  get diagnostics n_nps  = row_count;
  delete from public.seguimientos    where clinica_id = v_clinica_id;  get diagnostics n_seg  = row_count;
  delete from public.citas           where clinica_id = v_clinica_id;  get diagnostics n_cit  = row_count;
  delete from public.pacientes       where clinica_id = v_clinica_id;  get diagnostics n_pac  = row_count;
  delete from public.posts           where clinica_id = v_clinica_id;  get diagnostics n_post = row_count;

  raise notice 'Borrados — pacientes: %, citas: %, conversaciones: %, mensajes: %', n_pac, n_cit, n_con, n_msg;
  raise notice '           notas: %, documentos: %, posts: %, NPS: %, seguimientos: %', n_not, n_doc, n_post, n_nps, n_seg;

  -- ─── La clínica misma ────────────────────────────────────────────────
  if v_borrar_clinica then
    delete from public.perfiles_staff where clinica_id = v_clinica_id;
    delete from public.clinicas       where id = v_clinica_id;
    raise notice 'La clínica y su personal también se borraron. Falta quitar las cuentas en Authentication → Users.';
  else
    raise notice 'La clínica y su personal siguen ahí. El sistema arranca vacío pero funcional.';
  end if;

end $$;


-- ─── Comprobación ──────────────────────────────────────────────────────
-- Debe salir todo en 0. Si algún renglón quedó, es de otra clínica.
select 'pacientes' as tabla, count(*) from public.pacientes
union all select 'citas',          count(*) from public.citas
union all select 'conversaciones', count(*) from public.conversaciones
union all select 'mensajes',       count(*) from public.mensajes
union all select 'documentos',     count(*) from public.documentos
union all select 'posts',          count(*) from public.posts
union all select 'nps_respuestas', count(*) from public.nps_respuestas
union all select 'seguimientos',   count(*) from public.seguimientos
union all select 'notas_paciente', count(*) from public.notas_paciente
union all select 'clinicas',       count(*) from public.clinicas
union all select 'perfiles_staff', count(*) from public.perfiles_staff;
