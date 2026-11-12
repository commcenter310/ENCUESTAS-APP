'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, mensajeDeError, useConsulta } from '@/components/admin/contexto';
import { AreaTexto, Aviso, Boton, Insignia, Modal } from '@/components/ui';
import { columnasDeRespuestas, etiquetaDe } from '@/lib/encuesta/columnas';
import { etiquetasZona } from '@/lib/encuesta/monitoreo';
import { type Encuesta, type EstadoRevision, NOMBRES_REVISION } from '@/lib/encuesta/tipos';
import type { EntrevistaConNombre } from '@/lib/exportar';
import { diaLocal, duracion, fechaHora, hora } from '@/lib/formato';
import { supabase } from '@/lib/supabase';

const CAMPOS_DETALLE =
  '*, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre), revisor:perfiles!entrevistas_revisada_por_fkey(nombre)';

type Detalle = EntrevistaConNombre & { revisor: { nombre: string } | null };

export const TONO_REVISION = { pendiente: 'neutro', validada: 'bien', anulada: 'grave' } as const;

export function DetalleDeEntrevista({
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
            <Dato nombre={etiquetasZona(encuesta.definicion).singular}>{e.zona ?? '–'}</Dato>
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
              <Insignia tono={TONO_REVISION[e.revision]}>{NOMBRES_REVISION[e.revision]}</Insignia>
              {e.revisada_en && (
                <span className="ml-1.5 text-tinta-3">
                  {e.revisor?.nombre ? `${e.revisor.nombre}, ` : ''}
                  {fechaHora(e.revisada_en, zona)}
                </span>
              )}
            </Dato>
          </dl>

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
              <Boton
                cargando={guardando === 'validada'}
                disabled={guardando !== null}
                onClick={() => revisar('validada')}
              >
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
