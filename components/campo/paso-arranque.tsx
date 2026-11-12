'use client';

import { useState } from 'react';
import { List } from 'lucide-react';
import { CampoDePregunta, type Cambios } from '@/components/campo/pregunta';
import { Aviso, Boton, Entrada, Modal, cx } from '@/components/ui';
import type { EncuestaDeCampo } from '@/lib/campo';
import { etiquetasZona, zonaDe } from '@/lib/encuesta/monitoreo';
import type { Respuestas } from '@/lib/encuesta/tipos';
import type { SeccionMuestra } from '@/lib/muestra';
import { type Conteo, type RevisionDeSeccion, levantadasEn, revisarSeccion } from '@/lib/muestra-avance';

/** Datos operativos antes de tocar la puerta: sección y su situación en la muestra. */
export function PasoArranque({
  encuesta,
  version,
  respuestas,
  equipo,
  propias,
  alCambiar,
}: {
  encuesta: EncuestaDeCampo;
  version: string;
  respuestas: Respuestas;
  equipo: Conteo;
  propias: Conteo;
  alCambiar: (cambios: Cambios) => void;
}) {
  const [verLista, setVerLista] = useState(false);
  const def = encuesta.definicion;
  const etiquetas = etiquetasZona(def);
  const campoZona = def.monitoreo?.campoZona;
  const zona = zonaDe(def, respuestas);
  const conMuestra = encuesta.muestra.length > 0;
  const revision = revisarSeccion(encuesta.muestra, zona, equipo, propias);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl leading-snug font-semibold">{encuesta.titulo}</h1>
        <p className="mt-1 text-[15px] text-tinta-2">
          Cuestionario versión <strong className="font-semibold text-tinta">{version}</strong>
          {def.versiones.length > 1 && ' (el orden de partidos y nombres ya viene rotado)'}
        </p>
      </div>
      {(def.arranque ?? []).map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <p className="text-[17px] font-semibold">{p.texto}</p>
          {p.instruccion && <p className="text-[15px] text-tinta-2">{p.instruccion}</p>}
          <CampoDePregunta def={def} pregunta={p} version={version} respuestas={respuestas} alCambiar={alCambiar} />
        </div>
      ))}
      {conMuestra && campoZona && (
        <Boton variante="secundario" className="self-start" onClick={() => setVerLista(true)}>
          <List className="size-4" aria-hidden />
          Ver {etiquetas.plural.toLowerCase()} de la muestra
        </Boton>
      )}
      {revision && <InfoSeccion revision={revision} etiqueta={etiquetas.singular} />}
      {!conMuestra && zona && (
        <p className="text-[15px] text-tinta-2" role="status">
          Llevas <strong className="font-semibold text-tinta">{propias[zona] ?? 0}</strong>
          {def.monitoreo?.metaPorZona ? ` de ${def.monitoreo.metaPorZona}` : ''} entrevistas en{' '}
          {etiquetas.singular.toLowerCase()} {zona}.
        </p>
      )}
      {verLista && campoZona && (
        <ListaDeSecciones
          muestra={encuesta.muestra}
          conteo={equipo}
          titulo={`${etiquetas.plural} de la muestra`}
          alElegir={(seccion) => {
            alCambiar({ [campoZona]: Number(seccion) });
            setVerLista(false);
          }}
          alCerrar={() => setVerLista(false)}
        />
      )}
    </div>
  );
}

function InfoSeccion({ revision, etiqueta }: { revision: RevisionDeSeccion; etiqueta: string }) {
  const { ubicacion } = revision;
  if (ubicacion.tipo === 'fuera') {
    return (
      <Aviso tono="grave" titulo={`${etiqueta} ${revision.seccion} fuera de la muestra`}>
        No está en la lista de esta encuesta. Revisa el número o elige una de la lista.
      </Aviso>
    );
  }
  const fila = ubicacion.fila;
  const datos = [
    fila.distrito_local ? `Distrito local ${fila.distrito_local}` : null,
    fila.distrito_federal ? `Distrito federal ${fila.distrito_federal}` : null,
    fila.estrato,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3" role="status">
      {ubicacion.tipo === 'reemplazo' && (
        <Aviso tono="aviso" titulo={`Es el reemplazo de la ${etiqueta.toLowerCase()} ${fila.seccion}`}>
          Úsala solo si la titular es inaccesible. Lo que levantes aquí cuenta para el tope de la {fila.seccion}.
        </Aviso>
      )}
      {revision.llena ? (
        <Aviso tono="grave" titulo="Tope completo">
          Esta {etiqueta.toLowerCase()} ya tiene {revision.levantadas} de {fila.meta} entrevistas. Elige otra de la
          muestra.
        </Aviso>
      ) : (
        <div className="rounded-xl border border-linea bg-white px-4 py-3 text-[15px]">
          {datos.length > 0 && <p className="text-tinta-2">{datos.join(' · ')}</p>}
          <p className="mt-1">
            El equipo lleva <strong className="font-semibold">{revision.levantadas}</strong> de{' '}
            <strong className="font-semibold">{fila.meta}</strong> entrevistas
            {revision.propias > 0 && <span className="text-tinta-2"> (tú: {revision.propias})</span>}.
          </p>
        </div>
      )}
    </div>
  );
}

function ListaDeSecciones({
  muestra,
  conteo,
  titulo,
  alElegir,
  alCerrar,
}: {
  muestra: SeccionMuestra[];
  conteo: Conteo;
  titulo: string;
  alElegir: (seccion: string) => void;
  alCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [verLlenas, setVerLlenas] = useState(false);
  const filas = muestra
    .map((fila) => ({ fila, levantadas: levantadasEn(fila, conteo) }))
    .filter(({ fila, levantadas }) => verLlenas || levantadas < fila.meta)
    .filter(({ fila }) => !busqueda || fila.seccion.startsWith(busqueda) || fila.reemplazo?.startsWith(busqueda));
  return (
    <Modal abierto titulo={titulo} alCerrar={alCerrar}>
      <div className="flex flex-col gap-3">
        <Entrada
          aria-label="Buscar número"
          inputMode="numeric"
          placeholder="Buscar número"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, ''))}
        />
        <label className="flex items-center gap-2 text-sm text-tinta-2">
          <input
            type="checkbox"
            className="size-4 accent-marca-600"
            checked={verLlenas}
            onChange={(e) => setVerLlenas(e.target.checked)}
          />
          Mostrar también las que ya completaron su tope
        </label>
        <p className="text-xs text-tinta-3">Avance del equipo según la última vez que hubo conexión.</p>
        <ul className="divide-y divide-linea rounded-xl border border-linea">
          {filas.length === 0 && <li className="px-3 py-4 text-center text-sm text-tinta-3">Sin resultados.</li>}
          {filas.map(({ fila, levantadas }) => {
            const llena = levantadas >= fila.meta;
            return (
              <li key={fila.seccion}>
                <button
                  type="button"
                  disabled={llena}
                  onClick={() => alElegir(fila.seccion)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-plano disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="w-14 font-semibold tabular-nums">{fila.seccion}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-tinta-2">
                    {[
                      fila.distrito_local && `DL ${fila.distrito_local}`,
                      fila.estrato,
                      fila.reemplazo && `reemplazo ${fila.reemplazo}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className={cx('shrink-0 text-sm tabular-nums', llena ? 'text-bien-texto' : 'text-tinta-2')}>
                    {levantadas}/{fila.meta}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
