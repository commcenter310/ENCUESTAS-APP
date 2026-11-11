/**
 * Trabajo de campo en el dispositivo: encuestas descargadas, entrevista en
 * curso (borrador), cola de entrevistas por enviar y sincronización.
 *
 * Regla de oro: una entrevista terminada nunca se borra del dispositivo hasta
 * que el servidor confirma que la recibió.
 */
import { borrar, guardar, leer } from '@/lib/almacen';
import { esErrorDeRed, supabase } from '@/lib/supabase';
import type { Encuesta, EntrevistaNueva, Respuestas, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import type { SeccionMuestra } from '@/lib/muestra';

// ---------------------------------------------------------------------------
// Encuestas disponibles (con copia local para trabajar sin señal)
// ---------------------------------------------------------------------------

const CAMPOS_ENCUESTA =
  'id, clave, titulo, tipo, descripcion, definicion, estado, meta_muestra, zona_horaria, creada_en, actualizada_en';

export const CAMPOS_MUESTRA =
  'seccion, distrito_local, distrito_federal, meta, estrato, lista_nominal, factor_ponderacion, reemplazo';

/** Encuesta tal como la usa el encuestador: con su muestra (vacía si no tiene). */
export type EncuestaDeCampo = Encuesta & { muestra: SeccionMuestra[] };

export function encuestasEnCache(uid: string): EncuestaDeCampo[] {
  return (leer<EncuestaDeCampo[]>(`encuestas:${uid}`) ?? []).map((e) => ({ ...e, muestra: e.muestra ?? [] }));
}

/** Lee la muestra completa de una encuesta (por páginas: la API entrega 1,000 filas a la vez). */
export async function leerMuestra(encuestaId: string): Promise<SeccionMuestra[]> {
  const filas: SeccionMuestra[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase()
      .from('secciones_muestra')
      .select(CAMPOS_MUESTRA)
      .eq('encuesta_id', encuestaId)
      .order('seccion')
      .range(desde, desde + 999);
    if (error) throw error;
    const lote = (data ?? []).map((f) => ({ ...f, factor_ponderacion: f.factor_ponderacion === null ? null : Number(f.factor_ponderacion) })) as SeccionMuestra[];
    filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
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

// ---------------------------------------------------------------------------
// Entrevista en curso
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cola de envío y registro local
// ---------------------------------------------------------------------------

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
  guardar(`registro:${uid}`, [registro, ...leerRegistro(uid).filter((r) => r.id !== registro.id)].slice(0, MAX_REGISTRO));
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

// ---------------------------------------------------------------------------
// Avance propio (lo que el servidor ya tiene de este encuestador)
// ---------------------------------------------------------------------------

export type AvancePropio = {
  efectivas: number;
  hoy: number;
  /** Entrevistas propias por sección. */
  porZona: Record<string, number>;
  /** Entrevistas de todo el equipo por sección (para respetar los topes). */
  equipo: Record<string, number>;
  consultado_en: string;
};

export function avanceEnCache(uid: string, encuestaId: string): AvancePropio | null {
  return leer<AvancePropio>(`avance:${uid}:${encuestaId}`);
}

/** Pide al servidor el avance del encuestador (RLS lo limita a lo suyo). */
export async function cargarAvance(uid: string, encuestaId: string): Promise<AvancePropio | null> {
  const [{ data, error }, conteo] = await Promise.all([
    supabase().rpc('tablero_encuesta', { p_encuesta: encuestaId }),
    supabase().rpc('conteo_secciones', { p_encuesta: encuestaId }),
  ]);
  if (error || !data || conteo.error) return avanceEnCache(uid, encuestaId);
  const tablero = data as {
    totales: { efectivas: number; hoy: number };
    por_zona: { zona: string; n: number }[];
  };
  const avance: AvancePropio = {
    efectivas: tablero.totales.efectivas ?? 0,
    hoy: tablero.totales.hoy ?? 0,
    porZona: Object.fromEntries(tablero.por_zona.map((z) => [z.zona, z.n])),
    equipo: Object.fromEntries(
      ((conteo.data ?? []) as { zona: string; efectivas: number }[]).map((z) => [z.zona, Number(z.efectivas)]),
    ),
    consultado_en: new Date().toISOString(),
  };
  guardar(`avance:${uid}:${encuestaId}`, avance);
  return avance;
}

// ---------------------------------------------------------------------------
// Ubicación
// ---------------------------------------------------------------------------

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
