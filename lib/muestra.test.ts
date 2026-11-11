import { describe, expect, it } from 'vitest';
import {
  PLANTILLA_CSV,
  interpretarMuestra,
  leerCsv,
  levantadasEn,
  resumirMuestra,
  ubicarSeccion,
  type Hoja,
} from './muestra';

/** Misma forma que el archivo de diseño muestral de Guasave (recortado). */
const ARCHIVO: Hoja[] = [
  {
    nombre: 'Parámetros',
    filas: [['Encuesta interna Guasave – Diseño muestral'], [], ['Parámetro', 'Valor'], ['Total de entrevistas', 1000]],
  },
  {
    nombre: 'Grandes',
    filas: [
      ['#', 'SECCIÓN', 'DTTO LOCAL', 'LISTA NOMINAL', 'ENTREVISTAS PROPORCIONALES', 'ENTREVISTAS A LEVANTAR', 'FACTOR DE PONDERACIÓN'],
      [1, 2136, 7, 6537, 32.67, 10, 3.267],
      [2, 3937, 8, 1875, 9.37, 9, 1.041],
      ['TOTAL', null, null, 8412, 42.04, 19, null],
      [],
      ['Entrevistas proporcionales = Total × (LN sección ÷ LN total).'],
    ],
  },
  {
    nombre: 'Aleatorias',
    filas: [
      ['#', 'SECCIÓN', 'DTTO LOCAL', 'LISTA NOMINAL', 'ENTREVISTAS', 'FACTOR DE PONDERACIÓN', 'REEMPLAZO', 'LN REEMPLAZO'],
      [1, 2108, 7, 495, 10, 0.94, 2109, 577],
      [2, 2151, 8, 156, 10, 0.94, 2152, 200],
      ['Método: PPS sistemático.'],
    ],
  },
  {
    nombre: 'Zona de aplicación',
    filas: [
      ['DTTO FEDERAL', 'DTTO LOCAL', 'SECCIÓN', 'LISTA NOMINAL', 'ESTATUS'],
      [4, 7, 2136, 6537, 'GRANDE'],
      [4, 8, 3937, 1875, 'GRANDE'],
      [4, 7, 2108, 495, 'ALEATORIA'],
      [4, 8, 2151, 156, 'ALEATORIA'],
    ],
  },
];

describe('interpretar el archivo de muestra', () => {
  it('lee las hojas Grandes y Aleatorias y completa el distrito federal con la Zona de aplicación', () => {
    const r = interpretarMuestra(ARCHIVO);
    expect(r.errores).toEqual([]);
    expect(r.hojas).toEqual(['Grandes', 'Aleatorias']);
    expect(r.secciones).toEqual([
      { seccion: '2136', distrito_local: 7, distrito_federal: 4, meta: 10, estrato: 'Grande', lista_nominal: 6537, factor_ponderacion: 3.267, reemplazo: null },
      { seccion: '3937', distrito_local: 8, distrito_federal: 4, meta: 9, estrato: 'Grande', lista_nominal: 1875, factor_ponderacion: 1.041, reemplazo: null },
      { seccion: '2108', distrito_local: 7, distrito_federal: 4, meta: 10, estrato: 'Aleatoria', lista_nominal: 495, factor_ponderacion: 0.94, reemplazo: '2109' },
      { seccion: '2151', distrito_local: 8, distrito_federal: 4, meta: 10, estrato: 'Aleatoria', lista_nominal: 156, factor_ponderacion: 0.94, reemplazo: '2152' },
    ]);
  });

  it('usa "ENTREVISTAS A LEVANTAR" y no las proporcionales', () => {
    const r = interpretarMuestra(ARCHIVO);
    expect(r.secciones.find((s) => s.seccion === '2136')?.meta).toBe(10);
  });

  it('pide el distrito federal cuando el archivo no lo trae y lo acepta como opción', () => {
    const sinZona = ARCHIVO.filter((h) => h.nombre !== 'Zona de aplicación');
    expect(interpretarMuestra(sinZona).errores.join(' ')).toMatch(/Falta el distrito federal en 4 secciones/);
    const r = interpretarMuestra(sinZona, { distritoFederal: 4 });
    expect(r.errores).toEqual([]);
    expect(r.secciones.every((s) => s.distrito_federal === 4)).toBe(true);
  });

  it('detecta secciones repetidas y entrevistas inválidas', () => {
    const r = interpretarMuestra([
      {
        nombre: 'Hoja1',
        filas: [
          ['Sección', 'Distrito local', 'Distrito federal', 'Entrevistas'],
          [100, 1, 4, 10],
          [100, 1, 4, 8],
          [101, 1, 4, 0],
          [102, 1, 4, 2.5],
        ],
      },
    ]);
    const errores = r.errores.join(' | ');
    expect(errores).toMatch(/sección 100 aparece dos veces/);
    expect(errores).toMatch(/sección 101 no tiene un número de entrevistas válido/);
    expect(errores).toMatch(/sección 102 no tiene un número de entrevistas válido/);
  });

  it('explica qué falta si no hay columnas reconocibles', () => {
    expect(interpretarMuestra([{ nombre: 'X', filas: [['a', 'b'], [1, 2]] }]).errores[0]).toMatch(/SECCIÓN/);
  });

  it('descarta reemplazos que también son titulares o que se repiten', () => {
    const r = interpretarMuestra([
      {
        nombre: 'Muestra',
        filas: [
          ['SECCION', 'DL', 'DF', 'CUOTA', 'REEMPLAZO'],
          [1, 1, 1, 5, 2],
          [2, 1, 1, 5, 3],
          [4, 1, 1, 5, 3],
        ],
      },
    ]);
    expect(r.errores).toEqual([]);
    expect(r.secciones.map((s) => s.reemplazo)).toEqual([null, '3', null]);
    expect(r.avisos).toHaveLength(2);
  });
});

describe('CSV', () => {
  it('lee la plantilla con BOM y comas', () => {
    const r = interpretarMuestra([{ nombre: 'CSV', filas: leerCsv(PLANTILLA_CSV) }]);
    expect(r.errores).toEqual([]);
    expect(r.secciones.map((s) => [s.seccion, s.distrito_federal, s.meta, s.estrato, s.reemplazo])).toEqual([
      ['2136', 4, 10, 'Grande', null],
      ['2108', 4, 10, 'Aleatoria', '2109'],
    ]);
  });

  it('acepta punto y coma, comillas y saltos de línea de Windows', () => {
    const filas = leerCsv('sección;dtto local;entrevistas\r\n"2136";7;10\r\n2108;"7";"1,0"\r\n\r\n');
    expect(filas).toEqual([
      ['sección', 'dtto local', 'entrevistas'],
      ['2136', '7', '10'],
      ['2108', '7', '1,0'],
    ]);
  });
});

describe('uso en campo', () => {
  const { secciones } = interpretarMuestra(ARCHIVO);

  it('ubica titulares, reemplazos y secciones fuera de muestra', () => {
    expect(ubicarSeccion(secciones, 2136)).toMatchObject({ tipo: 'titular', fila: { seccion: '2136' } });
    expect(ubicarSeccion(secciones, '2109')).toMatchObject({ tipo: 'reemplazo', fila: { seccion: '2108' } });
    expect(ubicarSeccion(secciones, 9999)).toEqual({ tipo: 'fuera' });
    expect(ubicarSeccion(secciones, undefined)).toEqual({ tipo: 'fuera' });
  });

  it('suma las entrevistas del reemplazo a su titular', () => {
    const fila = secciones.find((s) => s.seccion === '2108')!;
    expect(levantadasEn(fila, { '2108': 4, '2109': 3, '2136': 9 })).toBe(7);
  });

  it('resume por distrito y estrato', () => {
    const r = resumirMuestra(secciones);
    expect(r).toMatchObject({ secciones: 4, meta: 39 });
    expect(r.porDistritoLocal).toEqual([
      { distrito: 7, secciones: 2, meta: 20 },
      { distrito: 8, secciones: 2, meta: 19 },
    ]);
    expect(r.porDistritoFederal).toEqual([{ distrito: 4, secciones: 4, meta: 39 }]);
    expect(r.porEstrato).toEqual([
      { estrato: 'Aleatoria', secciones: 2, meta: 20 },
      { estrato: 'Grande', secciones: 2, meta: 19 },
    ]);
  });
});
