/**
 * Puntos del mapa de entrevistas: color de cada pin, alertas y filtro por día.
 * Funciones puras (ver mapa.test.ts); el dibujo vive en components/admin/mapa.
 */
import type { EstadoRevision, ResultadoEntrevista } from '@/lib/encuesta/tipos';
import { diaLocal } from '@/lib/formato';

export type PuntoEntrevista = {
  id: string;
  lat: number;
  lng: number;
  precision_m: number | null;
  zona: string | null;
  terminada_en: string;
  duracion_seg: number;
  resultado: ResultadoEntrevista;
  revision: EstadoRevision;
  encuestador_id: string;
  encuestador: { nombre: string } | null;
};

/** Más allá de esto el GPS no ubica la vivienda con confianza. */
export const PRECISION_MAXIMA_M = 100;

export type Alerta = 'corta' | 'gps_impreciso';

export function alertasDe(p: PuntoEntrevista, duracionMinimaSeg: number): Alerta[] {
  const alertas: Alerta[] = [];
  if (p.resultado === 'completa' && p.duracion_seg < duracionMinimaSeg) alertas.push('corta');
  if (p.precision_m !== null && p.precision_m > PRECISION_MAXIMA_M) alertas.push('gps_impreciso');
  return alertas;
}

export type Leyenda = { clave: string; etiqueta: string; color: string; n: number }[];
export type Coloreado = { colorDe: (p: PuntoEntrevista) => string; leyenda: Leyenda };

/** Colores de estado: siempre acompañados de texto en la leyenda y en el pin. */
const COLOR_REVISION: Record<EstadoRevision, string> = {
  pendiente: '#2a78d6',
  validada: '#0ca30c',
  anulada: '#d03b3b',
};
const NOMBRE_REVISION: Record<EstadoRevision, string> = {
  pendiente: 'Pendiente',
  validada: 'Validada',
  anulada: 'Anulada',
};

export function colorPorRevision(puntos: PuntoEntrevista[]): Coloreado {
  const leyenda = (Object.keys(COLOR_REVISION) as EstadoRevision[]).map((r) => ({
    clave: r,
    etiqueta: NOMBRE_REVISION[r],
    color: COLOR_REVISION[r],
    n: puntos.filter((p) => p.revision === r).length,
  }));
  return { colorDe: (p) => COLOR_REVISION[p.revision], leyenda };
}

/** Paleta categórica validada, en orden fijo. */
const CATEGORICOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const COLOR_OTROS = '#898781';

/**
 * Un color por encuestador. Con más de 8, los 7 con más entrevistas conservan
 * su color y el resto va en gris como "Otros": más colores ya no se distinguen.
 * El color se asigna por nombre (orden estable), no por posición en el ranking.
 */
export function colorPorEncuestador(puntos: PuntoEntrevista[]): Coloreado {
  const conteo = new Map<string, { nombre: string; n: number }>();
  for (const p of puntos) {
    const actual = conteo.get(p.encuestador_id) ?? { nombre: p.encuestador?.nombre || 'Sin nombre', n: 0 };
    actual.n++;
    conteo.set(p.encuestador_id, actual);
  }
  const ranking = [...conteo.entries()].sort((a, b) => b[1].n - a[1].n || a[1].nombre.localeCompare(b[1].nombre));
  const conColor = ranking.length > CATEGORICOS.length ? ranking.slice(0, CATEGORICOS.length - 1) : ranking;
  const ordenEstable = [...conColor].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
  const colores = new Map(ordenEstable.map(([id], i) => [id, CATEGORICOS[i]]));
  const otros = ranking.slice(conColor.length);

  const leyenda: Leyenda = ordenEstable.map(([id, { nombre, n }]) => ({
    clave: id,
    etiqueta: nombre,
    color: colores.get(id)!,
    n,
  }));
  if (otros.length > 0) {
    leyenda.push({
      clave: 'otros',
      etiqueta: `Otros (${otros.length})`,
      color: COLOR_OTROS,
      n: otros.reduce((s, [, g]) => s + g.n, 0),
    });
  }
  return { colorDe: (p) => colores.get(p.encuestador_id) ?? COLOR_OTROS, leyenda };
}

export type Periodo = 'todo' | 'hoy' | 'ayer' | '7dias';

/** Día (AAAA-MM-DD) desde el que se muestran puntos, o null para todos. */
export function desdeDelPeriodo(periodo: Periodo, zona: string, ahora = new Date()): string | null {
  if (periodo === 'todo') return null;
  const dias = periodo === '7dias' ? 6 : periodo === 'ayer' ? 1 : 0;
  return diaLocal(new Date(ahora.getTime() - dias * 86400000), zona);
}

export function filtrarPorPeriodo(
  puntos: PuntoEntrevista[],
  periodo: Periodo,
  zona: string,
  ahora = new Date(),
): PuntoEntrevista[] {
  const desde = desdeDelPeriodo(periodo, zona, ahora);
  if (!desde) return puntos;
  const hasta = periodo === 'ayer' ? desde : diaLocal(ahora, zona);
  return puntos.filter((p) => {
    const dia = diaLocal(p.terminada_en, zona);
    return dia >= desde && dia <= hasta;
  });
}
