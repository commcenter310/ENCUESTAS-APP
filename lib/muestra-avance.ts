/**
 * Avance contra la muestra: ubicar una sección, revisar su tope y resumir el
 * avance de todas. Funciones puras que comparten campo, tablero y exportación.
 */
import type { DefinicionEncuesta, Respuestas } from '@/lib/encuesta/tipos';
import { type SeccionMuestra, seccionDe } from '@/lib/muestra';

export type Conteo = Record<string, number>;

export type UbicacionSeccion =
  | { tipo: 'titular'; fila: SeccionMuestra }
  | { tipo: 'reemplazo'; fila: SeccionMuestra }
  | { tipo: 'fuera' };

/** ¿La sección es titular de la muestra, reemplazo de una titular o está fuera? */
export function ubicarSeccion(
  muestra: SeccionMuestra[],
  seccion: string | number | null | undefined,
): UbicacionSeccion {
  const clave = seccionDe(seccion);
  if (!clave) return { tipo: 'fuera' };
  const titular = muestra.find((s) => s.seccion === clave);
  if (titular) return { tipo: 'titular', fila: titular };
  const reemplazada = muestra.find((s) => s.reemplazo === clave);
  if (reemplazada) return { tipo: 'reemplazo', fila: reemplazada };
  return { tipo: 'fuera' };
}

/** Entrevistas que cuentan para una sección de la muestra (titular + su reemplazo). */
export function levantadasEn(fila: SeccionMuestra, conteo: Conteo): number {
  return (conteo[fila.seccion] ?? 0) + (fila.reemplazo ? (conteo[fila.reemplazo] ?? 0) : 0);
}

export type ResumenMuestra = {
  secciones: number;
  meta: number;
  porDistritoLocal: { distrito: number | null; secciones: number; meta: number }[];
  porDistritoFederal: { distrito: number | null; secciones: number; meta: number }[];
  porEstrato: { estrato: string; secciones: number; meta: number }[];
};

export function resumirMuestra(muestra: SeccionMuestra[]): ResumenMuestra {
  const agrupar = <K>(clave: (s: SeccionMuestra) => K) => {
    const mapa = new Map<K, { secciones: number; meta: number }>();
    for (const s of muestra) {
      const g = mapa.get(clave(s)) ?? { secciones: 0, meta: 0 };
      g.secciones++;
      g.meta += s.meta;
      mapa.set(clave(s), g);
    }
    return [...mapa.entries()];
  };
  const porNumero = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
  return {
    secciones: muestra.length,
    meta: muestra.reduce((suma, s) => suma + s.meta, 0),
    porDistritoLocal: agrupar((s) => s.distrito_local)
      .map(([distrito, g]) => ({ distrito, ...g }))
      .sort((a, b) => porNumero(a.distrito, b.distrito)),
    porDistritoFederal: agrupar((s) => s.distrito_federal)
      .map(([distrito, g]) => ({ distrito, ...g }))
      .sort((a, b) => porNumero(a.distrito, b.distrito)),
    porEstrato: agrupar((s) => s.estrato ?? 'Sin estrato')
      .map(([estrato, g]) => ({ estrato, ...g }))
      .sort((a, b) => b.meta - a.meta),
  };
}

export function ordenarPorSeccion<T extends { seccion: string }>(filas: T[]): T[] {
  return [...filas].sort((a, b) => Number(a.seccion) - Number(b.seccion));
}

export function sumarConteos(...conteos: Conteo[]): Conteo {
  const total: Conteo = {};
  for (const c of conteos) for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
  return total;
}

export type EstadoDeSeccion = 'sin_iniciar' | 'en_curso' | 'completa' | 'excedida';

export function estadoDeSeccion(levantadas: number, meta: number): EstadoDeSeccion {
  if (levantadas > meta) return 'excedida';
  if (levantadas === meta) return 'completa';
  return levantadas > 0 ? 'en_curso' : 'sin_iniciar';
}

/** Situación de la sección elegida en campo respecto a la muestra y su tope. */
export type RevisionDeSeccion = {
  seccion: string;
  ubicacion: UbicacionSeccion;
  /** Todo el equipo (servidor) más lo pendiente de este teléfono. */
  levantadas: number;
  propias: number;
  llena: boolean;
};

/** null cuando no hay muestra cargada o no hay sección escrita: se acepta cualquiera. */
export function revisarSeccion(
  muestra: SeccionMuestra[],
  valor: unknown,
  equipo: Conteo,
  propias: Conteo,
): RevisionDeSeccion | null {
  if (muestra.length === 0 || valor === undefined || valor === null || valor === '') return null;
  const seccion = String(valor);
  const ubicacion = ubicarSeccion(muestra, seccion);
  if (ubicacion.tipo === 'fuera') return { seccion, ubicacion, levantadas: 0, propias: 0, llena: false };
  const levantadas = levantadasEn(ubicacion.fila, equipo);
  return {
    seccion,
    ubicacion,
    levantadas,
    propias: levantadasEn(ubicacion.fila, propias),
    llena: levantadas >= ubicacion.fila.meta,
  };
}

/**
 * Llena con los distritos de la muestra las preguntas que lo piden. Respeta lo
 * que el encuestador escribió, pero reemplaza lo que se llenó solo antes
 * (`previo`), por si cambió de sección.
 */
export function autollenarDistritos(
  def: DefinicionEncuesta,
  fila: SeccionMuestra,
  respuestas: Respuestas,
  previo: Respuestas = {},
): { respuestas: Respuestas; autollenado: Respuestas } {
  const destino = def.monitoreo?.autollenar ?? {};
  const salida = { ...respuestas };
  const autollenado: Respuestas = {};
  for (const campo of ['distrito_local', 'distrito_federal'] as const) {
    const clave = destino[campo];
    const valor = fila[campo];
    if (!clave || valor === null) continue;
    if (salida[clave] === undefined || salida[clave] === previo[clave]) {
      salida[clave] = valor;
      autollenado[clave] = valor;
    }
  }
  return { respuestas: salida, autollenado };
}

export type FilaDeAvance = SeccionMuestra & { levantadas: number; enReemplazo: number; estado: EstadoDeSeccion };

export type AvanceDeMuestra = {
  filas: FilaDeAvance[];
  meta: number;
  /** Entrevistas que cuentan para la meta (sin excedentes). */
  utiles: number;
  excedentes: number;
  completas: number;
  conReemplazo: number;
  /** Secciones con entrevistas que no están en la muestra: [sección, entrevistas]. */
  fuera: [string, number][];
  porDistritoLocal: { distrito: number | null; meta: number; utiles: number }[];
};

export function avanceDeMuestra(muestra: SeccionMuestra[], conteo: Conteo): AvanceDeMuestra {
  const filas = ordenarPorSeccion(muestra).map((s) => {
    const levantadas = levantadasEn(s, conteo);
    return {
      ...s,
      levantadas,
      enReemplazo: s.reemplazo ? (conteo[s.reemplazo] ?? 0) : 0,
      estado: estadoDeSeccion(levantadas, s.meta),
    };
  });
  const enMuestra = new Set(muestra.flatMap((s) => (s.reemplazo ? [s.seccion, s.reemplazo] : [s.seccion])));
  const porDl = new Map<number | null, { meta: number; utiles: number }>();
  for (const f of filas) {
    const g = porDl.get(f.distrito_local) ?? { meta: 0, utiles: 0 };
    g.meta += f.meta;
    g.utiles += Math.min(f.levantadas, f.meta);
    porDl.set(f.distrito_local, g);
  }
  return {
    filas,
    meta: filas.reduce((s, f) => s + f.meta, 0),
    utiles: filas.reduce((s, f) => s + Math.min(f.levantadas, f.meta), 0),
    excedentes: filas.reduce((s, f) => s + Math.max(0, f.levantadas - f.meta), 0),
    completas: filas.filter((f) => f.levantadas >= f.meta).length,
    conReemplazo: filas.filter((f) => f.enReemplazo > 0).length,
    fuera: Object.entries(conteo)
      .filter(([zona, n]) => zona && n > 0 && !enMuestra.has(zona))
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    porDistritoLocal: [...porDl.entries()]
      .map(([distrito, g]) => ({ distrito, ...g }))
      .sort((a, b) => (a.distrito ?? Infinity) - (b.distrito ?? Infinity)),
  };
}
