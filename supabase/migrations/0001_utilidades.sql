-- ═══════════════════════════════════════════════════════════════════════
-- 0001 — Extensiones y utilidades compartidas
--
-- Todo lo que las demás migraciones dan por hecho: generación de UUID,
-- el disparador de `actualizado_en`, la normalización de teléfonos y la
-- función que resuelve a qué clínica pertenece el usuario autenticado.
-- ═══════════════════════════════════════════════════════════════════════

-- Sin extensiones: gen_random_uuid() es parte del núcleo de Postgres
-- desde la versión 13, así que no hace falta pgcrypto.

-- ─── Marca de actualización ────────────────────────────────────────────
create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

comment on function public.tocar_actualizado_en is
  'Disparador BEFORE UPDATE: mantiene actualizado_en al día sin que la app tenga que acordarse.';

-- ─── Normalización de teléfonos ────────────────────────────────────────
-- Los últimos 10 dígitos son el número nacional mexicano completo. Sirve
-- para cruzar el "525588112233" que entrega WhatsApp con el
-- "55 8811 2233" que teclea la asistente. Es la versión en SQL de
-- claveTel() en js/conversaciones-store.js — si una cambia, cambia la otra.
create or replace function public.clave_telefono(tel text)
returns text
language sql
immutable
as $$
  select right(regexp_replace(coalesce(tel, ''), '\D', '', 'g'), 10);
$$;

comment on function public.clave_telefono is
  'Últimos 10 dígitos de un teléfono. Espejo de claveTel() en el frontend.';

-- clinica_actual() y rol_actual() viven en 0002, junto a la tabla
-- perfiles_staff que consultan: Postgres valida el cuerpo de la función
-- al crearla, así que no pueden nacer antes que su tabla.
