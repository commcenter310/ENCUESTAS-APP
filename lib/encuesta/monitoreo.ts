import type { DefinicionEncuesta, Respuestas } from './tipos';

/** Nombre de la zona de muestreo ("Sección" por defecto) en singular y plural. */
export function etiquetasZona(def: DefinicionEncuesta): { singular: string; plural: string } {
  const singular = def.monitoreo?.etiquetaZona ?? 'Sección';
  const plural = singular === 'Sección' ? 'Secciones' : /[aeiou]$/i.test(singular) ? `${singular}s` : `${singular}es`;
  return { singular, plural };
}

export function zonaDe(def: DefinicionEncuesta, respuestas: Respuestas): string | null {
  const campo = def.monitoreo?.campoZona;
  return campo && respuestas[campo] !== undefined ? String(respuestas[campo]) : null;
}
