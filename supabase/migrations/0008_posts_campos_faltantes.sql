-- ═══════════════════════════════════════════════════════════════════════
-- 0008 — Las tres columnas que le faltaban a `posts`
--
-- MediPost le pide a Claude cuatro cosas y las devuelve en bloques
-- separados: [CAPTION], [HASHTAGS], [SUGERENCIA_IMAGEN] y
-- [LLAMADA_A_ACCION]. El bloque de imagen trae además el prompt en
-- inglés para los generadores de imágenes, que es lo que la asistente
-- copia y pega en Firefly o Leonardo.
--
-- La tabla solo tenía columnas para las dos primeras. Al conectar el
-- módulo (B2) eso se habría traducido en que una clínica con backend
-- guardaba el caption y los hashtags, y perdía en silencio la
-- descripción de la imagen, el prompt y la llamada a la acción — tres de
-- las cuatro cosas por las que se hizo el módulo, y sin ningún error
-- visible que lo delatara.
--
-- Es aditivo y con valor por omisión: correrlo sobre una base con datos
-- no toca ni un renglón existente.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.posts
  add column if not exists sugerencia_imagen text default '',
  add column if not exists prompt_ia         text default '',
  add column if not exists llamada_accion    text default '';

comment on column public.posts.prompt_ia is
  'Prompt en inglés para generadores de imágenes (Firefly, Leonardo). Se muestra copiable en la UI.';
