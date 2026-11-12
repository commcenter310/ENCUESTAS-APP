'use client';

import { RefreshCw } from 'lucide-react';
import { usePanel } from '@/components/admin/contexto';
import { Aviso, Boton, Cargando, Tarjeta, Vacio, cx } from '@/components/ui';
import type { Encuesta } from '@/lib/encuesta/tipos';

export function Encabezado({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-1 text-[15px] text-tinta-2">{descripcion}</p>}
      </div>
      {children && <div className="no-imprimir flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function BotonActualizar({ alOprimir, girando }: { alOprimir: () => void; girando: boolean }) {
  return (
    <Boton variante="secundario" tamano="chico" onClick={alOprimir}>
      <RefreshCw className={cx('size-4', girando && 'animate-spin')} aria-hidden />
      Actualizar
    </Boton>
  );
}

export function TituloDeBloque({ children, detalle }: { children: React.ReactNode; detalle?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-base font-semibold">{children}</h2>
      {detalle && <span className="text-sm text-tinta-3">{detalle}</span>}
    </div>
  );
}

/**
 * Muestra el contenido de una pantalla que depende de la encuesta elegida.
 * Se vuelve a montar al cambiar de encuesta para no mezclar datos de dos.
 */
export function ConEncuesta({ children }: { children: (encuesta: Encuesta) => React.ReactNode }) {
  const { encuesta, cargando } = usePanel();
  if (cargando) return <Cargando />;
  if (!encuesta) {
    return (
      <Tarjeta>
        <Vacio titulo="Todavía no hay encuestas">Crea o importa una en la sección Encuestas.</Vacio>
      </Tarjeta>
    );
  }
  return <div key={encuesta.id}>{children(encuesta)}</div>;
}

/** Estado de una consulta: cargando, error o nada (cuando ya hay datos). */
export function EstadoDeConsulta({ cargando, error }: { cargando: boolean; error: string | null }) {
  if (cargando) return <Cargando />;
  if (error) return <Aviso tono="grave">{error}</Aviso>;
  return null;
}
