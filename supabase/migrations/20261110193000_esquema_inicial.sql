-- =============================================================================
-- Encuestas App: esquema inicial
--
-- Tablas
--   perfiles     Un renglón por usuario: nombre, rol (admin/encuestador), activo.
--   encuestas    Cuestionarios. La definición completa vive en JSON.
--   entrevistas  Cada levantamiento hecho en campo, con respuestas en JSON.
--
-- Seguridad
--   Todo se protege con Row Level Security. La app usa la llave pública
--   (publishable) desde el navegador, así que estas políticas son la única
--   barrera real: revísalas antes de cambiarlas.
--     · Encuestador activo: ve encuestas activas, registra y ve SUS entrevistas.
--     · Administrador activo: ve todo, administra encuestas y revisa entrevistas.
--     · Las cuentas se crean inactivas; solo la función "usuarios" (Edge
--       Function con llave secreta) las activa o les cambia el rol.
-- =============================================================================

-- Esquema para funciones y datos internos. No está expuesto por la API.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
grant usage on schema privado to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Perfiles
-- -----------------------------------------------------------------------------
create type public.rol_usuario as enum ('admin', 'encuestador');

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null default '',
  correo text not null default '',
  rol public.rol_usuario not null default 'encuestador',
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

comment on table public.perfiles is
  'Datos de cada usuario. Se crea solo al dar de alta la cuenta; lo modifica la Edge Function "usuarios".';

-- Crea el perfil cuando nace una cuenta, siempre como encuestador INACTIVO:
-- quien se registre por su cuenta no tiene acceso a nada. Solo la Edge
-- Function "usuarios" (con la llave secreta) activa cuentas y asigna roles.
-- Esta tabla es la fuente de verdad de los permisos.
create function privado.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, correo)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'nombre', ''), 80),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function privado.crear_perfil();

-- Ayudantes para las políticas. Son "security definer" para poder leer
-- perfiles sin caer en recursión de RLS.
create function privado.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.rol = 'admin' and p.activo
  );
$$;

create function privado.esta_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.activo
  );
$$;

revoke all on function privado.crear_perfil() from public, anon, authenticated;
revoke all on function privado.es_admin() from public, anon;
revoke all on function privado.esta_activo() from public, anon;
grant execute on function privado.es_admin() to authenticated, service_role;
grant execute on function privado.esta_activo() to authenticated, service_role;

alter table public.perfiles enable row level security;

create policy "Cada quien ve su perfil; el administrador ve todos"
  on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select privado.es_admin()));

revoke all on table public.perfiles from anon, authenticated;
grant select on table public.perfiles to authenticated;
grant all on table public.perfiles to service_role;

-- -----------------------------------------------------------------------------
-- Encuestas
-- -----------------------------------------------------------------------------
create table public.encuestas (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique check (clave ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  titulo text not null check (length(trim(titulo)) > 0),
  descripcion text,
  definicion jsonb not null check (jsonb_typeof(definicion) = 'object'),
  estado text not null default 'borrador' check (estado in ('borrador', 'activa', 'cerrada')),
  meta_muestra integer check (meta_muestra is null or meta_muestra > 0),
  zona_horaria text not null default 'America/Mazatlan',
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

comment on column public.encuestas.definicion is
  'Cuestionario completo en JSON. El formato está documentado en lib/encuesta/tipos.ts.';
comment on column public.encuestas.estado is
  'borrador: solo la ve el administrador. activa: se puede levantar. cerrada: ya no se inician entrevistas, pero se reciben las que venían en camino.';

create function privado.tocar_actualizada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizada_en := now();
  return new;
end;
$$;

create trigger al_actualizar_encuesta
  before update on public.encuestas
  for each row execute function privado.tocar_actualizada();

alter table public.encuestas enable row level security;

create policy "El administrador ve todas; el encuestador, las activas"
  on public.encuestas for select to authenticated
  using (
    (select privado.es_admin())
    or (estado = 'activa' and (select privado.esta_activo()))
  );

create policy "Solo el administrador crea encuestas"
  on public.encuestas for insert to authenticated
  with check ((select privado.es_admin()));

create policy "Solo el administrador edita encuestas"
  on public.encuestas for update to authenticated
  using ((select privado.es_admin()))
  with check ((select privado.es_admin()));

create policy "Solo el administrador borra encuestas"
  on public.encuestas for delete to authenticated
  using ((select privado.es_admin()));

revoke all on table public.encuestas from anon, authenticated;
grant select, insert, update, delete on table public.encuestas to authenticated;
grant all on table public.encuestas to service_role;

-- -----------------------------------------------------------------------------
-- Entrevistas
-- -----------------------------------------------------------------------------
create table public.entrevistas (
  -- El id lo genera el dispositivo: así un reenvío tras perder la conexión
  -- no duplica la entrevista.
  id uuid primary key,
  encuesta_id uuid not null references public.encuestas (id) on delete restrict,
  encuestador_id uuid not null default auth.uid() references public.perfiles (id) on delete restrict,
  version text not null default 'A' check (length(version) between 1 and 10),
  resultado text not null check (resultado in ('completa', 'no_elegible')),
  motivo_no_elegible text,
  respuestas jsonb not null default '{}'::jsonb
    check (jsonb_typeof(respuestas) = 'object' and pg_column_size(respuestas) < 200000),
  -- Zona de muestreo (sección). La calcula el servidor a partir de respuestas.
  zona text,
  -- Horas según el reloj del dispositivo.
  iniciada_en timestamptz not null,
  terminada_en timestamptz not null,
  duracion_seg integer generated always as (
    extract(epoch from (terminada_en - iniciada_en))::integer
  ) stored,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  precision_m real,
  dispositivo text check (dispositivo is null or length(dispositivo) <= 400),
  -- Hora del servidor al recibirla (sincronización).
  recibida_en timestamptz not null default now(),
  -- Supervisión.
  revision text not null default 'pendiente' check (revision in ('pendiente', 'validada', 'anulada')),
  revisada_por uuid references public.perfiles (id) on delete set null,
  revisada_en timestamptz,
  nota_revision text check (nota_revision is null or length(nota_revision) <= 1000),
  constraint tiempos_en_orden check (terminada_en >= iniciada_en)
);

comment on column public.entrevistas.respuestas is
  'Respuestas aplanadas { clave: valor }. Ej. {"P12":"pan","P6.sheinbaum":"aprueba"}.';
comment on column public.entrevistas.revision is
  'pendiente | validada | anulada. Las anuladas no cuentan en resultados ni en avance.';

create index entrevistas_encuesta_fecha on public.entrevistas (encuesta_id, terminada_en desc);
create index entrevistas_encuesta_encuestador on public.entrevistas (encuesta_id, encuestador_id);
create index entrevistas_encuesta_zona on public.entrevistas (encuesta_id, zona);
create index entrevistas_encuestador on public.entrevistas (encuestador_id);
create index entrevistas_revisada_por on public.entrevistas (revisada_por) where revisada_por is not null;

-- ¿La encuesta todavía recibe entrevistas? (activa, o cerrada con envíos tardíos)
create function privado.encuesta_recibe(p_encuesta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.encuestas e
    where e.id = p_encuesta and e.estado in ('activa', 'cerrada')
  );
$$;

revoke all on function privado.encuesta_recibe(uuid) from public, anon;
grant execute on function privado.encuesta_recibe(uuid) to authenticated, service_role;

-- Al recibir: el servidor fija lo que el dispositivo no debe decidir.
create function privado.preparar_entrevista()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campo_zona text;
begin
  select e.definicion #>> '{monitoreo,campoZona}' into campo_zona
  from public.encuestas e where e.id = new.encuesta_id;

  new.zona := case when campo_zona is null then null else nullif(trim(new.respuestas ->> campo_zona), '') end;
  new.recibida_en := now();
  new.revision := 'pendiente';
  new.revisada_por := null;
  new.revisada_en := null;
  new.nota_revision := null;
  return new;
end;
$$;

create trigger al_recibir_entrevista
  before insert on public.entrevistas
  for each row execute function privado.preparar_entrevista();

-- Al revisar: registra quién y cuándo.
create function privado.registrar_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision is distinct from old.revision
     or new.nota_revision is distinct from old.nota_revision then
    new.revisada_por := (select auth.uid());
    new.revisada_en := now();
  end if;
  return new;
end;
$$;

create trigger al_revisar_entrevista
  before update on public.entrevistas
  for each row execute function privado.registrar_revision();

revoke all on function privado.preparar_entrevista() from public, anon, authenticated;
revoke all on function privado.registrar_revision() from public, anon, authenticated;
revoke all on function privado.tocar_actualizada() from public, anon, authenticated;

alter table public.entrevistas enable row level security;

create policy "El encuestador activo registra sus propias entrevistas"
  on public.entrevistas for insert to authenticated
  with check (
    encuestador_id = (select auth.uid())
    and (select privado.esta_activo())
    and privado.encuesta_recibe(encuesta_id)
  );

create policy "El encuestador ve las suyas; el administrador, todas"
  on public.entrevistas for select to authenticated
  using (
    (encuestador_id = (select auth.uid()) and (select privado.esta_activo()))
    or (select privado.es_admin())
  );

create policy "Solo el administrador revisa entrevistas"
  on public.entrevistas for update to authenticated
  using ((select privado.es_admin()))
  with check ((select privado.es_admin()));

-- Nadie borra entrevistas desde la app: se anulan.
revoke all on table public.entrevistas from anon, authenticated;
grant select, insert on table public.entrevistas to authenticated;
-- El administrador solo puede tocar las columnas de supervisión.
grant update (revision, nota_revision) on table public.entrevistas to authenticated;
grant all on table public.entrevistas to service_role;

-- -----------------------------------------------------------------------------
-- Instalación inicial (alta del primer administrador)
-- -----------------------------------------------------------------------------
create table privado.instalacion (
  id boolean primary key default true check (id),
  -- sha256 en hexadecimal del código de instalación.
  codigo_hash text not null,
  creado_en timestamptz not null default now()
);

comment on table privado.instalacion is
  'Código de un solo uso para crear el primer administrador. Deja de servir en cuanto existe un administrador.';

revoke all on table privado.instalacion from public, anon, authenticated;

-- ¿Falta crear el primer administrador? Lo consulta la pantalla de acceso.
create function public.requiere_instalacion()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.perfiles p where p.rol = 'admin');
$$;

revoke all on function public.requiere_instalacion() from public;
grant execute on function public.requiere_instalacion() to anon, authenticated, service_role;

-- Valida el código de instalación. Solo la llama la Edge Function "usuarios".
create function public.verificar_instalacion(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.perfiles p where p.rol = 'admin')
    and exists (
      select 1 from privado.instalacion i
      where i.codigo_hash = encode(sha256(convert_to(coalesce(p_codigo, ''), 'UTF8')), 'hex')
    );
$$;

revoke all on function public.verificar_instalacion(text) from public, anon, authenticated;
grant execute on function public.verificar_instalacion(text) to service_role;

-- -----------------------------------------------------------------------------
-- Monitoreo y resultados (corren con los permisos de quien consulta: RLS aplica)
-- -----------------------------------------------------------------------------

-- Avance general, por día, por encuestador y por zona.
create function public.tablero_encuesta(p_encuesta uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with enc as (
    select
      e.id,
      e.zona_horaria,
      coalesce((e.definicion #>> '{monitoreo,duracionMinimaSeg}')::integer, 0) as dur_min
    from public.encuestas e
    where e.id = p_encuesta
  ),
  base as (
    select
      t.encuestador_id,
      t.resultado,
      t.revision,
      t.zona,
      t.duracion_seg,
      t.lat,
      t.terminada_en,
      (t.terminada_en at time zone enc.zona_horaria)::date as dia,
      (now() at time zone enc.zona_horaria)::date as hoy,
      (t.resultado = 'completa' and t.revision <> 'anulada') as efectiva,
      (t.resultado = 'completa' and t.revision <> 'anulada' and t.duracion_seg < enc.dur_min) as corta
    from public.entrevistas t
    join enc on enc.id = t.encuesta_id
  )
  select jsonb_build_object(
    'totales', (
      select jsonb_build_object(
        'efectivas', count(*) filter (where efectiva),
        'hoy', count(*) filter (where efectiva and dia = hoy),
        'no_elegibles', count(*) filter (where resultado = 'no_elegible'),
        'anuladas', count(*) filter (where revision = 'anulada'),
        'validadas', count(*) filter (where efectiva and revision = 'validada'),
        'pendientes', count(*) filter (where efectiva and revision = 'pendiente'),
        'cortas', count(*) filter (where corta),
        'sin_gps', count(*) filter (where efectiva and lat is null),
        'duracion_mediana', percentile_cont(0.5) within group (order by duracion_seg) filter (where efectiva),
        'encuestadores', count(distinct encuestador_id) filter (where efectiva),
        'zonas', count(distinct zona) filter (where efectiva and zona is not null),
        'ultima', max(terminada_en)
      )
      from base
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia), '[]'::jsonb)
      from (select dia, count(*) as n from base where efectiva group by dia) d
    ),
    'por_encuestador', (
      select coalesce(jsonb_agg(q.fila order by q.efectivas desc, q.nombre), '[]'::jsonb)
      from (
        select
          count(*) filter (where b.efectiva) as efectivas,
          p.nombre,
          jsonb_build_object(
            'id', b.encuestador_id,
            'nombre', p.nombre,
            'activo', p.activo,
            'efectivas', count(*) filter (where b.efectiva),
            'hoy', count(*) filter (where b.efectiva and b.dia = b.hoy),
            'no_elegibles', count(*) filter (where b.resultado = 'no_elegible'),
            'anuladas', count(*) filter (where b.revision = 'anulada'),
            'cortas', count(*) filter (where b.corta),
            'sin_gps', count(*) filter (where b.efectiva and b.lat is null),
            'duracion_mediana', percentile_cont(0.5) within group (order by b.duracion_seg) filter (where b.efectiva),
            'ultima', max(b.terminada_en)
          ) as fila
        from base b
        join public.perfiles p on p.id = b.encuestador_id
        group by b.encuestador_id, p.nombre, p.activo
      ) q
    ),
    'por_zona', (
      select coalesce(jsonb_agg(jsonb_build_object('zona', z.zona, 'n', z.n) order by z.zona), '[]'::jsonb)
      from (
        select coalesce(zona, '') as zona, count(*) as n
        from base where efectiva group by 1
      ) z
    )
  );
$$;

-- Conteo de respuestas por clave y valor: {"P12": {"pan": 31, "pri": 20}, ...}
-- Solo entrevistas completas y no anuladas.
create function public.resultados_encuesta(p_encuesta uuid, p_claves text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.clave, t.conteo), '{}'::jsonb)
  from (
    select c.clave, jsonb_object_agg(c.valor, c.n) as conteo
    from (
      select kv.key as clave, kv.value as valor, count(*) as n
      from public.entrevistas e
      cross join lateral jsonb_each_text(e.respuestas) as kv
      where e.encuesta_id = p_encuesta
        and e.resultado = 'completa'
        and e.revision <> 'anulada'
        and kv.key = any (p_claves)
      group by kv.key, kv.value
    ) c
    group by c.clave
  ) t;
$$;

-- Respuestas de texto libre agrupadas (sin distinguir mayúsculas).
create function public.respuestas_abiertas(p_encuesta uuid, p_clave text, p_limite integer default 200)
returns table (texto text, n bigint)
language sql
stable
set search_path = ''
as $$
  select min(trim(e.respuestas ->> p_clave)) as texto, count(*) as n
  from public.entrevistas e
  where e.encuesta_id = p_encuesta
    and e.resultado = 'completa'
    and e.revision <> 'anulada'
    and nullif(trim(e.respuestas ->> p_clave), '') is not null
  group by lower(trim(e.respuestas ->> p_clave))
  order by n desc, texto
  limit greatest(1, least(coalesce(p_limite, 200), 1000));
$$;

revoke all on function public.tablero_encuesta(uuid) from public, anon;
revoke all on function public.resultados_encuesta(uuid, text[]) from public, anon;
revoke all on function public.respuestas_abiertas(uuid, text, integer) from public, anon;
grant execute on function public.tablero_encuesta(uuid) to authenticated, service_role;
grant execute on function public.resultados_encuesta(uuid, text[]) to authenticated, service_role;
grant execute on function public.respuestas_abiertas(uuid, text, integer) to authenticated, service_role;
