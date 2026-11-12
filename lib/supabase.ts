import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase para el navegador.
 *
 * Usa la llave pública (publishable): es seguro tenerla en el navegador porque
 * todo acceso a datos pasa por las políticas RLS de la base de datos. La sesión
 * se guarda en el dispositivo para que el encuestador pueda seguir capturando
 * aunque se quede sin señal.
 */
let cliente: SupabaseClient | null = null;

export function configuracionLista(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !llave) {
    throw new Error('Falta configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
  cliente = createClient(url, llave, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'encuestas-sesion',
    },
  });
  return cliente;
}

/** ¿El error viene de no tener conexión (y no de un rechazo del servidor)? */
export function esErrorDeRed(error: unknown): boolean {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const e = error as { message?: string; name?: string; status?: number; code?: string };
  const mensaje = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase();
  return (
    e.status === 0 ||
    mensaje.includes('failed to fetch') ||
    mensaje.includes('networkerror') ||
    mensaje.includes('network request failed') ||
    mensaje.includes('load failed') ||
    mensaje.includes('fetch failed') ||
    mensaje.includes('authretryablefetcherror') ||
    mensaje.includes('timeout')
  );
}

/** Lee el mensaje de error que devuelve una Edge Function. */
export async function mensajeDeFuncion(error: unknown): Promise<string> {
  const contexto = (error as { context?: Response })?.context;
  if (contexto && typeof contexto.json === 'function') {
    try {
      const cuerpo = (await contexto.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      // La respuesta no era JSON: se usa el mensaje genérico.
    }
  }
  if (esErrorDeRed(error)) return 'No hay conexión. Revisa tu internet e intenta de nuevo.';
  return 'No se pudo completar la operación. Intenta de nuevo.';
}

/**
 * Lee todas las filas de una consulta por páginas (la API entrega como máximo
 * 1,000 por petición). `pagina(desde, hasta)` debe aplicar `.range(desde, hasta)`.
 */
export async function leerPaginado<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamano = 1000,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await pagina(desde, desde + tamano - 1);
    if (error) throw error;
    filas.push(...(data ?? []));
    if (!data || data.length < tamano) return filas;
  }
}
