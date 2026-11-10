'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  CloudOff,
  CloudUpload,
  LayoutDashboard,
  Play,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Entrevista } from '@/components/campo/entrevista';
import { MenuCuenta } from '@/components/cuenta';
import { Marca } from '@/components/marca';
import type { Identidad } from '@/components/sesion';
import { useEnLinea } from '@/components/service-worker';
import { Aviso, Boton, Cargando, Insignia, Modal, Tarjeta, Vacio } from '@/components/ui';
import { pedirPersistencia } from '@/lib/almacen';
import {
  type AvancePropio,
  type Borrador,
  type EstadoEnvio,
  type Pendiente,
  type Registro,
  avanceEnCache,
  borrarBorrador,
  cargarAvance,
  cargarEncuestas,
  contarInicio,
  encuestasEnCache,
  guardarBorrador,
  leerArranque,
  leerBorrador,
  leerCola,
  leerRegistro,
  nuevoId,
  sincronizar,
} from '@/lib/campo';
import { siguienteVersion } from '@/lib/encuesta/motor';
import type { Encuesta, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import { diaLocal, entero, hora } from '@/lib/formato';

const CADA_CUANTO_REINTENTAR_MS = 45000;

export function InicioEncuestador({ identidad }: { identidad: Identidad }) {
  const uid = identidad.id;
  const enLinea = useEnLinea();

  // Esta pantalla solo existe en el navegador (después de iniciar sesión), así
  // que puede arrancar con lo que ya está guardado en el dispositivo.
  const [encuestas, setEncuestas] = useState<Encuesta[]>(() => encuestasEnCache(uid));
  const [cargando, setCargando] = useState(() => encuestasEnCache(uid).length === 0);
  const [deCache, setDeCache] = useState(false);
  const [avances, setAvances] = useState<Record<string, AvancePropio | null>>(() =>
    Object.fromEntries(encuestasEnCache(uid).map((e) => [e.id, avanceEnCache(uid, e.id)])),
  );
  const [borrador, setBorrador] = useState<Borrador | null>(() => leerBorrador(uid));
  const [enEntrevista, setEnEntrevista] = useState(false);
  const [cola, setCola] = useState<Pendiente[]>(() => leerCola(uid));
  const [registro, setRegistro] = useState<Registro[]>(() => leerRegistro(uid));
  const [envio, setEnvio] = useState<EstadoEnvio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  /** Confirmación para descartar la entrevista a medias (y, si aplica, abrir una nueva). */
  const [confirmar, setConfirmar] = useState<{ nueva: Encuesta | null } | null>(null);
  const montado = useRef(true);
  const primeraVez = useRef(true);

  const leerLocal = useCallback(() => {
    setCola(leerCola(uid));
    setRegistro(leerRegistro(uid));
    setBorrador(leerBorrador(uid));
  }, [uid]);

  const cargarAvances = useCallback(
    async (lista: Encuesta[]) => {
      const pares = await Promise.all(
        lista.map(async (e) => [e.id, await cargarAvance(uid, e.id)] as const),
      );
      if (montado.current) setAvances(Object.fromEntries(pares));
    },
    [uid],
  );

  const enviar = useCallback(async () => {
    const resultado = await sincronizar(uid);
    if (!montado.current) return;
    setEnvio(resultado.estado);
    leerLocal();
    if (resultado.enviadas > 0) cargarAvances(encuestasEnCache(uid));
  }, [uid, leerLocal, cargarAvances]);

  const refrescar = useCallback(async () => {
    const { encuestas: lista, deCache: copia } = await cargarEncuestas(uid);
    if (!montado.current) return;
    setEncuestas(lista);
    setDeCache(copia);
    setCargando(false);
    if (!copia) cargarAvances(lista);
  }, [uid, cargarAvances]);

  // Arranque: lo guardado en el dispositivo aparece al instante; luego la red.
  useEffect(() => {
    montado.current = true;
    pedirPersistencia();
    refrescar();
    enviar();
    return () => {
      montado.current = false;
    };
  }, [refrescar, enviar]);

  // Al recuperar la señal se manda lo pendiente y se actualiza la lista.
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false; // El arranque ya hizo esta carga.
      return;
    }
    if (!enLinea) return;
    enviar();
    refrescar();
  }, [enLinea, enviar, refrescar]);

  // Mientras haya pendientes se reintenta cada cierto tiempo.
  useEffect(() => {
    if (cola.length === 0) return;
    const reloj = setInterval(enviar, CADA_CUANTO_REINTENTAR_MS);
    return () => clearInterval(reloj);
  }, [cola.length, enviar]);

  // El botón "atrás" del teléfono saca de la entrevista sin perderla.
  useEffect(() => {
    if (!enEntrevista) return;
    window.history.pushState({ entrevista: true }, '');
    const alRetroceder = () => {
      setEnEntrevista(false);
      setBorrador(leerBorrador(uid));
    };
    window.addEventListener('popstate', alRetroceder);
    return () => window.removeEventListener('popstate', alRetroceder);
  }, [enEntrevista, uid]);

  const salirDeEntrevista = useCallback(() => {
    // Quita la entrada que se agregó al historial al abrir la entrevista.
    if (window.history.state?.entrevista) window.history.back();
    else setEnEntrevista(false);
  }, []);

  function iniciar(encuesta: Encuesta) {
    const nuevo: Borrador = {
      id: nuevoId(),
      encuesta_id: encuesta.id,
      version: siguienteVersion(encuesta.definicion, contarInicio(uid, encuesta.id)),
      respuestas: leerArranque(uid, encuesta.id),
      paso: 'arranque',
      iniciada_en: null,
      lat: null,
      lng: null,
      precision_m: null,
    };
    if (!guardarBorrador(uid, nuevo)) {
      setMensaje('El dispositivo no tiene espacio para guardar la entrevista. Libera espacio e intenta de nuevo.');
      return;
    }
    setMensaje(null);
    setBorrador(nuevo);
    setEnEntrevista(true);
  }

  function alTerminar(resultado: ResultadoEntrevista) {
    setBorrador(null);
    salirDeEntrevista();
    setEnEntrevista(false);
    leerLocal();
    setMensaje(
      resultado === 'completa'
        ? 'Entrevista guardada.'
        : 'Se registró que la persona no cumplía los requisitos.',
    );
    enviar();
  }

  function descartar() {
    borrarBorrador(uid);
    setBorrador(null);
    salirDeEntrevista();
    setEnEntrevista(false);
  }

  const hoy = diaLocal(new Date());
  const pendientesPorEncuesta = useMemo(() => {
    const mapa: Record<string, { total: number; hoy: number; porZona: Record<string, number> }> = {};
    for (const r of registro) {
      if (r.enviada || r.resultado !== 'completa') continue;
      const m = (mapa[r.encuesta_id] ??= { total: 0, hoy: 0, porZona: {} });
      m.total++;
      if (diaLocal(r.terminada_en) === hoy) m.hoy++;
      if (r.zona) m.porZona[r.zona] = (m.porZona[r.zona] ?? 0) + 1;
    }
    return mapa;
  }, [registro, hoy]);

  const encuestaDelBorrador = borrador ? encuestas.find((e) => e.id === borrador.encuesta_id) : undefined;

  // --- Pantalla de captura -----------------------------------------------------
  if (enEntrevista && borrador && encuestaDelBorrador) {
    return (
      <Entrevista
        key={borrador.id}
        encuesta={encuestaDelBorrador}
        encuestador={{ id: uid, nombre: identidad.nombre }}
        inicial={borrador}
        avance={avances[encuestaDelBorrador.id] ?? null}
        pendientesPorZona={pendientesPorEncuesta[encuestaDelBorrador.id]?.porZona ?? {}}
        alPausar={salirDeEntrevista}
        alDescartar={descartar}
        alTerminar={alTerminar}
      />
    );
  }

  const rechazadas = cola.filter((p) => p.rechazo);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex h-14 items-center justify-between gap-2 px-4">
        <Marca />
        <div className="flex items-center gap-1">
          <Insignia tono={enLinea ? 'bien' : 'aviso'}>
            {enLinea ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
            {enLinea ? 'En línea' : 'Sin conexión'}
          </Insignia>
          <MenuCuenta
            avisoAlSalir={
              cola.length > 0
                ? `Tienes ${cola.length} ${cola.length === 1 ? 'entrevista' : 'entrevistas'} sin enviar. Se quedan guardadas en este dispositivo y se enviarán cuando vuelvas a entrar con tu cuenta.`
                : null
            }
          />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-10">
        {identidad.rol === 'admin' && (
          <Link
            href="/admin"
            className="flex items-center gap-2 self-start rounded-xl px-2.5 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            Ir al panel de administración
          </Link>
        )}

        {mensaje && (
          <Aviso tono={mensaje.startsWith('El dispositivo') ? 'grave' : 'bien'}>{mensaje}</Aviso>
        )}

        {/* Entrevista a medias */}
        {borrador && (
          <Tarjeta className="border-marca-300 bg-marca-50 p-4">
            <p className="font-semibold text-marca-900">Tienes una entrevista sin terminar</p>
            <p className="mt-0.5 text-sm text-marca-900/80">
              {encuestaDelBorrador
                ? encuestaDelBorrador.titulo
                : 'La encuesta de esta entrevista ya no está disponible.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {encuestaDelBorrador && (
                <Boton onClick={() => setEnEntrevista(true)}>
                  <Play className="size-4" aria-hidden />
                  Continuar entrevista
                </Boton>
              )}
              <Boton variante="peligro" onClick={() => setConfirmar({ nueva: null })}>
                Descartar
              </Boton>
            </div>
          </Tarjeta>
        )}

        {/* Encuestas */}
        {cargando ? (
          <Cargando texto="Cargando encuestas…" />
        ) : encuestas.length === 0 ? (
          <Tarjeta>
            <Vacio titulo="No hay encuestas activas">
              {deCache
                ? 'No se pudieron descargar. Conéctate a internet y toca Actualizar.'
                : 'Cuando tu coordinador active una encuesta aparecerá aquí.'}
            </Vacio>
          </Tarjeta>
        ) : (
          encuestas.map((encuesta) => {
            const avance = avances[encuesta.id];
            const local = pendientesPorEncuesta[encuesta.id];
            return (
              <Tarjeta key={encuesta.id} className="p-4">
                <h2 className="text-lg leading-snug font-semibold">{encuesta.titulo}</h2>
                {encuesta.descripcion && (
                  <p className="mt-0.5 text-sm leading-snug text-tinta-2">{encuesta.descripcion}</p>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-plano px-3 py-2.5">
                    <dt className="text-sm text-tinta-2">Hoy</dt>
                    <dd className="text-2xl font-semibold">{entero((avance?.hoy ?? 0) + (local?.hoy ?? 0))}</dd>
                  </div>
                  <div className="rounded-xl bg-plano px-3 py-2.5">
                    <dt className="text-sm text-tinta-2">En total</dt>
                    <dd className="text-2xl font-semibold">
                      {entero((avance?.efectivas ?? 0) + (local?.total ?? 0))}
                    </dd>
                  </div>
                </dl>
                <Boton
                  tamano="grande"
                  ancho
                  className="mt-4"
                  onClick={() => (borrador ? setConfirmar({ nueva: encuesta }) : iniciar(encuesta))}
                >
                  <Plus className="size-5" aria-hidden />
                  Nueva entrevista
                </Boton>
              </Tarjeta>
            );
          })
        )}

        {/* Envío */}
        <Tarjeta className="p-4">
          <div className="flex items-start gap-3">
            {cola.length === 0 ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-bien" aria-hidden />
            ) : enLinea ? (
              <CloudUpload className="mt-0.5 size-5 shrink-0 text-marca-600" aria-hidden />
            ) : (
              <CloudOff className="mt-0.5 size-5 shrink-0 text-aviso-texto" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold" role="status">
                {cola.length === 0
                  ? 'Todo está enviado'
                  : `${cola.length} ${cola.length === 1 ? 'entrevista por enviar' : 'entrevistas por enviar'}`}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-tinta-2">
                {cola.length === 0
                  ? 'No hay entrevistas pendientes en este dispositivo.'
                  : envio === 'sin_sesion'
                    ? 'Tu sesión venció. Cierra sesión y vuelve a entrar para enviarlas; no se pierde nada.'
                    : envio === 'rechazadas'
                      ? 'El servidor no aceptó algunas. Siguen guardadas aquí: avisa a tu coordinador.'
                      : enLinea
                        ? 'Están guardadas en este dispositivo y se envían solas.'
                        : 'Están guardadas en este dispositivo. Se enviarán solas al recuperar la señal.'}
              </p>
              {rechazadas.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-grave-texto">
                  {rechazadas.slice(0, 3).map((p) => (
                    <li key={p.id}>
                      {hora(p.terminada_en)}: {p.rechazo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {cola.length > 0 && (
              <Boton
                variante="secundario"
                cargando={enviando}
                onClick={async () => {
                  setEnviando(true);
                  await enviar();
                  if (montado.current) setEnviando(false);
                }}
              >
                {!enviando && <CloudUpload className="size-4" aria-hidden />}
                Enviar ahora
              </Boton>
            )}
            <Boton variante="fantasma" onClick={refrescar}>
              <RefreshCw className="size-4" aria-hidden />
              Actualizar
            </Boton>
          </div>
        </Tarjeta>

        {/* Lo levantado en este dispositivo */}
        {registro.length > 0 && (
          <section aria-labelledby="titulo-recientes">
            <h2 id="titulo-recientes" className="mb-2 px-1 text-sm font-semibold text-tinta-2">
              Últimas entrevistas en este dispositivo
            </h2>
            <Tarjeta className="divide-y divide-linea">
              {registro.slice(0, 15).map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-tinta-2 tabular-nums">
                    {diaLocal(r.terminada_en) === hoy ? 'Hoy' : diaLocal(r.terminada_en).slice(5)} · {hora(r.terminada_en)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.zona ? `Sección ${r.zona}` : 'Sin sección'}
                    {r.resultado === 'no_elegible' && <span className="text-tinta-3"> · no elegible</span>}
                  </span>
                  <Insignia tono={r.enviada ? 'bien' : 'aviso'}>{r.enviada ? 'Enviada' : 'Por enviar'}</Insignia>
                </div>
              ))}
            </Tarjeta>
          </section>
        )}
      </main>

      <Modal abierto={confirmar !== null} titulo="Entrevista sin terminar" alCerrar={() => setConfirmar(null)}>
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-snug">
            Hay una entrevista a medias. Si la descartas se borran sus respuestas y no se puede recuperar.
          </p>
          {encuestaDelBorrador && (
            <Boton
              ancho
              onClick={() => {
                setConfirmar(null);
                setEnEntrevista(true);
              }}
            >
              Continuar la que está a medias
            </Boton>
          )}
          <Boton
            variante="peligro"
            ancho
            onClick={() => {
              const nueva = confirmar?.nueva ?? null;
              borrarBorrador(uid);
              setBorrador(null);
              setConfirmar(null);
              if (nueva) iniciar(nueva);
            }}
          >
            {confirmar?.nueva ? 'Descartarla y empezar una nueva' : 'Descartarla'}
          </Boton>
        </div>
      </Modal>
    </div>
  );
}
