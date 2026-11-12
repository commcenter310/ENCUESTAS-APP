'use client';

import { useMemo, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { mensajeDeError } from '@/components/admin/contexto';
import { Aviso, Boton, Campo, Cargando, Entrada, Modal } from '@/components/ui';
import type { Encuesta } from '@/lib/encuesta/tipos';
import { descargar } from '@/lib/exportar';
import { entero } from '@/lib/formato';
import { type Hoja, PLANTILLA_CSV, interpretarMuestra, leerCsv } from '@/lib/muestra';
import { resumirMuestra } from '@/lib/muestra-avance';
import { supabase } from '@/lib/supabase';

class ArchivoNoSoportado extends Error {}

async function leerArchivo(archivo: File): Promise<Hoja[]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) {
    return [{ nombre: archivo.name, filas: leerCsv(await archivo.text()) }];
  }
  if (nombre.endsWith('.xls')) {
    throw new ArchivoNoSoportado(
      'Los archivos .xls (Excel 97-2003) no se pueden leer. Guárdalo como .xlsx o como CSV.',
    );
  }
  // Se carga solo cuando hace falta para no pesar en el resto de la app.
  const { default: leerXlsx } = await import('read-excel-file/browser');
  const hojas = await leerXlsx(archivo);
  return hojas.map((h) => ({ nombre: h.sheet, filas: h.data as unknown[][] }));
}

function numeroOpcional(texto: string): number | null {
  const n = Number(texto);
  return texto.trim() && Number.isInteger(n) && n > 0 ? n : null;
}

function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, 3);
}

export function CargarMuestra({
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

  const resultado = useMemo(
    () =>
      hojas
        ? interpretarMuestra(hojas, { distritoFederal: numeroOpcional(df), distritoLocal: numeroOpcional(dl) })
        : null,
    [hojas, df, dl],
  );
  // Sin los valores por defecto: así el campo sigue visible mientras se escribe.
  const sinDefectos = useMemo(() => (hojas ? interpretarMuestra(hojas) : null), [hojas]);
  const resumen = resultado ? resumirMuestra(resultado.secciones) : null;
  const listo = resultado && resultado.errores.length === 0 && resultado.secciones.length > 0;

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
        e instanceof ArchivoNoSoportado
          ? e.message
          : 'No se pudo leer el archivo. Revisa que sea un Excel (.xlsx) o un CSV.',
      );
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!listo) return;
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

        {resultado && sinDefectos && !leyendo && (
          <>
            {(sinDefectos.faltanDf > 0 || sinDefectos.faltanDl > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {sinDefectos.faltanDf > 0 && (
                  <Campo etiqueta="Distrito federal para las secciones que no lo traen">
                    {(p) => (
                      <Entrada
                        {...p}
                        inputMode="numeric"
                        className="max-w-32"
                        value={df}
                        onChange={(e) => setDf(soloDigitos(e.target.value))}
                      />
                    )}
                  </Campo>
                )}
                {sinDefectos.faltanDl > 0 && (
                  <Campo etiqueta="Distrito local para las secciones que no lo traen">
                    {(p) => (
                      <Entrada
                        {...p}
                        inputMode="numeric"
                        className="max-w-32"
                        value={dl}
                        onChange={(e) => setDl(soloDigitos(e.target.value))}
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

            {listo && resumen && (
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
          <Boton cargando={guardando} disabled={!listo} onClick={guardar}>
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
