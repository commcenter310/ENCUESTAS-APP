'use client';

import { useCallback, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, useConsulta } from '@/components/admin/contexto';
import { BarraSegmentada, ColumnasDeEscala, Leyenda, ListaDeBarras, coloresDe } from '@/components/admin/graficas';
import { Aviso, Boton, Cargando, Tarjeta, cx } from '@/components/ui';
import { clavesCerradas } from '@/lib/encuesta/columnas';
import { OPCIONES_CONOCE, opcionesDeEscala, resolverOpciones } from '@/lib/encuesta/opciones';
import { type Conteo, promedioDeEscala, resumirConteo } from '@/lib/encuesta/reportes';
import type { DefinicionEncuesta, Encuesta, Opcion, Pregunta } from '@/lib/encuesta/tipos';
import { entero, porcentaje } from '@/lib/formato';
import { supabase } from '@/lib/supabase';

type Conteos = Record<string, Conteo>;

function RespuestasAbiertas({ encuestaId, clave, rotulo }: { encuestaId: string; clave: string; rotulo: string }) {
  const [abierto, setAbierto] = useState(false);
  const consulta = useCallback(
    async () =>
      abierto
        ? (exigir(
            await supabase().rpc('respuestas_abiertas', { p_encuesta: encuestaId, p_clave: clave, p_limite: 300 }),
          ) as { texto: string; n: number }[])
        : null,
    [abierto, encuestaId, clave],
  );
  const { datos, error } = useConsulta(consulta);

  return (
    <div>
      <Boton variante="secundario" tamano="chico" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
        {abierto ? 'Ocultar' : rotulo}
      </Boton>
      {abierto &&
        (error ? (
          <Aviso tono="grave" className="mt-3">
            {error}
          </Aviso>
        ) : !datos ? (
          <Cargando className="py-4" />
        ) : datos.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-3">Sin respuestas todavía.</p>
        ) : (
          <ul className="mt-3 max-h-80 divide-y divide-linea overflow-y-auto rounded-xl border border-linea text-sm">
            {datos.map((r) => (
              <li key={r.texto} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
                <span className="min-w-0 break-words">{r.texto}</span>
                <span className="shrink-0 text-tinta-2 tabular-nums">{entero(r.n)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** Tabla con una barra segmentada por fila (matrices y opinión). */
function TablaSegmentada({
  filas,
  columnas,
  conteoDe,
  sinNsnc,
  primeraColumna,
  extra,
}: {
  filas: Opcion[];
  columnas: Opcion[];
  conteoDe: (fila: Opcion) => Conteo | undefined;
  sinNsnc: boolean;
  primeraColumna: string;
  /** Columna adicional antes de las categorías (p. ej. "Conoce"). */
  extra?: { titulo: string; celda: (fila: Opcion) => React.ReactNode };
}) {
  const visibles = sinNsnc ? columnas.filter((c) => !c.nsnc) : columnas;
  const colores = coloresDe(columnas);
  return (
    <div>
      <div className="mb-3">
        <Leyenda elementos={visibles.map((c) => ({ etiqueta: c.etiqueta, color: colores[c.valor] }))} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-linea text-tinta-2">
            <tr>
              <th className="py-2 pr-3 text-left font-medium">{primeraColumna}</th>
              {extra && <th className="px-2 py-2 text-right font-medium">{extra.titulo}</th>}
              {visibles.map((c) => (
                <th key={c.valor} className="px-2 py-2 text-right font-medium">
                  {c.etiqueta}
                </th>
              ))}
              <th className="w-[28%] py-2 pl-3 text-left font-medium">
                <span className="sr-only">Distribución</span>
              </th>
              <th className="py-2 pl-2 text-right font-medium">Base</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {filas.map((f) => {
              const { filas: resumen, base, baseSinNsnc } = resumirConteo(columnas, conteoDe(f));
              const porValor = Object.fromEntries(resumen.map((r) => [r.valor, r]));
              return (
                <tr key={f.valor} className="border-b border-linea last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {f.etiqueta}
                  </th>
                  {extra && <td className="px-2 py-2 text-right">{extra.celda(f)}</td>}
                  {visibles.map((c) => {
                    const r = porValor[c.valor];
                    return (
                      <td key={c.valor} className="px-2 py-2 text-right">
                        {(sinNsnc ? baseSinNsnc : base) === 0 ? '–' : porcentaje(sinNsnc ? r.pctSinNsnc : r.pct, 0)}
                      </td>
                    );
                  })}
                  <td className="py-2 pl-3">
                    <BarraSegmentada
                      titulo={f.etiqueta}
                      segmentos={visibles.map((c) => ({
                        valor: c.valor,
                        etiqueta: c.etiqueta,
                        n: porValor[c.valor]?.n ?? 0,
                        color: colores[c.valor],
                      }))}
                    />
                  </td>
                  <td className="py-2 pl-2 text-right text-tinta-3">{entero(sinNsnc ? baseSinNsnc : base)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BloqueDePregunta({
  def,
  pregunta: p,
  conteos,
  sinNsnc,
  encuestaId,
}: {
  def: DefinicionEncuesta;
  pregunta: Pregunta;
  conteos: Conteos;
  sinNsnc: boolean;
  encuestaId: string;
}) {
  switch (p.tipo) {
    case 'unica': {
      const opciones = resolverOpciones(def, p.opciones);
      const { filas, base, baseSinNsnc } = resumirConteo(opciones, conteos[p.id]);
      return (
        <Marco pregunta={p} base={sinNsnc ? baseSinNsnc : base}>
          <ListaDeBarras titulo={p.texto} filas={filas} sinNsnc={sinNsnc} />
          {opciones.some((o) => o.especificar) && (
            <div className="no-imprimir mt-4">
              <RespuestasAbiertas encuestaId={encuestaId} clave={`${p.id}_otro`} rotulo="Ver respuestas de “Otro”" />
            </div>
          )}
        </Marco>
      );
    }
    case 'escala': {
      const { filas, base } = resumirConteo(opcionesDeEscala(p.min, p.max, p.nsnc), conteos[p.id]);
      const { promedio, n } = promedioDeEscala(conteos[p.id]);
      const nsnc = filas.find((f) => f.nsnc);
      return (
        <Marco pregunta={p} base={sinNsnc ? n : base}>
          <div className="grid items-end gap-6 sm:grid-cols-[auto_1fr]">
            <div>
              <p className="text-sm text-tinta-2">Promedio</p>
              <p className="text-4xl leading-none font-semibold tracking-tight">
                {promedio === null ? '–' : promedio.toFixed(1)}
              </p>
              <p className="mt-1.5 text-sm text-tinta-3">
                escala {p.min} a {p.max}
                {nsnc && base > 0 && <> · NS/NC {porcentaje(nsnc.pct, 0)}</>}
              </p>
            </div>
            <ColumnasDeEscala titulo={`Distribución de calificaciones: ${p.texto}`} filas={filas} />
          </div>
        </Marco>
      );
    }
    case 'matriz':
      return (
        <Marco pregunta={p}>
          <TablaSegmentada
            primeraColumna=""
            filas={resolverOpciones(def, p.filas)}
            columnas={p.columnas}
            conteoDe={(f) => conteos[`${p.id}.${f.valor}`]}
            sinNsnc={sinNsnc}
          />
        </Marco>
      );
    case 'conocimiento':
      return (
        <Marco pregunta={p} nota="La opinión se calcula entre quienes sí conocen a la persona.">
          <TablaSegmentada
            primeraColumna="Persona"
            filas={resolverOpciones(def, p.filas)}
            columnas={p.opinion}
            conteoDe={(f) => conteos[`${p.id}.${f.valor}.opinion`]}
            sinNsnc={sinNsnc}
            extra={{
              titulo: 'Conoce',
              celda: (f) => {
                const { filas, base } = resumirConteo(OPCIONES_CONOCE, conteos[`${p.id}.${f.valor}.conoce`]);
                return base === 0 ? '–' : <strong className="font-semibold">{porcentaje(filas[0].pct, 0)}</strong>;
              },
            }}
          />
        </Marco>
      );
    case 'atributos': {
      const personas = [...resolverOpciones(def, p.personas), ...(p.opcionesFijas ?? [])];
      const resumenes = p.atributos.map((a) => resumirConteo(personas, conteos[`${p.id}.${a.valor}`]));
      return (
        <Marco pregunta={p} nota="Porcentaje de menciones por característica. Más oscuro = más menciones.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-sm">
              <thead className="text-tinta-2">
                <tr>
                  <th className="py-2 pr-3 text-left font-medium">Persona</th>
                  {p.atributos.map((a) => (
                    <th key={a.valor} className="max-w-28 px-2 py-2 text-right align-bottom leading-tight font-medium">
                      {a.etiqueta}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {personas.map((persona, i) => (
                  <tr key={persona.valor}>
                    <th scope="row" className={cx('py-1.5 pr-3 text-left font-medium', persona.fija && 'text-tinta-2')}>
                      {persona.etiqueta}
                    </th>
                    {resumenes.map((r, j) => {
                      const pct = r.filas[i].pct;
                      return (
                        <td
                          key={p.atributos[j].valor}
                          className="rounded-md px-2 py-1.5 text-right"
                          style={{
                            // Una sola tinta: la intensidad sigue al porcentaje.
                            background:
                              r.base > 0 && pct > 0
                                ? `color-mix(in oklab, var(--color-serie) ${Math.round(Math.min(55, pct * 0.9 + 4))}%, transparent)`
                                : undefined,
                          }}
                        >
                          {r.base === 0 ? '–' : porcentaje(pct, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="text-tinta-3">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    Base
                  </th>
                  {resumenes.map((r, j) => (
                    <td key={p.atributos[j].valor} className="px-2 py-1.5 text-right">
                      {entero(r.base)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Marco>
      );
    }
    case 'abierta':
      return (
        <Marco pregunta={p} nota="Pregunta abierta: respuestas textuales agrupadas.">
          <div className="no-imprimir">
            <RespuestasAbiertas encuestaId={encuestaId} clave={p.id} rotulo="Ver respuestas" />
          </div>
        </Marco>
      );
    case 'grupo':
      return (
        <>
          {p.campos
            .filter((c) => c.tipo === 'unica')
            .map((c) => (
              <BloqueDePregunta
                key={c.id}
                def={def}
                pregunta={c}
                conteos={conteos}
                sinNsnc={sinNsnc}
                encuestaId={encuestaId}
              />
            ))}
        </>
      );
    case 'numero':
      return null;
  }
}

function Marco({
  pregunta,
  base,
  nota,
  children,
}: {
  pregunta: Pregunta;
  base?: number;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <Tarjeta role="group" aria-label={pregunta.texto} className="break-inside-avoid p-5">
      <div className="mb-4">
        <h3 className="text-base leading-snug font-semibold">
          {pregunta.numero && <span className="mr-1.5 text-tinta-3">{pregunta.numero}.</span>}
          {pregunta.texto}
        </h3>
        {(nota || base !== undefined) && (
          <p className="mt-1 text-sm text-tinta-3">
            {base !== undefined && <>Base: {entero(base)} respuestas</>}
            {base !== undefined && nota && ' · '}
            {nota}
          </p>
        )}
      </div>
      {children}
    </Tarjeta>
  );
}

function ResultadosDeEncuesta({ encuesta }: { encuesta: Encuesta }) {
  const def = encuesta.definicion;
  const claves = useMemo(() => clavesCerradas(def), [def]);
  const [sinNsnc, setSinNsnc] = useState(false);

  const consulta = useCallback(async () => {
    const [conteos, total] = await Promise.all([
      supabase().rpc('resultados_encuesta', { p_encuesta: encuesta.id, p_claves: claves }),
      supabase()
        .from('entrevistas')
        .select('id', { count: 'exact', head: true })
        .eq('encuesta_id', encuesta.id)
        .eq('resultado', 'completa')
        .neq('revision', 'anulada'),
    ]);
    if (total.error) throw total.error;
    return { conteos: exigir(conteos) as Conteos, efectivas: total.count ?? 0 };
  }, [encuesta.id, claves]);

  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta);

  return (
    <>
      <Encabezado
        titulo="Resultados"
        descripcion={
          datos
            ? `${entero(datos.efectivas)} entrevistas efectivas (completas y no anuladas). Porcentajes sin ponderar.`
            : 'Respuestas por pregunta.'
        }
      >
        <div
          role="group"
          aria-label="Cómo calcular los porcentajes"
          className="flex rounded-lg border border-eje bg-white p-0.5 text-sm"
        >
          {[
            { valor: false, texto: 'Con NS/NC' },
            { valor: true, texto: 'Sin NS/NC' },
          ].map((o) => (
            <button
              key={o.texto}
              type="button"
              aria-pressed={sinNsnc === o.valor}
              onClick={() => setSinNsnc(o.valor)}
              className={cx(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                sinNsnc === o.valor ? 'bg-marca-600 text-white' : 'text-tinta-2 hover:bg-black/5',
              )}
            >
              {o.texto}
            </button>
          ))}
        </div>
        <BotonActualizar alOprimir={recargar} girando={actualizando} />
        <Boton variante="secundario" tamano="chico" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Imprimir
        </Boton>
      </Encabezado>

      {!datos ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : datos.efectivas === 0 ? (
        <Tarjeta className="px-4 py-12 text-center">
          <p className="font-medium text-tinta-2">Todavía no hay entrevistas efectivas</p>
          <p className="mt-1 text-sm text-tinta-3">Los resultados aparecerán aquí conforme lleguen del campo.</p>
        </Tarjeta>
      ) : (
        <div className={cx('flex flex-col gap-8 transition-opacity', actualizando && 'opacity-60')}>
          {error && <Aviso tono="aviso">{error} Se muestran los últimos datos cargados.</Aviso>}
          {def.secciones.map((seccion) => (
            <section key={seccion.id} aria-labelledby={`seccion-${seccion.id}`}>
              <h2 id={`seccion-${seccion.id}`} className="mb-3 text-lg font-semibold">
                {seccion.titulo}
              </h2>
              <div className="flex flex-col gap-4">
                {seccion.preguntas.map((p) => (
                  <BloqueDePregunta
                    key={p.id}
                    def={def}
                    pregunta={p}
                    conteos={datos.conteos}
                    sinNsnc={sinNsnc}
                    encuestaId={encuesta.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export default function PaginaResultados() {
  return <ConEncuesta>{(encuesta) => <ResultadosDeEncuesta encuesta={encuesta} />}</ConEncuesta>;
}
