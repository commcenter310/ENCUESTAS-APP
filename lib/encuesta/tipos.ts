/**
 * Formato de definición de una encuesta.
 *
 * Una encuesta se describe con un documento JSON (columna `encuestas.definicion`).
 * La app lo interpreta para dibujar el cuestionario, validar respuestas, rotar
 * opciones según la versión (A/B/C) y armar los reportes del administrador.
 *
 * Las respuestas de una entrevista se guardan "aplanadas": un objeto
 * { clave: valor } donde la clave identifica la pregunta (o la fila de una
 * matriz) y el valor es texto o número. Ver `columnasDePregunta` en columnas.ts.
 */

/** Valor que se guarda para una clave de respuesta. */
export type Valor = string | number;

/** Respuestas aplanadas de una entrevista. */
export type Respuestas = Record<string, Valor>;

export type Opcion = {
  /** Código que se guarda en la base de datos (sin espacios ni acentos). */
  valor: string;
  /** Texto que ve el encuestador. */
  etiqueta: string;
  /** No rota: se queda al final en su orden original (Otro, Ninguno, NS/NC). */
  fija?: boolean;
  /** Opción que no se lee al entrevistado (NS/NC, NO SABE). */
  noLeer?: boolean;
  /** Pide anotar un texto ("Otro: ____"). Se guarda en `<clave>_otro`. */
  especificar?: boolean;
  /** Cuenta como NS/NC al calcular porcentajes "sin NS/NC". */
  nsnc?: boolean;
  /**
   * Sentido de la opción, para colorear las gráficas de los reportes
   * (a favor en azul, en contra en rojo, neutro en gris). Opcional.
   */
  tono?: 'positivo' | 'positivo_suave' | 'neutro' | 'negativo';
};

/** Lista de opciones escrita en la pregunta o referencia a `definicion.listas`. */
export type RefOpciones = Opcion[] | { lista: string };

/** Condición sobre las respuestas ya capturadas. */
export type Condicion =
  | { pregunta: string; es: Valor | Valor[] }
  | { pregunta: string; noEs: Valor | Valor[] }
  | { pregunta: string; menorQue: number }
  | { pregunta: string; mayorQue: number }
  | { todas: Condicion[] }
  | { alguna: Condicion[] };

/** Regla que termina la entrevista (filtros de elegibilidad). */
export type ReglaTerminar = {
  si: Condicion;
  /** Motivo que se registra, p. ej. "Menor de 18 años". */
  motivo: string;
};

type PreguntaBase = {
  /** Clave de la respuesta. Única en toda la encuesta. Ej. "P1", "F3", "S2". */
  id: string;
  /** Número visible. Ej. "1", "F1", "S3". */
  numero?: string;
  /** Texto que se lee al entrevistado. */
  texto: string;
  /** Instrucción para el encuestador (no se lee). */
  instruccion?: string;
  /** Si es true se puede dejar sin respuesta. */
  opcional?: boolean;
  /** La pregunta solo se muestra si se cumple la condición. */
  mostrarSi?: Condicion;
  /** Si alguna regla se cumple al responder, la entrevista termina. */
  terminar?: ReglaTerminar[];
};

export type PreguntaUnica = PreguntaBase & {
  tipo: 'unica';
  opciones: RefOpciones;
  /** Rota las opciones no fijas según la versión del cuestionario. */
  rotar?: boolean;
  /** Oculta la opción elegida en otra pregunta (p. ej. "¿Y en segundo lugar?"). */
  excluirRespuestaDe?: string;
  /** Muestra un botón para enseñar las opciones en grande al entrevistado. */
  tarjeta?: boolean;
  /**
   * La respuesta se calcula a partir de una pregunta numérica y no se pregunta.
   * Ej. grupo de edad (S1) a partir de la edad exacta (F3).
   */
  derivarDe?: { pregunta: string; rangos: { hasta: number; valor: string }[] };
};

export type PreguntaAbierta = PreguntaBase & {
  tipo: 'abierta';
  multilinea?: boolean;
  maxCaracteres?: number;
  /** Texto de ayuda dentro del campo. */
  marcador?: string;
};

export type PreguntaNumero = PreguntaBase & {
  tipo: 'numero';
  min?: number;
  max?: number;
  sufijo?: string;
};

/** Escala numérica (p. ej. 1 a 10) con NS/NC opcional. Guarda número o "nsnc". */
export type PreguntaEscala = PreguntaBase & {
  tipo: 'escala';
  min: number;
  max: number;
  etiquetaMin?: string;
  etiquetaMax?: string;
  nsnc?: boolean;
};

/** Matriz: una opción por fila. Clave por fila: `<id>.<fila>`. */
export type PreguntaMatriz = PreguntaBase & {
  tipo: 'matriz';
  filas: RefOpciones;
  columnas: Opcion[];
  rotarFilas?: boolean;
};

/**
 * Conocimiento y opinión por persona.
 * Claves por fila: `<id>.<fila>.conoce` ("si" | "no") y, si conoce,
 * `<id>.<fila>.opinion`.
 */
export type PreguntaConocimiento = PreguntaBase & {
  tipo: 'conocimiento';
  filas: RefOpciones;
  rotarFilas?: boolean;
  /** Pregunta de seguimiento para quien sí conoce. */
  textoOpinion: string;
  opinion: Opcion[];
};

/**
 * Atributos: para cada atributo se elige una sola persona.
 * Clave por atributo: `<id>.<atributo>`.
 */
export type PreguntaAtributos = PreguntaBase & {
  tipo: 'atributos';
  atributos: { valor: string; etiqueta: string }[];
  personas: RefOpciones;
  rotarPersonas?: boolean;
  /** Limita las personas a las que el entrevistado conoce según esa pregunta. */
  soloConocidasEn?: string;
  /** Opciones siempre disponibles (p. ej. "Ninguna de las anteriores"). */
  opcionesFijas?: Opcion[];
};

/** Varios campos sencillos en una misma pantalla (p. ej. domicilio). */
export type PreguntaGrupo = PreguntaBase & {
  tipo: 'grupo';
  campos: (PreguntaUnica | PreguntaAbierta | PreguntaNumero)[];
};

export type Pregunta =
  | PreguntaUnica
  | PreguntaAbierta
  | PreguntaNumero
  | PreguntaEscala
  | PreguntaMatriz
  | PreguntaConocimiento
  | PreguntaAtributos
  | PreguntaGrupo;

export type TipoPregunta = Pregunta['tipo'];

export type Seccion = {
  id: string;
  titulo: string;
  /** Instrucción general del bloque para el encuestador. */
  instruccion?: string;
  preguntas: Pregunta[];
};

export type DefinicionEncuesta = {
  /** Versión del formato de definición. */
  formato: 1;
  /** Organización que levanta la encuesta (encabezado). */
  organizacion?: string;
  /** Versiones de rotación del cuestionario. Ej. ["A","B","C"]. */
  versiones: string[];
  /** Listas de opciones reutilizables (partidos, aspirantes...). */
  listas?: Record<string, Opcion[]>;
  /** Datos operativos que se piden antes de iniciar (sección, etc.). */
  arranque?: Pregunta[];
  introduccion: {
    /** Texto que se lee. Admite el marcador {encuestador}. */
    texto: string;
    instruccion?: string;
  };
  secciones: Seccion[];
  cierre: {
    /** Agradecimiento que se lee al entrevistado. */
    texto: string;
    /** Declaración que el encuestador acepta para poder enviar. */
    declaracion: string;
  };
  monitoreo?: {
    /** Clave de respuesta que identifica la zona de muestreo (sección). */
    campoZona?: string;
    etiquetaZona?: string;
    /** Entrevistas efectivas esperadas por zona. */
    metaPorZona?: number;
    /** Entrevistas más cortas que esto se marcan para revisión. */
    duracionMinimaSeg?: number;
    /** Claves que describen la muestra (sexo, edad...) en el tablero. */
    perfil?: string[];
    /**
     * Preguntas que se llenan solas con los datos de la sección en la muestra
     * (si están vacías). Ej. { "distrito_local": "DOM_dl" }.
     */
    autollenar?: { distrito_local?: string; distrito_federal?: string };
  };
};

export type TipoEncuesta = 'rigor_cientifico' | 'posicionamiento';

export const TIPOS_ENCUESTA: { valor: TipoEncuesta; nombre: string; ayuda: string }[] = [
  {
    valor: 'rigor_cientifico',
    nombre: 'Rigor científico',
    ayuda: 'Muestra probabilística por secciones, con margen de error y ponderación.',
  },
  {
    valor: 'posicionamiento',
    nombre: 'Posicionamiento',
    ayuda: 'Medición de imagen, conocimiento y posicionamiento de actores.',
  },
];

export function nombreDeTipo(tipo: TipoEncuesta | null | undefined): string {
  return TIPOS_ENCUESTA.find((t) => t.valor === tipo)?.nombre ?? 'Sin tipo';
}

/** Fila de la tabla `encuestas`. */
export type Encuesta = {
  id: string;
  clave: string;
  titulo: string;
  tipo: TipoEncuesta;
  descripcion: string | null;
  definicion: DefinicionEncuesta;
  estado: 'borrador' | 'activa' | 'cerrada';
  meta_muestra: number | null;
  zona_horaria: string;
  creada_en: string;
  actualizada_en: string;
};

export type ResultadoEntrevista = 'completa' | 'no_elegible';
export type EstadoRevision = 'pendiente' | 'validada' | 'anulada';

export const NOMBRES_RESULTADO: Record<ResultadoEntrevista, string> = {
  completa: 'Completa',
  no_elegible: 'No elegible',
};
export const NOMBRES_REVISION: Record<EstadoRevision, string> = {
  pendiente: 'Pendiente',
  validada: 'Validada',
  anulada: 'Anulada',
};

export type EstadoEncuesta = Encuesta['estado'];
export const ESTADOS_ENCUESTA: {
  valor: EstadoEncuesta;
  nombre: string;
  ayuda: string;
  tono: 'bien' | 'neutro' | 'aviso';
}[] = [
  { valor: 'borrador', nombre: 'Borrador', ayuda: 'Solo la ve el administrador.', tono: 'aviso' },
  { valor: 'activa', nombre: 'Activa', ayuda: 'Los encuestadores pueden levantarla.', tono: 'bien' },
  { valor: 'cerrada', nombre: 'Cerrada', ayuda: 'Ya no se inician entrevistas nuevas.', tono: 'neutro' },
];

export function estadoDeEncuesta(estado: EstadoEncuesta) {
  return ESTADOS_ENCUESTA.find((e) => e.valor === estado) ?? ESTADOS_ENCUESTA[0];
}

/** Entrevista tal como se envía desde el dispositivo. */
export type EntrevistaNueva = {
  id: string;
  encuesta_id: string;
  encuestador_id: string;
  version: string;
  resultado: ResultadoEntrevista;
  motivo_no_elegible: string | null;
  respuestas: Respuestas;
  iniciada_en: string;
  terminada_en: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  dispositivo: string | null;
};

/** Fila de la tabla `entrevistas`. */
export type Entrevista = EntrevistaNueva & {
  zona: string | null;
  duracion_seg: number;
  recibida_en: string;
  revision: EstadoRevision;
  revisada_por: string | null;
  revisada_en: string | null;
  nota_revision: string | null;
};
