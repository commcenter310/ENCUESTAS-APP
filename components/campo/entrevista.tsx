'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, List, MapPin, MapPinOff, Megaphone, X } from 'lucide-react';
import { CampoDePregunta, type Cambios } from '@/components/campo/pregunta';
import { Aviso, Boton, Entrada, Modal, cx } from '@/components/ui';
import {
  type AvancePropio,
  type Borrador,
  type EncuestaDeCampo,
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
import type { EntrevistaNueva, Respuestas, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import { type SeccionMuestra, type UbicacionSeccion, levantadasEn, ubicarSeccion } from '@/lib/muestra';
import { supabase } from '@/lib/supabase';

/** Situación de la sección elegida respecto a la muestra y su tope. */
type EstadoSeccion = {
  seccion: string;
  ubicacion: UbicacionSeccion;
  /** Entrevistas que ya cuentan para la sección (todo el equipo + pendientes de este teléfono). */
  levantadas: number;
  /** Entrevistas propias en la sección. */
  propias: number;
  llena: boolean;
};

function sumar(...mapas: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const m of mapas) for (const [k, v] of Object.entries(m)) total[k] = (total[k] ?? 0) + v;
  return total;
}

/** Revisa la sección contra la muestra. Sin muestra cargada devuelve null (se acepta cualquiera). */
function revisarSeccion(
  muestra: SeccionMuestra[],
  valor: unknown,
  avance: AvancePropio | null,
  pendientes: Record<string, number>,
): EstadoSeccion | null {
  if (muestra.length === 0 || valor === undefined || valor === null || valor === '') return null;
  const seccion = String(valor);
  const ubicacion = ubicarSeccion(muestra, seccion);
  const conteo = sumar(avance?.equipo ?? {}, pendientes);
  const propio = sumar(avance?.porZona ?? {}, pendientes);
  if (ubicacion.tipo === 'fuera') return { seccion, ubicacion, levantadas: 0, propias: 0, llena: false };
  const levantadas = levantadasEn(ubicacion.fila, conteo);
  return {
    seccion,
    ubicacion,
    levantadas,
    propias: levantadasEn(ubicacion.fila, propio),
    llena: levantadas >= ubicacion.fila.meta,
  };
}

type Props = {
  encuesta: EncuestaDeCampo;
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
  const [listaSecciones, setListaSecciones] = useState(false);
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
      // Con muestra cargada: la sección debe estar en ella y no haber llegado a su tope.
      const campo = def.monitoreo?.campoZona;
      const estado = campo ? revisarSeccion(encuesta.muestra, b.respuestas[campo], avance, pendientesPorZona) : null;
      const etiqueta = (def.monitoreo?.etiquetaZona ?? 'Sección').toLowerCase();
      if (estado?.ubicacion.tipo === 'fuera') {
        setError(`La ${etiqueta} ${estado.seccion} no está en la muestra de esta encuesta. Revisa el número o elige una de la lista.`);
        return;
      }
      let respuestas = b.respuestas;
      if (estado) {
        // Titular o reemplazo (las que están fuera ya se rechazaron arriba).
        const fila = estado.ubicacion.fila;
        if (estado.llena) {
          setError(
            `La ${etiqueta} ${fila.seccion} ya completó su tope (${estado.levantadas} de ${fila.meta} entrevistas). Elige otra de la muestra.`,
          );
          return;
        }
        // Distritos de la muestra en las preguntas que lo piden (si están vacías).
        const autollenar = def.monitoreo?.autollenar;
        respuestas = { ...respuestas };
        if (autollenar?.distrito_local && respuestas[autollenar.distrito_local] === undefined && fila.distrito_local) {
          respuestas[autollenar.distrito_local] = fila.distrito_local;
        }
        if (autollenar?.distrito_federal && respuestas[autollenar.distrito_federal] === undefined && fila.distrito_federal) {
          respuestas[autollenar.distrito_federal] = fila.distrito_federal;
        }
      }
      irA('intro', { iniciada_en: b.iniciada_en ?? new Date().toISOString(), respuestas });
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
  }, [actualizar, def, irA, encuesta.muestra, avance, pendientesPorZona]);

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
  const conMuestra = encuesta.muestra.length > 0;
  const hechasEnZona = zonaActual
    ? (avance?.porZona[zonaActual] ?? 0) + (pendientesPorZona[zonaActual] ?? 0)
    : null;
  const estadoZona = revisarSeccion(encuesta.muestra, zonaActual, avance, pendientesPorZona);
  const etiquetaZona = def.monitoreo?.etiquetaZona ?? 'Sección';

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
          {conMuestra && campoZona && (
            <Boton variante="secundario" className="self-start" onClick={() => setListaSecciones(true)}>
              <List className="size-4" aria-hidden />
              Ver {etiquetaZona.toLowerCase() === 'sección' ? 'secciones' : 'zonas'} de la muestra
            </Boton>
          )}
          {conMuestra && estadoZona && <InfoSeccion estado={estadoZona} etiqueta={etiquetaZona} />}
          {!conMuestra && zonaActual && hechasEnZona !== null && (
            <p className="text-[15px] text-tinta-2" role="status">
              Llevas <strong className="font-semibold text-tinta">{hechasEnZona}</strong>
              {def.monitoreo?.metaPorZona ? ` de ${def.monitoreo.metaPorZona}` : ''} entrevistas en{' '}
              {etiquetaZona.toLowerCase()} {zonaActual}.
            </p>
          )}
          {listaSecciones && campoZona && (
            <ListaDeSecciones
              muestra={encuesta.muestra}
              conteo={sumar(avance?.equipo ?? {}, pendientesPorZona)}
              etiqueta={etiquetaZona}
              alElegir={(seccion) => {
                cambiar({ [campoZona]: Number(seccion) });
                setListaSecciones(false);
              }}
              alCerrar={() => setListaSecciones(false)}
            />
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

// ---------------------------------------------------------------------------
// Sección de la muestra
// ---------------------------------------------------------------------------

function InfoSeccion({ estado, etiqueta }: { estado: EstadoSeccion; etiqueta: string }) {
  const { ubicacion } = estado;
  if (ubicacion.tipo === 'fuera') {
    return (
      <Aviso tono="grave" titulo={`${etiqueta} ${estado.seccion} fuera de la muestra`}>
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
      {estado.llena ? (
        <Aviso tono="grave" titulo="Tope completo">
          Esta {etiqueta.toLowerCase()} ya tiene {estado.levantadas} de {fila.meta} entrevistas. Elige otra de la muestra.
        </Aviso>
      ) : (
        <div className="rounded-xl border border-linea bg-white px-4 py-3 text-[15px]">
          {datos.length > 0 && <p className="text-tinta-2">{datos.join(' · ')}</p>}
          <p className="mt-1">
            El equipo lleva <strong className="font-semibold">{estado.levantadas}</strong> de{' '}
            <strong className="font-semibold">{fila.meta}</strong> entrevistas
            {estado.propias > 0 && <span className="text-tinta-2"> (tú: {estado.propias})</span>}.
          </p>
        </div>
      )}
    </div>
  );
}

function ListaDeSecciones({
  muestra,
  conteo,
  etiqueta,
  alElegir,
  alCerrar,
}: {
  muestra: SeccionMuestra[];
  conteo: Record<string, number>;
  etiqueta: string;
  alElegir: (seccion: string) => void;
  alCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [verLlenas, setVerLlenas] = useState(false);
  const filas = muestra
    .map((f) => ({ fila: f, levantadas: levantadasEn(f, conteo) }))
    .filter(({ fila, levantadas }) => verLlenas || levantadas < fila.meta)
    .filter(({ fila }) => !busqueda || fila.seccion.startsWith(busqueda.trim()) || fila.reemplazo?.startsWith(busqueda.trim()))
    .sort((a, b) => Number(a.fila.seccion) - Number(b.fila.seccion));
  return (
    <Modal abierto titulo={`${etiqueta === 'Sección' ? 'Secciones' : 'Zonas'} de la muestra`} alCerrar={alCerrar}>
      <div className="flex flex-col gap-3">
        <Entrada
          aria-label="Buscar número"
          inputMode="numeric"
          placeholder="Buscar número"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, ''))}
        />
        <label className="flex items-center gap-2 text-sm text-tinta-2">
          <input type="checkbox" className="size-4 accent-marca-600" checked={verLlenas} onChange={(e) => setVerLlenas(e.target.checked)} />
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
                    {[fila.distrito_local && `DL ${fila.distrito_local}`, fila.estrato, fila.reemplazo && `reemplazo ${fila.reemplazo}`]
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
