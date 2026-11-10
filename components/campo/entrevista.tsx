'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, MapPinOff, Megaphone, X } from 'lucide-react';
import { CampoDePregunta, type Cambios } from '@/components/campo/pregunta';
import { Aviso, Boton, Modal, cx } from '@/components/ui';
import {
  type AvancePropio,
  type Borrador,
  borrarBorrador,
  encolar,
  guardarArranque,
  guardarBorrador,
  obtenerUbicacion,
} from '@/lib/campo';
import {
  aplicarDerivadas,
  limpiarRespuestas,
  motivoParaTerminar,
  preguntasVisibles,
  validarPregunta,
} from '@/lib/encuesta/motor';
import type { Encuesta, EntrevistaNueva, Respuestas, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import { supabase } from '@/lib/supabase';

type Props = {
  encuesta: Encuesta;
  encuestador: { id: string; nombre: string };
  inicial: Borrador;
  avance: AvancePropio | null;
  /** Entrevistas de este dispositivo aún sin enviar, por zona. */
  pendientesPorZona: Record<string, number>;
  /** Sale sin terminar: la entrevista queda guardada para continuar después. */
  alPausar: () => void;
  alDescartar: () => void;
  alTerminar: (resultado: ResultadoEntrevista) => void;
};

/** Instrucción para el encuestador: no se lee al entrevistado. */
function Instruccion({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-aviso/15 px-3 py-2.5 text-[15px] leading-snug text-aviso-texto">
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">Instrucción para el encuestador: </span>
        {children}
      </span>
    </p>
  );
}

export function Entrevista({
  encuesta,
  encuestador,
  inicial,
  avance,
  pendientesPorZona,
  alPausar,
  alDescartar,
  alTerminar,
}: Props) {
  const def = encuesta.definicion;
  const [borrador, setBorrador] = useState<Borrador>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [marcar, setMarcar] = useState(false);
  const [terminada, setTerminada] = useState<string | null>(null);
  const [declaro, setDeclaro] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actual = useRef(borrador);
  /** true cuando la entrevista ya se guardó o la pantalla se cerró. */
  const cerrada = useRef(false);

  const { version, respuestas, paso } = borrador;
  const conDerivadas = useMemo(() => aplicarDerivadas(def, respuestas), [def, respuestas]);
  const visibles = useMemo(() => preguntasVisibles(def, version, conDerivadas), [def, version, conDerivadas]);
  const indice = visibles.findIndex((v) => v.pregunta.id === paso);
  const enPregunta = indice >= 0 ? visibles[indice] : null;

  /** Aplica un cambio al borrador y lo guarda en el dispositivo al momento. */
  const actualizar = useCallback(
    (cambio: Partial<Borrador>) => {
      // Una respuesta tardía (p. ej. la ubicación) no debe revivir un borrador ya cerrado.
      if (cerrada.current) return;
      const nuevo = { ...actual.current, ...cambio };
      actual.current = nuevo;
      setBorrador(nuevo);
      if (!guardarBorrador(encuestador.id, nuevo)) {
        setError('El dispositivo no pudo guardar el avance. Libera espacio y no cierres esta pantalla.');
      }
    },
    [encuestador.id],
  );

  // Cada paso empieza arriba y sin avisos del paso anterior.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [paso, terminada]);

  useEffect(() => {
    cerrada.current = false;
    return () => {
      cerrada.current = true;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, []);

  const irA = useCallback(
    (nuevoPaso: string, extra: Partial<Borrador> = {}) => {
      setError(null);
      setMarcar(false);
      actualizar({ paso: nuevoPaso, ...extra });
    },
    [actualizar],
  );

  /** Avanza desde el paso actual con las respuestas más recientes. */
  const siguiente = useCallback(() => {
    const b = actual.current;
    if (b.paso === 'arranque') {
      for (const p of def.arranque ?? []) {
        const falta = validarPregunta(def, p, b.version, b.respuestas);
        if (falta) {
          setError(`${p.texto}: ${falta}`);
          return;
        }
      }
      irA('intro', { iniciada_en: b.iniciada_en ?? new Date().toISOString() });
      // La ubicación se pide sin detener la entrevista.
      if (b.lat === null) {
        obtenerUbicacion().then((u) => {
          if (u && actual.current.id === b.id) actualizar(u);
        });
      }
      return;
    }

    const limpias = limpiarRespuestas(def, b.version, b.respuestas);
    const pasos = preguntasVisibles(def, b.version, limpias);
    if (b.paso === 'intro') {
      irA(pasos[0]?.pregunta.id ?? 'cierre');
      return;
    }

    const i = pasos.findIndex((v) => v.pregunta.id === b.paso);
    if (i < 0) {
      irA(pasos[0]?.pregunta.id ?? 'cierre');
      return;
    }
    const pregunta = pasos[i].pregunta;
    const falta = validarPregunta(def, pregunta, b.version, limpias);
    if (falta) {
      setError(falta);
      setMarcar(true);
      return;
    }
    const motivo = motivoParaTerminar(pregunta, limpias);
    if (motivo) {
      setError(null);
      setTerminada(motivo);
      return;
    }
    irA(pasos[i + 1]?.pregunta.id ?? 'cierre', { respuestas: limpias });
  }, [actualizar, def, irA]);

  const atras = useCallback(() => {
    const b = actual.current;
    if (b.paso === 'intro') return irA('arranque');
    const pasos = preguntasVisibles(def, b.version, aplicarDerivadas(def, b.respuestas));
    if (b.paso === 'cierre') return irA(pasos.at(-1)?.pregunta.id ?? 'intro');
    const i = pasos.findIndex((v) => v.pregunta.id === b.paso);
    irA(i > 0 ? pasos[i - 1].pregunta.id : 'intro');
  }, [def, irA]);

  const cambiar = useCallback(
    (cambios: Cambios, opciones?: { avanzar?: boolean }) => {
      const nuevas: Respuestas = { ...actual.current.respuestas };
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === undefined) delete nuevas[clave];
        else nuevas[clave] = valor;
      }
      setError(null);
      actualizar({ respuestas: nuevas });
      if (temporizador.current) clearTimeout(temporizador.current);
      if (opciones?.avanzar) {
        // Pausa breve para que se vea la opción marcada antes de avanzar.
        temporizador.current = setTimeout(siguiente, 220);
      }
    },
    [actualizar, siguiente],
  );

  async function guardar(resultado: ResultadoEntrevista, motivo: string | null) {
    setGuardando(true);
    setError(null);
    let b = actual.current;
    if (b.lat === null) {
      const u = await obtenerUbicacion(7000);
      if (u) b = { ...b, ...u };
    }
    const limpias = limpiarRespuestas(def, b.version, b.respuestas);
    const ahora = new Date().toISOString();
    const entrevista: EntrevistaNueva = {
      id: b.id,
      encuesta_id: encuesta.id,
      encuestador_id: encuestador.id,
      version: b.version,
      resultado,
      motivo_no_elegible: motivo,
      respuestas: limpias,
      iniciada_en: b.iniciada_en ?? ahora,
      terminada_en: ahora,
      lat: b.lat,
      lng: b.lng,
      precision_m: b.precision_m,
      dispositivo: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 400),
    };
    const campoZona = def.monitoreo?.campoZona;
    const zona = campoZona && limpias[campoZona] !== undefined ? String(limpias[campoZona]) : null;

    let guardada = encolar(encuestador.id, entrevista, zona);
    if (!guardada) {
      // El dispositivo no pudo guardarla: se intenta enviarla directamente.
      const { error: fallo } = await supabase()
        .from('entrevistas')
        .upsert(entrevista, { onConflict: 'id', ignoreDuplicates: true });
      guardada = !fallo;
    }
    if (!guardada) {
      setGuardando(false);
      setError(
        'No se pudo guardar la entrevista: el dispositivo no tiene espacio y no hay conexión. No cierres esta pantalla; libera espacio o busca señal y vuelve a intentar.',
      );
      return;
    }

    const arranque: Respuestas = {};
    for (const p of def.arranque ?? []) {
      if (limpias[p.id] !== undefined) arranque[p.id] = limpias[p.id];
    }
    cerrada.current = true;
    guardarArranque(encuestador.id, encuesta.id, arranque);
    borrarBorrador(encuestador.id);
    alTerminar(resultado);
  }

  // --- Datos de la zona (sección) para el arranque ---------------------------
  const campoZona = def.monitoreo?.campoZona;
  const zonaActual = campoZona && respuestas[campoZona] !== undefined ? String(respuestas[campoZona]) : null;
  const hechasEnZona = zonaActual
    ? (avance?.porZona[zonaActual] ?? 0) + (pendientesPorZona[zonaActual] ?? 0)
    : null;

  const total = visibles.length;
  const progreso =
    paso === 'cierre' ? 1 : indice >= 0 && total > 0 ? indice / total : 0;

  // --- Pantalla: entrevista terminada por un filtro ---------------------------
  if (terminada) {
    return (
      <Marco titulo="Entrevista terminada" progreso={null} alAbrirMenu={null}>
        <div className="flex flex-col gap-4">
          <Aviso tono="aviso" titulo="La persona no cumple los requisitos">
            {terminada}
          </Aviso>
          <p className="text-[17px] leading-relaxed">Agradezca su tiempo y despídase amablemente.</p>
          {error && <Aviso tono="grave">{error}</Aviso>}
        </div>
        <Pie>
          <Boton variante="secundario" tamano="grande" onClick={() => setTerminada(null)} disabled={guardando}>
            <ArrowLeft className="size-5" aria-hidden />
            Corregir
          </Boton>
          <Boton tamano="grande" className="flex-1" cargando={guardando} onClick={() => guardar('no_elegible', terminada)}>
            Registrar y terminar
          </Boton>
        </Pie>
      </Marco>
    );
  }

  return (
    <Marco
      titulo={
        paso === 'arranque'
          ? 'Nueva entrevista'
          : paso === 'intro'
            ? 'Introducción'
            : paso === 'cierre'
              ? 'Cierre'
              : (enPregunta?.seccion.titulo ?? '')
      }
      progreso={paso === 'arranque' ? null : progreso}
      detalle={enPregunta ? `${indice + 1} de ${total}` : undefined}
      version={version}
      alAbrirMenu={() => setMenu(true)}
      alEnviar={paso === 'cierre' ? undefined : siguiente}
    >
      {/* Arranque: datos operativos antes de tocar la puerta */}
      {paso === 'arranque' && (
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
              <CampoDePregunta def={def} pregunta={p} version={version} respuestas={respuestas} alCambiar={cambiar} />
            </div>
          ))}
          {zonaActual && hechasEnZona !== null && (
            <p className="text-[15px] text-tinta-2" role="status">
              Llevas <strong className="font-semibold text-tinta">{hechasEnZona}</strong>
              {def.monitoreo?.metaPorZona ? ` de ${def.monitoreo.metaPorZona}` : ''} entrevistas en{' '}
              {(def.monitoreo?.etiquetaZona ?? 'zona').toLowerCase()} {zonaActual}.
            </p>
          )}
        </div>
      )}

      {/* Introducción: lo que se lee al abrir la puerta */}
      {paso === 'intro' && (
        <div className="flex flex-col gap-4">
          {def.introduccion.instruccion && <Instruccion>{def.introduccion.instruccion}</Instruccion>}
          <div className="rounded-2xl border border-linea bg-white p-4 text-[19px] leading-relaxed whitespace-pre-line">
            {def.introduccion.texto.replaceAll('{encuestador}', encuestador.nombre || '(nombre del encuestador)')}
          </div>
        </div>
      )}

      {/* Pregunta */}
      {enPregunta && (
        <div className="flex flex-col gap-4">
          {indice === visibles.findIndex((v) => v.seccion.id === enPregunta.seccion.id) &&
            enPregunta.seccion.instruccion && <Instruccion>{enPregunta.seccion.instruccion}</Instruccion>}
          <h1 className="text-[21px] leading-snug font-semibold">
            {enPregunta.pregunta.numero && (
              <span className="mr-2 text-tinta-3">{enPregunta.pregunta.numero}.</span>
            )}
            {enPregunta.pregunta.texto}
          </h1>
          {enPregunta.pregunta.instruccion && <Instruccion>{enPregunta.pregunta.instruccion}</Instruccion>}
          <CampoDePregunta
            key={enPregunta.pregunta.id}
            def={def}
            pregunta={enPregunta.pregunta}
            version={version}
            respuestas={conDerivadas}
            alCambiar={cambiar}
            marcarFaltantes={marcar}
          />
        </div>
      )}

      {/* Cierre */}
      {paso === 'cierre' && (
        <div className="flex flex-col gap-4">
          <Instruccion>{def.cierre.texto}</Instruccion>
          <label className="flex cursor-pointer gap-3 rounded-2xl border border-eje bg-white p-4">
            <input
              type="checkbox"
              className="mt-1 size-6 shrink-0 accent-marca-600"
              checked={declaro}
              onChange={(e) => setDeclaro(e.target.checked)}
            />
            <span className="text-[15px] leading-relaxed">
              <strong className="font-semibold">Yo, {encuestador.nombre || 'encuestador(a)'}:</strong>{' '}
              {def.cierre.declaracion}
            </span>
          </label>
          <p className="flex items-center gap-2 text-sm text-tinta-2">
            {borrador.lat !== null ? (
              <>
                <MapPin className="size-4 text-bien" aria-hidden />
                Ubicación registrada (precisión ±{borrador.precision_m ?? '?'} m)
              </>
            ) : (
              <>
                <MapPinOff className="size-4 text-aviso-texto" aria-hidden />
                Sin ubicación todavía: se intentará de nuevo al guardar.
              </>
            )}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Aviso tono="grave">{error}</Aviso>
        </div>
      )}

      <Pie>
        {paso !== 'arranque' && (
          <Boton variante="secundario" tamano="grande" onClick={atras} disabled={guardando} aria-label="Atrás">
            <ArrowLeft className="size-5" aria-hidden />
            <span className="hidden sm:inline">Atrás</span>
          </Boton>
        )}
        {paso === 'cierre' ? (
          <Boton
            tamano="grande"
            className="flex-1"
            disabled={!declaro}
            cargando={guardando}
            onClick={() => guardar('completa', null)}
          >
            Guardar entrevista
          </Boton>
        ) : (
          <Boton tamano="grande" className="flex-1" onClick={siguiente}>
            {paso === 'arranque' ? 'Comenzar' : paso === 'intro' ? 'Iniciar preguntas' : 'Siguiente'}
            <ArrowRight className="size-5" aria-hidden />
          </Boton>
        )}
      </Pie>

      <Modal abierto={menu} titulo="Entrevista en curso" alCerrar={() => setMenu(false)}>
        {confirmarDescarte ? (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] leading-snug">
              Se borrarán las respuestas capturadas de esta entrevista. Esto no se puede deshacer.
            </p>
            <Boton variante="peligro" ancho onClick={alDescartar}>
              Sí, descartar entrevista
            </Boton>
            <Boton variante="secundario" ancho onClick={() => setConfirmarDescarte(false)}>
              No, conservarla
            </Boton>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Boton ancho onClick={() => setMenu(false)}>
              Seguir con la entrevista
            </Boton>
            <Boton variante="secundario" ancho onClick={alPausar}>
              Salir y continuar después
            </Boton>
            <Boton variante="peligro" ancho onClick={() => setConfirmarDescarte(true)}>
              Descartar entrevista
            </Boton>
          </div>
        )}
      </Modal>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Marco de la pantalla de captura
// ---------------------------------------------------------------------------

function Marco({
  titulo,
  progreso,
  detalle,
  version,
  alAbrirMenu,
  alEnviar,
  children,
}: {
  titulo: string;
  progreso: number | null;
  detalle?: string;
  version?: string;
  alAbrirMenu: (() => void) | null;
  /** Qué hacer al oprimir Enter/"Ir" en el teclado. */
  alEnviar?: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      noValidate
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        alEnviar?.();
      }}
    >
      <header className="sticky top-0 z-10 border-b border-linea bg-plano/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-tinta-2">{titulo}</p>
          </div>
          {detalle && <span className="shrink-0 text-sm text-tinta-3 tabular-nums">{detalle}</span>}
          {version && (
            <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-xs font-semibold text-tinta-2">
              V{version}
            </span>
          )}
          {alAbrirMenu && (
            <button
              type="button"
              onClick={alAbrirMenu}
              aria-label="Opciones de la entrevista"
              className="-mr-2 rounded-lg p-2 text-tinta-2 hover:bg-black/5"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        {progreso !== null && (
          <div
            className="h-1 bg-marca-100"
            role="progressbar"
            aria-label="Avance de la entrevista"
            aria-valuenow={Math.round(progreso * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cx('h-full bg-marca-600 transition-[width] duration-300')}
              style={{ width: `${Math.round(progreso * 100)}%` }}
            />
          </div>
        )}
      </header>
      <main className="flex-1 px-4 pt-5 pb-28">{children}</main>
    </form>
  );
}

/** Barra fija de acciones al pie, al alcance del pulgar. */
function Pie({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-linea bg-plano/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
