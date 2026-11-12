/** Opciones de respuesta: listas reutilizables, rotación por versión y opciones fijas. */
import type { DefinicionEncuesta, Opcion, RefOpciones } from './tipos';

export const NSNC = 'nsnc';

export function resolverOpciones(def: DefinicionEncuesta, ref: RefOpciones): Opcion[] {
  if (Array.isArray(ref)) return ref;
  const lista = def.listas?.[ref.lista];
  if (!lista) throw new Error(`La lista "${ref.lista}" no existe en la definición`);
  return lista;
}

/**
 * Rota las opciones no fijas según la versión. La primera versión conserva el
 * orden original; las demás empiezan en un punto distinto de la lista, repartido
 * de forma pareja. Las opciones fijas (Otro, Ninguno, NS/NC) quedan al final.
 */
export function rotar(opciones: Opcion[], versiones: string[], version: string): Opcion[] {
  const rotables = opciones.filter((o) => !o.fija);
  const fijas = opciones.filter((o) => o.fija);
  const indice = Math.max(0, versiones.indexOf(version));
  if (rotables.length < 2 || versiones.length < 2 || indice === 0) {
    return [...rotables, ...fijas];
  }
  const inicio = Math.round((rotables.length * indice) / versiones.length) % rotables.length;
  return [...rotables.slice(inicio), ...rotables.slice(0, inicio), ...fijas];
}

export const OPCIONES_CONOCE: Opcion[] = [
  { valor: 'si', etiqueta: 'Sí conoce' },
  { valor: 'no', etiqueta: 'No conoce' },
];

export function opcionesDeEscala(min: number, max: number, nsnc?: boolean): Opcion[] {
  const opciones: Opcion[] = [];
  for (let i = min; i <= max; i++) opciones.push({ valor: String(i), etiqueta: String(i) });
  if (nsnc) opciones.push({ valor: NSNC, etiqueta: 'NS/NC', nsnc: true, noLeer: true });
  return opciones;
}
