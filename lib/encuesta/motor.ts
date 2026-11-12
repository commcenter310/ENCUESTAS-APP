/**
 * Motor de captura: funciones puras que recorren el cuestionario, validan y
 * limpian respuestas. No dependen de React ni de Supabase (ver motor.test.ts).
 */
import { clavesDePregunta } from './columnas';
import { NSNC, resolverOpciones, rotar } from './opciones';
import type {
  Condicion,
  DefinicionEncuesta,
  Opcion,
  Pregunta,
  PreguntaAtributos,
  PreguntaUnica,
  RefOpciones,
  Respuestas,
  Seccion,
  Valor,
} from './tipos';

function ordenar(def: DefinicionEncuesta, ref: RefOpciones, debeRotar: boolean | undefined, version: string): Opcion[] {
  const opciones = resolverOpciones(def, ref);
  return debeRotar ? rotar(opciones, def.versiones, version) : opciones;
}

/** Opciones de una pregunta de opción única, ya rotadas y filtradas. */
export function opcionesDe(
  def: DefinicionEncuesta,
  p: PreguntaUnica,
  version: string,
  respuestas: Respuestas = {},
): Opcion[] {
  let opciones = ordenar(def, p.opciones, p.rotar, version);
  if (p.excluirRespuestaDe) {
    const elegida = respuestas[p.excluirRespuestaDe];
    opciones = opciones.filter((o) => o.fija || o.valor !== elegida);
  }
  return opciones;
}

/** Filas de una matriz o de una pregunta de conocimiento, ya rotadas. */
export function filasDe(
  def: DefinicionEncuesta,
  p: Extract<Pregunta, { tipo: 'matriz' | 'conocimiento' }>,
  version: string,
): Opcion[] {
  return ordenar(def, p.filas, p.rotarFilas, version);
}

/** Personas elegibles en una pregunta de atributos (solo las conocidas). */
export function personasDe(
  def: DefinicionEncuesta,
  p: PreguntaAtributos,
  version: string,
  respuestas: Respuestas = {},
): Opcion[] {
  const personas = ordenar(def, p.personas, p.rotarPersonas, version);
  if (!p.soloConocidasEn) return personas;
  return personas.filter((o) => respuestas[`${p.soloConocidasEn}.${o.valor}.conoce`] === 'si');
}

/**
 * Valores válidos en una pregunta de atributos: personas que conoce más las
 * opciones fijas. null si la pregunta no aplica (no conoce a nadie).
 */
function valoresDeAtributos(
  def: DefinicionEncuesta,
  p: PreguntaAtributos,
  version: string,
  r: Respuestas,
): Set<string> | null {
  const personas = personasDe(def, p, version, r);
  if (p.soloConocidasEn && personas.length === 0) return null;
  return new Set([...personas.map((o) => o.valor), ...(p.opcionesFijas ?? []).map((o) => o.valor)]);
}

function comoLista(v: Valor | Valor[]): Valor[] {
  return Array.isArray(v) ? v : [v];
}

export function cumple(c: Condicion, r: Respuestas): boolean {
  if ('todas' in c) return c.todas.every((x) => cumple(x, r));
  if ('alguna' in c) return c.alguna.some((x) => cumple(x, r));
  const valor = r[c.pregunta];
  if ('es' in c) return valor !== undefined && comoLista(c.es).includes(valor);
  if ('noEs' in c) return valor !== undefined && !comoLista(c.noEs).includes(valor);
  if ('menorQue' in c) return typeof valor === 'number' && valor < c.menorQue;
  return typeof valor === 'number' && valor > c.mayorQue;
}

/** ¿La pregunta se muestra al encuestador con las respuestas actuales? */
export function esVisible(def: DefinicionEncuesta, p: Pregunta, version: string, r: Respuestas): boolean {
  if (p.mostrarSi && !cumple(p.mostrarSi, r)) return false;
  if (p.tipo === 'unica' && p.derivarDe) return false;
  if (p.tipo === 'atributos' && p.soloConocidasEn) {
    return personasDe(def, p, version, r).length > 0;
  }
  return true;
}

export type PreguntaConSeccion = { seccion: Seccion; pregunta: Pregunta };

/** Todas las preguntas del cuestionario en orden (sin las de arranque). */
export function todasLasPreguntas(def: DefinicionEncuesta): PreguntaConSeccion[] {
  return def.secciones.flatMap((seccion) => seccion.preguntas.map((pregunta) => ({ seccion, pregunta })));
}

/** Preguntas que tocan con las respuestas actuales, en orden. */
export function preguntasVisibles(def: DefinicionEncuesta, version: string, r: Respuestas): PreguntaConSeccion[] {
  return todasLasPreguntas(def).filter(({ pregunta }) => esVisible(def, pregunta, version, r));
}

/** Motivo por el que la entrevista termina al responder esta pregunta, o null. */
export function motivoParaTerminar(p: Pregunta, r: Respuestas): string | null {
  for (const regla of p.terminar ?? []) {
    if (cumple(regla.si, r)) return regla.motivo;
  }
  return null;
}

function campos(p: Pregunta): Pregunta[] {
  return p.tipo === 'grupo' ? p.campos : [p];
}

export function vacio(v: Valor | undefined): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Revisa que una pregunta esté completa. Devuelve un mensaje para el
 * encuestador o null si todo está bien.
 */
export function validarPregunta(def: DefinicionEncuesta, p: Pregunta, version: string, r: Respuestas): string | null {
  if (p.mostrarSi && !cumple(p.mostrarSi, r)) return null;

  switch (p.tipo) {
    case 'unica': {
      if (p.derivarDe) return null;
      const valor = r[p.id];
      if (vacio(valor)) return p.opcional ? null : 'Selecciona una opción.';
      const opcion = opcionesDe(def, p, version, r).find((o) => o.valor === valor);
      if (!opcion) return 'Selecciona una opción de la lista.';
      if (opcion.especificar && vacio(r[`${p.id}_otro`])) return 'Anota cuál.';
      return null;
    }
    case 'abierta': {
      if (vacio(r[p.id])) return p.opcional ? null : 'Anota la respuesta.';
      return null;
    }
    case 'numero': {
      const valor = r[p.id];
      if (vacio(valor)) return p.opcional ? null : 'Anota un número.';
      if (typeof valor !== 'number' || !Number.isInteger(valor)) return 'Anota un número entero.';
      if (p.min !== undefined && valor < p.min) return `El mínimo es ${p.min}.`;
      if (p.max !== undefined && valor > p.max) return `El máximo es ${p.max}.`;
      return null;
    }
    case 'escala': {
      const valor = r[p.id];
      if (vacio(valor)) return p.opcional ? null : 'Selecciona una calificación.';
      if (valor === NSNC) return p.nsnc ? null : 'Selecciona una calificación.';
      if (typeof valor !== 'number' || valor < p.min || valor > p.max) {
        return `Selecciona un valor de ${p.min} a ${p.max}.`;
      }
      return null;
    }
    case 'matriz': {
      const faltan = filasDe(def, p, version).filter((f) => vacio(r[`${p.id}.${f.valor}`]));
      if (faltan.length && !p.opcional) return `Falta responder: ${faltan[0].etiqueta}.`;
      return null;
    }
    case 'conocimiento': {
      for (const f of filasDe(def, p, version)) {
        const conoce = r[`${p.id}.${f.valor}.conoce`];
        if (vacio(conoce)) return p.opcional ? null : `Falta responder: ${f.etiqueta}.`;
        if (conoce === 'si' && vacio(r[`${p.id}.${f.valor}.opinion`])) {
          return `Falta la opinión sobre ${f.etiqueta}.`;
        }
      }
      return null;
    }
    case 'atributos': {
      const validas = valoresDeAtributos(def, p, version, r);
      if (!validas) return null;
      for (const a of p.atributos) {
        const valor = r[`${p.id}.${a.valor}`];
        if (vacio(valor)) {
          if (p.opcional) continue;
          return `Falta responder: ${a.etiqueta}.`;
        }
        if (!validas.has(String(valor))) return `Revisa la respuesta de: ${a.etiqueta}.`;
      }
      return null;
    }
    case 'grupo': {
      for (const c of p.campos) {
        const error = validarPregunta(def, c, version, r);
        if (error) return `${c.texto}: ${error}`;
      }
      return null;
    }
  }
}

/** Calcula las respuestas derivadas (p. ej. grupo de edad a partir de la edad). */
export function aplicarDerivadas(def: DefinicionEncuesta, r: Respuestas): Respuestas {
  const salida = { ...r };
  for (const { pregunta } of todasLasPreguntas(def)) {
    for (const c of campos(pregunta)) {
      if (c.tipo !== 'unica' || !c.derivarDe) continue;
      const origen = salida[c.derivarDe.pregunta];
      delete salida[c.id];
      if (typeof origen !== 'number') continue;
      const rango = c.derivarDe.rangos.find((x) => origen <= x.hasta);
      if (rango) salida[c.id] = rango.valor;
    }
  }
  return salida;
}

/**
 * Deja solo las respuestas que siguen siendo válidas: quita las de preguntas
 * que ya no se muestran, opiniones de personas que no conoce, textos de "Otro"
 * que ya no aplican, etc. Se usa antes de avanzar y antes de enviar.
 */
export function limpiarRespuestas(def: DefinicionEncuesta, version: string, respuestas: Respuestas): Respuestas {
  const r = aplicarDerivadas(def, respuestas);
  const conservar = new Set<string>();

  for (const p of def.arranque ?? []) {
    for (const clave of clavesDePregunta(def, p)) conservar.add(clave);
  }

  for (const { pregunta } of todasLasPreguntas(def)) {
    if (pregunta.mostrarSi && !cumple(pregunta.mostrarSi, r)) continue;
    for (const p of campos(pregunta)) {
      if (p.mostrarSi && !cumple(p.mostrarSi, r)) continue;
      switch (p.tipo) {
        case 'unica': {
          if (p.derivarDe) {
            conservar.add(p.id);
            break;
          }
          const opcion = opcionesDe(def, p, version, r).find((o) => o.valor === r[p.id]);
          if (opcion) {
            conservar.add(p.id);
            if (opcion.especificar) conservar.add(`${p.id}_otro`);
          }
          break;
        }
        case 'conocimiento':
          for (const f of resolverOpciones(def, p.filas)) {
            conservar.add(`${p.id}.${f.valor}.conoce`);
            if (r[`${p.id}.${f.valor}.conoce`] === 'si') {
              conservar.add(`${p.id}.${f.valor}.opinion`);
            }
          }
          break;
        case 'atributos': {
          const validas = valoresDeAtributos(def, p, version, r);
          for (const a of p.atributos) {
            const clave = `${p.id}.${a.valor}`;
            if (validas?.has(String(r[clave]))) conservar.add(clave);
          }
          break;
        }
        default:
          for (const clave of clavesDePregunta(def, p)) conservar.add(clave);
      }
    }
  }

  const salida: Respuestas = {};
  for (const [clave, valor] of Object.entries(r)) {
    if (!conservar.has(clave) || vacio(valor)) continue;
    salida[clave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  return salida;
}

/** Versión que toca a la siguiente entrevista, para repartirlas parejo. */
export function siguienteVersion(def: DefinicionEncuesta, entrevistasPrevias: number): string {
  return def.versiones[entrevistasPrevias % def.versiones.length] ?? def.versiones[0] ?? 'A';
}
