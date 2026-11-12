import { clavesDePregunta } from './columnas';
import type { DefinicionEncuesta, Pregunta } from './tipos';

/**
 * Revisa que un JSON tenga la forma mínima de una definición. Devuelve la
 * lista de problemas encontrados (vacía si se puede usar).
 */
export function revisarDefinicion(dato: unknown): string[] {
  const errores: string[] = [];
  const def = dato as Partial<DefinicionEncuesta> | null;
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return ['El contenido no es un objeto JSON.'];
  }
  if (def.formato !== 1) errores.push('Falta "formato": 1.');
  if (!Array.isArray(def.versiones) || def.versiones.length === 0) {
    errores.push('Falta "versiones" (por ejemplo ["A"]).');
  }
  if (!def.introduccion?.texto) errores.push('Falta "introduccion.texto".');
  if (!def.cierre?.texto || !def.cierre?.declaracion) {
    errores.push('Falta "cierre.texto" o "cierre.declaracion".');
  }
  if (!Array.isArray(def.secciones) || def.secciones.length === 0) {
    errores.push('Falta "secciones" con al menos una sección.');
    return errores;
  }
  if (errores.length) return errores;

  const completa = def as DefinicionEncuesta;
  const vistas = new Set<string>();
  const tipos = new Set(['unica', 'abierta', 'numero', 'escala', 'matriz', 'conocimiento', 'atributos', 'grupo']);
  const revisar = (p: Pregunta, donde: string) => {
    if (!p?.id || !p.texto) {
      errores.push(`${donde}: hay una pregunta sin "id" o sin "texto".`);
      return;
    }
    if (!tipos.has(p.tipo)) {
      errores.push(`${p.id}: tipo desconocido "${String(p.tipo)}".`);
      return;
    }
    if (vistas.has(p.id)) errores.push(`${p.id}: el id está repetido.`);
    vistas.add(p.id);
    try {
      clavesDePregunta(completa, p);
      if (p.tipo === 'grupo') p.campos.forEach((c) => revisar(c, p.id));
    } catch (e) {
      errores.push(`${p.id}: ${e instanceof Error ? e.message : 'definición incompleta'}`);
    }
  };
  (completa.arranque ?? []).forEach((p) => revisar(p, 'arranque'));
  completa.secciones.forEach((s) => {
    if (!s?.id || !s.titulo || !Array.isArray(s.preguntas)) {
      errores.push('Hay una sección sin "id", "titulo" o "preguntas".');
      return;
    }
    s.preguntas.forEach((p) => revisar(p, s.id));
  });
  return errores;
}
