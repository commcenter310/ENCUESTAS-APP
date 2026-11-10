-- Datos solo para desarrollo local (se cargan con `supabase db reset`).
-- En producción el código de instalación se registra aparte y es secreto.

-- Código de instalación local: instalacion-local
insert into privado.instalacion (codigo_hash)
values (encode(sha256(convert_to('instalacion-local', 'UTF8')), 'hex'))
on conflict (id) do update set codigo_hash = excluded.codigo_hash;
