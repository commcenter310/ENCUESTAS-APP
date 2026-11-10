'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { guardar, leerCrudo, suscribir } from '@/lib/almacen';
import type { Encuesta } from '@/lib/encuesta/tipos';
import { esErrorDeRed, supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Consultas con recarga
// ---------------------------------------------------------------------------

type EstadoConsulta<T> = { datos: T | null; error: string | null; cargando: boolean; actualizando: boolean };

export function mensajeDeError(e: unknown): string {
  if (esErrorDeRed(e)) return 'No hay conexión. Revisa tu internet e intenta de nuevo.';
  const mensaje = (e as { message?: string })?.message;
  return mensaje ? `No se pudo cargar la información (${mensaje}).` : 'No se pudo cargar la información.';
}

/**
 * Ejecuta una consulta y la repite cuando cambia, cuando se pide recargar o
 * cada cierto tiempo. Mientras recarga conserva los datos anteriores para que
 * la pantalla no brinque.
 *
 * `consulta` debe venir de `useCallback`: la consulta se repite cuando cambia.
 */
export function useConsulta<T>(consulta: () => Promise<T>, cadaMs?: number) {
  const [estado, setEstado] = useState<EstadoConsulta<T>>({
    datos: null,
    error: null,
    cargando: true,
    actualizando: false,
  });
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vivo = true;
    consulta()
      .then((datos) => {
        if (vivo) setEstado({ datos, error: null, cargando: false, actualizando: false });
      })
      .catch((e) => {
        if (vivo) setEstado((a) => ({ ...a, error: mensajeDeError(e), cargando: false, actualizando: false }));
      });
    return () => {
      vivo = false;
    };
  }, [consulta, vuelta]);

  const recargar = useCallback(() => {
    setEstado((a) => ({ ...a, actualizando: true }));
    setVuelta((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!cadaMs) return;
    const reloj = setInterval(() => {
      // Con la pestaña oculta no vale la pena consultar.
      if (document.visibilityState === 'visible') setVuelta((v) => v + 1);
    }, cadaMs);
    return () => clearInterval(reloj);
  }, [cadaMs]);

  return { ...estado, recargar };
}

/** Lanza el error de Supabase (si lo hay) y devuelve los datos. */
export function exigir<T>(respuesta: { data: T | null; error: { message: string } | null }): T {
  if (respuesta.error) throw respuesta.error;
  return respuesta.data as T;
}

// ---------------------------------------------------------------------------
// Encuesta seleccionada en el panel
// ---------------------------------------------------------------------------

type ContextoPanel = {
  encuestas: Encuesta[];
  /** Encuesta que se está viendo en el panel (null si no hay ninguna). */
  encuesta: Encuesta | null;
  elegir: (id: string) => void;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
};

const Contexto = createContext<ContextoPanel | null>(null);

const CLAVE = 'panel:encuesta';
const suscribirEleccion = (oyente: () => void) => suscribir(CLAVE, oyente);
const eleccionGuardada = () => leerCrudo(CLAVE);
const sinEleccion = () => null;

export function ProveedorPanel({ children }: { children: React.ReactNode }) {
  const consulta = useCallback(
    async () =>
      exigir(
        await supabase().from('encuestas').select('*').order('creada_en', { ascending: true }),
      ) as unknown as Encuesta[],
    [],
  );
  const { datos, cargando, error, recargar } = useConsulta(consulta);
  const cruda = useSyncExternalStore(suscribirEleccion, eleccionGuardada, sinEleccion);

  const valor = useMemo<ContextoPanel>(() => {
    const encuestas = datos ?? [];
    let elegida: string | null = null;
    try {
      elegida = cruda ? (JSON.parse(cruda) as string) : null;
    } catch {
      elegida = null;
    }
    const encuesta =
      encuestas.find((e) => e.id === elegida) ??
      encuestas.find((e) => e.estado === 'activa') ??
      encuestas[0] ??
      null;
    return { encuestas, encuesta, elegir: (id) => guardar(CLAVE, id), cargando, error, recargar };
  }, [datos, cruda, cargando, error, recargar]);

  return <Contexto value={valor}>{children}</Contexto>;
}

export function usePanel(): ContextoPanel {
  const panel = useContext(Contexto);
  if (!panel) throw new Error('usePanel debe usarse dentro de <ProveedorPanel>');
  return panel;
}
