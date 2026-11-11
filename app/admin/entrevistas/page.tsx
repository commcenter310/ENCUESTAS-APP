'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ExternalLink, MapPin, MapPinOff } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, mensajeDeError, useConsulta } from '@/components/admin/contexto';
import { Aviso, AreaTexto, Boton, Cargando, Insignia, Modal, Selector, Tarjeta, Vacio, cx } from '@/components/ui';
import { columnasDeRespuestas, etiquetaDe } from '@/lib/encuesta/motor';
import type { Encuesta, Entrevista, EstadoRevision } from '@/lib/encuesta/tipos';
import { type EntrevistaConNombre, descargar, entrevistasACsv } from '@/lib/exportar';
import { diaLocal, duracion, entero, fechaHora, hora } from '@/lib/formato';
import { leerMuestra } from '@/lib/campo';
import { supabase } from '@/lib/supabase';

const POR_PAGINA = 50;
const CAMPOS_LISTA =
  'id, version, resultado, motivo_no_elegible, zona, iniciada_en, terminada_en, duracion_seg, lat, lng, revision, encuestador_id, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre)';
const CAMPOS_DETALLE =
  '*, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre), revisor:perfiles!entrevistas_revisada_por_fkey(nombre)';

type Fila = Pick<
  Entrevista,
  | 'id'
  | 'version'
  | 'resultado'
  | 'motivo_no_elegible'
  | 'zona'
  | 'iniciada_en'
  | 'terminada_en'
  | 'duracion_seg'
  | 'lat'
  | 'lng'
  | 'revision'
> & { encuestador: { nombre: string } | null };

type Detalle = EntrevistaConNombre & { revisor: { nombre: string } | null };

type Filtros = { encuestador: string; revision: string; resultado: string; zona: string; alertas: boolean };

const TONO_REVISION = { pendiente: 'neutro', validada: 'bien', anulada: 'grave' } as const;
const NOMBRE_REVISION = { pendiente: 'Pendiente', validada: 'Validada', anulada: 'Anulada' } as const;

// ---------------------------------------------------------------------------
// Detalle y revisión de una entrevista
// ---------------------------------------------------------------------------

function DetalleDeEntrevista({
  id,
  encuesta,
  alCerrar,
  alCambiar,
}: {
  id: string;
  encuesta: Encuesta;
  alCerrar: () => void;
  alCambiar: () => void;
}) {
  const consulta = useCallback(
    async () =>
      exigir(await supabase().from('entrevistas').select(CAMPOS_DETALLE).eq('id', id).single()) as unknown as Detalle,
    [id],
  );
  const { datos: e, cargando, error, recargar } = useConsulta(consulta);
  const [nota, setNota] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<EstadoRevision | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const columnas = useMemo(() => columnasDeRespuestas(encuesta.definicion), [encuesta]);
  const minimo = encuesta.definicion.monitoreo?.duracionMinimaSeg ?? 0;
  const zona = encuesta.zona_horaria;

  async function revisar(revision: EstadoRevision) {
    setGuardando(revision);
    setFallo(null);
    const { error: problema } = await supabase()
      .from('entrevistas')
      .update({ revision, nota_revision: (nota ?? e?.nota_revision ?? '').trim() || null })
      .eq('id', id)
      .select('id')
      .single();
    setGuardando(null);
    if (problema) {
      setFallo(mensajeDeError(problema));
      return;
    }
    recargar();
    alCambiar();
  }

  return (
    <Modal abierto titulo="Entrevista" alCerrar={alCerrar} ancho="max-w-3xl">
      {!e ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : (
        <div className="flex flex-col gap-5">
          {/* Datos del levantamiento */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Dato nombre="Encuestador">{e.encuestador?.nombre || '–'}</Dato>
            <Dato nombre="Fecha">
              {diaLocal(e.terminada_en, zona)} · {hora(e.iniciada_en, zona)} a {hora(e.terminada_en, zona)}
            </Dato>
            <Dato nombre="Duración">
              <span className="inline-flex items-center gap-1.5">
                {duracion(e.duracion_seg)}
                {e.resultado === 'completa' && e.duracion_seg < minimo && (
                  <Insignia tono="aviso">
                    <AlertTriangle className="size-3" aria-hidden />
                    Muy corta
                  </Insignia>
                )}
              </span>
            </Dato>
            <Dato nombre={encuesta.definicion.monitoreo?.etiquetaZona ?? 'Zona'}>{e.zona ?? '–'}</Dato>
            <Dato nombre="Versión">{e.version}</Dato>
            <Dato nombre="Resultado">
              {e.resultado === 'completa' ? 'Completa' : `No elegible: ${e.motivo_no_elegible ?? ''}`}
            </Dato>
            <Dato nombre="Ubicación">
              {e.lat !== null && e.lng !== null ? (
                <a
                  href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-marca-700 hover:underline"
                >
                  Ver en el mapa
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : (
                <Insignia tono="aviso">Sin GPS</Insignia>
              )}
              {e.precision_m !== null && <span className="ml-1.5 text-tinta-3">±{Math.round(e.precision_m)} m</span>}
            </Dato>
            <Dato nombre="Recibida en el servidor">{fechaHora(e.recibida_en, zona)}</Dato>
            <Dato nombre="Revisión">
              <Insignia tono={TONO_REVISION[e.revision]}>{NOMBRE_REVISION[e.revision]}</Insignia>
              {e.revisada_en && (
                <span className="ml-1.5 text-tinta-3">
                  {e.revisor?.nombre ? `${e.revisor.nombre}, ` : ''}
                  {fechaHora(e.revisada_en, zona)}
                </span>
              )}
            </Dato>
          </dl>

          {/* Supervisión */}
          <div className="rounded-xl border border-linea bg-plano p-4">
            <label htmlFor="nota-revision" className="text-sm font-medium text-tinta-2">
              Nota de supervisión (opcional)
            </label>
            <AreaTexto
              id="nota-revision"
              className="mt-1.5 min-h-20"
              maxLength={1000}
              placeholder="Ej. Se verificó por teléfono con el entrevistado."
              value={nota ?? e.nota_revision ?? ''}
              onChange={(ev) => setNota(ev.target.value)}
            />
            {fallo && (
              <Aviso tono="grave" className="mt-3">
                {fallo}
              </Aviso>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton cargando={guardando === 'validada'} disabled={guardando !== null} onClick={() => revisar('validada')}>
                Validar
              </Boton>
              <Boton
                variante="peligro"
                cargando={guardando === 'anulada'}
                disabled={guardando !== null}
                onClick={() => revisar('anulada')}
              >
                Anular
              </Boton>
              <Boton
                variante="secundario"
                cargando={guardando === 'pendiente'}
                disabled={guardando !== null}
                onClick={() => revisar('pendiente')}
              >
                Dejar pendiente
              </Boton>
            </div>
            <p className="mt-2 text-sm text-tinta-3">
              Las entrevistas anuladas no cuentan en el avance ni en los resultados.
            </p>
          </div>

          {/* Respuestas */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-tinta-2">Respuestas</h3>
            <table className="w-full text-sm">
              <tbody>
                {columnas
                  .filter((c) => e.respuestas[c.clave] !== undefined)
                  .map((c) => (
                    <tr key={c.clave} className="border-t border-linea align-top">
                      <th scope="row" className="w-2/5 py-1.5 pr-4 text-left font-normal text-tinta-2">
                        {c.titulo}
                      </th>
                      <td className="py-1.5 font-medium break-words">{etiquetaDe(c, e.respuestas[c.clave])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Dato({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-tinta-3">{nombre}</dt>
      <dd className="mt-0.5 font-medium break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function ListaDeEntrevistas({ encuesta }: { encuesta: Encuesta }) {
  const parametros = useSearchParams();
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    encuestador: parametros.get('encuestador') ?? '',
    revision: '',
    resultado: '',
    zona: '',
    alertas: false,
  }));
  const [pagina, setPagina] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [falloExportar, setFalloExportar] = useState<string | null>(null);
  const minimo = encuesta.definicion.monitoreo?.duracionMinimaSeg ?? 0;
  const etiquetaZona = encuesta.definicion.monitoreo?.etiquetaZona ?? 'Zona';
  const zona = encuesta.zona_horaria;

  const consultaEncuestadores = useCallback(
    async () =>
      exigir(await supabase().from('perfiles').select('id, nombre').order('nombre')) as { id: string; nombre: string }[],
    [],
  );
  const encuestadores = useConsulta(consultaEncuestadores);

  const consulta = useCallback(async () => {
    let q = supabase().from('entrevistas').select(CAMPOS_LISTA, { count: 'exact' }).eq('encuesta_id', encuesta.id);
    if (filtros.encuestador) q = q.eq('encuestador_id', filtros.encuestador);
    if (filtros.revision) q = q.eq('revision', filtros.revision);
    if (filtros.resultado) q = q.eq('resultado', filtros.resultado);
    if (filtros.zona.trim()) q = q.eq('zona', filtros.zona.trim());
    if (filtros.alertas) q = q.eq('resultado', 'completa').or(`duracion_seg.lt.${minimo},lat.is.null`);
    const { data, error, count } = await q
      .order('terminada_en', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    return { filas: (data ?? []) as unknown as Fila[], total: count ?? 0 };
  }, [encuesta.id, filtros, pagina, minimo]);

  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta);

  function cambiar(cambio: Partial<Filtros>) {
    setFiltros((f) => ({ ...f, ...cambio }));
    setPagina(0);
  }

  async function exportar() {
    setExportando(true);
    setFalloExportar(null);
    try {
      const todas: EntrevistaConNombre[] = [];
      for (let desde = 0; ; desde += 1000) {
        const lote = exigir(
          await supabase()
            .from('entrevistas')
            .select('*, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre)')
            .eq('encuesta_id', encuesta.id)
            .order('terminada_en', { ascending: true })
            .range(desde, desde + 999),
        ) as unknown as EntrevistaConNombre[];
        todas.push(...lote);
        if (lote.length < 1000) break;
      }
      const muestra = await leerMuestra(encuesta.id);
      descargar(
        `${encuesta.clave}_entrevistas_${diaLocal(new Date(), zona)}.csv`,
        entrevistasACsv(encuesta, todas, muestra),
      );
    } catch (e) {
      setFalloExportar(mensajeDeError(e));
    } finally {
      setExportando(false);
    }
  }

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / POR_PAGINA)) : 1;

  return (
    <>
      <Encabezado
        titulo="Entrevistas"
        descripcion={datos ? `${entero(datos.total)} con los filtros actuales.` : 'Revisión y supervisión de lo levantado.'}
      >
        <BotonActualizar alOprimir={recargar} girando={actualizando} />
        <Boton variante="secundario" tamano="chico" cargando={exportando} onClick={exportar}>
          {!exportando && <Download className="size-4" aria-hidden />}
          Exportar todo a Excel (CSV)
        </Boton>
      </Encabezado>

      {falloExportar && (
        <Aviso tono="grave" className="mb-4">
          {falloExportar}
        </Aviso>
      )}

      {/* Filtros: una sola fila arriba de la tabla */}
      <div className="no-imprimir mb-4 flex flex-wrap items-center gap-2">
        <Selector
          aria-label="Encuestador"
          className="h-10 w-auto min-w-44 text-sm"
          value={filtros.encuestador}
          onChange={(e) => cambiar({ encuestador: e.target.value })}
        >
          <option value="">Todos los encuestadores</option>
          {(encuestadores.datos ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre || 'Sin nombre'}
            </option>
          ))}
        </Selector>
        <Selector
          aria-label="Revisión"
          className="h-10 w-auto text-sm"
          value={filtros.revision}
          onChange={(e) => cambiar({ revision: e.target.value })}
        >
          <option value="">Toda revisión</option>
          <option value="pendiente">Pendientes</option>
          <option value="validada">Validadas</option>
          <option value="anulada">Anuladas</option>
        </Selector>
        <Selector
          aria-label="Resultado"
          className="h-10 w-auto text-sm"
          value={filtros.resultado}
          onChange={(e) => cambiar({ resultado: e.target.value })}
        >
          <option value="">Todo resultado</option>
          <option value="completa">Completas</option>
          <option value="no_elegible">No elegibles</option>
        </Selector>
        <input
          aria-label={etiquetaZona}
          placeholder={etiquetaZona}
          inputMode="numeric"
          className="h-10 w-28 rounded-xl border border-eje bg-white px-3 text-sm placeholder:text-tinta-3"
          value={filtros.zona}
          onChange={(e) => cambiar({ zona: e.target.value })}
        />
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-eje bg-white px-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-marca-600"
            checked={filtros.alertas}
            onChange={(e) => cambiar({ alertas: e.target.checked })}
          />
          Solo con alertas
        </label>
      </div>

      {!datos ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : (
        <Tarjeta className={cx('overflow-hidden transition-opacity', actualizando && 'opacity-60')}>
          {error && (
            <Aviso tono="aviso" className="m-4">
              {error}
            </Aviso>
          )}
          {datos.filas.length === 0 ? (
            <Vacio titulo="No hay entrevistas con estos filtros" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-linea text-left text-tinta-2">
                  <tr>
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Encuestador</th>
                    <th className="px-3 py-2 font-medium">{etiquetaZona}</th>
                    <th className="px-3 py-2 font-medium">Versión</th>
                    <th className="px-3 py-2 text-right font-medium">Duración</th>
                    <th className="px-3 py-2 font-medium">GPS</th>
                    <th className="px-3 py-2 font-medium">Resultado</th>
                    <th className="px-3 py-2 font-medium">Revisión</th>
                    <th className="px-4 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((f) => {
                    const corta = f.resultado === 'completa' && f.duracion_seg < minimo;
                    return (
                      <tr key={f.id} className="border-b border-linea last:border-0 hover:bg-plano">
                        <td className="px-4 py-2 whitespace-nowrap tabular-nums">{fechaHora(f.terminada_en, zona)}</td>
                        <td className="px-3 py-2">{f.encuestador?.nombre || '–'}</td>
                        <td className="px-3 py-2 tabular-nums">{f.zona ?? '–'}</td>
                        <td className="px-3 py-2">{f.version}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                          {corta && (
                            <AlertTriangle className="mr-1 inline size-4 text-aviso-texto" aria-label="Muy corta" />
                          )}
                          {duracion(f.duracion_seg)}
                        </td>
                        <td className="px-3 py-2">
                          {f.lat !== null ? (
                            <MapPin className="size-4 text-bien" aria-label="Con ubicación" />
                          ) : (
                            <MapPinOff className="size-4 text-aviso-texto" aria-label="Sin ubicación" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {f.resultado === 'completa' ? 'Completa' : <span className="text-tinta-2">No elegible</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Insignia tono={TONO_REVISION[f.revision]}>{NOMBRE_REVISION[f.revision]}</Insignia>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Boton variante="secundario" tamano="chico" onClick={() => setAbierta(f.id)}>
                            Ver
                          </Boton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {datos.total > POR_PAGINA && (
            <div className="flex items-center justify-between gap-3 border-t border-linea px-4 py-2.5 text-sm">
              <span className="text-tinta-2">
                Página {pagina + 1} de {paginas}
              </span>
              <div className="flex gap-2">
                <Boton variante="secundario" tamano="chico" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
                  <ChevronLeft className="size-4" aria-hidden />
                  Anterior
                </Boton>
                <Boton
                  variante="secundario"
                  tamano="chico"
                  disabled={pagina + 1 >= paginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Siguiente
                  <ChevronRight className="size-4" aria-hidden />
                </Boton>
              </div>
            </div>
          )}
        </Tarjeta>
      )}

      {abierta && (
        <DetalleDeEntrevista
          key={abierta}
          id={abierta}
          encuesta={encuesta}
          alCerrar={() => setAbierta(null)}
          alCambiar={recargar}
        />
      )}
    </>
  );
}

export default function PaginaEntrevistas() {
  return (
    <ConEncuesta>
      {(encuesta) => (
        <Suspense fallback={<Cargando />}>
          <ListaDeEntrevistas encuesta={encuesta} />
        </Suspense>
      )}
    </ConEncuesta>
  );
}
