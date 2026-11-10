import { ClipboardList } from 'lucide-react';
import { cx } from '@/components/ui';

/** Nombre e icono de la app. Neutral: sin colores ni símbolos de partido. */
export function Marca({ className, compacta = false }: { className?: string; compacta?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2 font-semibold text-tinta', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-marca-600 text-white">
        <ClipboardList className="size-[18px]" aria-hidden />
      </span>
      {!compacta && <span className="text-[15px] tracking-tight">Encuestas</span>}
    </span>
  );
}

/** Marco de las pantallas de acceso (login e instalación). */
export function MarcoAcceso({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Marca className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {subtitulo && <p className="mt-1.5 text-[15px] leading-snug text-tinta-2">{subtitulo}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
