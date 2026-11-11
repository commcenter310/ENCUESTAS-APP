'use client';

import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

/** Une clases ignorando valores vacíos. */
export function cx(...clases: (string | false | null | undefined)[]): string {
  return clases.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Botón
// ---------------------------------------------------------------------------

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';
type Tamano = 'chico' | 'normal' | 'grande';

const VARIANTES: Record<Variante, string> = {
  primario:
    'bg-marca-600 text-white hover:bg-marca-700 active:bg-marca-800 disabled:bg-marca-200 disabled:text-white',
  secundario:
    'bg-white text-tinta border border-eje hover:bg-plano active:bg-linea disabled:text-tinta-3 disabled:bg-white',
  fantasma: 'text-tinta-2 hover:bg-black/5 active:bg-black/10 disabled:text-tinta-3',
  peligro:
    'bg-white text-grave-texto border border-grave/40 hover:bg-grave/5 active:bg-grave/10 disabled:opacity-50',
};

const TAMANOS: Record<Tamano, string> = {
  chico: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  normal: 'h-11 px-4 text-[15px] gap-2 rounded-xl',
  grande: 'h-14 px-6 text-base gap-2 rounded-2xl',
};

export function Boton({
  variante = 'primario',
  tamano = 'normal',
  cargando = false,
  ancho = false,
  className,
  children,
  disabled,
  type = 'button',
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  tamano?: Tamano;
  cargando?: boolean;
  /** Ocupa todo el ancho disponible. */
  ancho?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-semibold transition-colors select-none disabled:cursor-not-allowed',
        VARIANTES[variante],
        TAMANOS[tamano],
        ancho && 'w-full',
        className,
      )}
      {...resto}
    >
      {cargando && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Campos de formulario
// ---------------------------------------------------------------------------

/** Ancho completo, salvo que quien lo usa indique otro ancho (w-auto, w-28, max-w-…). */
function ancho(className?: string): string | false {
  return !/(^|\s)w-/.test(className ?? '') && 'w-full';
}

const ESTILO_ENTRADA =
  'rounded-xl border border-eje bg-white px-3.5 text-tinta placeholder:text-tinta-3 focus:border-marca-500 focus:outline-none focus:ring-2 focus:ring-marca-500/25 disabled:bg-plano disabled:text-tinta-3';

export function Campo({
  etiqueta,
  ayuda,
  error,
  children,
  className,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const describe = error || ayuda ? idAyuda : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-tinta-2">
        {etiqueta}
      </label>
      {children({ id, 'aria-describedby': describe, 'aria-invalid': error ? true : undefined })}
      {(error || ayuda) && (
        <p id={idAyuda} className={cx('text-sm', error ? 'text-grave-texto' : 'text-tinta-3')}>
          {error || ayuda}
        </p>
      )}
    </div>
  );
}

export function Entrada({ className, ...resto }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(ESTILO_ENTRADA, ancho(className), 'h-12', className)} {...resto} />;
}

export function AreaTexto({ className, ...resto }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(ESTILO_ENTRADA, 'w-full min-h-28 py-3 leading-snug', className)} {...resto} />;
}

export function Selector({ className, children, ...resto }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(ESTILO_ENTRADA, ancho(className), 'h-11 pr-8', className)} {...resto}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Contenedores y avisos
// ---------------------------------------------------------------------------

export function Tarjeta({ className, children, ...resto }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-2xl border border-black/10 bg-superficie', className)}
      {...resto}
    >
      {children}
    </div>
  );
}

type Tono = 'neutro' | 'marca' | 'bien' | 'aviso' | 'grave';

const TONOS_INSIGNIA: Record<Tono, string> = {
  neutro: 'bg-black/5 text-tinta-2',
  marca: 'bg-marca-50 text-marca-800',
  bien: 'bg-bien/10 text-bien-texto',
  aviso: 'bg-aviso/20 text-aviso-texto',
  grave: 'bg-grave/10 text-grave-texto',
};

export function Insignia({
  tono = 'neutro',
  children,
  className,
}: {
  tono?: Tono;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONOS_INSIGNIA[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

const TONOS_AVISO: Record<Exclude<Tono, 'neutro'>, { caja: string; icono: React.ReactNode }> = {
  marca: { caja: 'border-marca-200 bg-marca-50 text-marca-900', icono: <Info className="size-5" aria-hidden /> },
  bien: {
    caja: 'border-bien/30 bg-bien/10 text-bien-texto',
    icono: <CheckCircle2 className="size-5" aria-hidden />,
  },
  aviso: {
    caja: 'border-aviso/50 bg-aviso/15 text-aviso-texto',
    icono: <AlertTriangle className="size-5" aria-hidden />,
  },
  grave: {
    caja: 'border-grave/30 bg-grave/10 text-grave-texto',
    icono: <XCircle className="size-5" aria-hidden />,
  },
};

export function Aviso({
  tono = 'marca',
  titulo,
  children,
  className,
}: {
  tono?: Exclude<Tono, 'neutro'>;
  titulo?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const estilo = TONOS_AVISO[tono];
  return (
    <div
      role={tono === 'grave' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-xl border px-3.5 py-3 text-sm leading-snug', estilo.caja, className)}
    >
      <span className="mt-px shrink-0">{estilo.icono}</span>
      <div className="min-w-0">
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children && <div className={titulo ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
    </div>
  );
}

export function Cargando({ texto = 'Cargando…', className }: { texto?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-tinta-3', className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

export function PantallaCargando({ texto }: { texto?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Cargando texto={texto} />
    </div>
  );
}

export function Vacio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium text-tinta-2">{titulo}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-tinta-3">{children}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ventana modal
// ---------------------------------------------------------------------------

export function Modal({
  abierto,
  titulo,
  alCerrar,
  children,
  ancho = 'max-w-md',
}: {
  abierto: boolean;
  titulo: string;
  alCerrar: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onClose={alCerrar}
      onClick={(e) => {
        // Un clic fuera del contenido (sobre el fondo) cierra la ventana.
        if (e.target === ref.current) alCerrar();
      }}
      className={cx(
        'm-auto w-[calc(100%-2rem)] rounded-2xl border border-black/10 bg-superficie p-0 text-tinta shadow-xl backdrop:bg-black/40',
        ancho,
      )}
    >
      {abierto && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-linea px-5 py-3.5">
            <h2 id={idTitulo} className="text-base font-semibold">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={alCerrar}
              aria-label="Cerrar"
              className="-mr-1.5 rounded-lg p-1.5 text-tinta-3 hover:bg-black/5 hover:text-tinta"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
