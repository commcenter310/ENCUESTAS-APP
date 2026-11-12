import { describe, expect, it } from 'vitest';
import guasave from '../../encuestas/guasave-ims.json';
import { clavesCerradas, columnasDeRespuestas } from './columnas';
import {
  aplicarDerivadas,
  cumple,
  esVisible,
  filasDe,
  limpiarRespuestas,
  motivoParaTerminar,
  opcionesDe,
  personasDe,
  preguntasVisibles,
  siguienteVersion,
  todasLasPreguntas,
  validarPregunta,
} from './motor';
import { resolverOpciones, rotar } from './opciones';
import { promedioDeEscala, resumirConteo } from './reportes';
import { revisarDefinicion } from './revisar';
import type { DefinicionEncuesta, Opcion, Pregunta, PreguntaAtributos, PreguntaUnica, Respuestas } from './tipos';

const def = guasave as unknown as DefinicionEncuesta;

function pregunta<T extends Pregunta = Pregunta>(id: string): T {
  const encontrada = todasLasPreguntas(def).find((x) => x.pregunta.id === id);
  if (!encontrada) throw new Error(`No existe la pregunta ${id}`);
  return encontrada.pregunta as T;
}

/** Responde una pregunta con la primera opción válida de cada cosa. */
function responder(p: Pregunta, version: string, r: Respuestas): void {
  switch (p.tipo) {
    case 'unica': {
      if (p.derivarDe) return;
      const opcion = opcionesDe(def, p, version, r)[0];
      r[p.id] = opcion.valor;
      if (opcion.especificar) r[`${p.id}_otro`] = 'texto';
      return;
    }
    case 'abierta':
      r[p.id] = 'respuesta de prueba';
      return;
    case 'numero':
      r[p.id] = Math.max(p.min ?? 1, 35);
      return;
    case 'escala':
      r[p.id] = p.max;
      return;
    case 'matriz':
      for (const f of filasDe(def, p, version)) r[`${p.id}.${f.valor}`] = p.columnas[0].valor;
      return;
    case 'conocimiento':
      filasDe(def, p, version).forEach((f, i) => {
        const conoce = i % 2 === 0;
        r[`${p.id}.${f.valor}.conoce`] = conoce ? 'si' : 'no';
        if (conoce) r[`${p.id}.${f.valor}.opinion`] = p.opinion[0].valor;
      });
      return;
    case 'atributos': {
      const persona = personasDe(def, p, version, r)[0];
      for (const a of p.atributos) r[`${p.id}.${a.valor}`] = persona.valor;
      return;
    }
    case 'grupo':
      for (const c of p.campos) {
        if (esVisible(def, c, version, r)) responder(c, version, r);
      }
      return;
  }
}

describe('definición de Guasave', () => {
  it('tiene la forma correcta', () => {
    expect(revisarDefinicion(def)).toEqual([]);
  });

  it('incluye todas las preguntas del cuestionario en papel', () => {
    const ids = todasLasPreguntas(def).map((x) => x.pregunta.id);
    const esperadas = [
      'F1',
      'F2',
      'F3',
      ...Array.from({ length: 21 }, (_, i) => `P${i + 1}`),
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'DOM',
    ];
    expect(ids).toEqual(esperadas);
  });

  it('no repite claves de respuesta', () => {
    const claves = columnasDeRespuestas(def).map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves).toContain('seccion');
    expect(claves).toContain('P17.cecilia_ramirez.opinion');
    expect(claves).toContain('P21.campo');
  });

  it('lista 13 personas y 10 aspirantes más Ninguno y NS/NC', () => {
    expect(resolverOpciones(def, { lista: 'personas' })).toHaveLength(13);
    const aspirantes = resolverOpciones(def, { lista: 'aspirantes_morena' });
    expect(aspirantes.filter((o) => !o.fija)).toHaveLength(10);
    expect(aspirantes.filter((o) => o.fija).map((o) => o.valor)).toEqual(['ninguno', 'nsnc']);
  });
});

describe('rotación', () => {
  const opciones: Opcion[] = [
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((v) => ({ valor: v, etiqueta: v })),
    { valor: 'otro', etiqueta: 'Otro', fija: true },
    { valor: 'nsnc', etiqueta: 'NS/NC', fija: true },
  ];
  const versiones = ['A', 'B', 'C'];
  const valores = (v: string) => rotar(opciones, versiones, v).map((o) => o.valor);

  it('la versión A conserva el orden original', () => {
    expect(valores('A')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'otro', 'nsnc']);
  });

  it('B y C empiezan en otro punto y dejan las fijas al final', () => {
    expect(valores('B')).toEqual(['c', 'd', 'e', 'f', 'g', 'a', 'b', 'otro', 'nsnc']);
    expect(valores('C')).toEqual(['f', 'g', 'a', 'b', 'c', 'd', 'e', 'otro', 'nsnc']);
  });

  it('cada versión empieza con una opción distinta y no pierde ninguna', () => {
    const primeras = versiones.map((v) => valores(v)[0]);
    expect(new Set(primeras).size).toBe(3);
    for (const v of versiones) expect([...valores(v)].sort()).toEqual([...valores('A')].sort());
  });

  it('rota partidos y personas del cuestionario real', () => {
    const p12 = pregunta<PreguntaUnica>('P12');
    expect(opcionesDe(def, p12, 'A')[0].valor).toBe('pri');
    expect(opcionesDe(def, p12, 'B')[0].valor).not.toBe('pri');
    expect(
      opcionesDe(def, p12, 'C')
        .slice(-2)
        .map((o) => o.valor),
    ).toEqual(['ninguno', 'nsnc']);
    const p20 = pregunta<Extract<Pregunta, { tipo: 'matriz' }>>('P20');
    expect(filasDe(def, p20, 'A')[0].valor).toBe('cecilia_ramirez');
    expect(filasDe(def, p20, 'B')[0].valor).not.toBe('cecilia_ramirez');
    expect(filasDe(def, p20, 'B')).toHaveLength(13);
  });

  it('reparte las versiones de forma pareja', () => {
    expect([0, 1, 2, 3, 4].map((n) => siguienteVersion(def, n))).toEqual(['A', 'B', 'C', 'A', 'B']);
  });
});

describe('lógica del cuestionario', () => {
  it('termina la entrevista con los filtros de elegibilidad', () => {
    expect(motivoParaTerminar(pregunta('F1'), { F1: 'no' })).toMatch(/Guasave/);
    expect(motivoParaTerminar(pregunta('F1'), { F1: 'si' })).toBeNull();
    expect(motivoParaTerminar(pregunta('F2'), { F2: 'no' })).toMatch(/credencial/);
    expect(motivoParaTerminar(pregunta('F3'), { F3: 17 })).toMatch(/18/);
    expect(motivoParaTerminar(pregunta('F3'), { F3: 18 })).toBeNull();
  });

  it('evalúa condiciones', () => {
    expect(cumple({ pregunta: 'x', es: ['a', 'b'] }, { x: 'b' })).toBe(true);
    expect(cumple({ pregunta: 'x', noEs: 'a' }, { x: 'b' })).toBe(true);
    expect(cumple({ pregunta: 'x', noEs: 'a' }, {})).toBe(false);
    expect(
      cumple(
        {
          todas: [
            { pregunta: 'x', es: 'a' },
            { pregunta: 'y', mayorQue: 3 },
          ],
        },
        { x: 'a', y: 4 },
      ),
    ).toBe(true);
    expect(
      cumple(
        {
          alguna: [
            { pregunta: 'x', es: 'a' },
            { pregunta: 'y', es: 1 },
          ],
        },
        { x: 'z' },
      ),
    ).toBe(false);
  });

  it('calcula el grupo de edad a partir de la edad', () => {
    expect(aplicarDerivadas(def, { F3: 18 }).S1).toBe('18_24');
    expect(aplicarDerivadas(def, { F3: 34 }).S1).toBe('25_34');
    expect(aplicarDerivadas(def, { F3: 35 }).S1).toBe('35_44');
    expect(aplicarDerivadas(def, { F3: 64 }).S1).toBe('55_64');
    expect(aplicarDerivadas(def, { F3: 65 }).S1).toBe('65_mas');
    expect(aplicarDerivadas(def, { F3: 90 }).S1).toBe('65_mas');
  });

  it('no pregunta S1 porque se calcula sola', () => {
    const visibles = preguntasVisibles(def, 'A', { F3: 40 }).map((x) => x.pregunta.id);
    expect(visibles).not.toContain('S1');
    expect(visibles).toContain('S2');
  });

  it('en la 19 quita a la persona elegida en la 18, pero no Ninguno ni NS/NC', () => {
    const p19 = pregunta<PreguntaUnica>('P19');
    const con = opcionesDe(def, p19, 'A', { P18: 'martin_ahumada' }).map((o) => o.valor);
    expect(con).not.toContain('martin_ahumada');
    expect(con).toHaveLength(11);
    const ninguno = opcionesDe(def, p19, 'A', { P18: 'ninguno' }).map((o) => o.valor);
    expect(ninguno).toContain('ninguno');
    expect(ninguno).toHaveLength(12);
  });

  it('en la 21 solo ofrece a las personas que conoce', () => {
    const p21 = pregunta<PreguntaAtributos>('P21');
    const r: Respuestas = {
      'P17.cecilia_ramirez.conoce': 'si',
      'P17.martin_ahumada.conoce': 'no',
      'P17.dolores_franco.conoce': 'si',
    };
    expect(personasDe(def, p21, 'A', r).map((o) => o.valor)).toEqual(['cecilia_ramirez', 'dolores_franco']);
    expect(esVisible(def, p21, 'A', r)).toBe(true);
    expect(esVisible(def, p21, 'A', { 'P17.cecilia_ramirez.conoce': 'no' })).toBe(false);
  });
});

describe('validación', () => {
  it('opción única con "Otro" exige el texto', () => {
    const p1 = pregunta('P1');
    expect(validarPregunta(def, p1, 'A', {})).toBe('Selecciona una opción.');
    expect(validarPregunta(def, p1, 'A', { P1: 'inseguridad' })).toBeNull();
    expect(validarPregunta(def, p1, 'A', { P1: 'otro' })).toBe('Anota cuál.');
    expect(validarPregunta(def, p1, 'A', { P1: 'otro', P1_otro: '  ' })).toBe('Anota cuál.');
    expect(validarPregunta(def, p1, 'A', { P1: 'otro', P1_otro: 'Basura' })).toBeNull();
    expect(validarPregunta(def, p1, 'A', { P1: 'inventada' })).toMatch(/lista/);
  });

  it('número respeta mínimo y máximo', () => {
    const f3 = pregunta('F3');
    expect(validarPregunta(def, f3, 'A', {})).toBe('Anota un número.');
    expect(validarPregunta(def, f3, 'A', { F3: 0 })).toMatch(/mínimo/);
    expect(validarPregunta(def, f3, 'A', { F3: 121 })).toMatch(/máximo/);
    expect(validarPregunta(def, f3, 'A', { F3: 45.5 })).toMatch(/entero/);
    expect(validarPregunta(def, f3, 'A', { F3: 45 })).toBeNull();
  });

  it('escala acepta 1 a 10 o NS/NC', () => {
    const p7 = pregunta('P7');
    expect(validarPregunta(def, p7, 'A', {})).not.toBeNull();
    expect(validarPregunta(def, p7, 'A', { P7: 0 })).not.toBeNull();
    expect(validarPregunta(def, p7, 'A', { P7: 11 })).not.toBeNull();
    expect(validarPregunta(def, p7, 'A', { P7: 10 })).toBeNull();
    expect(validarPregunta(def, p7, 'A', { P7: 'nsnc' })).toBeNull();
  });

  it('matriz exige todas las filas', () => {
    const p6 = pregunta('P6');
    expect(validarPregunta(def, p6, 'A', { 'P6.sheinbaum': 'aprueba' })).toMatch(/Falta responder/);
    expect(
      validarPregunta(def, p6, 'A', {
        'P6.sheinbaum': 'aprueba',
        'P6.dominguez': 'nsnc',
        'P6.ramirez': 'desaprueba',
      }),
    ).toBeNull();
  });

  it('conocimiento exige opinión solo de quien conoce', () => {
    const p17 = pregunta<Extract<Pregunta, { tipo: 'conocimiento' }>>('P17');
    const r: Respuestas = {};
    for (const f of filasDe(def, p17, 'A')) r[`P17.${f.valor}.conoce`] = 'no';
    expect(validarPregunta(def, p17, 'A', r)).toBeNull();
    r['P17.cecilia_rojo.conoce'] = 'si';
    expect(validarPregunta(def, p17, 'A', r)).toMatch(/opinión sobre Cecilia Rojo/);
    r['P17.cecilia_rojo.opinion'] = 'neutra';
    expect(validarPregunta(def, p17, 'A', r)).toBeNull();
  });

  it('atributos solo acepta personas conocidas o Ninguna', () => {
    const p21 = pregunta<PreguntaAtributos>('P21');
    const r: Respuestas = { 'P17.cecilia_rojo.conoce': 'si' };
    for (const a of p21.atributos) r[`P21.${a.valor}`] = 'cecilia_rojo';
    expect(validarPregunta(def, p21, 'A', r)).toBeNull();
    r['P21.campo'] = 'ninguna';
    expect(validarPregunta(def, p21, 'A', r)).toBeNull();
    r['P21.campo'] = 'martin_ahumada';
    expect(validarPregunta(def, p21, 'A', r)).toMatch(/Revisa/);
    delete r['P21.campo'];
    expect(validarPregunta(def, p21, 'A', r)).toMatch(/Falta responder/);
  });

  it('domicilio pide la localidad solo en zona rural', () => {
    const dom = pregunta('DOM');
    expect(validarPregunta(def, dom, 'A', { DOM_tipo: 'ciudad', DOM_calle: 'Zaragoza' })).toBeNull();
    expect(validarPregunta(def, dom, 'A', { DOM_tipo: 'rural', DOM_calle: 'Conocido' })).toMatch(/Sindicatura/);
    expect(
      validarPregunta(def, dom, 'A', { DOM_tipo: 'rural', DOM_calle: 'Conocido', DOM_localidad: 'Juan José Ríos' }),
    ).toBeNull();
  });
});

describe('limpieza de respuestas', () => {
  it('quita lo que ya no aplica y calcula derivadas', () => {
    const limpias = limpiarRespuestas(def, 'A', {
      seccion: 1450,
      F3: 30,
      P1: 'inseguridad',
      P1_otro: 'ya no aplica',
      P2: '  baches  ',
      'P17.cecilia_ramirez.conoce': 'no',
      'P17.cecilia_ramirez.opinion': 'positiva',
      'P17.martin_ahumada.conoce': 'si',
      'P17.martin_ahumada.opinion': 'negativa',
      P18: 'martin_ahumada',
      P19: 'martin_ahumada',
      'P21.honesto': 'cecilia_ramirez',
      'P21.campo': 'martin_ahumada',
      DOM_tipo: 'ciudad',
      DOM_localidad: 'no aplica en ciudad',
      inventada: 'x',
    });
    expect(limpias).toEqual({
      seccion: 1450,
      F3: 30,
      S1: '25_34',
      P1: 'inseguridad',
      P2: 'baches',
      'P17.cecilia_ramirez.conoce': 'no',
      'P17.martin_ahumada.conoce': 'si',
      'P17.martin_ahumada.opinion': 'negativa',
      P18: 'martin_ahumada',
      'P21.campo': 'martin_ahumada',
      DOM_tipo: 'ciudad',
    });
  });
});

describe('entrevista completa simulada', () => {
  for (const version of def.versiones) {
    it(`versión ${version}: todas las preguntas se pueden responder y validar`, () => {
      const r: Respuestas = { seccion: 1450 };
      let pasos = 0;
      // Recorre igual que la pantalla de captura: responde la siguiente
      // pregunta visible hasta que no quede ninguna pendiente.
      for (;;) {
        const pendiente = preguntasVisibles(def, version, aplicarDerivadas(def, r)).find(
          ({ pregunta: p }) => validarPregunta(def, p, version, aplicarDerivadas(def, r)) !== null,
        );
        if (!pendiente) break;
        responder(pendiente.pregunta, version, r);
        expect(motivoParaTerminar(pendiente.pregunta, r)).toBeNull();
        expect(validarPregunta(def, pendiente.pregunta, version, aplicarDerivadas(def, r))).toBeNull();
        if (++pasos > 100) throw new Error('El cuestionario no termina');
      }
      const limpias = limpiarRespuestas(def, version, r);
      expect(limpias.S1).toBe('35_44');
      expect(Object.keys(limpias).length).toBeGreaterThan(60);
      // Nada de lo capturado se pierde al limpiar.
      for (const clave of Object.keys(r)) expect(limpias).toHaveProperty([clave]);
    });
  }
});

describe('reportes', () => {
  it('calcula porcentajes con y sin NS/NC', () => {
    const opciones: Opcion[] = [
      { valor: 'aprueba', etiqueta: 'Aprueba' },
      { valor: 'desaprueba', etiqueta: 'Desaprueba' },
      { valor: 'nsnc', etiqueta: 'NS/NC', nsnc: true },
    ];
    const { filas, base, baseSinNsnc } = resumirConteo(opciones, { aprueba: 60, desaprueba: 20, nsnc: 20 });
    expect(base).toBe(100);
    expect(baseSinNsnc).toBe(80);
    expect(filas[0]).toMatchObject({ n: 60, pct: 60, pctSinNsnc: 75 });
    expect(filas[1]).toMatchObject({ n: 20, pct: 20, pctSinNsnc: 25 });
    expect(filas[2]).toMatchObject({ n: 20, pct: 20, pctSinNsnc: null, nsnc: true });
  });

  it('no divide entre cero y conserva valores fuera de lista', () => {
    expect(resumirConteo([{ valor: 'a', etiqueta: 'A' }]).filas[0]).toMatchObject({ n: 0, pct: 0 });
    const { filas } = resumirConteo([{ valor: 'a', etiqueta: 'A' }], { a: 1, raro: 3 });
    expect(filas.map((f) => f.valor)).toEqual(['a', 'raro']);
    expect(filas[1].pct).toBe(75);
  });

  it('promedia una escala ignorando NS/NC', () => {
    expect(promedioDeEscala({ '10': 2, '5': 2, nsnc: 6 })).toEqual({ promedio: 7.5, n: 4 });
    expect(promedioDeEscala({ nsnc: 3 })).toEqual({ promedio: null, n: 0 });
  });

  it('las claves cerradas excluyen texto libre', () => {
    const claves = clavesCerradas(def);
    expect(claves).toContain('P12');
    expect(claves).toContain('P7');
    expect(claves).toContain('P20.dolores_franco');
    expect(claves).not.toContain('P2');
    expect(claves).not.toContain('P16');
    expect(claves).not.toContain('P1_otro');
    expect(claves).not.toContain('DOM_calle');
  });
});

describe('revisión de definiciones importadas', () => {
  it('rechaza contenido que no es una encuesta', () => {
    expect(revisarDefinicion(null)).toHaveLength(1);
    expect(revisarDefinicion([])).toHaveLength(1);
    expect(revisarDefinicion({}).length).toBeGreaterThan(2);
  });

  it('detecta ids repetidos, tipos desconocidos y listas inexistentes', () => {
    const mala = {
      formato: 1,
      versiones: ['A'],
      introduccion: { texto: 'Hola' },
      cierre: { texto: 'Gracias', declaracion: 'Declaro' },
      secciones: [
        {
          id: 's',
          titulo: 'S',
          preguntas: [
            { id: 'a', tipo: 'abierta', texto: 'A' },
            { id: 'a', tipo: 'abierta', texto: 'A otra vez' },
            { id: 'b', tipo: 'magia', texto: 'B' },
            { id: 'c', tipo: 'unica', texto: 'C', opciones: { lista: 'no_existe' } },
          ],
        },
      ],
    };
    const errores = revisarDefinicion(mala).join(' | ');
    expect(errores).toMatch(/a: el id está repetido/);
    expect(errores).toMatch(/b: tipo desconocido/);
    expect(errores).toMatch(/no_existe/);
  });
});
