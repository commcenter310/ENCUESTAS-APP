-- =============================================================================
-- Tipo de encuesta y muestra por sección
--
--  · encuestas.tipo: 'rigor_cientifico' | 'posicionamiento' (obligatorio).
--  · secciones_muestra: secciones que se levantan en cada encuesta, con su
--    distrito local y federal, el tope de entrevistas y datos del diseño
--    (estrato, lista nominal, factor de ponderación, sección de reemplazo).
--  · conteo_secciones(): entrevistas efectivas por sección de TODO el equipo,
--    para que el encuestador sepa si una sección ya llegó a su tope.
--  · guardar_muestra(): reemplaza la muestra completa de una vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipo de encuesta
-- -----------------------------------------------------------------------------
alter table public.encuestas add column tipo text
  check (tipo in ('rigor_cientifico', 'posicionamiento'));

update public.encuestas set tipo = 'rigor_cientifico' where tipo is null;

alter table public.encuestas alter column tipo set not null;

comment on column public.encuestas.tipo is
  'rigor_cientifico: muestra probabilística con margen de error. posicionamiento: medición de imagen y posicionamiento.';

-- -----------------------------------------------------------------------------
-- Muestra
-- -----------------------------------------------------------------------------
create table public.secciones_muestra (
  encuesta_id uuid not null references public.encuestas (id) on delete cascade,
  seccion text not null check (seccion ~ '^[1-9][0-9]{0,5}$'),
  distrito_local integer check (distrito_local > 0),
  distrito_federal integer check (distrito_federal > 0),
  meta integer not null check (meta > 0 and meta <= 100000),
  estrato text check (length(estrato) <= 60),
  lista_nominal integer check (lista_nominal >= 0),
  factor_ponderacion numeric check (factor_ponderacion > 0),
  reemplazo text check (reemplazo ~ '^[1-9][0-9]{0,5}$' and reemplazo <> seccion),
  primary key (encuesta_id, seccion)
);

create unique index secciones_muestra_reemplazo
  on public.secciones_muestra (encuesta_id, reemplazo) where reemplazo is not null;

comment on table public.secciones_muestra is
  'Secciones a levantar por encuesta y su tope (meta). Las entrevistas en la sección de reemplazo cuentan para la titular.';

alter table public.secciones_muestra enable row level security;

-- Los encuestadores la necesitan (también sin conexión) para validar secciones y topes.
create policy "El administrador ve todas; el encuestador, las de encuestas que recibe"
  on public.secciones_muestra for select to authenticated
  using (
    (select privado.es_admin())
    or ((select privado.esta_activo()) and privado.encuesta_recibe(encuesta_id))
  );

create policy "Solo el administrador carga la muestra"
  on public.secciones_muestra for insert to authenticated
  with check ((select privado.es_admin()));

create policy "Solo el administrador cambia la muestra"
  on public.secciones_muestra for update to authenticated
  using ((select privado.es_admin()))
  with check ((select privado.es_admin()));

create policy "Solo el administrador borra la muestra"
  on public.secciones_muestra for delete to authenticated
  using ((select privado.es_admin()));

revoke all on table public.secciones_muestra from anon, authenticated;
grant select, insert, update, delete on table public.secciones_muestra to authenticated;
grant all on table public.secciones_muestra to service_role;

-- -----------------------------------------------------------------------------
-- Conteo por sección (todo el equipo)
-- -----------------------------------------------------------------------------
-- El encuestador solo ve sus propias entrevistas (RLS), pero para respetar el
-- tope necesita saber cuántas lleva todo el equipo en cada sección. Esta
-- función devuelve solo totales por sección: no expone respuestas ni nombres.
create function public.conteo_secciones(p_encuesta uuid)
returns table (zona text, efectivas bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.zona, count(*) as efectivas
  from public.entrevistas e
  where e.encuesta_id = p_encuesta
    and e.zona is not null
    and e.resultado = 'completa'
    and e.revision <> 'anulada'
    and (select privado.esta_activo())
    and privado.encuesta_recibe(p_encuesta)
  group by e.zona;
$$;

revoke all on function public.conteo_secciones(uuid) from public, anon;
grant execute on function public.conteo_secciones(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guardar la muestra completa (reemplaza la anterior en una sola operación)
-- -----------------------------------------------------------------------------
create function public.guardar_muestra(p_encuesta uuid, p_secciones jsonb, p_actualizar_meta boolean default true)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  total integer;
begin
  if not (select privado.es_admin()) then
    raise exception 'Solo un administrador puede cargar la muestra' using errcode = '42501';
  end if;
  if jsonb_typeof(p_secciones) <> 'array' then
    raise exception 'La muestra debe ser una lista de secciones' using errcode = '22023';
  end if;

  delete from public.secciones_muestra where encuesta_id = p_encuesta;

  insert into public.secciones_muestra
    (encuesta_id, seccion, distrito_local, distrito_federal, meta, estrato, lista_nominal, factor_ponderacion, reemplazo)
  select p_encuesta, s.seccion, s.distrito_local, s.distrito_federal, s.meta, s.estrato, s.lista_nominal, s.factor_ponderacion, s.reemplazo
  from jsonb_to_recordset(p_secciones) as s (
    seccion text, distrito_local integer, distrito_federal integer, meta integer,
    estrato text, lista_nominal integer, factor_ponderacion numeric, reemplazo text
  );

  select coalesce(sum(meta), 0) into total from public.secciones_muestra where encuesta_id = p_encuesta;

  if p_actualizar_meta then
    update public.encuestas set meta_muestra = nullif(total, 0) where id = p_encuesta;
  end if;
  return total;
end;
$$;

revoke all on function public.guardar_muestra(uuid, jsonb, boolean) from public, anon;
grant execute on function public.guardar_muestra(uuid, jsonb, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guasave: llenar distritos del domicilio a partir de la muestra
-- -----------------------------------------------------------------------------
update public.encuestas
set definicion = jsonb_set(
  definicion,
  '{monitoreo,autollenar}',
  '{"distrito_local": "DOM_dl", "distrito_federal": "DOM_df"}'::jsonb
)
where clave = 'guasave-2026' and definicion ? 'monitoreo';
