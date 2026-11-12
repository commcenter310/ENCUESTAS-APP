/**
 * Muestra de una encuesta: qué secciones se levantan y cuántas entrevistas
 * (tope) lleva cada una.
 *
 * El archivo se interpreta aquí, sin depender de la interfaz, para poder
 * probarlo solo (ver muestra.test.ts). Acepta:
 *  - Excel con una o varias hojas. Toma de muestra toda hoja que tenga una
 *    columna de sección y una de entrevistas; las hojas que solo traen sección
 *    y distritos (p. ej. "Zona de aplicación") sirven para completar distritos.
 *  - CSV con encabezados (separado por comas, punto y coma o tabulador).
 */

export type SeccionMuestra = {
  /** Número de sección, como texto y sin ceros a la izquierda: "2136". */
  seccion: string;
  distrito_local: number | null;
  distrito_federal: number | null;
  /** Entrevistas a levantar en la sección (tope). */
  meta: number;
  /** Tipo de sección en el diseño (p. ej. "Grande", "Aleatoria"). */
  estrato: string | null;
  lista_nominal: number | null;
  factor_ponderacion: number | null;
  /** Sección que la sustituye si la titular es inaccesible. */
  reemplazo: string | null;
};

export type Hoja = { nombre: string; filas: unknown[][] };

export type ResultadoMuestra = {
  secciones: SeccionMuestra[];
  /** Problemas que impiden guardar. */
  errores: string[];
  /** Cosas a revisar que no impiden guardar. */
  avisos: string[];
  /** Hojas de donde salieron las secciones. */
  hojas: string[];
  /** Secciones sin distrito (para pedir uno por defecto al cargar). */
  faltanDf: number;
  faltanDl: number;
};

/** "Dtto. Federal" → "DTTO FEDERAL"; "SECCIÓN" → "SECCION". */
export function normalizar(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, ' ')
    .trim();
}

type Campo = 'seccion' | 'dl' | 'df' | 'meta' | 'estrato' | 'ln' | 'factor' | 'reemplazo';

/** Nombres aceptados por campo, en orden de preferencia. */
const NOMBRES: Record<Campo, string[]> = {
  seccion: ['SECCION', 'SECCION ELECTORAL', 'SECC', 'NUM SECCION', 'NO SECCION'],
  dl: ['DTTO LOCAL', 'DISTRITO LOCAL', 'DIST LOCAL', 'DL'],
  df: ['DTTO FEDERAL', 'DISTRITO FEDERAL', 'DIST FEDERAL', 'DF'],
  meta: [
    'ENTREVISTAS A LEVANTAR',
    'ENCUESTAS A REALIZAR',
    'ENCUESTAS A LEVANTAR',
    'ENTREVISTAS A REALIZAR',
    'CUOTA',
    'TOPE',
    'META',
    'ENTREVISTAS',
    'ENCUESTAS',
    'CANTIDAD',
    'NUM ENTREVISTAS',
    'NUM ENCUESTAS',
  ],
  estrato: ['ESTRATO', 'TIPO DE SECCION', 'TIPO', 'ESTATUS'],
  ln: ['LISTA NOMINAL', 'LN'],
  factor: ['FACTOR DE PONDERACION', 'FACTOR', 'PONDERACION'],
  reemplazo: ['REEMPLAZO', 'SECCION DE REEMPLAZO', 'SECCION REEMPLAZO'],
};

type Columnas = Partial<Record<Campo, number>>;

function columnasDe(fila: unknown[]): Columnas {
  const encabezados = fila.map(normalizar);
  const columnas: Columnas = {};
  for (const campo of Object.keys(NOMBRES) as Campo[]) {
    for (const nombre of NOMBRES[campo]) {
      const i = encabezados.indexOf(nombre);
      if (i >= 0) {
        columnas[campo] = i;
        break;
      }
    }
  }
  return columnas;
}

/** Busca la fila de encabezados en las primeras filas de la hoja. */
function encabezadoDe(hoja: Hoja): { fila: number; columnas: Columnas } | null {
  for (let i = 0; i < Math.min(15, hoja.filas.length); i++) {
    const columnas = columnasDe(hoja.filas[i] ?? []);
    if (columnas.seccion !== undefined) return { fila: i, columnas };
  }
  return null;
}

/**
 * Número de una celda. En texto, la coma seguida de exactamente 3 dígitos es de
 * miles ("1,000"); cualquier otra coma es decimal ("3,27" de un CSV con ";").
 */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let texto = String(valor).trim();
  texto = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(texto) ? texto.replace(/,/g, '') : texto.replace(',', '.');
  const n = Number(texto);
  return texto && Number.isFinite(n) ? n : null;
}

/** Sección como texto entero ("2136"), o null si la celda no es una sección. */
export function seccionDe(valor: unknown): string | null {
  const n = numero(valor);
  if (n === null || !Number.isInteger(n) || n <= 0 || n > 999999) return null;
  return String(n);
}

function entero(valor: unknown): number | null {
  const n = numero(valor);
  return n !== null && Number.isInteger(n) ? n : null;
}

function texto(valor: unknown): string | null {
  const t = String(valor ?? '').trim();
  return t ? t : null;
}

/** "GRANDE" → "Grande"; respeta lo que ya viene en minúsculas. */
function estratoBonito(valor: string): string {
  const t = valor.trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

/** "Aleatorias" → "Aleatoria", "Grandes" → "Grande" (nombre de hoja como estrato). */
function singular(nombre: string): string {
  const t = nombre.trim();
  if (/ces$/i.test(t)) return t.slice(0, -3) + 'z';
  if (/[aeiou]s$/i.test(t)) return t.slice(0, -1);
  return t;
}

export function interpretarMuestra(
  hojas: Hoja[],
  opciones: { distritoFederal?: number | null; distritoLocal?: number | null } = {},
): ResultadoMuestra {
  const errores: string[] = [];
  const avisos: string[] = [];

  type Lectura = { hoja: Hoja; inicio: number; columnas: Columnas };
  const lecturas: Lectura[] = [];
  for (const hoja of hojas) {
    const encabezado = encabezadoDe(hoja);
    if (encabezado) lecturas.push({ hoja, inicio: encabezado.fila + 1, columnas: encabezado.columnas });
  }

  const deMuestra = lecturas.filter((l) => l.columnas.meta !== undefined);
  if (deMuestra.length === 0) {
    return {
      secciones: [],
      errores: [
        'No encontré una hoja con columnas de sección y de entrevistas. Revisa que los encabezados digan, por ejemplo, "SECCIÓN" y "ENTREVISTAS".',
      ],
      avisos,
      hojas: [],
      faltanDf: 0,
      faltanDl: 0,
    };
  }

  // Distritos de apoyo (hojas que traen sección y distritos, pero no entrevistas).
  const apoyo = new Map<string, { dl: number | null; df: number | null }>();
  for (const l of lecturas) {
    if (l.columnas.dl === undefined && l.columnas.df === undefined) continue;
    for (const fila of l.hoja.filas.slice(l.inicio)) {
      const seccion = seccionDe(fila[l.columnas.seccion!]);
      if (!seccion) continue;
      const previo = apoyo.get(seccion) ?? { dl: null, df: null };
      apoyo.set(seccion, {
        dl: previo.dl ?? (l.columnas.dl !== undefined ? entero(fila[l.columnas.dl]) : null),
        df: previo.df ?? (l.columnas.df !== undefined ? entero(fila[l.columnas.df]) : null),
      });
    }
  }

  const secciones: SeccionMuestra[] = [];
  const origen = new Map<string, string>();
  const variasHojas = deMuestra.length > 1;

  for (const { hoja, inicio, columnas } of deMuestra) {
    for (let i = inicio; i < hoja.filas.length; i++) {
      const fila = hoja.filas[i] ?? [];
      const seccion = seccionDe(fila[columnas.seccion!]);
      // Filas de totales, notas o vacías: no son secciones.
      if (!seccion) continue;
      const lugar = `${hoja.nombre}, fila ${i + 1}`;

      const meta = numero(fila[columnas.meta!]);
      if (meta === null || !Number.isInteger(meta) || meta <= 0) {
        errores.push(
          `${lugar}: la sección ${seccion} no tiene un número de entrevistas válido (${String(fila[columnas.meta!] ?? 'vacío')}).`,
        );
        continue;
      }
      if (origen.has(seccion)) {
        errores.push(`La sección ${seccion} aparece dos veces (${origen.get(seccion)} y ${lugar}).`);
        continue;
      }
      origen.set(seccion, lugar);

      const deApoyo = apoyo.get(seccion);
      const estratoCelda = columnas.estrato !== undefined ? texto(fila[columnas.estrato]) : null;
      secciones.push({
        seccion,
        distrito_local:
          (columnas.dl !== undefined ? entero(fila[columnas.dl]) : null) ??
          deApoyo?.dl ??
          opciones.distritoLocal ??
          null,
        distrito_federal:
          (columnas.df !== undefined ? entero(fila[columnas.df]) : null) ??
          deApoyo?.df ??
          opciones.distritoFederal ??
          null,
        meta,
        estrato: estratoCelda ? estratoBonito(estratoCelda) : variasHojas ? singular(hoja.nombre) : null,
        lista_nominal: columnas.ln !== undefined ? entero(fila[columnas.ln]) : null,
        factor_ponderacion: columnas.factor !== undefined ? numero(fila[columnas.factor]) : null,
        reemplazo: columnas.reemplazo !== undefined ? seccionDe(fila[columnas.reemplazo]) : null,
      });
    }
  }

  if (secciones.length === 0 && errores.length === 0) {
    errores.push('No encontré ninguna sección con entrevistas en el archivo.');
  }

  const sinDf = secciones.filter((s) => s.distrito_federal === null).length;
  if (sinDf > 0) {
    errores.push(
      `Falta el distrito federal en ${sinDf} ${sinDf === 1 ? 'sección' : 'secciones'}. Indica el distrito federal que les corresponde.`,
    );
  }
  const sinDl = secciones.filter((s) => s.distrito_local === null).length;
  if (sinDl > 0) {
    errores.push(
      `Falta el distrito local en ${sinDl} ${sinDl === 1 ? 'sección' : 'secciones'}. Agrégalo al archivo o indica uno para todas.`,
    );
  }

  // Reemplazos: no pueden ser titulares ni repetirse.
  const titulares = new Set(secciones.map((s) => s.seccion));
  const usados = new Map<string, string>();
  for (const s of secciones) {
    if (!s.reemplazo) continue;
    if (titulares.has(s.reemplazo)) {
      avisos.push(
        `La sección ${s.reemplazo} es titular y también reemplazo de la ${s.seccion}; no se usará como reemplazo.`,
      );
      s.reemplazo = null;
    } else if (usados.has(s.reemplazo)) {
      avisos.push(
        `La sección ${s.reemplazo} es reemplazo de la ${usados.get(s.reemplazo)} y de la ${s.seccion}; solo queda para la ${usados.get(s.reemplazo)}.`,
      );
      s.reemplazo = null;
    } else {
      usados.set(s.reemplazo, s.seccion);
    }
  }

  return { secciones, errores, avisos, hojas: deMuestra.map((l) => l.hoja.nombre), faltanDf: sinDf, faltanDl: sinDl };
}

/** Lee un CSV sencillo (comillas dobles, separador "," ";" o tabulador). */
export function leerCsv(contenido: string): unknown[][] {
  const textoLimpio = contenido.replace(/^﻿/, '');
  const primera = textoLimpio.split(/\r?\n/, 1)[0] ?? '';
  const separador = [';', '\t', ','].reduce((mejor, s) =>
    primera.split(s).length > primera.split(mejor).length ? s : mejor,
  );
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < textoLimpio.length; i++) {
    const c = textoLimpio[i];
    if (comillas) {
      if (c === '"' && textoLimpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === separador) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && textoLimpio[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

/** Encabezados de la muestra en CSV (plantilla y descarga). */
export const COLUMNAS_CSV = [
  'SECCION',
  'DISTRITO LOCAL',
  'DISTRITO FEDERAL',
  'ENTREVISTAS',
  'ESTRATO',
  'LISTA NOMINAL',
  'FACTOR DE PONDERACION',
  'REEMPLAZO',
] as const;

export const PLANTILLA_CSV =
  `\uFEFF${COLUMNAS_CSV.join(',')}\r\n` +
  '2136,7,4,10,Grande,6537,3.27,\r\n' +
  '2108,7,4,10,Aleatoria,495,0.94,2109\r\n';
