import { columnasDeRespuestas, etiquetaDe } from '@/lib/encuesta/columnas';
import { type Encuesta, type Entrevista, NOMBRES_RESULTADO, NOMBRES_REVISION } from '@/lib/encuesta/tipos';
import { diaLocal, hora } from '@/lib/formato';
import { COLUMNAS_CSV, type SeccionMuestra } from '@/lib/muestra';
import { type FilaDeAvance, ubicarSeccion } from '@/lib/muestra-avance';

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

/**
 * Una fila por entrevista y una columna por respuesta, con etiquetas legibles.
 * Los datos de la sección en la muestra van al final para no mover las columnas de siempre.
 */
export function entrevistasACsv(
  encuesta: Encuesta,
  entrevistas: EntrevistaConNombre[],
  muestra: SeccionMuestra[] = [],
): string {
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
    'distrito_local',
    'distrito_federal',
    'estrato',
    'factor_ponderacion',
    'en_muestra',
    'reemplazo_de',
  ];
  const filas = entrevistas.map((e) => {
    const ubicacion = ubicarSeccion(muestra, e.zona);
    const fila = ubicacion.tipo === 'fuera' ? null : ubicacion.fila;
    return [
      e.id,
      diaLocal(e.terminada_en, zona),
      hora(e.iniciada_en, zona),
      hora(e.terminada_en, zona),
      e.duracion_seg,
      e.encuestador?.nombre ?? '',
      e.version,
      NOMBRES_RESULTADO[e.resultado],
      e.motivo_no_elegible,
      NOMBRES_REVISION[e.revision],
      e.nota_revision,
      e.lat,
      e.lng,
      e.precision_m,
      ...columnas.map((c) => etiquetaDe(c, e.respuestas[c.clave])),
      fila?.distrito_local,
      fila?.distrito_federal,
      fila?.estrato,
      fila?.factor_ponderacion,
      muestra.length === 0 ? '' : fila ? 'Sí' : 'No',
      ubicacion.tipo === 'reemplazo' ? ubicacion.fila.seccion : '',
    ];
  });
  return aCsv(encabezados, filas);
}

export function muestraACsv(filas: FilaDeAvance[]): string {
  return aCsv(
    [...COLUMNAS_CSV, 'LEVANTADAS'],
    filas.map((f) => [
      f.seccion,
      f.distrito_local,
      f.distrito_federal,
      f.meta,
      f.estrato,
      f.lista_nominal,
      f.factor_ponderacion,
      f.reemplazo,
      f.levantadas,
    ]),
  );
}
