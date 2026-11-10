'use client';

/**
 * Piezas de gráficas del panel. Siguen unas pocas reglas fijas:
 *  - Un solo color para una sola serie; el color nunca codifica el tamaño.
 *  - NS/NC siempre en gris apagado.
 *  - A favor en azul, en contra en rojo, neutro en gris (cuando la opción
 *    declara su "tono"); el texto nunca lleva el color de la serie.
 *  - Marcas delgadas, extremo redondeado y base recta; 2 px de separación.
 *  - Cada valor se puede leer sin pasar el cursor (cifra visible o tabla).
 */
import { useId, useState } from 'react';
import { Table2 } from 'lucide-react';
import { cx } from '@/components/ui';
import type { FilaResultado } from '@/lib/encuesta/motor';
import type { Opcion } from '@/lib/encuesta/tipos';
import { diaCorto, diaLargo, entero, porcentaje } from '@/lib/formato';

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

/** Paleta categórica validada (orden fijo; no se recicla ni se generan más). */
const CATEGORICOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const POR_TONO: Record<NonNullable<Opcion['tono']>, string> = {
  positivo: 'var(--color-serie)',
  positivo_suave: 'var(--color-serie-suave)',
  neutro: 'var(--color-neutro)',
  negativo: 'var(--color-contra)',
};

/**
 * Color de cada opción de una pregunta con varias categorías por fila.
 * Si las opciones declaran tono se usa ese; si no, la paleta categórica en
 * orden. NS/NC siempre va en gris apagado.
 */
export function coloresDe(opciones: Opcion[]): Record<string, string> {
  const colores: Record<string, string> = {};
  let siguiente = 0;
  for (const o of opciones) {
    if (o.nsnc) colores[o.valor] = 'var(--color-apagado)';
    else if (o.tono) colores[o.valor] = POR_TONO[o.tono];
    else colores[o.valor] = CATEGORICOS[Math.min(siguiente++, CATEGORICOS.length - 1)];
  }
  return colores;
}

// ---------------------------------------------------------------------------
// Cifras
// ---------------------------------------------------------------------------

/** Cifra principal con etiqueta: el formato de los indicadores del tablero. */
export function Cifra({
  etiqueta,
  valor,
  detalle,
  children,
  className,
}: {
  etiqueta: string;
  valor: React.ReactNode;
  detalle?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={cx('rounded-2xl border border-black/10 bg-superficie p-4', className)}>
      <p className="text-sm text-tinta-2">{etiqueta}</p>
      <p className="mt-1 text-3xl leading-none font-semibold tracking-tight">{valor}</p>
      {detalle && <p className="mt-1.5 text-sm text-tinta-2">{detalle}</p>}
      {children}
    </div>
  );
}

/** Avance contra una meta: relleno y pista del mismo tono. */
export function Medidor({ valor, meta, etiqueta }: { valor: number; meta: number; etiqueta: string }) {
  const fraccion = meta > 0 ? Math.min(1, valor / meta) : 0;
  return (
    <div
      role="meter"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={meta}
      aria-valuenow={Math.min(valor, meta)}
      aria-valuetext={`${entero(valor)} de ${entero(meta)}`}
      className="h-2 overflow-hidden rounded-full bg-marca-100"
    >
      <div className="h-full rounded-full bg-marca-500" style={{ width: `${fraccion * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de barras (una serie): nombre, barra y cifra por renglón
// ---------------------------------------------------------------------------

export function ListaDeBarras({
  filas,
  sinNsnc = false,
  titulo,
}: {
  filas: FilaResultado[];
  /** Calcula los porcentajes sin contar NS/NC. */
  sinNsnc?: boolean;
  /** Nombre accesible de la lista. */
  titulo: string;
}) {
  const valorDe = (f: FilaResultado) => (sinNsnc ? (f.pctSinNsnc ?? 0) : f.pct);
  const maximo = Math.max(1, ...filas.map(valorDe));
  // La escala llega al valor más alto redondeado hacia arriba (mínimo 25 %),
  // para que barras chicas no se vean enormes en preguntas muy repartidas.
  const tope = Math.min(100, Math.max(25, Math.ceil(maximo / 5) * 5));

  return (
    <ul aria-label={titulo} className="flex flex-col gap-2">
      {filas.map((f) => {
        const excluida = sinNsnc && f.nsnc;
        const pct = valorDe(f);
        return (
          <li
            key={f.valor}
            tabIndex={0}
            className="group relative grid grid-cols-[minmax(0,2fr)_minmax(3rem,3fr)_auto] items-center gap-x-3 rounded-md text-sm outline-offset-4"
          >
            <span className={cx('truncate', f.nsnc ? 'text-tinta-3' : 'text-tinta')} title={f.etiqueta}>
              {f.etiqueta}
            </span>
            <span className="relative block h-3.5 border-l border-eje" aria-hidden>
              {!excluida && pct > 0 && (
                <span
                  className="absolute inset-y-0 left-0 block rounded-r-[4px] transition-[width,filter] duration-300 group-hover:brightness-110 group-focus-visible:brightness-110"
                  style={{
                    width: `${Math.max(0.75, (pct / tope) * 100)}%`,
                    background: f.nsnc ? 'var(--color-neutro)' : 'var(--color-serie)',
                  }}
                />
              )}
            </span>
            <span className="w-[5.5rem] text-right tabular-nums">
              <span className={cx('font-semibold', excluida && 'text-tinta-3')}>
                {excluida ? '–' : porcentaje(pct)}
              </span>
              <span className="ml-1.5 inline-block w-8 text-tinta-3">{entero(f.n)}</span>
            </span>
            <Flotante>
              <strong className="font-semibold">{entero(f.n)}</strong> {f.n === 1 ? 'respuesta' : 'respuestas'} ·{' '}
              {porcentaje(f.pct)} del total
              {f.pctSinNsnc !== null && <> · {porcentaje(f.pctSinNsnc)} sin NS/NC</>}
            </Flotante>
          </li>
        );
      })}
    </ul>
  );
}

/** Cuadro que aparece al pasar el cursor o enfocar con el teclado. */
function Flotante({ children, arriba = false }: { children: React.ReactNode; arriba?: boolean }) {
  return (
    <span
      role="tooltip"
      className={cx(
        'pointer-events-none absolute left-1/2 z-20 hidden -translate-x-1/2 rounded-lg bg-tinta px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg group-hover:block group-focus-visible:block',
        arriba ? 'bottom-full mb-1.5' : 'top-full mt-1',
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Barra segmentada delgada (un todo repartido), junto a sus cifras
// ---------------------------------------------------------------------------

export type Segmento = { valor: string; etiqueta: string; n: number; color: string };

export function BarraSegmentada({ segmentos, titulo }: { segmentos: Segmento[]; titulo: string }) {
  const total = segmentos.reduce((suma, s) => suma + s.n, 0);
  const descripcion = segmentos
    .map((s) => `${s.etiqueta} ${porcentaje(total ? (s.n / total) * 100 : 0, 0)}`)
    .join(', ');
  return (
    <div role="img" aria-label={`${titulo}: ${total ? descripcion : 'sin respuestas'}`} className="flex h-2 w-full gap-0.5">
      {total === 0 ? (
        <span className="h-full w-full rounded-full bg-linea" />
      ) : (
        segmentos
          .filter((s) => s.n > 0)
          .map((s) => (
            <span
              key={s.valor}
              title={`${s.etiqueta}: ${porcentaje((s.n / total) * 100)} (${entero(s.n)})`}
              className="h-full min-w-1 rounded-full"
              style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
            />
          ))
      )}
    </div>
  );
}

export function Leyenda({ elementos }: { elementos: { etiqueta: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-tinta-2">
      {elementos.map((e) => (
        <li key={e.etiqueta} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: e.color }} aria-hidden />
          {e.etiqueta}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Columnas por día (una serie en el tiempo)
// ---------------------------------------------------------------------------

function pasoBonito(maximo: number): number {
  const objetivo = Math.max(1, maximo) / 4;
  const potencia = 10 ** Math.floor(Math.log10(objetivo));
  const candidato = [1, 2, 5, 10].find((m) => m * potencia >= objetivo) ?? 10;
  return Math.max(1, candidato * potencia);
}

/** Rellena con cero los días sin entrevistas entre el primero y el último. */
function completarDias(datos: { dia: string; n: number }[], maxDias: number): { dia: string; n: number }[] {
  if (datos.length === 0) return [];
  const porDia = new Map(datos.map((d) => [d.dia, d.n]));
  const [a, m, d] = datos[datos.length - 1].dia.split('-').map(Number);
  const fin = Date.UTC(a, m - 1, d);
  const [a0, m0, d0] = datos[0].dia.split('-').map(Number);
  const inicio = Math.max(Date.UTC(a0, m0 - 1, d0), fin - (maxDias - 1) * 86400000);
  const salida: { dia: string; n: number }[] = [];
  for (let t = inicio; t <= fin; t += 86400000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    salida.push({ dia, n: porDia.get(dia) ?? 0 });
  }
  return salida;
}

export function ColumnasPorDia({ datos, unidad = 'entrevistas' }: { datos: { dia: string; n: number }[]; unidad?: string }) {
  const [tabla, setTabla] = useState(false);
  const idTitulo = useId();
  const dias = completarDias(datos, 31);
  const maximo = Math.max(0, ...dias.map((d) => d.n));
  const paso = pasoBonito(maximo);
  const tope = Math.max(paso, Math.ceil(maximo / paso) * paso);
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  const indiceMaximo = dias.findIndex((d) => d.n === maximo);
  // Solo se rotulan el día más alto y el más reciente; el resto lo dan el eje y la tabla.
  const rotulados = new Set([indiceMaximo, dias.length - 1]);
  const cadaCuantos = Math.ceil(dias.length / 8);

  if (dias.length === 0) {
    return <p className="py-8 text-center text-sm text-tinta-3">Todavía no hay entrevistas.</p>;
  }

  return (
    <figure>
      <div className="mb-3 flex items-center justify-between gap-3">
        <figcaption id={idTitulo} className="text-sm text-tinta-2">
          Entrevistas efectivas por día
        </figcaption>
        <button
          type="button"
          onClick={() => setTabla((t) => !t)}
          aria-pressed={tabla}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-tinta-2 hover:bg-black/5"
        >
          <Table2 className="size-4" aria-hidden />
          {tabla ? 'Ver gráfica' : 'Ver tabla'}
        </button>
      </div>

      {tabla ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm" aria-labelledby={idTitulo}>
            <thead className="text-left text-tinta-2">
              <tr>
                <th className="py-1 font-medium">Día</th>
                <th className="py-1 text-right font-medium capitalize">{unidad}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {dias.map((d) => (
                <tr key={d.dia} className="border-t border-linea">
                  <td className="py-1 capitalize">{diaLargo(d.dia)}</td>
                  <td className="py-1 text-right">{entero(d.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2" aria-labelledby={idTitulo} role="group">
          {/* Eje vertical */}
          <div className="relative h-44 w-8 shrink-0 text-xs text-tinta-3 tabular-nums" aria-hidden>
            {marcas.map((m) => (
              <span
                key={m}
                className="absolute right-0 translate-y-1/2 leading-none"
                style={{ bottom: `${(m / tope) * 100}%` }}
              >
                {entero(m)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-44">
              {marcas.map((m) => (
                <span
                  key={m}
                  aria-hidden
                  className={cx('absolute inset-x-0 border-t', m === 0 ? 'border-eje' : 'border-linea')}
                  style={{ bottom: `${(m / tope) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-end justify-around gap-0.5">
                {dias.map((d, i) => (
                  <div
                    key={d.dia}
                    tabIndex={0}
                    role="img"
                    aria-label={`${diaLargo(d.dia)}: ${entero(d.n)} ${unidad}`}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-offset-0"
                  >
                    {rotulados.has(i) && d.n > 0 && (
                      <span
                        className="absolute text-xs font-semibold text-tinta tabular-nums"
                        style={{ bottom: `calc(${(d.n / tope) * 100}% + 4px)` }}
                        aria-hidden
                      >
                        {entero(d.n)}
                      </span>
                    )}
                    <span
                      aria-hidden
                      className="block w-full max-w-6 rounded-t-[4px] bg-serie transition-[height,filter] duration-300 group-hover:brightness-110 group-focus-visible:brightness-110"
                      style={{ height: d.n > 0 ? `max(2px, ${(d.n / tope) * 100}%)` : 0 }}
                    />
                    <Flotante arriba>
                      <strong className="font-semibold">{entero(d.n)}</strong> {unidad} ·{' '}
                      <span className="capitalize">{diaLargo(d.dia)}</span>
                    </Flotante>
                  </div>
                ))}
              </div>
            </div>
            {/* Eje horizontal */}
            <div className="mt-1.5 flex justify-around gap-0.5 text-xs text-tinta-3" aria-hidden>
              {dias.map((d, i) => (
                <span key={d.dia} className="min-w-0 flex-1 text-center whitespace-nowrap">
                  {i % cadaCuantos === 0 || i === dias.length - 1 ? diaCorto(d.dia) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Columnas chicas para una escala (1 a 10)
// ---------------------------------------------------------------------------

export function ColumnasDeEscala({ filas, titulo }: { filas: FilaResultado[]; titulo: string }) {
  const numericas = filas.filter((f) => !f.nsnc);
  const maximo = Math.max(1, ...numericas.map((f) => f.pctSinNsnc ?? 0));
  return (
    <div role="group" aria-label={titulo}>
      <div className="flex h-24 items-end gap-0.5 border-b border-eje">
        {numericas.map((f) => (
          <div
            key={f.valor}
            tabIndex={0}
            role="img"
            aria-label={`Calificación ${f.etiqueta}: ${porcentaje(f.pctSinNsnc)} (${entero(f.n)})`}
            className="group relative flex h-full flex-1 items-end justify-center outline-offset-0"
          >
            <span
              aria-hidden
              className="block w-full max-w-6 rounded-t-[4px] bg-serie group-hover:brightness-110 group-focus-visible:brightness-110"
              style={{ height: f.n > 0 ? `max(2px, ${((f.pctSinNsnc ?? 0) / maximo) * 100}%)` : 0 }}
            />
            <Flotante arriba>
              Calificación {f.etiqueta}: <strong className="font-semibold">{porcentaje(f.pctSinNsnc)}</strong> (
              {entero(f.n)})
            </Flotante>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-xs text-tinta-3 tabular-nums" aria-hidden>
        {numericas.map((f) => (
          <span key={f.valor} className="flex-1 text-center">
            {f.etiqueta}
          </span>
        ))}
      </div>
    </div>
  );
}
