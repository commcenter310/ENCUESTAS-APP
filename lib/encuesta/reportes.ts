/** Resumen de resultados: porcentajes con y sin NS/NC, y promedios de escalas. */
import { NSNC } from './opciones';
import type { Opcion } from './tipos';

export type Conteo = Record<string, number>;

export type FilaResultado = {
  valor: string;
  etiqueta: string;
  n: number;
  /** Porcentaje sobre todas las respuestas. */
  pct: number;
  /** Porcentaje sin contar NS/NC (null para las propias opciones NS/NC). */
  pctSinNsnc: number | null;
  nsnc: boolean;
};

/**
 * Convierte un conteo { valor: n } en filas con porcentajes con y sin NS/NC.
 * Conserva el orden de las opciones; los valores fuera de lista van al final.
 */
export function resumirConteo(
  opciones: Opcion[],
  conteo: Conteo = {},
): { filas: FilaResultado[]; base: number; baseSinNsnc: number } {
  const conocidas = new Set(opciones.map((o) => o.valor));
  const extras: Opcion[] = Object.keys(conteo)
    .filter((valor) => !conocidas.has(valor))
    .map((valor) => ({ valor, etiqueta: valor }));
  const todas = [...opciones, ...extras];

  const base = todas.reduce((suma, o) => suma + (conteo[o.valor] ?? 0), 0);
  const baseSinNsnc = todas.reduce((suma, o) => suma + (o.nsnc ? 0 : (conteo[o.valor] ?? 0)), 0);

  const filas = todas.map((o) => {
    const n = conteo[o.valor] ?? 0;
    return {
      valor: o.valor,
      etiqueta: o.etiqueta,
      n,
      pct: base ? (n / base) * 100 : 0,
      pctSinNsnc: o.nsnc ? null : baseSinNsnc ? (n / baseSinNsnc) * 100 : 0,
      nsnc: Boolean(o.nsnc),
    };
  });
  return { filas, base, baseSinNsnc };
}

/** Promedio de una escala a partir de su conteo (ignora NS/NC). */
export function promedioDeEscala(conteo: Conteo = {}): { promedio: number | null; n: number } {
  let suma = 0;
  let n = 0;
  for (const [valor, cuantos] of Object.entries(conteo)) {
    const numero = Number(valor);
    if (valor === NSNC || Number.isNaN(numero)) continue;
    suma += numero * cuantos;
    n += cuantos;
  }
  return { promedio: n ? suma / n : null, n };
}
