'use client';

import { Megaphone, X } from 'lucide-react';

/** Instrucción para el encuestador: no se lee al entrevistado. */
export function Instruccion({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-aviso/15 px-3 py-2.5 text-[15px] leading-snug text-aviso-texto">
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">Instrucción para el encuestador: </span>
        {children}
      </span>
    </p>
  );
}

/** Pantalla de captura: encabezado con avance, contenido y envío con Enter. */
export function Marco({
  titulo,
  progreso,
  detalle,
  version,
  alAbrirMenu,
  alEnviar,
  children,
}: {
  titulo: string;
  progreso: number | null;
  detalle?: string;
  version?: string;
  alAbrirMenu: (() => void) | null;
  /** Lo que hace la tecla Enter ("Ir" en el teclado del celular). */
  alEnviar?: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      noValidate
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        alEnviar?.();
      }}
    >
      <header className="sticky top-0 z-10 border-b border-linea bg-plano/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-tinta-2">{titulo}</p>
          </div>
          {detalle && <span className="shrink-0 text-sm text-tinta-3 tabular-nums">{detalle}</span>}
          {version && (
            <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-xs font-semibold text-tinta-2">
              V{version}
            </span>
          )}
          {alAbrirMenu && (
            <button
              type="button"
              onClick={alAbrirMenu}
              aria-label="Opciones de la entrevista"
              className="-mr-2 rounded-lg p-2 text-tinta-2 hover:bg-black/5"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        {progreso !== null && (
          <div
            className="h-1 bg-marca-100"
            role="progressbar"
            aria-label="Avance de la entrevista"
            aria-valuenow={Math.round(progreso * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-marca-600 transition-[width] duration-300"
              style={{ width: `${Math.round(progreso * 100)}%` }}
            />
          </div>
        )}
      </header>
      <main className="flex-1 px-4 pt-5 pb-28">{children}</main>
    </form>
  );
}

/** Barra fija de acciones al pie, al alcance del pulgar. */
export function Pie({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-linea bg-plano/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
