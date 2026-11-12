/**
 * Trabajo de campo en el dispositivo: encuestas descargadas, entrevista en
 * curso (borrador), cola de entrevistas por enviar y sincronización.
 *
 * Regla de oro: una entrevista terminada nunca se borra del dispositivo hasta
 * que el servidor confirma que la recibió.
 */
import { borrar, guardar, leer } from '@/lib/almacen';
import { esErrorDeRed, supabase } from '@/lib/supabase';
import { limpiarRespuestas, validarPregunta } from '@/lib/encuesta/motor';
import { etiquetasZona, zonaDe } from '@/lib/encuesta/monitoreo';
import type { Encuesta, EntrevistaNueva, Respuestas, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import type { SeccionMuestra } from '@/lib/muestra';
import { type Conteo, autollenarDistritos, revisarSeccion, sumarConteos } from '@/lib/muestra-avance';
import { leerConteoSecciones, leerMuestra } from '@/lib/muestra-datos';

const CAMPOS_ENCUESTA =
  'id, clave, titulo, tipo, descripcion, definicion, estado, meta_muestra, zona_horaria, creada_en, actualizada_en';

/** Encuesta tal como la usa el encuestador: con su muestra (vacía si no tiene). */
export type EncuestaDeCampo = Encuesta & { muestra: SeccionMuestra[] };

export function encuestasEnCache(uid: string): EncuestaDeCampo[] {
  return (leer<EncuestaDeCampo[]>(`encuestas:${uid}`) ?? []).map((e) => ({ ...e, muestra: e.muestra ?? [] }));
}

/** Descarga las encuestas activas con su muestra. Sin conexión devuelve la copia local. */
export async function cargarEncuestas(uid: string): Promise<{ encuestas: EncuestaDeCampo[]; deCache: boolean }> {
  try {
    const { data, error } = await supabase()
      .from('encuestas')
      .select(CAMPOS_ENCUESTA)
      .eq('estado', 'activa')
      .order('creada_en', { ascending: true });
    if (error || !data) throw error ?? new Error('Sin datos');
    const encuestas = await Promise.all(
      (data as unknown as Encuesta[]).map(async (e) => ({ ...e, muestra: await leerMuestra(e.id) })),
    );
    guardar(`encuestas:${uid}`, encuestas);
    return { encuestas, deCache: false };
  } catch {
    return { encuestas: encuestasEnCache(uid), deCache: true };
  }
}

export type Borrador = {
  id: string;
  encuesta_id: string;
  version: string;
  respuestas: Respuestas;
  /** 'arranque' | 'intro' | 'cierre' | id de la pregunta en pantalla. */
  paso: string;
  iniciada_en: string | null;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  /** Respuestas que se llenaron solas con la muestra (para poder corregirlas). */
  autollenado?: Respuestas;
};

export function leerBorrador(uid: string): Borrador | null {
  return leer<Borrador>(`borrador:${uid}`);
}

export function guardarBorrador(uid: string, borrador: Borrador): boolean {
  return guardar(`borrador:${uid}`, borrador);
}

export function borrarBorrador(uid: string): void {
  borrar(`borrador:${uid}`);
}

/** Entrevistas iniciadas en este dispositivo: reparte las versiones A/B/C. */
export function contarInicio(uid: string, encuestaId: string): number {
  const clave = `contador:${uid}:${encuestaId}`;
  const actual = leer<number>(clave) ?? 0;
  guardar(clave, actual + 1);
  return actual;
}

/** Últimos datos de arranque usados (p. ej. la sección), para no reteclearlos. */
export function leerArranque(uid: string, encuestaId: string): Respuestas {
  return leer<Respuestas>(`arranque:${uid}:${encuestaId}`) ?? {};
}

export function guardarArranque(uid: string, encuestaId: string, valores: Respuestas): void {
  guardar(`arranque:${uid}:${encuestaId}`, valores);
}

export function nuevoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Respaldo para navegadores viejos o páginas sin HTTPS.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Revisa los datos de arranque antes de empezar: preguntas de arranque y, con
 * muestra cargada, que la sección esté en ella y no haya llegado a su tope.
 */
export function revisarArranque(
  encuesta: EncuestaDeCampo,
  borrador: Borrador,
  equipo: Conteo,
  propias: Conteo,
): { error: string } | { respuestas: Respuestas; autollenado: Respuestas } {
  const def = encuesta.definicion;
  for (const p of def.arranque ?? []) {
    const falta = validarPregunta(def, p, borrador.version, borrador.respuestas);
    if (falta) return { error: `${p.texto}: ${falta}` };
  }
  const revision = revisarSeccion(encuesta.muestra, zonaDe(def, borrador.respuestas), equipo, propias);
  if (!revision) return { respuestas: borrador.respuestas, autollenado: {} };
  const etiqueta = etiquetasZona(def).singular.toLowerCase();
  if (revision.ubicacion.tipo === 'fuera') {
    return {
      error: `La ${etiqueta} ${revision.seccion} no está en la muestra de esta encuesta. Revisa el número o elige una de la lista.`,
    };
  }
  const fila = revision.ubicacion.fila;
  if (revision.llena) {
    return {
      error: `La ${etiqueta} ${fila.seccion} ya completó su tope (${revision.levantadas} de ${fila.meta} entrevistas). Elige otra de la muestra.`,
    };
  }
  return autollenarDistritos(def, fila, borrador.respuestas, borrador.autollenado);
}

/** Conteos para revisar topes: equipo (servidor) y propias, más lo pendiente en este teléfono. */
export function conteosDeCampo(avance: AvancePropio | null, pendientes: Conteo): { equipo: Conteo; propias: Conteo } {
  return {
    equipo: sumarConteos(avance?.equipoPorZona ?? {}, pendientes),
    propias: sumarConteos(avance?.propiasPorZona ?? {}, pendientes),
  };
}

export function armarEntrevista(
  encuesta: Encuesta,
  encuestadorId: string,
  b: Borrador,
  resultado: ResultadoEntrevista,
  motivo: string | null,
): EntrevistaNueva {
  const ahora = new Date().toISOString();
  return {
    id: b.id,
    encuesta_id: encuesta.id,
    encuestador_id: encuestadorId,
    version: b.version,
    resultado,
    motivo_no_elegible: motivo,
    respuestas: limpiarRespuestas(encuesta.definicion, b.version, b.respuestas),
    iniciada_en: b.iniciada_en ?? ahora,
    terminada_en: ahora,
    lat: b.lat,
    lng: b.lng,
    precision_m: b.precision_m,
    dispositivo: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 400),
  };
}

/**
 * Deja la entrevista a salvo: en la cola del teléfono o, si el teléfono no
 * pudo guardarla, enviada directo. Al terminar borra el borrador y recuerda
 * los datos de arranque. Devuelve false si no quedó guardada en ningún lado.
 */
export async function guardarEntrevistaTerminada(
  uid: string,
  encuesta: Encuesta,
  entrevista: EntrevistaNueva,
): Promise<boolean> {
  const def = encuesta.definicion;
  let guardada = encolar(uid, entrevista, zonaDe(def, entrevista.respuestas));
  if (!guardada) {
    const { error } = await supabase()
      .from('entrevistas')
      .upsert(entrevista, { onConflict: 'id', ignoreDuplicates: true });
    guardada = !error;
  }
  if (!guardada) return false;
  const arranque: Respuestas = {};
  for (const p of def.arranque ?? []) {
    if (entrevista.respuestas[p.id] !== undefined) arranque[p.id] = entrevista.respuestas[p.id];
  }
  guardarArranque(uid, encuesta.id, arranque);
  borrarBorrador(uid);
  return true;
}

export type Pendiente = EntrevistaNueva & {
  /** Motivo del último rechazo del servidor, si lo hubo. */
  rechazo?: string | null;
};

/** Resumen de lo levantado en este dispositivo (para la lista del encuestador). */
export type Registro = {
  id: string;
  encuesta_id: string;
  terminada_en: string;
  zona: string | null;
  resultado: ResultadoEntrevista;
  enviada: boolean;
};

const MAX_REGISTRO = 300;

export function leerCola(uid: string): Pendiente[] {
  return leer<Pendiente[]>(`cola:${uid}`) ?? [];
}

export function leerRegistro(uid: string): Registro[] {
  return leer<Registro[]>(`registro:${uid}`) ?? [];
}

/**
 * Deja una entrevista terminada en la cola de envío.
 * Devuelve false si el dispositivo no pudo guardarla (p. ej. sin espacio).
 */
export function encolar(uid: string, entrevista: EntrevistaNueva, zona: string | null): boolean {
  const cola = leerCola(uid).filter((p) => p.id !== entrevista.id);
  if (!guardar(`cola:${uid}`, [...cola, entrevista])) return false;
  const registro: Registro = {
    id: entrevista.id,
    encuesta_id: entrevista.encuesta_id,
    terminada_en: entrevista.terminada_en,
    zona,
    resultado: entrevista.resultado,
    enviada: false,
  };
  guardar(
    `registro:${uid}`,
    [registro, ...leerRegistro(uid).filter((r) => r.id !== registro.id)].slice(0, MAX_REGISTRO),
  );
  return true;
}

function quitarDeCola(uid: string, id: string): void {
  // Se vuelve a leer: pudo entrar otra entrevista mientras se enviaba esta.
  guardar(
    `cola:${uid}`,
    leerCola(uid).filter((p) => p.id !== id),
  );
  guardar(
    `registro:${uid}`,
    leerRegistro(uid).map((r) => (r.id === id ? { ...r, enviada: true } : r)),
  );
}

function anotarRechazo(uid: string, id: string, motivo: string): void {
  guardar(
    `cola:${uid}`,
    leerCola(uid).map((p) => (p.id === id ? { ...p, rechazo: motivo } : p)),
  );
}

export type EstadoEnvio =
  | 'al_dia' // no queda nada por enviar
  | 'sin_red' // no hay conexión: se reintenta después
  | 'sin_sesion' // hay que volver a iniciar sesión para enviar
  | 'rechazadas'; // el servidor no aceptó alguna (queda guardada)

export type ResultadoEnvio = { estado: EstadoEnvio; enviadas: number; pendientes: number };

let envioEnCurso: Promise<ResultadoEnvio> | null = null;

/** Envía lo pendiente. Si ya hay un envío en curso, devuelve ese mismo. */
export function sincronizar(uid: string): Promise<ResultadoEnvio> {
  if (!envioEnCurso) {
    envioEnCurso = enviarPendientes(uid).finally(() => {
      envioEnCurso = null;
    });
  }
  return envioEnCurso;
}

async function enviarPendientes(uid: string): Promise<ResultadoEnvio> {
  const cola = leerCola(uid);
  const fin = (estado: EstadoEnvio, enviadas: number): ResultadoEnvio => ({
    estado,
    enviadas,
    pendientes: leerCola(uid).length,
  });
  if (cola.length === 0) return fin('al_dia', 0);

  const { data, error: errorSesion } = await supabase().auth.getSession();
  if (!data.session) return fin(errorSesion && esErrorDeRed(errorSesion) ? 'sin_red' : 'sin_sesion', 0);
  if (data.session.user.id !== uid) return fin('sin_sesion', 0);

  let enviadas = 0;
  let rechazadas = 0;
  for (const pendiente of cola) {
    const { rechazo: _rechazo, ...fila } = pendiente;
    void _rechazo;
    // ignoreDuplicates: si ya había llegado en un intento anterior, no falla ni duplica.
    const { error, status } = await supabase()
      .from('entrevistas')
      .upsert(fila, { onConflict: 'id', ignoreDuplicates: true });

    if (!error) {
      quitarDeCola(uid, pendiente.id);
      enviadas++;
      continue;
    }
    if (esErrorDeRed(error)) return fin('sin_red', enviadas);
    if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') {
      return fin('sin_sesion', enviadas);
    }
    // El servidor la rechazó (cuenta desactivada, encuesta en borrador...).
    // Se queda guardada con el motivo y se sigue con las demás.
    anotarRechazo(uid, pendiente.id, error.message || `Error ${status}`);
    rechazadas++;
  }
  return fin(rechazadas > 0 ? 'rechazadas' : 'al_dia', enviadas);
}

export type AvancePropio = {
  efectivas: number;
  hoy: number;
  propiasPorZona: Conteo;
  /** Todo el equipo: con esto se respetan los topes de la muestra. */
  equipoPorZona: Conteo;
  consultado_en: string;
};

export function avanceEnCache(uid: string, encuestaId: string): AvancePropio | null {
  const guardado = leer<AvancePropio & { porZona?: Conteo; equipo?: Conteo }>(`avance:${uid}:${encuestaId}`);
  if (!guardado) return null;
  // Copias guardadas por la versión anterior de la app.
  return {
    ...guardado,
    propiasPorZona: guardado.propiasPorZona ?? guardado.porZona ?? {},
    equipoPorZona: guardado.equipoPorZona ?? guardado.equipo ?? {},
  };
}

/** Avance propio (RLS lo limita a lo suyo) y conteo del equipo por sección. */
export async function cargarAvance(uid: string, encuestaId: string): Promise<AvancePropio | null> {
  try {
    const [tablero, equipoPorZona] = await Promise.all([
      supabase().rpc('tablero_encuesta', { p_encuesta: encuestaId }),
      leerConteoSecciones(encuestaId),
    ]);
    if (tablero.error || !tablero.data) throw tablero.error;
    const datos = tablero.data as {
      totales: { efectivas: number; hoy: number };
      por_zona: { zona: string; n: number }[];
    };
    const avance: AvancePropio = {
      efectivas: datos.totales.efectivas ?? 0,
      hoy: datos.totales.hoy ?? 0,
      propiasPorZona: Object.fromEntries(datos.por_zona.map((z) => [z.zona, z.n])),
      equipoPorZona,
      consultado_en: new Date().toISOString(),
    };
    guardar(`avance:${uid}:${encuestaId}`, avance);
    return avance;
  } catch {
    return avanceEnCache(uid, encuestaId);
  }
}

export type Ubicacion = { lat: number; lng: number; precision_m: number };

/** Pide la ubicación al dispositivo. Devuelve null si no se pudo o no hay permiso. */
export function obtenerUbicacion(esperaMs = 15000): Promise<Ubicacion | null> {
  return new Promise((resolver) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolver(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolver({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision_m: Math.round(p.coords.accuracy),
        }),
      () => resolver(null),
      { enableHighAccuracy: true, timeout: esperaMs, maximumAge: 60000 },
    );
  });
}
