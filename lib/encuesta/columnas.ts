/**
 * Columnas de respuesta: qué claves produce cada pregunta, con su encabezado y
 * sus opciones. Es la única fuente de las claves; captura y reportes la comparten.
 */
import { OPCIONES_CONOCE, opcionesDeEscala, resolverOpciones } from './opciones';
import type { DefinicionEncuesta, Opcion, Pregunta, Valor } from './tipos';

export type Columna = {
  clave: string;
  /** Encabezado legible para exportar. */
  titulo: string;
  /** Opciones para traducir el código guardado a su etiqueta. */
  opciones?: Opcion[];
  /** Respuesta de texto libre o numérica (no se cuenta por opción). */
  libre?: boolean;
};

export function columnasDePregunta(def: DefinicionEncuesta, p: Pregunta): Columna[] {
  const num = p.numero ?? p.id;
  switch (p.tipo) {
    case 'unica': {
      const opciones = resolverOpciones(def, p.opciones);
      const columnas: Columna[] = [{ clave: p.id, titulo: num, opciones }];
      if (opciones.some((o) => o.especificar)) {
        columnas.push({ clave: `${p.id}_otro`, titulo: `${num} (otro)`, libre: true });
      }
      return columnas;
    }
    case 'abierta':
    case 'numero':
      return [{ clave: p.id, titulo: num, libre: true }];
    case 'escala':
      return [{ clave: p.id, titulo: num, opciones: opcionesDeEscala(p.min, p.max, p.nsnc) }];
    case 'matriz':
      return resolverOpciones(def, p.filas).map((f) => ({
        clave: `${p.id}.${f.valor}`,
        titulo: `${num} ${f.etiqueta}`,
        opciones: p.columnas,
      }));
    case 'conocimiento':
      return resolverOpciones(def, p.filas).flatMap((f) => [
        {
          clave: `${p.id}.${f.valor}.conoce`,
          titulo: `${num} ${f.etiqueta} (conoce)`,
          opciones: OPCIONES_CONOCE,
        },
        {
          clave: `${p.id}.${f.valor}.opinion`,
          titulo: `${num} ${f.etiqueta} (opinión)`,
          opciones: p.opinion,
        },
      ]);
    case 'atributos': {
      const opciones = [...resolverOpciones(def, p.personas), ...(p.opcionesFijas ?? [])];
      return p.atributos.map((a) => ({
        clave: `${p.id}.${a.valor}`,
        titulo: `${num} ${a.etiqueta}`,
        opciones,
      }));
    }
    case 'grupo':
      return p.campos.flatMap((c) => columnasDePregunta(def, c));
  }
}

export function clavesDePregunta(def: DefinicionEncuesta, p: Pregunta): string[] {
  return columnasDePregunta(def, p).map((c) => c.clave);
}

/** Columnas de respuestas en el orden del cuestionario (arranque incluido). */
export function columnasDeRespuestas(def: DefinicionEncuesta): Columna[] {
  return [...(def.arranque ?? []), ...def.secciones.flatMap((s) => s.preguntas)].flatMap((p) =>
    columnasDePregunta(def, p),
  );
}

/** Claves de respuestas cerradas, las que tiene sentido contar por opción. */
export function clavesCerradas(def: DefinicionEncuesta): string[] {
  return columnasDeRespuestas(def)
    .filter((c) => !c.libre)
    .map((c) => c.clave);
}

export function etiquetaDe(columna: Columna, valor: Valor | undefined): string {
  if (valor === undefined || valor === null) return '';
  const opcion = columna.opciones?.find((o) => o.valor === String(valor));
  return opcion ? opcion.etiqueta : String(valor);
}
