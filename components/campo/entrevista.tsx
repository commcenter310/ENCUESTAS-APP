'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, MapPinOff } from 'lucide-react';
import { Instruccion, Marco, Pie } from '@/components/campo/marco-captura';
import { PasoArranque } from '@/components/campo/paso-arranque';
import { CampoDePregunta, type Cambios } from '@/components/campo/pregunta';
import { Aviso, Boton, Modal } from '@/components/ui';
import {
  type AvancePropio,
  type Borrador,
  type EncuestaDeCampo,
  armarEntrevista,
  conteosDeCampo,
  guardarBorrador,
  guardarEntrevistaTerminada,
  obtenerUbicacion,
  revisarArranque,
} from '@/lib/campo';
import {
  aplicarDerivadas,
  limpiarRespuestas,
  motivoParaTerminar,
  preguntasVisibles,
  validarPregunta,
} from '@/lib/encuesta/motor';
import type { Respuestas, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import type { Conteo } from '@/lib/muestra-avance';

type Props = {
  encuesta: EncuestaDeCampo;
  encuestador: { id: string; nombre: string };
  inicial: Borrador;
  avance: AvancePropio | null;
  /** Entrevistas de este teléfono aún sin enviar, por sección. */
  pendientesPorZona: Conteo;
  /** Sale sin terminar: la entrevista queda guardada para continuar después. */
  alPausar: () => void;
  alDescartar: () => void;
  alTerminar: (resultado: ResultadoEntrevista) => void;
};

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
  const { equipo, propias } = useMemo(() => conteosDeCampo(avance, pendientesPorZona), [avance, pendientesPorZona]);

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

  const siguiente = useCallback(() => {
    const b = actual.current;
    if (b.paso === 'arranque') {
      const revision = revisarArranque(encuesta, b, equipo, propias);
      if ('error' in revision) {
        setError(revision.error);
        return;
      }
      const { respuestas, autollenado } = revision;
      irA('intro', { iniciada_en: b.iniciada_en ?? new Date().toISOString(), respuestas, autollenado });
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
  }, [actualizar, def, irA, encuesta, equipo, propias]);

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
    const entrevista = armarEntrevista(encuesta, encuestador.id, b, resultado, motivo);
    if (!(await guardarEntrevistaTerminada(encuestador.id, encuesta, entrevista))) {
      setGuardando(false);
      setError(
        'No se pudo guardar la entrevista: el dispositivo no tiene espacio y no hay conexión. No cierres esta pantalla; libera espacio o busca señal y vuelve a intentar.',
      );
      return;
    }
    cerrada.current = true;
    alTerminar(resultado);
  }

  const total = visibles.length;
  const progreso = paso === 'cierre' ? 1 : indice >= 0 && total > 0 ? indice / total : 0;

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
          <Boton
            tamano="grande"
            className="flex-1"
            cargando={guardando}
            onClick={() => guardar('no_elegible', terminada)}
          >
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
      {paso === 'arranque' && (
        <PasoArranque
          encuesta={encuesta}
          version={version}
          respuestas={respuestas}
          equipo={equipo}
          propias={propias}
          alCambiar={cambiar}
        />
      )}

      {paso === 'intro' && (
        <div className="flex flex-col gap-4">
          {def.introduccion.instruccion && <Instruccion>{def.introduccion.instruccion}</Instruccion>}
          <div className="rounded-2xl border border-linea bg-white p-4 text-[19px] leading-relaxed whitespace-pre-line">
            {def.introduccion.texto.replaceAll('{encuestador}', encuestador.nombre || '(nombre del encuestador)')}
          </div>
        </div>
      )}

      {enPregunta && (
        <div className="flex flex-col gap-4">
          {indice === visibles.findIndex((v) => v.seccion.id === enPregunta.seccion.id) &&
            enPregunta.seccion.instruccion && <Instruccion>{enPregunta.seccion.instruccion}</Instruccion>}
          <h1 className="text-[21px] leading-snug font-semibold">
            {enPregunta.pregunta.numero && <span className="mr-2 text-tinta-3">{enPregunta.pregunta.numero}.</span>}
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
