'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListChecks,
  Map as IconoMapa,
  MapPinned,
  Smartphone,
  Users,
} from 'lucide-react';
import { ProveedorPanel, usePanel } from '@/components/admin/contexto';
import { MenuCuenta } from '@/components/cuenta';
import { Marca } from '@/components/marca';
import { useAcceso } from '@/components/sesion';
import { Aviso, Insignia, PantallaCargando, Selector, cx } from '@/components/ui';
import { estadoDeEncuesta, nombreDeTipo } from '@/lib/encuesta/tipos';

const SECCIONES = [
  { ruta: '/admin', nombre: 'Tablero', icono: LayoutDashboard },
  { ruta: '/admin/resultados', nombre: 'Resultados', icono: BarChart3 },
  { ruta: '/admin/entrevistas', nombre: 'Entrevistas', icono: ListChecks },
  { ruta: '/admin/mapa', nombre: 'Mapa', icono: IconoMapa },
  { ruta: '/admin/muestra', nombre: 'Muestra', icono: MapPinned },
  { ruta: '/admin/usuarios', nombre: 'Usuarios', icono: Users },
  { ruta: '/admin/encuestas', nombre: 'Encuestas', icono: FileText },
] as const;

function Navegacion() {
  const ruta = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {SECCIONES.map((s) => {
        const actual = s.ruta === '/admin' ? ruta === '/admin' : ruta.startsWith(s.ruta);
        return (
          <Link
            key={s.ruta}
            href={s.ruta}
            aria-current={actual ? 'page' : undefined}
            className={cx(
              'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors',
              actual ? 'bg-marca-50 text-marca-800' : 'text-tinta-2 hover:bg-black/5 hover:text-tinta',
            )}
          >
            <s.icono className="size-[18px]" aria-hidden />
            {s.nombre}
          </Link>
        );
      })}
      <Link
        href="/encuestador"
        className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[15px] font-medium text-tinta-2 hover:bg-black/5 hover:text-tinta lg:mt-4 lg:border-t lg:border-linea lg:pt-4"
      >
        <Smartphone className="size-[18px]" aria-hidden />
        Levantar entrevista
      </Link>
    </nav>
  );
}

function SelectorDeEncuesta() {
  const { encuestas, encuesta, elegir } = usePanel();
  if (!encuesta) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ClipboardList className="hidden size-4 shrink-0 text-tinta-3 sm:block" aria-hidden />
      {encuestas.length > 1 ? (
        <Selector
          aria-label="Encuesta"
          value={encuesta.id}
          onChange={(e) => elegir(e.target.value)}
          className="h-9 max-w-64 min-w-0 text-sm"
        >
          {encuestas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.titulo}
            </option>
          ))}
        </Selector>
      ) : (
        <span className="truncate text-sm font-semibold">{encuesta.titulo}</span>
      )}
      <Insignia tono={estadoDeEncuesta(encuesta.estado).tono}>{estadoDeEncuesta(encuesta.estado).nombre}</Insignia>
      <Insignia tono="marca" className="hidden sm:inline-flex">
        {nombreDeTipo(encuesta.tipo)}
      </Insignia>
    </div>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  const { error } = usePanel();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col lg:flex-row">
      <aside className="no-imprimir border-b border-linea px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="mb-3 flex items-center justify-between lg:mb-6 lg:px-2">
          <Link href="/admin" aria-label="Encuestas: tablero">
            <Marca />
          </Link>
          <div className="lg:hidden">
            <MenuCuenta />
          </div>
        </div>
        <Navegacion />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-imprimir flex min-h-14 items-center justify-between gap-3 border-b border-linea px-4 py-2 lg:px-8">
          <SelectorDeEncuesta />
          <div className="hidden lg:block">
            <MenuCuenta />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">
          {error && (
            <Aviso tono="grave" className="mb-4">
              {error}
            </Aviso>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export default function PanelAdmin({ children }: { children: React.ReactNode }) {
  const identidad = useAcceso(['admin']);
  if (!identidad) return <PantallaCargando />;
  return (
    <ProveedorPanel>
      <Marco>{children}</Marco>
    </ProveedorPanel>
  );
}
