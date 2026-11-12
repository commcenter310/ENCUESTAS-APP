'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta, TituloDeBloque } from '@/components/admin/comunes';
import { exigir, useConsulta } from '@/components/admin/contexto';
import { Cifra, ColumnasPorDia, ListaDeBarras, Medidor } from '@/components/admin/graficas';
import { Aviso, Insignia, Tarjeta, Vacio, cx } from '@/components/ui';
import { columnasDeRespuestas } from '@/lib/encuesta/columnas';
import { resumirConteo, type Conteo } from '@/lib/encuesta/reportes';
import type { Encuesta } from '@/lib/encuesta/tipos';
import { duracion, entero, haceCuanto, porcentaje } from '@/lib/formato';
import { etiquetasZona } from '@/lib/encuesta/monitoreo';
import { avanceDeMuestra } from '@/lib/muestra-avance';
import { leerMuestra } from '@/lib/muestra-datos';
import { supabase } from '@/lib/supabase';

type Totales = {
  efectivas: number;
  hoy: number;
  no_elegibles: number;
  anuladas: number;
  validadas: number;
  pendientes: number;
  cortas: number;
  sin_gps: number;
  duracion_mediana: number | null;
  encuestadores: number;
  zonas: number;
  ultima: string | null;
};

type PorEncuestador = {
  id: string;
  nombre: string;
  activo: boolean;
  efectivas: number;
  hoy: number;
  no_elegibles: number;
  anuladas: number;
  cortas: number;
  sin_gps: number;
  duracion_mediana: number | null;
  ultima: string | null;
};

type Tablero = {
  totales: Totales;
  por_dia: { dia: string; n: number }[];
  por_encuestador: PorEncuestador[];
  por_zona: { zona: string; n: number }[];
};

const CADA_MINUTO = 60000;

function TableroDeEncuesta({ encuesta }: { encuesta: Encuesta }) {
  const def = encuesta.definicion;
  const clavesPerfil = useMemo(() => def.monitoreo?.perfil ?? [], [def]);

  const consulta = useCallback(async () => {
    const [tablero, perfil, muestra] = await Promise.all([
      supabase().rpc('tablero_encuesta', { p_encuesta: encuesta.id }),
      clavesPerfil.length > 0
        ? supabase().rpc('resultados_encuesta', {
            p_encuesta: encuesta.id,
            p_claves: clavesPerfil,
          })
        : Promise.resolve({ data: {}, error: null }),
      leerMuestra(encuesta.id),
    ]);
    return {
      tablero: exigir(tablero) as Tablero,
      perfil: exigir(perfil) as Record<string, Conteo>,
      muestra,
    };
  }, [encuesta.id, clavesPerfil]);

  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta, CADA_MINUTO);

  const meta = encuesta.meta_muestra;
  const metaZona = def.monitoreo?.metaPorZona ?? null;
  const { singular: etiquetaZona, plural: etiquetaZonas } = etiquetasZona(def);
  const minimo = def.monitoreo?.duracionMinimaSeg ?? 0;
  const columnas = useMemo(() => columnasDeRespuestas(def), [def]);

  // Con muestra cargada, el avance se mide contra el tope de cada sección.
  const avanceMuestra = useMemo(() => {
    if (!datos || datos.muestra.length === 0) return null;
    return avanceDeMuestra(datos.muestra, Object.fromEntries(datos.tablero.por_zona.map((z) => [z.zona, z.n])));
  }, [datos]);
  const enFuera = avanceMuestra?.fuera.reduce((s, [, n]) => s + n, 0) ?? 0;

  return (
    <>
      <Encabezado
        titulo="Tablero"
        descripcion={
          datos?.tablero.totales.ultima
            ? `Última entrevista ${haceCuanto(datos.tablero.totales.ultima)}. Se actualiza solo cada minuto.`
            : 'Avance del levantamiento en campo.'
        }
      >
        <BotonActualizar alOprimir={recargar} girando={actualizando} />
      </Encabezado>

      {!datos ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : (
        <div className={cx('flex flex-col gap-4 transition-opacity', actualizando && 'opacity-60')}>
          {error && <Aviso tono="aviso">{error} Se muestran los últimos datos cargados.</Aviso>}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Cifra
              className="col-span-2"
              etiqueta="Entrevistas efectivas"
              valor={
                <>
                  {entero(datos.tablero.totales.efectivas)}
                  {meta && <span className="ml-2 text-lg font-normal text-tinta-3">de {entero(meta)}</span>}
                </>
              }
              detalle={
                meta
                  ? `${porcentaje((datos.tablero.totales.efectivas / meta) * 100, datos.tablero.totales.efectivas / meta < 0.1 ? 1 : 0)} de la meta · ${entero(Math.max(0, meta - datos.tablero.totales.efectivas))} por levantar`
                  : 'Completas y no anuladas'
              }
            >
              {meta && (
                <div className="mt-3">
                  <Medidor valor={datos.tablero.totales.efectivas} meta={meta} etiqueta="Avance contra la meta" />
                </div>
              )}
            </Cifra>
            <Cifra
              etiqueta="Hoy"
              valor={entero(datos.tablero.totales.hoy)}
              detalle={`${entero(datos.tablero.totales.encuestadores)} ${datos.tablero.totales.encuestadores === 1 ? 'encuestador' : 'encuestadores'} en total`}
            />
            <Cifra
              etiqueta="Duración mediana"
              valor={duracion(datos.tablero.totales.duracion_mediana)}
              detalle={minimo ? `Mínimo esperado: ${duracion(minimo)}` : undefined}
            />
            <Cifra
              etiqueta="Por revisar"
              valor={entero(datos.tablero.totales.pendientes)}
              detalle={`${entero(datos.tablero.totales.validadas)} validadas · ${entero(datos.tablero.totales.anuladas)} anuladas`}
            />
            <Cifra
              etiqueta="Con alertas"
              valor={
                <span className="inline-flex items-center gap-2">
                  {entero(datos.tablero.totales.cortas + datos.tablero.totales.sin_gps)}
                  {datos.tablero.totales.cortas + datos.tablero.totales.sin_gps > 0 ? (
                    <AlertTriangle className="size-6 text-aviso-texto" aria-label="Requieren revisión" />
                  ) : (
                    <CheckCircle2 className="size-6 text-bien" aria-label="Sin alertas" />
                  )}
                </span>
              }
              detalle={`${entero(datos.tablero.totales.cortas)} muy cortas · ${entero(datos.tablero.totales.sin_gps)} sin GPS`}
            />
            <Cifra
              etiqueta="No elegibles"
              valor={entero(datos.tablero.totales.no_elegibles)}
              detalle="Terminadas por los filtros"
            />
            {avanceMuestra ? (
              <Cifra
                etiqueta={`${etiquetaZonas} completas`}
                valor={entero(avanceMuestra.completas)}
                detalle={`de ${entero(avanceMuestra.filas.length)} en la muestra${enFuera ? ` · ${entero(enFuera)} fuera de muestra` : ''}`}
              />
            ) : (
              <Cifra
                etiqueta={`${etiquetaZonas} con avance`}
                valor={entero(datos.tablero.totales.zonas)}
                detalle={metaZona ? `Meta: ${metaZona} por ${etiquetaZona.toLowerCase()}` : undefined}
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Tarjeta className="p-5 lg:col-span-3">
              <ColumnasPorDia datos={datos.tablero.por_dia} />
            </Tarjeta>

            <Tarjeta className="p-5 lg:col-span-2">
              <TituloDeBloque detalle="% de entrevistas efectivas">Perfil de la muestra</TituloDeBloque>
              {clavesPerfil.length === 0 || datos.tablero.totales.efectivas === 0 ? (
                <p className="py-6 text-center text-sm text-tinta-3">Aparecerá con las primeras entrevistas.</p>
              ) : (
                <div className="flex flex-col gap-5">
                  {clavesPerfil.map((clave) => {
                    const columna = columnas.find((c) => c.clave === clave);
                    if (!columna?.opciones) return null;
                    const { filas } = resumirConteo(columna.opciones, datos.perfil[clave]);
                    return <ListaDeBarras key={clave} titulo={columna.titulo} filas={filas} />;
                  })}
                </div>
              )}
            </Tarjeta>
          </div>

          <Tarjeta className="overflow-hidden">
            <div className="px-5 pt-5">
              <TituloDeBloque detalle="Ordenados por entrevistas efectivas">Encuestadores</TituloDeBloque>
            </div>
            {datos.tablero.por_encuestador.length === 0 ? (
              <Vacio titulo="Nadie ha levantado entrevistas todavía" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-linea text-left text-tinta-2">
                    <tr>
                      <th className="px-5 py-2 font-medium">Encuestador</th>
                      <th className="px-3 py-2 text-right font-medium">Efectivas</th>
                      <th className="px-3 py-2 text-right font-medium">Hoy</th>
                      <th className="px-3 py-2 text-right font-medium">Duración mediana</th>
                      <th className="px-3 py-2 text-right font-medium">Muy cortas</th>
                      <th className="px-3 py-2 text-right font-medium">Sin GPS</th>
                      <th className="px-3 py-2 text-right font-medium">No elegibles</th>
                      <th className="px-5 py-2 text-right font-medium">Última</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {datos.tablero.por_encuestador.map((e) => (
                      <tr key={e.id} className="border-b border-linea last:border-0">
                        <td className="px-5 py-2.5 font-medium">
                          <Link
                            href={`/admin/entrevistas?encuestador=${e.id}`}
                            className="hover:text-marca-700 hover:underline"
                          >
                            {e.nombre || 'Sin nombre'}
                          </Link>
                          {!e.activo && (
                            <Insignia className="ml-2" tono="neutro">
                              Inactivo
                            </Insignia>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{entero(e.efectivas)}</td>
                        <td className="px-3 py-2.5 text-right">{entero(e.hoy)}</td>
                        <td className="px-3 py-2.5 text-right">{duracion(e.duracion_mediana)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {e.cortas > 0 ? <Insignia tono="aviso">{entero(e.cortas)}</Insignia> : '0'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {e.sin_gps > 0 ? <Insignia tono="aviso">{entero(e.sin_gps)}</Insignia> : '0'}
                        </td>
                        <td className="px-3 py-2.5 text-right">{entero(e.no_elegibles)}</td>
                        <td className="px-5 py-2.5 text-right text-tinta-2">{haceCuanto(e.ultima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          {avanceMuestra && (
            <Tarjeta className="p-5">
              <TituloDeBloque
                detalle={
                  <Link href="/admin/muestra" className="font-medium text-marca-700 hover:underline">
                    Ver detalle de la muestra
                  </Link>
                }
              >
                Avance de la muestra por {etiquetaZona.toLowerCase()}
              </TituloDeBloque>
              <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {avanceMuestra.porDistritoLocal.map((g) => {
                  const nombre = g.distrito === null ? 'Sin dato' : `DL ${g.distrito}`;
                  return (
                    <div key={nombre} className="text-sm">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{nombre}</span>
                        <span className="text-tinta-2 tabular-nums">
                          {entero(g.utiles)} / {entero(g.meta)}
                        </span>
                      </div>
                      <Medidor valor={g.utiles} meta={g.meta} etiqueta={nombre} />
                    </div>
                  );
                })}
              </div>
              <ul className="grid grid-cols-3 gap-x-5 gap-y-2.5 sm:grid-cols-5 lg:grid-cols-8">
                {avanceMuestra.filas.map((f) => (
                  <li key={f.seccion} className="text-xs">
                    <div className="mb-0.5 flex items-baseline justify-between gap-1">
                      <span className="font-medium">{f.seccion}</span>
                      <span
                        className={cx(
                          'tabular-nums',
                          f.estado === 'excedida' ? 'font-semibold text-aviso-texto' : 'text-tinta-2',
                        )}
                      >
                        {f.levantadas}/{f.meta}
                      </span>
                    </div>
                    <Medidor valor={f.levantadas} meta={f.meta} etiqueta={`${etiquetaZona} ${f.seccion}`} />
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {!avanceMuestra && (
            <Tarjeta className="p-5">
              <TituloDeBloque
                detalle={metaZona ? `Meta: ${metaZona} efectivas por ${etiquetaZona.toLowerCase()}` : undefined}
              >
                Avance por {etiquetaZona.toLowerCase()}
              </TituloDeBloque>
              {datos.tablero.por_zona.length === 0 ? (
                <p className="py-6 text-center text-sm text-tinta-3">Aparecerá con las primeras entrevistas.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                  {[...datos.tablero.por_zona]
                    .sort((a, b) => a.zona.localeCompare(b.zona, 'es', { numeric: true }))
                    .map((z) => (
                      <li key={z.zona} className="text-sm">
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{z.zona || `Sin ${etiquetaZona.toLowerCase()}`}</span>
                          <span className="shrink-0 text-tinta-2 tabular-nums">
                            {entero(z.n)}
                            {metaZona ? ` / ${metaZona}` : ''}
                            {metaZona && z.n >= metaZona && (
                              <CheckCircle2 className="ml-1 inline size-4 text-bien" aria-label="Meta cumplida" />
                            )}
                          </span>
                        </div>
                        {metaZona && <Medidor valor={z.n} meta={metaZona} etiqueta={`${etiquetaZona} ${z.zona}`} />}
                      </li>
                    ))}
                </ul>
              )}
            </Tarjeta>
          )}
        </div>
      )}
    </>
  );
}

export default function PaginaTablero() {
  return <ConEncuesta>{(encuesta) => <TableroDeEncuesta encuesta={encuesta} />}</ConEncuesta>;
}
