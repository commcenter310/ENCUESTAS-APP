import { columnasDeRespuestas, etiquetaDe } from '@/lib/encuesta/motor';
import type { Encuesta, Entrevista } from '@/lib/encuesta/tipos';
import { diaLocal, hora } from '@/lib/formato';

type Celda = string | number | null | undefined;

function celdaCsv(valor: Celda): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  // Evita que Excel interprete como fórmula un texto capturado en campo.
  if (/^[=+\-@\t\r]/.test(texto) && typeof valor === 'string') texto = `'${texto}`;
  return /[",\n\r]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** Arma un CSV que Excel abre bien (UTF-8 con BOM, saltos de línea CRLF). */
export function aCsv(encabezados: string[], filas: Celda[][]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(celdaCsv).join(','));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

export function descargar(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

export type EntrevistaConNombre = Entrevista & { encuestador: { nombre: string } | null };

const RESULTADOS = { completa: 'Completa', no_elegible: 'No elegible' } as const;
const REVISIONES = { pendiente: 'Pendiente', validada: 'Validada', anulada: 'Anulada' } as const;

/** Una fila por entrevista y una columna por respuesta, con etiquetas legibles. */
export function entrevistasACsv(encuesta: Encuesta, entrevistas: EntrevistaConNombre[]): string {
  const columnas = columnasDeRespuestas(encuesta.definicion);
  const zona = encuesta.zona_horaria;
  const encabezados = [
    'id',
    'fecha',
    'hora_inicio',
    'hora_fin',
    'duracion_seg',
    'encuestador',
    'version',
    'resultado',
    'motivo_no_elegible',
    'revision',
    'nota_revision',
    'latitud',
    'longitud',
    'precision_m',
    ...columnas.map((c) => c.titulo),
  ];
  const filas = entrevistas.map((e) => [
    e.id,
    diaLocal(e.terminada_en, zona),
    hora(e.iniciada_en, zona),
    hora(e.terminada_en, zona),
    e.duracion_seg,
    e.encuestador?.nombre ?? '',
    e.version,
    RESULTADOS[e.resultado],
    e.motivo_no_elegible,
    REVISIONES[e.revision],
    e.nota_revision,
    e.lat,
    e.lng,
    e.precision_m,
    ...columnas.map((c) => etiquetaDe(c, e.respuestas[c.clave])),
  ]);
  return aCsv(encabezados, filas);
}
