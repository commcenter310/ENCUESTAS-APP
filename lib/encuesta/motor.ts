/**
 * Motor de encuestas: funciones puras que interpretan una definición.
 * No dependen de React ni de Supabase, así que se prueban solas (ver
 * motor.test.ts) y las usan tanto la captura como los reportes.
 */
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

export const NSNC = 'nsnc';

// ---------------------------------------------------------------------------
// Opciones y rotación
// ---------------------------------------------------------------------------

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

function ordenar(
  def: DefinicionEncuesta,
  ref: RefOpciones,
  debeRotar: boolean | undefined,
  version: string,
): Opcion[] {
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

// ---------------------------------------------------------------------------
// Condiciones y recorrido del cuestionario
// ---------------------------------------------------------------------------

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
export function esVisible(
  def: DefinicionEncuesta,
  p: Pregunta,
  version: string,
  r: Respuestas,
): boolean {
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
  return def.secciones.flatMap((seccion) =>
    seccion.preguntas.map((pregunta) => ({ seccion, pregunta })),
  );
}

/** Preguntas que tocan con las respuestas actuales, en orden. */
export function preguntasVisibles(
  def: DefinicionEncuesta,
  version: string,
  r: Respuestas,
): PreguntaConSeccion[] {
  return todasLasPreguntas(def).filter(({ pregunta }) => esVisible(def, pregunta, version, r));
}

/** Motivo por el que la entrevista termina al responder esta pregunta, o null. */
export function motivoParaTerminar(p: Pregunta, r: Respuestas): string | null {
  for (const regla of p.terminar ?? []) {
    if (cumple(regla.si, r)) return regla.motivo;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claves, validación y limpieza de respuestas
// ---------------------------------------------------------------------------

function campos(p: Pregunta): Pregunta[] {
  return p.tipo === 'grupo' ? p.campos : [p];
}

/** Claves de respuesta que puede producir una pregunta. */
export function clavesDePregunta(def: DefinicionEncuesta, p: Pregunta): string[] {
  switch (p.tipo) {
    case 'unica': {
      const pideTexto = resolverOpciones(def, p.opciones).some((o) => o.especificar);
      return pideTexto ? [p.id, `${p.id}_otro`] : [p.id];
    }
    case 'abierta':
    case 'numero':
    case 'escala':
      return [p.id];
    case 'matriz':
      return resolverOpciones(def, p.filas).map((f) => `${p.id}.${f.valor}`);
    case 'conocimiento':
      return resolverOpciones(def, p.filas).flatMap((f) => [
        `${p.id}.${f.valor}.conoce`,
        `${p.id}.${f.valor}.opinion`,
      ]);
    case 'atributos':
      return p.atributos.map((a) => `${p.id}.${a.valor}`);
    case 'grupo':
      return p.campos.flatMap((c) => clavesDePregunta(def, c));
  }
}

function vacio(v: Valor | undefined): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Revisa que una pregunta esté completa. Devuelve un mensaje para el
 * encuestador o null si todo está bien.
 */
export function validarPregunta(
  def: DefinicionEncuesta,
  p: Pregunta,
  version: string,
  r: Respuestas,
): string | null {
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
      const validas = new Set([
        ...personasDe(def, p, version, r).map((o) => o.valor),
        ...(p.opcionesFijas ?? []).map((o) => o.valor),
      ]);
      if (p.soloConocidasEn && personasDe(def, p, version, r).length === 0) return null;
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
export function limpiarRespuestas(
  def: DefinicionEncuesta,
  version: string,
  respuestas: Respuestas,
): Respuestas {
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
          const validas = new Set([
            ...personasDe(def, p, version, r).map((o) => o.valor),
            ...(p.opcionesFijas ?? []).map((o) => o.valor),
          ]);
          const aplica = !p.soloConocidasEn || personasDe(def, p, version, r).length > 0;
          for (const a of p.atributos) {
            const clave = `${p.id}.${a.valor}`;
            if (aplica && validas.has(String(r[clave]))) conservar.add(clave);
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

// ---------------------------------------------------------------------------
// Reportes y exportación
// ---------------------------------------------------------------------------

export type Columna = {
  clave: string;
  /** Encabezado legible para exportar. */
  titulo: string;
  /** Opciones para traducir el código guardado a su etiqueta. */
  opciones?: Opcion[];
  /** Respuesta de texto libre o numérica (no se cuenta por opción). */
  libre?: boolean;
};

function columnasDePregunta(def: DefinicionEncuesta, p: Pregunta): Columna[] {
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

/** Columnas de respuestas en el orden del cuestionario (arranque incluido). */
export function columnasDeRespuestas(def: DefinicionEncuesta): Columna[] {
  return [
    ...(def.arranque ?? []).flatMap((p) => columnasDePregunta(def, p)),
    ...todasLasPreguntas(def).flatMap(({ pregunta }) => columnasDePregunta(def, pregunta)),
  ];
}

/** Claves de respuestas cerradas, las que tiene sentido contar por opción. */
export function clavesCerradas(def: DefinicionEncuesta): string[] {
  return columnasDeRespuestas(def)
    .filter((c) => !c.libre)
    .map((c) => c.clave);
}

/** Traduce un valor guardado a su etiqueta legible. */
export function etiquetaDe(columna: Columna, valor: Valor | undefined): string {
  if (valor === undefined || valor === null) return '';
  const opcion = columna.opciones?.find((o) => o.valor === String(valor));
  return opcion ? opcion.etiqueta : String(valor);
}

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

// ---------------------------------------------------------------------------
// Revisión de una definición importada
// ---------------------------------------------------------------------------

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
  const tipos = new Set([
    'unica',
    'abierta',
    'numero',
    'escala',
    'matriz',
    'conocimiento',
    'atributos',
    'grupo',
  ]);
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
