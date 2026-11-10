/** Formatos de fechas, números y duraciones para México. */

const LOCAL = 'es-MX';

export function entero(n: number | null | undefined): string {
  return new Intl.NumberFormat(LOCAL).format(n ?? 0);
}

/** Porcentaje con un decimal: 45.3% */
export function porcentaje(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return `${n.toFixed(decimales)}%`;
}

/** Duración legible: 9 min 30 s */
export function duracion(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || Number.isNaN(segundos)) return '–';
  const s = Math.max(0, Math.round(segundos));
  const min = Math.floor(s / 60);
  const resto = s % 60;
  if (min === 0) return `${resto} s`;
  return resto === 0 ? `${min} min` : `${min} min ${resto} s`;
}

export function fechaHora(iso: string | null | undefined, zona?: string): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat(LOCAL, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  }).format(new Date(iso));
}

export function hora(iso: string | null | undefined, zona?: string): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat(LOCAL, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  }).format(new Date(iso));
}

/** Día corto a partir de 'AAAA-MM-DD': 10 nov */
export function diaCorto(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCAL, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(a, m - 1, d)),
  );
}

/** Día largo a partir de 'AAAA-MM-DD': martes 10 de noviembre */
export function diaLargo(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCAL, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(a, m - 1, d)));
}

/** 'AAAA-MM-DD' de un instante en la zona horaria dada. */
export function diaLocal(iso: string | Date, zona?: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: zona,
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
  return partes;
}

/** Hace cuánto pasó algo: "hace 5 min", "hace 2 h", "ayer". */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return '–';
  const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
