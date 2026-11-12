'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { mensajeDeError, useConsulta, usePanel } from '@/components/admin/contexto';
import { Cifra, Medidor } from '@/components/admin/graficas';
import { CargarMuestra } from '@/components/admin/muestra/cargar-muestra';
import { TablaDeSecciones } from '@/components/admin/muestra/tabla-secciones';
import { Aviso, Boton, Modal, Tarjeta, cx } from '@/components/ui';
import { etiquetasZona } from '@/lib/encuesta/monitoreo';
import { type Encuesta, nombreDeTipo } from '@/lib/encuesta/tipos';
import { descargar, muestraACsv } from '@/lib/exportar';
import { entero, porcentaje } from '@/lib/formato';
import { avanceDeMuestra } from '@/lib/muestra-avance';
import { leerConteoSecciones, leerMuestra } from '@/lib/muestra-datos';
import { supabase } from '@/lib/supabase';

function MuestraDeEncuesta({ encuesta }: { encuesta: Encuesta }) {
  const { recargar: recargarEncuestas } = usePanel();
  const etiqueta = etiquetasZona(encuesta.definicion).singular;

  const consulta = useCallback(
    async () => Promise.all([leerMuestra(encuesta.id), leerConteoSecciones(encuesta.id)]),
    [encuesta.id],
  );
  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta, 60000);
  const avance = useMemo(() => (datos ? avanceDeMuestra(datos[0], datos[1]) : null), [datos]);

  const [cargar, setCargar] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'bien' | 'grave'; texto: string } | null>(null);

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
      setAviso({ tono: 'bien', texto: 'Muestra quitada. Los encuestadores pueden usar cualquier sección.' });
      recargar();
    }
  }

  const tieneMuestra = (avance?.filas.length ?? 0) > 0;
  const enFuera = avance?.fuera.reduce((s, [, n]) => s + n, 0) ?? 0;

  return (
    <>
      <Encabezado
        titulo="Muestra"
        descripcion={`${nombreDeTipo(encuesta.tipo)} · secciones a levantar y tope de entrevistas en cada una.`}
      >
        {tieneMuestra && avance && (
          <>
            <BotonActualizar alOprimir={recargar} girando={actualizando} />
            <Boton
              variante="secundario"
              tamano="chico"
              onClick={() => descargar(`${encuesta.clave}_muestra.csv`, muestraACsv(avance.filas))}
            >
              <Download className="size-4" aria-hidden />
              Descargar (CSV)
            </Boton>
          </>
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

      {!avance ? (
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
                  {entero(avance.utiles)}
                  <span className="ml-2 text-lg font-normal text-tinta-3">de {entero(avance.meta)}</span>
                </>
              }
              detalle={`${porcentaje(avance.meta ? (avance.utiles / avance.meta) * 100 : 0, 1)} del total · sin contar excedentes`}
            >
              <div className="mt-3">
                <Medidor valor={avance.utiles} meta={avance.meta} etiqueta="Avance de la muestra" />
              </div>
            </Cifra>
            <Cifra
              etiqueta="Secciones completas"
              valor={entero(avance.completas)}
              detalle={`de ${entero(avance.filas.length)} en la muestra`}
            />
            <Cifra
              etiqueta="Con alertas"
              valor={
                <span className="inline-flex items-center gap-2">
                  {entero(avance.excedentes + enFuera)}
                  {avance.excedentes + enFuera > 0 ? (
                    <AlertTriangle className="size-6 text-aviso-texto" aria-label="Requieren revisión" />
                  ) : (
                    <CheckCircle2 className="size-6 text-bien" aria-label="Sin alertas" />
                  )}
                </span>
              }
              detalle={`${entero(avance.excedentes)} sobre el tope · ${entero(enFuera)} fuera de muestra`}
            />
          </div>

          {avance.fuera.length > 0 && (
            <Aviso tono="aviso" titulo="Entrevistas en secciones fuera de la muestra">
              {avance.fuera.map(([zona, n]) => `${zona} (${n})`).join(', ')}. Pueden venir de teléfonos que capturaron
              antes de cargar la muestra. Revísalas en Entrevistas.
            </Aviso>
          )}
          {avance.conReemplazo > 0 && (
            <Aviso tono="marca">
              {avance.conReemplazo} {avance.conReemplazo === 1 ? 'sección tiene' : 'secciones tienen'} entrevistas en su
              sección de reemplazo; cuentan para la titular.
            </Aviso>
          )}

          <TablaDeSecciones filas={avance.filas} />

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
          yaTiene={avance?.filas.length ?? 0}
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
