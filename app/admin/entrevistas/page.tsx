'use client';

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, MapPin, MapPinOff } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, mensajeDeError, useConsulta } from '@/components/admin/contexto';
import { DetalleDeEntrevista, TONO_REVISION } from '@/components/admin/detalle-entrevista';
import { Aviso, Boton, Cargando, Entrada, Insignia, Selector, Tarjeta, Vacio, cx } from '@/components/ui';
import { etiquetasZona } from '@/lib/encuesta/monitoreo';
import { type Encuesta, type Entrevista, NOMBRES_REVISION } from '@/lib/encuesta/tipos';
import { type EntrevistaConNombre, descargar, entrevistasACsv } from '@/lib/exportar';
import { diaLocal, duracion, entero, fechaHora } from '@/lib/formato';
import { leerMuestra } from '@/lib/muestra-datos';
import { leerPaginado, supabase } from '@/lib/supabase';

const POR_PAGINA = 50;
const CAMPOS_LISTA =
  'id, version, resultado, motivo_no_elegible, zona, iniciada_en, terminada_en, duracion_seg, lat, lng, revision, encuestador_id, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre)';

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

type Filtros = { encuestador: string; revision: string; resultado: string; zona: string; alertas: boolean };

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
  const etiquetaZona = etiquetasZona(encuesta.definicion).singular;
  const zona = encuesta.zona_horaria;

  const consultaEncuestadores = useCallback(
    async () =>
      exigir(await supabase().from('perfiles').select('id, nombre').order('nombre')) as {
        id: string;
        nombre: string;
      }[],
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
      const [todas, muestra] = await Promise.all([
        leerPaginado<EntrevistaConNombre>((desde, hasta) =>
          supabase()
            .from('entrevistas')
            .select('*, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre)')
            .eq('encuesta_id', encuesta.id)
            .order('terminada_en', { ascending: true })
            .range(desde, hasta)
            .overrideTypes<EntrevistaConNombre[], { merge: false }>(),
        ),
        leerMuestra(encuesta.id),
      ]);
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
        descripcion={
          datos ? `${entero(datos.total)} con los filtros actuales.` : 'Revisión y supervisión de lo levantado.'
        }
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
        <Entrada
          aria-label={etiquetaZona}
          placeholder={etiquetaZona}
          inputMode="numeric"
          className="h-10 w-28 text-sm"
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
                          <Insignia tono={TONO_REVISION[f.revision]}>{NOMBRES_REVISION[f.revision]}</Insignia>
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
                <Boton
                  variante="secundario"
                  tamano="chico"
                  disabled={pagina === 0}
                  onClick={() => setPagina((p) => p - 1)}
                >
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
