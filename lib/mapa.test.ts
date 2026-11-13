import { describe, expect, it } from 'vitest';
import {
  type PuntoEntrevista,
  alertasDe,
  colorPorEncuestador,
  colorPorRevision,
  desdeDelPeriodo,
  filtrarPorPeriodo,
} from './mapa';

function punto(cambios: Partial<PuntoEntrevista> = {}): PuntoEntrevista {
  return {
    id: crypto.randomUUID(),
    lat: 25.57,
    lng: -108.47,
    precision_m: 12,
    zona: '2136',
    terminada_en: '2026-11-13T18:00:00Z',
    duracion_seg: 600,
    resultado: 'completa',
    revision: 'pendiente',
    encuestador_id: 'a',
    encuestador: { nombre: 'Ana' },
    ...cambios,
  };
}

describe('alertas de un punto', () => {
  it('marca entrevistas cortas y GPS impreciso', () => {
    expect(alertasDe(punto(), 300)).toEqual([]);
    expect(alertasDe(punto({ duracion_seg: 120 }), 300)).toEqual(['corta']);
    expect(alertasDe(punto({ precision_m: 250 }), 300)).toEqual(['gps_impreciso']);
    expect(alertasDe(punto({ resultado: 'no_elegible', duracion_seg: 20 }), 300)).toEqual([]);
  });
});

describe('colores', () => {
  it('por revisión, con conteo por estado', () => {
    const { colorDe, leyenda } = colorPorRevision([punto(), punto({ revision: 'anulada' }), punto()]);
    expect(leyenda.map((l) => [l.etiqueta, l.n])).toEqual([
      ['Pendiente', 2],
      ['Validada', 0],
      ['Anulada', 1],
    ]);
    expect(colorDe(punto({ revision: 'validada' }))).toBe('#0ca30c');
  });

  it('por encuestador: color estable por nombre y "Otros" a partir del noveno', () => {
    const puntos = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 10 - i }, () =>
        punto({ encuestador_id: `e${i}`, encuestador: { nombre: `Encuestador ${String.fromCharCode(74 - i)}` } }),
      ),
    ).flat();
    const { colorDe, leyenda } = colorPorEncuestador(puntos);
    expect(leyenda).toHaveLength(8);
    expect(leyenda.at(-1)).toMatchObject({ etiqueta: 'Otros (3)', n: 6, color: '#898781' });
    expect(new Set(leyenda.slice(0, 7).map((l) => l.color)).size).toBe(7);
    // Los nombres van en orden alfabético y conservan su color si cambia el ranking.
    expect(leyenda.slice(0, 7).map((l) => l.etiqueta)).toEqual([...leyenda.slice(0, 7).map((l) => l.etiqueta)].sort());
    expect(colorDe(punto({ encuestador_id: 'e9' }))).toBe('#898781');
  });

  it('con 8 o menos encuestadores no hay "Otros"', () => {
    const { leyenda } = colorPorEncuestador([punto(), punto({ encuestador_id: 'b', encuestador: { nombre: 'Beto' } })]);
    expect(leyenda.map((l) => l.etiqueta)).toEqual(['Ana', 'Beto']);
  });
});

describe('periodo', () => {
  const zona = 'America/Mazatlan';
  const ahora = new Date('2026-11-13T20:00:00Z');

  it('calcula desde qué día mostrar', () => {
    expect(desdeDelPeriodo('todo', zona, ahora)).toBeNull();
    expect(desdeDelPeriodo('hoy', zona, ahora)).toBe('2026-11-13');
    expect(desdeDelPeriodo('ayer', zona, ahora)).toBe('2026-11-12');
    expect(desdeDelPeriodo('7dias', zona, ahora)).toBe('2026-11-07');
  });

  it('filtra por día local de la encuesta', () => {
    const puntos = [
      punto({ terminada_en: '2026-11-13T18:00:00Z' }),
      // 05:00 UTC del 13 es todavía el 12 en Mazatlán (UTC-7).
      punto({ terminada_en: '2026-11-13T05:00:00Z' }),
      punto({ terminada_en: '2026-11-01T18:00:00Z' }),
    ];
    expect(filtrarPorPeriodo(puntos, 'hoy', zona, ahora)).toHaveLength(1);
    expect(filtrarPorPeriodo(puntos, 'ayer', zona, ahora)).toHaveLength(1);
    expect(filtrarPorPeriodo(puntos, '7dias', zona, ahora)).toHaveLength(2);
    expect(filtrarPorPeriodo(puntos, 'todo', zona, ahora)).toHaveLength(3);
  });
});
