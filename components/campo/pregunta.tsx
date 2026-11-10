'use client';

import { useState } from 'react';
import { Check, CreditCard, EyeOff, X } from 'lucide-react';
import { AreaTexto, Boton, Entrada, cx } from '@/components/ui';
import { NSNC, esVisible, filasDe, opcionesDe, personasDe } from '@/lib/encuesta/motor';
import type {
  DefinicionEncuesta,
  Opcion,
  Pregunta,
  PreguntaAbierta,
  PreguntaAtributos,
  PreguntaEscala,
  PreguntaNumero,
  PreguntaUnica,
  Respuestas,
  Valor,
} from '@/lib/encuesta/tipos';

/** Cambios a las respuestas: `undefined` borra la clave. */
export type Cambios = Record<string, Valor | undefined>;

type Props<P extends Pregunta = Pregunta> = {
  def: DefinicionEncuesta;
  pregunta: P;
  version: string;
  respuestas: Respuestas;
  alCambiar: (cambios: Cambios, opciones?: { avanzar?: boolean }) => void;
  /** Resalta lo que falta (después de intentar continuar). */
  marcarFaltantes?: boolean;
  /** Presentación compacta, dentro de un grupo de campos. */
  compacta?: boolean;
};

function vacio(v: Valor | undefined): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function NoLeer() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-tinta-2 uppercase">
      <EyeOff className="size-3" aria-hidden />
      No leer
    </span>
  );
}

/** Opción grande de lista, para un solo toque con el pulgar. */
function OpcionLista({
  opcion,
  elegida,
  alElegir,
}: {
  opcion: Opcion;
  elegida: boolean;
  alElegir: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={elegida}
      onClick={alElegir}
      className={cx(
        'flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[17px] leading-snug transition-colors',
        elegida
          ? 'border-marca-600 bg-marca-50 font-semibold text-marca-900'
          : 'border-eje bg-white text-tinta active:bg-plano',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
          elegida ? 'border-marca-600 bg-marca-600 text-white' : 'border-eje bg-white',
        )}
      >
        {elegida && <Check className="size-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">{opcion.etiqueta}</span>
      {opcion.noLeer && <NoLeer />}
    </button>
  );
}

/** Opción chica, para matrices y listas de personas. */
function Ficha({
  etiqueta,
  elegida,
  alElegir,
  noLeer,
  className,
}: {
  etiqueta: string;
  elegida: boolean;
  alElegir: () => void;
  noLeer?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={elegida}
      onClick={alElegir}
      className={cx(
        'min-h-12 rounded-xl border px-3 py-2 text-[15px] leading-tight transition-colors',
        elegida
          ? 'border-marca-600 bg-marca-600 font-semibold text-white'
          : noLeer
            ? 'border-dashed border-eje bg-plano text-tinta-2 active:bg-linea'
            : 'border-eje bg-white text-tinta active:bg-plano',
        className,
      )}
    >
      {etiqueta}
    </button>
  );
}

function columnasParaFichas(n: number): string {
  if (n <= 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-4';
}

/** Tarjeta que se le muestra al entrevistado con los nombres en grande. */
function TarjetaParaMostrar({ opciones, alCerrar }: { opciones: Opcion[]; alCerrar: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tarjeta para el entrevistado"
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <ol className="mx-auto flex max-w-xl flex-col gap-1">
          {opciones.map((o) => (
            <li key={o.valor} className="border-b border-linea py-4 text-2xl leading-snug font-medium text-tinta">
              {o.etiqueta}
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-linea p-4">
        <Boton variante="secundario" tamano="grande" ancho onClick={alCerrar}>
          <X className="size-5" aria-hidden />
          Cerrar tarjeta
        </Boton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos de pregunta
// ---------------------------------------------------------------------------

function Unica({ def, pregunta: p, version, respuestas, alCambiar, compacta }: Props<PreguntaUnica>) {
  const [tarjeta, setTarjeta] = useState(false);
  const opciones = opcionesDe(def, p, version, respuestas);
  const valor = respuestas[p.id];
  const elegida = opciones.find((o) => o.valor === valor);

  function elegir(o: Opcion) {
    alCambiar(
      { [p.id]: o.valor, ...(o.especificar ? {} : { [`${p.id}_otro`]: undefined }) },
      { avanzar: !o.especificar && !compacta },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {p.tarjeta && (
        <>
          <Boton variante="secundario" onClick={() => setTarjeta(true)} className="self-start">
            <CreditCard className="size-4" aria-hidden />
            Mostrar tarjeta al entrevistado
          </Boton>
          {tarjeta && (
            <TarjetaParaMostrar opciones={opciones.filter((o) => !o.noLeer)} alCerrar={() => setTarjeta(false)} />
          )}
        </>
      )}
      <div
        role="radiogroup"
        aria-label={p.texto}
        className={compacta ? cx('grid gap-2', columnasParaFichas(opciones.length)) : 'flex flex-col gap-2'}
      >
        {opciones.map((o) =>
          compacta ? (
            <Ficha
              key={o.valor}
              etiqueta={o.etiqueta}
              noLeer={o.noLeer}
              elegida={o.valor === valor}
              alElegir={() => elegir(o)}
            />
          ) : (
            <OpcionLista key={o.valor} opcion={o} elegida={o.valor === valor} alElegir={() => elegir(o)} />
          ),
        )}
      </div>
      {elegida?.especificar && (
        <Entrada
          autoFocus
          aria-label={`${p.texto}: ¿cuál?`}
          placeholder="¿Cuál? Anotar textualmente"
          maxLength={200}
          value={String(respuestas[`${p.id}_otro`] ?? '')}
          onChange={(e) => alCambiar({ [`${p.id}_otro`]: e.target.value })}
        />
      )}
    </div>
  );
}

function Abierta({ pregunta: p, respuestas, alCambiar }: Props<PreguntaAbierta>) {
  const valor = String(respuestas[p.id] ?? '');
  const comunes = {
    'aria-label': p.texto,
    placeholder: p.marcador ?? (p.opcional ? 'Opcional' : 'Anotar textualmente'),
    maxLength: p.maxCaracteres ?? 300,
    value: valor,
  };
  return p.multilinea ? (
    <AreaTexto {...comunes} onChange={(e) => alCambiar({ [p.id]: e.target.value })} />
  ) : (
    <Entrada {...comunes} onChange={(e) => alCambiar({ [p.id]: e.target.value })} />
  );
}

function Numero({ pregunta: p, respuestas, alCambiar, compacta }: Props<PreguntaNumero>) {
  const valor = respuestas[p.id];
  return (
    <div className="flex items-center gap-3">
      <Entrada
        aria-label={p.texto}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder={p.opcional ? 'Opcional' : undefined}
        className={compacta ? 'max-w-32' : 'h-16 max-w-40 text-center text-2xl font-semibold'}
        value={valor === undefined ? '' : String(valor)}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, '').slice(0, 6);
          alCambiar({ [p.id]: digitos === '' ? undefined : Number(digitos) });
        }}
      />
      {p.sufijo && <span className="text-lg text-tinta-2">{p.sufijo}</span>}
    </div>
  );
}

function Escala({ pregunta: p, respuestas, alCambiar }: Props<PreguntaEscala>) {
  const valor = respuestas[p.id];
  const valores = Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={p.texto} className="grid grid-cols-5 gap-2">
        {valores.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={valor === n}
            onClick={() => alCambiar({ [p.id]: n }, { avanzar: true })}
            className={cx(
              'flex h-14 items-center justify-center rounded-xl border text-xl font-semibold transition-colors',
              valor === n
                ? 'border-marca-600 bg-marca-600 text-white'
                : 'border-eje bg-white text-tinta active:bg-plano',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {(p.etiquetaMin || p.etiquetaMax) && (
        <div className="flex justify-between text-sm text-tinta-2">
          <span>
            {p.min} = {p.etiquetaMin}
          </span>
          <span>
            {p.max} = {p.etiquetaMax}
          </span>
        </div>
      )}
      {p.nsnc && (
        <div role="radiogroup" aria-label="Sin respuesta">
          <OpcionLista
            opcion={{ valor: NSNC, etiqueta: 'NS/NC', noLeer: true }}
            elegida={valor === NSNC}
            alElegir={() => alCambiar({ [p.id]: NSNC }, { avanzar: true })}
          />
        </div>
      )}
    </div>
  );
}

/** Marco de cada fila de una matriz: nombre, estado y controles. */
function Fila({
  titulo,
  lista,
  falta,
  children,
}: {
  titulo: string;
  lista: boolean;
  falta: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-2xl border bg-white p-3.5',
        falta ? 'border-aviso ring-2 ring-aviso/40' : lista ? 'border-linea' : 'border-eje',
      )}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="text-[17px] leading-snug font-semibold">{titulo}</p>
        {lista ? (
          <Check className="mt-0.5 size-5 shrink-0 text-bien" aria-label="Respondida" />
        ) : (
          falta && <span className="shrink-0 text-xs font-semibold text-aviso-texto uppercase">Falta</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Matriz({
  def,
  pregunta: p,
  version,
  respuestas,
  alCambiar,
  marcarFaltantes,
}: Props<Extract<Pregunta, { tipo: 'matriz' }>>) {
  return (
    <div className="flex flex-col gap-3">
      {filasDe(def, p, version).map((f) => {
        const clave = `${p.id}.${f.valor}`;
        const valor = respuestas[clave];
        return (
          <Fila key={f.valor} titulo={f.etiqueta} lista={!vacio(valor)} falta={Boolean(marcarFaltantes) && vacio(valor)}>
            <div role="radiogroup" aria-label={f.etiqueta} className={cx('grid gap-2', columnasParaFichas(p.columnas.length))}>
              {p.columnas.map((c) => (
                <Ficha
                  key={c.valor}
                  etiqueta={c.etiqueta}
                  noLeer={c.noLeer}
                  elegida={valor === c.valor}
                  alElegir={() => alCambiar({ [clave]: c.valor })}
                />
              ))}
            </div>
          </Fila>
        );
      })}
    </div>
  );
}

function Conocimiento({
  def,
  pregunta: p,
  version,
  respuestas,
  alCambiar,
  marcarFaltantes,
}: Props<Extract<Pregunta, { tipo: 'conocimiento' }>>) {
  return (
    <div className="flex flex-col gap-3">
      {filasDe(def, p, version).map((f) => {
        const claveConoce = `${p.id}.${f.valor}.conoce`;
        const claveOpinion = `${p.id}.${f.valor}.opinion`;
        const conoce = respuestas[claveConoce];
        const opinion = respuestas[claveOpinion];
        const lista = conoce === 'no' || (conoce === 'si' && !vacio(opinion));
        return (
          <Fila key={f.valor} titulo={f.etiqueta} lista={lista} falta={Boolean(marcarFaltantes) && !lista}>
            <div role="radiogroup" aria-label={`${f.etiqueta}: ¿conoce?`} className="grid grid-cols-2 gap-2">
              <Ficha
                etiqueta="No conoce"
                elegida={conoce === 'no'}
                alElegir={() => alCambiar({ [claveConoce]: 'no', [claveOpinion]: undefined })}
              />
              <Ficha
                etiqueta="Sí conoce"
                elegida={conoce === 'si'}
                alElegir={() => alCambiar({ [claveConoce]: 'si' })}
              />
            </div>
            {conoce === 'si' && (
              <div className="mt-3 border-t border-linea pt-3">
                <p className="mb-2 text-sm text-tinta-2">{p.textoOpinion}</p>
                <div
                  role="radiogroup"
                  aria-label={`${f.etiqueta}: opinión`}
                  className={cx('grid gap-2', columnasParaFichas(p.opinion.length))}
                >
                  {p.opinion.map((o) => (
                    <Ficha
                      key={o.valor}
                      etiqueta={o.etiqueta}
                      noLeer={o.noLeer}
                      elegida={opinion === o.valor}
                      alElegir={() => alCambiar({ [claveOpinion]: o.valor })}
                    />
                  ))}
                </div>
              </div>
            )}
          </Fila>
        );
      })}
    </div>
  );
}

function Atributos({ def, pregunta: p, version, respuestas, alCambiar, marcarFaltantes }: Props<PreguntaAtributos>) {
  const personas = [...personasDe(def, p, version, respuestas), ...(p.opcionesFijas ?? [])];
  return (
    <div className="flex flex-col gap-3">
      {p.atributos.map((a) => {
        const clave = `${p.id}.${a.valor}`;
        const valor = respuestas[clave];
        const valida = personas.some((o) => o.valor === valor);
        return (
          <Fila key={a.valor} titulo={a.etiqueta} lista={valida} falta={Boolean(marcarFaltantes) && !valida}>
            <div role="radiogroup" aria-label={a.etiqueta} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {personas.map((o) => (
                <Ficha
                  key={o.valor}
                  etiqueta={o.etiqueta}
                  noLeer={o.fija}
                  elegida={valor === o.valor}
                  alElegir={() => alCambiar({ [clave]: o.valor })}
                  className="text-left"
                />
              ))}
            </div>
          </Fila>
        );
      })}
    </div>
  );
}

function Grupo(props: Props<Extract<Pregunta, { tipo: 'grupo' }>>) {
  const { def, pregunta: p, version, respuestas } = props;
  return (
    <div className="flex flex-col gap-5">
      {p.campos
        .filter((c) => esVisible(def, c, version, respuestas))
        .map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <p className="text-[15px] font-semibold text-tinta-2">
              {c.texto}
              {c.opcional && <span className="font-normal text-tinta-3"> (opcional)</span>}
            </p>
            <CampoDePregunta {...props} pregunta={c} compacta />
          </div>
        ))}
    </div>
  );
}

/** Dibuja el control que corresponde al tipo de pregunta. */
export function CampoDePregunta(props: Props) {
  const p = props.pregunta;
  switch (p.tipo) {
    case 'unica':
      return <Unica {...props} pregunta={p} />;
    case 'abierta':
      return <Abierta {...props} pregunta={p} />;
    case 'numero':
      return <Numero {...props} pregunta={p} />;
    case 'escala':
      return <Escala {...props} pregunta={p} />;
    case 'matriz':
      return <Matriz {...props} pregunta={p} />;
    case 'conocimiento':
      return <Conocimiento {...props} pregunta={p} />;
    case 'atributos':
      return <Atributos {...props} pregunta={p} />;
    case 'grupo':
      return <Grupo {...props} pregunta={p} />;
  }
}
