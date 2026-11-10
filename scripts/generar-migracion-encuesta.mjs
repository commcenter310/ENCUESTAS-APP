#!/usr/bin/env node
/**
 * Convierte una definición de encuesta (JSON) en una migración SQL que la
 * inserta en la tabla `encuestas`.
 *
 * Uso:
 *   node scripts/generar-migracion-encuesta.mjs <archivo.json> <clave> "<título>" [meta] ["descripción"]
 *
 * Ejemplo:
 *   node scripts/generar-migracion-encuesta.mjs encuestas/guasave-ims.json guasave-2026 "Encuesta Municipal Guasave" 1000
 *
 * Para encuestas nuevas normalmente no hace falta: el administrador puede
 * importar el JSON desde la app (Encuestas → Importar).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [archivo, clave, titulo, meta, descripcion] = process.argv.slice(2);
if (!archivo || !clave || !titulo) {
  console.error('Uso: node scripts/generar-migracion-encuesta.mjs <archivo.json> <clave> "<título>" [meta] ["descripción"]');
  process.exit(1);
}

const definicion = JSON.parse(readFileSync(archivo, 'utf8'));
const json = JSON.stringify(definicion, null, 2);
if (json.includes('$json$')) throw new Error('La definición no puede contener el texto $json$');

const texto = (valor) => (valor ? `'${String(valor).replaceAll("'", "''")}'` : 'null');
const marca = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const salida = `supabase/migrations/${marca}_encuesta_${clave.replaceAll('-', '_')}.sql`;

writeFileSync(
  salida,
  `-- Encuesta "${titulo}" (generada desde ${basename(archivo)}).
-- Si la clave ya existe no hace nada: los cambios posteriores se hacen desde la app.
insert into public.encuestas (clave, titulo, descripcion, definicion, estado, meta_muestra)
values (
  ${texto(clave)},
  ${texto(titulo)},
  ${texto(descripcion)},
  $json$${json}$json$::jsonb,
  'activa',
  ${meta ? Number(meta) : 'null'}
)
on conflict (clave) do nothing;
`,
);
console.log(`Listo: ${salida}`);
