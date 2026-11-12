import type { SeccionMuestra } from '@/lib/muestra';
import { type Conteo, ordenarPorSeccion } from '@/lib/muestra-avance';
import { leerPaginado, supabase } from '@/lib/supabase';

const CAMPOS_MUESTRA =
  'seccion, distrito_local, distrito_federal, meta, estrato, lista_nominal, factor_ponderacion, reemplazo';

/** Muestra completa de una encuesta, ordenada por número de sección. */
export async function leerMuestra(encuestaId: string): Promise<SeccionMuestra[]> {
  const filas = await leerPaginado<SeccionMuestra>((desde, hasta) =>
    supabase().from('secciones_muestra').select(CAMPOS_MUESTRA).eq('encuesta_id', encuestaId).range(desde, hasta),
  );
  // numeric llega como texto desde la API.
  return ordenarPorSeccion(
    filas.map((f) => ({
      ...f,
      factor_ponderacion: f.factor_ponderacion === null ? null : Number(f.factor_ponderacion),
    })),
  );
}

/** Entrevistas efectivas por sección de todo el equipo: { "2136": 7, ... }. */
export async function leerConteoSecciones(encuestaId: string): Promise<Conteo> {
  const { data, error } = await supabase().rpc('conteo_secciones', { p_encuesta: encuestaId });
  if (error) throw error;
  return (data ?? {}) as Conteo;
}
