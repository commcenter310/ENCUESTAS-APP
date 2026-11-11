'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta, TituloDeBloque } from '@/components/admin/comunes';
import { exigir, mensajeDeError, useConsulta, usePanel } from '@/components/admin/contexto';
import { Cifra, Medidor } from '@/components/admin/graficas';
import { Aviso, Boton, Campo, Cargando, Entrada, Insignia, Modal, Selector, Tarjeta, Vacio, cx } from '@/components/ui';
import { leerMuestra } from '@/lib/campo';
import { nombreDeTipo, type Encuesta } from '@/lib/encuesta/tipos';
import { aCsv, descargar } from '@/lib/exportar';
import { entero, porcentaje } from '@/lib/formato';
import {
  type Hoja,
  type ResultadoMuestra,
  PLANTILLA_CSV,
  interpretarMuestra,
  leerCsv,
  levantadasEn,
  resumirMuestra,
} from '@/lib/muestra';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Lectura del archivo
// ---------------------------------------------------------------------------

async function leerArchivo(archivo: File): Promise<Hoja[]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) {
    return [{ nombre: archivo.name, filas: leerCsv(await archivo.text()) }];
  }
  if (nombre.endsWith('.xls')) {
    throw new Error('Los archivos .xls (Excel 97-2003) no se pueden leer. Guárdalo como .xlsx o como CSV.');
  }
  // Se carga solo cuando hace falta: así no pesa en el resto de la app.
  const { default: leerXlsx } = await import('read-excel-file/browser');
  const hojas = await leerXlsx(archivo);
  return hojas.map((h) => ({ nombre: h.sheet, filas: h.data as unknown[][] }));
}

function numeroOpcional(texto: string): number | null {
  const n = Number(texto);
  return texto.trim() && Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Carga de la muestra
// ---------------------------------------------------------------------------

function CargarMuestra({
  encuesta,
  yaTiene,
  alCerrar,
  alGuardar,
}: {
  encuesta: Encuesta;
  yaTiene: number;
  alCerrar: () => void;
  alGuardar: (total: number, secciones: number) => void;
}) {
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [df, setDf] = useState('');
  const [dl, setDl] = useState('');
  const [actualizarMeta, setActualizarMeta] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const resultado: ResultadoMuestra | null = useMemo(
    () =>
      hojas
        ? interpretarMuestra(hojas, {
            distritoFederal: numeroOpcional(df),
            distritoLocal: numeroOpcional(dl),
          })
        : null,
    [hojas, df, dl],
  );
  const resumen = resultado ? resumirMuestra(resultado.secciones) : null;
  const pideDf = resultado?.errores.some((e) => e.includes('distrito federal')) || df !== '';
  const pideDl = resultado?.errores.some((e) => e.includes('distrito local')) || dl !== '';

  async function elegir(f: File | undefined) {
    if (!f) return;
    setFallo(null);
    setLeyendo(true);
    setArchivo(f.name);
    try {
      setHojas(await leerArchivo(f));
    } catch (e) {
      setHojas(null);
      setFallo(
        e instanceof Error && e.message.startsWith('Los archivos')
          ? e.message
          : 'No se pudo leer el archivo. Revisa que sea un Excel (.xlsx) o un CSV.',
      );
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!resultado || resultado.errores.length > 0) return;
    setGuardando(true);
    setFallo(null);
    const { data, error } = await supabase().rpc('guardar_muestra', {
      p_encuesta: encuesta.id,
      p_secciones: resultado.secciones,
      p_actualizar_meta: actualizarMeta,
    });
    setGuardando(false);
    if (error) setFallo(mensajeDeError(error));
    else alGuardar(Number(data ?? 0), resultado.secciones.length);
  }

  return (
    <Modal abierto titulo="Cargar muestra" alCerrar={alCerrar} ancho="max-w-3xl">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-snug text-tinta-2">
          Sube un Excel (.xlsx) o CSV con una fila por sección:{' '}
          <strong className="font-semibold text-tinta">sección</strong>,{' '}
          <strong className="font-semibold text-tinta">distrito local</strong>,{' '}
          <strong className="font-semibold text-tinta">distrito federal</strong> y{' '}
          <strong className="font-semibold text-tinta">entrevistas</strong> a levantar. Opcionales: estrato, lista
          nominal, factor de ponderación y reemplazo. Si el Excel tiene varias hojas, se toman todas las que traigan
          sección y entrevistas.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-marca-600 px-4 text-[15px] font-semibold text-white hover:bg-marca-700">
            <Upload className="size-4" aria-hidden />
            Elegir archivo
            <input
              type="file"
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              aria-label="Archivo de muestra"
              onChange={(e) => {
                elegir(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <Boton variante="fantasma" tamano="chico" onClick={() => descargar('plantilla_muestra.csv', PLANTILLA_CSV)}>
            <Download className="size-4" aria-hidden />
            Descargar plantilla CSV
          </Boton>
          {archivo && <span className="text-sm text-tinta-2">{archivo}</span>}
        </div>

        {leyendo && <Cargando texto="Leyendo archivo…" className="py-4" />}
        {fallo && <Aviso tono="grave">{fallo}</Aviso>}

        {resultado && !leyendo && (
          <>
            {(pideDf || pideDl) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {pideDf && (
                  <Campo etiqueta="Distrito federal para las secciones que no lo traen">
                    {(p) => (
                      <Entrada
                        {...p}
                        inputMode="numeric"
                        className="max-w-32"
                        value={df}
                        onChange={(e) => setDf(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      />
                    )}
                  </Campo>
                )}
                {pideDl && (
                  <Campo etiqueta="Distrito local para las secciones que no lo traen">
                    {(p) => (
                      <Entrada
                        {...p}
                        inputMode="numeric"
                        className="max-w-32"
                        value={dl}
                        onChange={(e) => setDl(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      />
                    )}
                  </Campo>
                )}
              </div>
            )}

            {resultado.errores.length > 0 && (
              <Aviso tono="grave" titulo="Hay que corregir antes de guardar">
                <ul className="list-disc pl-4">
                  {resultado.errores.slice(0, 10).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                  {resultado.errores.length > 10 && <li>…y {resultado.errores.length - 10} más.</li>}
                </ul>
              </Aviso>
            )}
            {resultado.avisos.length > 0 && (
              <Aviso tono="aviso" titulo="Revisa">
                <ul className="list-disc pl-4">
                  {resultado.avisos.slice(0, 6).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Aviso>
            )}

            {resumen && resumen.secciones > 0 && (
              <div className="rounded-xl border border-linea bg-plano p-4 text-sm">
                <p className="text-[15px]">
                  <strong className="font-semibold">{entero(resumen.secciones)} secciones</strong> ·{' '}
                  <strong className="font-semibold">{entero(resumen.meta)} entrevistas</strong>
                  {resultado.hojas.length > 0 && (
                    <span className="text-tinta-2"> · tomadas de: {resultado.hojas.join(', ')}</span>
                  )}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Desglose
                    titulo="Por distrito local"
                    filas={resumen.porDistritoLocal.map((g) => [
                      g.distrito === null ? 'Sin dato' : `DL ${g.distrito}`,
                      g.secciones,
                      g.meta,
                    ])}
                  />
                  <Desglose
                    titulo="Por distrito federal"
                    filas={resumen.porDistritoFederal.map((g) => [
                      g.distrito === null ? 'Sin dato' : `DF ${g.distrito}`,
                      g.secciones,
                      g.meta,
                    ])}
                  />
                  <Desglose
                    titulo="Por estrato"
                    filas={resumen.porEstrato.map((g) => [g.estrato, g.secciones, g.meta])}
                  />
                </div>
              </div>
            )}

            {resultado.errores.length === 0 && resumen && resumen.secciones > 0 && (
              <>
                <label className="flex items-center gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    className="size-4 accent-marca-600"
                    checked={actualizarMeta}
                    onChange={(e) => setActualizarMeta(e.target.checked)}
                  />
                  Usar {entero(resumen.meta)} como meta total de la encuesta
                  {encuesta.meta_muestra && encuesta.meta_muestra !== resumen.meta && (
                    <span className="text-tinta-3">(ahora: {entero(encuesta.meta_muestra)})</span>
                  )}
                </label>
                {yaTiene > 0 && (
                  <Aviso tono="aviso">
                    Esta encuesta ya tiene una muestra de {entero(yaTiene)} secciones. Se reemplazará completa; las
                    entrevistas ya levantadas no se tocan.
                  </Aviso>
                )}
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-3">
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardando}
            disabled={!resultado || resultado.errores.length > 0 || resultado.secciones.length === 0}
            onClick={guardar}
          >
            Guardar muestra
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

function Desglose({ titulo, filas }: { titulo: string; filas: [string, number, number][] }) {
  return (
    <div>
      <p className="mb-1 font-medium text-tinta-2">{titulo}</p>
      <table className="w-full tabular-nums">
        <tbody>
          {filas.map(([nombre, secciones, meta]) => (
            <tr key={nombre}>
              <td className="py-0.5 pr-2">{nombre}</td>
              <td className="py-0.5 text-right text-tinta-2">{entero(secciones)} secc.</td>
              <td className="py-0.5 pl-2 text-right font-semibold">{entero(meta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

type Estado = 'todas' | 'pendientes' | 'completas' | 'excedidas';

function MuestraDeEncuesta({ encuesta }: { encuesta: Encuesta }) {
  const { recargar: recargarEncuestas } = usePanel();
  const etiqueta = encuesta.definicion.monitoreo?.etiquetaZona ?? 'Sección';

  const consulta = useCallback(async () => {
    const [muestra, conteo] = await Promise.all([
      leerMuestra(encuesta.id),
      supabase().rpc('conteo_secciones', { p_encuesta: encuesta.id }),
    ]);
    const filas = exigir(conteo) as { zona: string; efectivas: number }[];
    return {
      muestra,
      conteo: Object.fromEntries(filas.map((f) => [f.zona, Number(f.efectivas)])) as Record<string, number>,
    };
  }, [encuesta.id]);
  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta, 60000);

  const [cargar, setCargar] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [aviso, setAviso] = useState<{
    tono: 'bien' | 'grave';
    texto: string;
  } | null>(null);
  const [dl, setDl] = useState('');
  const [estado, setEstado] = useState<Estado>('todas');
  const [busqueda, setBusqueda] = useState('');

  const filas = useMemo(() => {
    if (!datos) return [];
    return datos.muestra.map((s) => {
      const levantadas = levantadasEn(s, datos.conteo);
      const enReemplazo = s.reemplazo ? (datos.conteo[s.reemplazo] ?? 0) : 0;
      return { ...s, levantadas, enReemplazo };
    });
  }, [datos]);

  const fuera = useMemo(() => {
    if (!datos) return [];
    const enMuestra = new Set(datos.muestra.flatMap((s) => [s.seccion, s.reemplazo].filter(Boolean)));
    return Object.entries(datos.conteo)
      .filter(([zona]) => !enMuestra.has(zona))
      .sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [datos]);

  const totales = useMemo(() => {
    const meta = filas.reduce((s, f) => s + f.meta, 0);
    const utiles = filas.reduce((s, f) => s + Math.min(f.levantadas, f.meta), 0);
    const excedentes = filas.reduce((s, f) => s + Math.max(0, f.levantadas - f.meta), 0);
    const completas = filas.filter((f) => f.levantadas >= f.meta).length;
    const conReemplazo = filas.filter((f) => f.enReemplazo > 0).length;
    return { meta, utiles, excedentes, completas, conReemplazo };
  }, [filas]);

  const distritos = [...new Set(filas.map((f) => f.distrito_local))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const visibles = filas
    .filter((f) => !dl || String(f.distrito_local) === dl)
    .filter((f) =>
      estado === 'pendientes'
        ? f.levantadas < f.meta
        : estado === 'completas'
          ? f.levantadas >= f.meta
          : estado === 'excedidas'
            ? f.levantadas > f.meta
            : true,
    )
    .filter((f) => !busqueda || f.seccion.startsWith(busqueda) || f.reemplazo?.startsWith(busqueda))
    .sort((a, b) => Number(a.seccion) - Number(b.seccion));

  function exportar() {
    descargar(
      `${encuesta.clave}_muestra.csv`,
      aCsv(
        [
          'SECCION',
          'DISTRITO LOCAL',
          'DISTRITO FEDERAL',
          'ENTREVISTAS',
          'ESTRATO',
          'LISTA NOMINAL',
          'FACTOR DE PONDERACION',
          'REEMPLAZO',
          'LEVANTADAS',
        ],
        filas.map((f) => [
          f.seccion,
          f.distrito_local,
          f.distrito_federal,
          f.meta,
          f.estrato,
          f.lista_nominal,
          f.factor_ponderacion,
          f.reemplazo,
          f.levantadas,
        ]),
      ),
    );
  }

  async function quitarMuestra() {
    setQuitando(true);
    const { error: fallo } = await supabase().rpc('guardar_muestra', {
      p_encuesta: encuesta.id,
      p_secciones: [],
      p_actualizar_meta: false,
    });
    setQuitando(false);
    setQuitar(false);
    if (fallo) setAviso({ tono: 'grave', texto: mensajeDeError(fallo) });
    else {
      setAviso({
        tono: 'bien',
        texto: 'Muestra quitada. Los encuestadores pueden usar cualquier sección.',
      });
      recargar();
    }
  }

  const tieneMuestra = (datos?.muestra.length ?? 0) > 0;

  return (
    <>
      <Encabezado
        titulo="Muestra"
        descripcion={`${nombreDeTipo(encuesta.tipo)} · secciones a levantar y tope de entrevistas en cada una.`}
      >
        {tieneMuestra && <BotonActualizar alOprimir={recargar} girando={actualizando} />}
        {tieneMuestra && (
          <Boton variante="secundario" tamano="chico" onClick={exportar}>
            <Download className="size-4" aria-hidden />
            Descargar (CSV)
          </Boton>
        )}
        <Boton tamano="chico" onClick={() => setCargar(true)}>
          <Upload className="size-4" aria-hidden />
          {tieneMuestra ? 'Reemplazar muestra' : 'Cargar muestra'}
        </Boton>
      </Encabezado>

      {aviso && (
        <Aviso tono={aviso.tono} className="mb-4">
          {aviso.texto}
        </Aviso>
      )}

      {!datos ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : !tieneMuestra ? (
        <Tarjeta className="px-4 py-12 text-center">
          <FileSpreadsheet className="mx-auto size-8 text-tinta-3" aria-hidden />
          <p className="mt-3 font-medium text-tinta-2">Esta encuesta no tiene muestra cargada</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-tinta-3">
            Sin muestra, los encuestadores pueden capturar cualquier {etiqueta.toLowerCase()} y no hay tope por sección.
            Carga el archivo con las secciones, sus distritos y las entrevistas de cada una.
          </p>
          <Boton className="mt-4" onClick={() => setCargar(true)}>
            <Upload className="size-4" aria-hidden />
            Cargar muestra
          </Boton>
        </Tarjeta>
      ) : (
        <div className={cx('flex flex-col gap-4 transition-opacity', actualizando && 'opacity-60')}>
          {error && <Aviso tono="aviso">{error} Se muestran los últimos datos cargados.</Aviso>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Cifra
              className="col-span-2"
              etiqueta="Entrevistas dentro de la muestra"
              valor={
                <>
                  {entero(totales.utiles)}
                  <span className="ml-2 text-lg font-normal text-tinta-3">de {entero(totales.meta)}</span>
                </>
              }
              detalle={`${porcentaje(totales.meta ? (totales.utiles / totales.meta) * 100 : 0, 1)} del total · sin contar excedentes`}
            >
              <div className="mt-3">
                <Medidor valor={totales.utiles} meta={totales.meta} etiqueta="Avance de la muestra" />
              </div>
            </Cifra>
            <Cifra
              etiqueta="Secciones completas"
              valor={entero(totales.completas)}
              detalle={`de ${entero(filas.length)} en la muestra`}
            />
            <Cifra
              etiqueta="Con alertas"
              valor={
                <span className="inline-flex items-center gap-2">
                  {entero(totales.excedentes + fuera.reduce((s, [, n]) => s + n, 0))}
                  {totales.excedentes + fuera.length > 0 ? (
                    <AlertTriangle className="size-6 text-aviso-texto" aria-label="Requieren revisión" />
                  ) : (
                    <CheckCircle2 className="size-6 text-bien" aria-label="Sin alertas" />
                  )}
                </span>
              }
              detalle={`${entero(totales.excedentes)} sobre el tope · ${entero(fuera.reduce((s, [, n]) => s + n, 0))} fuera de muestra`}
            />
          </div>

          {fuera.length > 0 && (
            <Aviso tono="aviso" titulo="Entrevistas en secciones fuera de la muestra">
              {fuera.map(([zona, n]) => `${zona} (${n})`).join(', ')}. Pueden venir de teléfonos que capturaron antes de
              cargar la muestra. Revísalas en Entrevistas.
            </Aviso>
          )}
          {totales.conReemplazo > 0 && (
            <Aviso tono="marca">
              {totales.conReemplazo} {totales.conReemplazo === 1 ? 'sección tiene' : 'secciones tienen'} entrevistas en
              su sección de reemplazo; cuentan para la titular.
            </Aviso>
          )}

          <Tarjeta className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-5">
              <div className="mr-auto">
                <TituloDeBloque detalle={`${entero(visibles.length)} de ${entero(filas.length)}`}>
                  Secciones
                </TituloDeBloque>
              </div>
              <Selector
                aria-label="Distrito local"
                className="h-10 w-auto text-sm"
                value={dl}
                onChange={(e) => setDl(e.target.value)}
              >
                <option value="">Todo distrito local</option>
                {distritos.map((d) => (
                  <option key={String(d)} value={String(d)}>
                    DL {d ?? 'sin dato'}
                  </option>
                ))}
              </Selector>
              <Selector
                aria-label="Avance"
                className="h-10 w-auto text-sm"
                value={estado}
                onChange={(e) => setEstado(e.target.value as Estado)}
              >
                <option value="todas">Todas</option>
                <option value="pendientes">Por completar</option>
                <option value="completas">Completas</option>
                <option value="excedidas">Sobre el tope</option>
              </Selector>
              <input
                aria-label="Buscar sección"
                placeholder="Buscar sección"
                inputMode="numeric"
                className="h-10 w-36 rounded-xl border border-eje bg-white px-3 text-sm placeholder:text-tinta-3"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {visibles.length === 0 ? (
              <Vacio titulo="No hay secciones con estos filtros" />
            ) : (
              <div className="mt-2 max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 border-b border-linea bg-superficie text-left text-tinta-2">
                    <tr>
                      <th className="px-5 py-2 font-medium">Sección</th>
                      <th className="px-3 py-2 text-right font-medium">DL</th>
                      <th className="px-3 py-2 text-right font-medium">DF</th>
                      <th className="px-3 py-2 font-medium">Estrato</th>
                      <th className="px-3 py-2 text-right font-medium">Lista nominal</th>
                      <th className="px-3 py-2 text-right font-medium">Factor</th>
                      <th className="px-3 py-2 font-medium">Reemplazo</th>
                      <th className="w-48 px-3 py-2 font-medium">Avance</th>
                      <th className="px-5 py-2 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {visibles.map((f) => (
                      <tr key={f.seccion} className="border-b border-linea last:border-0">
                        <th scope="row" className="px-5 py-2 text-left font-semibold">
                          {f.seccion}
                        </th>
                        <td className="px-3 py-2 text-right">{f.distrito_local ?? '–'}</td>
                        <td className="px-3 py-2 text-right">{f.distrito_federal ?? '–'}</td>
                        <td className="px-3 py-2">{f.estrato ?? '–'}</td>
                        <td className="px-3 py-2 text-right">
                          {f.lista_nominal === null ? '–' : entero(f.lista_nominal)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {f.factor_ponderacion === null ? '–' : f.factor_ponderacion.toFixed(3)}
                        </td>
                        <td className="px-3 py-2">
                          {f.reemplazo ?? '–'}
                          {f.enReemplazo > 0 && <span className="text-tinta-3"> ({f.enReemplazo})</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Medidor valor={f.levantadas} meta={f.meta} etiqueta={`Sección ${f.seccion}`} />
                            </div>
                            <span className="w-14 text-right">
                              {f.levantadas}/{f.meta}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-2">
                          {f.levantadas > f.meta ? (
                            <Insignia tono="aviso">+{f.levantadas - f.meta} sobre el tope</Insignia>
                          ) : f.levantadas === f.meta ? (
                            <Insignia tono="bien">Completa</Insignia>
                          ) : f.levantadas > 0 ? (
                            <Insignia tono="marca">En curso</Insignia>
                          ) : (
                            <Insignia>Sin iniciar</Insignia>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          <div>
            <Boton variante="peligro" tamano="chico" onClick={() => setQuitar(true)}>
              <Trash2 className="size-3.5" aria-hidden />
              Quitar muestra
            </Boton>
          </div>
        </div>
      )}

      {cargar && (
        <CargarMuestra
          encuesta={encuesta}
          yaTiene={datos?.muestra.length ?? 0}
          alCerrar={() => setCargar(false)}
          alGuardar={(total, secciones) => {
            setCargar(false);
            setAviso({
              tono: 'bien',
              texto: `Muestra guardada: ${entero(secciones)} secciones, ${entero(total)} entrevistas. Los encuestadores la reciben al abrir la app con conexión.`,
            });
            recargar();
            recargarEncuestas();
          }}
        />
      )}

      <Modal abierto={quitar} titulo="Quitar muestra" alCerrar={() => setQuitar(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-snug">
            Se borran las secciones y topes de esta encuesta. Las entrevistas levantadas no se tocan. Después los
            encuestadores podrán capturar cualquier sección.
          </p>
          <Boton variante="peligro" ancho cargando={quitando} onClick={quitarMuestra}>
            Sí, quitar muestra
          </Boton>
          <Boton variante="secundario" ancho onClick={() => setQuitar(false)}>
            Cancelar
          </Boton>
        </div>
      </Modal>
    </>
  );
}

export default function PaginaMuestra() {
  return <ConEncuesta>{(encuesta) => <MuestraDeEncuesta encuesta={encuesta} />}</ConEncuesta>;
}
