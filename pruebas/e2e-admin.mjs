/**
 * Segunda parte de la prueba de punta a punta: el panel del administrador.
 * La llama pruebas/e2e.mjs cuando ya existen entrevistas levantadas.
 */
import { readFileSync } from 'node:fs';

export async function probarPanel({ admin, campo, ok, afirmar, captura, BASE, ENCUESTADOR }) {
  // Next conserva ocultas las pantallas anteriores: solo cuenta lo visible.
  const texto = (t) => admin.getByText(t).filter({ visible: true }).first();
  const ir = async (nombre) => {
    await admin.getByRole('link', { name: nombre, exact: true }).click();
    await admin.getByRole('heading', { name: nombre, level: 1 }).waitFor();
  };

  // ===== 4. Tablero ============================================================
  console.log('\n4. Tablero del administrador');
  await ir('Tablero');
  const efectivas = admin.getByRole('group', { name: 'Entrevistas efectivas', exact: true });
  // Al volver al tablero se ven un instante los datos anteriores y luego se actualizan.
  await efectivas.getByText('998 por levantar').waitFor({ timeout: 15000 });
  afirmar(
    /^Entrevistas efectivas 2 ?de 1,000/.test((await efectivas.innerText()).replace(/\s+/g, ' ')),
    'cuenta 2 entrevistas efectivas contra la meta de 1,000',
  );
  const fila = admin.getByRole('row').filter({ hasText: ENCUESTADOR.nombre });
  await fila.waitFor();
  const celdas = await fila.getByRole('cell').allInnerTexts();
  afirmar(celdas[1] === '2' && celdas[6] === '1', 'la tabla de encuestadores muestra 2 efectivas y 1 no elegible');
  afirmar(Number(celdas[4]) === 2, 'marca como muy cortas las entrevistas de menos de 5 minutos');
  await texto('1 / 10').waitFor();
  ok('muestra el avance por sección contra la meta de 10');
  await admin.getByRole('img', { name: /: 2 entrevistas$/ }).waitFor();
  ok('la gráfica por día tiene el total de hoy');
  await admin.getByRole('button', { name: 'Ver tabla' }).click();
  await admin.getByRole('columnheader', { name: 'Día' }).waitFor();
  ok('la gráfica tiene vista de tabla');
  await admin.getByRole('button', { name: 'Ver gráfica' }).click();
  await captura(admin, '09-tablero');

  // ===== 5. Resultados =========================================================
  console.log('\n5. Resultados');
  await ir('Resultados');
  await texto('2 entrevistas efectivas').waitFor();
  const p12 = admin.getByRole('group', { name: /por cuál partido votaría/ });
  await p12.getByText('Base: 2 respuestas').waitFor();
  ok('cada pregunta muestra su base');
  const nsnc = p12.getByRole('listitem').filter({ hasText: /^NS\/NC/ });
  afirmar((await nsnc.innerText()).includes('50.0%'), 'P12: NS/NC tiene 50% (una de dos entrevistas)');
  await admin.getByRole('button', { name: 'Sin NS/NC' }).click();
  await p12.getByText('Base: 1 respuestas').waitFor();
  afirmar(
    (await p12.getByRole('listitem').first().innerText()).includes('100.0%'),
    'sin NS/NC el porcentaje se recalcula sobre la base válida',
  );
  await admin.getByRole('button', { name: 'Con NS/NC' }).click();
  const p2 = admin.getByRole('group', { name: /principal problema de su colonia/ });
  await p2.getByRole('button', { name: 'Ver respuestas' }).click();
  await p2.getByText('Respuesta de prueba').waitFor();
  ok('las preguntas abiertas listan las respuestas textuales');
  await admin.getByRole('columnheader', { name: 'Conoce', exact: true }).waitFor();
  ok('la pregunta de conocimiento muestra conoce y opinión por persona');
  await captura(admin, '10-resultados');

  // ===== 6. Entrevistas: revisión y exportación ================================
  console.log('\n6. Entrevistas');
  await ir('Entrevistas');
  await texto('3 con los filtros actuales.').waitFor();
  await admin.getByLabel('Resultado').filter({ visible: true }).selectOption('no_elegible');
  await texto('1 con los filtros actuales.').waitFor();
  ok('filtra por resultado');
  await admin.getByLabel('Resultado').filter({ visible: true }).selectOption('');
  await admin.getByLabel('Solo con alertas').filter({ visible: true }).check();
  await texto('2 con los filtros actuales.').waitFor();
  ok('filtra las entrevistas con alertas');
  await admin.getByLabel('Solo con alertas').filter({ visible: true }).uncheck();
  await texto('3 con los filtros actuales.').waitFor();
  await captura(admin, '11-entrevistas');

  const filaCompleta = admin.getByRole('row').filter({ hasText: 'Completa' }).first();
  await filaCompleta.getByRole('button', { name: 'Ver' }).click();
  const detalle = admin.getByRole('dialog');
  await detalle.getByRole('link', { name: 'Ver en el mapa' }).waitFor();
  await detalle.getByText('Muy corta').waitFor();
  await detalle.getByRole('rowheader', { name: '12', exact: true }).waitFor();
  ok('el detalle muestra ubicación, alerta de duración y respuestas');
  await captura(admin, '12-detalle');
  await detalle.getByLabel('Nota de supervisión (opcional)').fill('Duración imposible: se anula.');
  await detalle.getByRole('button', { name: 'Anular' }).click();
  await detalle.getByText('Anulada').waitFor();
  ok('el administrador anula una entrevista con nota');
  await detalle.getByRole('button', { name: 'Cerrar' }).click();
  await admin.getByRole('row').filter({ hasText: 'Anulada' }).waitFor();

  const [bajada] = await Promise.all([
    admin.waitForEvent('download'),
    admin.getByRole('button', { name: 'Exportar todo a Excel (CSV)' }).click(),
  ]);
  const csv = readFileSync(await bajada.path(), 'utf8');
  const lineas = csv.trim().split('\r\n');
  afirmar(csv.charCodeAt(0) === 0xfeff && lineas.length === 4, 'exporta un CSV con encabezado y las 3 entrevistas');
  afirmar(
    lineas[0].includes('encuestador') &&
      lineas[0].includes('17 Cecilia Ramírez Montoya (conoce)') &&
      csv.includes(ENCUESTADOR.nombre) &&
      csv.includes('Anulada'),
    'el CSV trae una columna por respuesta, el encuestador y la revisión',
  );

  await ir('Tablero');
  const despues = admin.getByRole('group', { name: 'Entrevistas efectivas', exact: true });
  await despues.getByText('999 por levantar').waitFor({ timeout: 15000 });
  afirmar(
    /^Entrevistas efectivas 1 ?de 1,000/.test((await despues.innerText()).replace(/\s+/g, ' ')),
    'la anulada deja de contar en el avance',
  );

  // ===== 7. Usuarios: desactivar corta el acceso ===============================
  console.log('\n7. Control de acceso');
  await ir('Usuarios');
  const filaUsuario = admin.getByRole('row').filter({ hasText: ENCUESTADOR.correo });
  await filaUsuario.getByRole('button', { name: 'Desactivar' }).click();
  await filaUsuario.getByText('Inactivo').waitFor();
  await campo.reload();
  await campo.waitForURL('**/login', { timeout: 15000 });
  ok('al desactivarlo, el encuestador pierde el acceso');
  await campo.getByLabel('Correo').filter({ visible: true }).fill(ENCUESTADOR.correo);
  await campo.getByLabel('Contraseña').filter({ visible: true }).fill(ENCUESTADOR.password);
  await campo.getByRole('button', { name: 'Entrar' }).click();
  await campo.getByText('Tu cuenta está desactivada').filter({ visible: true }).waitFor();
  ok('una cuenta desactivada no puede iniciar sesión');
  await filaUsuario.getByRole('button', { name: 'Activar' }).click();
  await filaUsuario.getByText('Activo', { exact: true }).waitFor();
  await campo.getByRole('button', { name: 'Entrar' }).click();
  await campo.waitForURL('**/encuestador');
  ok('al reactivarlo puede volver a entrar');
  await campo.goto(`${BASE}/admin`);
  await campo.waitForURL('**/encuestador');
  ok('un encuestador no puede abrir el panel del administrador');

  // ===== 8. Encuestas ==========================================================
  console.log('\n8. Encuestas');
  await ir('Encuestas');
  await admin.getByLabel('Estado de Encuesta Municipal Guasave').filter({ visible: true }).selectOption('cerrada');
  await texto('Ya no se inician entrevistas nuevas.').waitFor();
  await campo.getByRole('button', { name: 'Actualizar' }).click();
  await campo.getByText('No hay encuestas activas').filter({ visible: true }).waitFor();
  ok('al cerrar la encuesta, el encuestador ya no puede iniciarla');
  await admin.getByLabel('Estado de Encuesta Municipal Guasave').filter({ visible: true }).selectOption('activa');
  await texto('Los encuestadores pueden levantarla.').waitFor();

  await admin.getByRole('button', { name: 'Nueva encuesta' }).click();
  const formulario = admin.getByRole('dialog');
  await formulario.getByLabel('Título').fill('Encuesta de satisfacción');
  afirmar(
    await formulario.getByRole('button', { name: 'Crear como borrador' }).isDisabled(),
    'no deja crear una encuesta sin indicar su tipo',
  );
  await formulario.getByRole('radio', { name: /Posicionamiento/ }).click();
  await formulario.getByLabel('Cuestionario en formato JSON').fill('{ "formato": 1, "versiones": ["A"] }');
  await formulario.getByRole('button', { name: 'Crear como borrador' }).click();
  await formulario.getByText('Falta "introduccion.texto".').waitFor();
  ok('rechaza un cuestionario incompleto y dice qué le falta');
  await formulario.getByLabel('Cuestionario en formato JSON').fill(
    JSON.stringify({
      formato: 1,
      versiones: ['A'],
      introduccion: { texto: 'Buenos días.' },
      secciones: [
        {
          id: 's1',
          titulo: 'Servicio',
          preguntas: [
            {
              id: 'P1',
              numero: '1',
              tipo: 'unica',
              texto: '¿Cómo califica el servicio?',
              opciones: [
                { valor: 'bueno', etiqueta: 'Bueno' },
                { valor: 'malo', etiqueta: 'Malo' },
              ],
            },
          ],
        },
      ],
      cierre: { texto: 'Gracias.', declaracion: 'Declaro que la información es verídica.' },
    }),
  );
  await formulario.getByRole('button', { name: 'Crear como borrador' }).click();
  await texto('Encuesta creada como borrador.').waitFor();
  await admin.getByRole('heading', { name: 'Encuesta de satisfacción' }).waitFor();
  await admin.getByRole('group', { name: 'Encuesta de satisfacción' }).getByText('Posicionamiento').waitFor();
  await admin.getByRole('group', { name: 'Encuesta Municipal Guasave' }).getByText('Rigor científico').waitFor();
  ok('crea una encuesta nueva con su tipo (posicionamiento); Guasave queda como rigor científico');
  await captura(admin, '13-encuestas');
  const tarjeta = admin.getByRole('group', { name: 'Encuesta de satisfacción' });
  await tarjeta.getByRole('button', { name: 'Borrar' }).click();
  await admin.getByRole('button', { name: 'Sí, borrar' }).click();
  await texto('Encuesta borrada.').waitFor();
  ok('permite borrar una encuesta sin entrevistas');

  // ===== 9. Muestra por sección =================================================
  console.log('\n9. Muestra por sección');
  await admin
    .getByRole('group', { name: 'Encuesta Municipal Guasave' })
    .getByRole('link', { name: 'Cargar muestra' })
    .click();
  await admin.getByRole('heading', { name: 'Muestra', level: 1 }).waitFor();
  await texto('Esta encuesta no tiene muestra cargada').waitFor();
  await admin.getByRole('button', { name: 'Cargar muestra' }).first().click();
  const carga = admin.getByRole('dialog');
  // Archivo sin distrito federal, como el de Guasave: se indica al cargar.
  await carga.getByLabel('Archivo de muestra').setInputFiles({
    name: 'muestra.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'SECCIÓN;DTTO LOCAL;ENTREVISTAS;ESTRATO;REEMPLAZO\n1450;7;1;Grande;\n1451;8;3;Aleatoria;1452\n',
    ),
  });
  await carga.getByText('Falta el distrito federal en 2 secciones').waitFor();
  afirmar(
    await carga.getByRole('button', { name: 'Guardar muestra' }).isDisabled(),
    'no deja guardar la muestra sin distrito federal',
  );
  await carga.getByLabel('Distrito federal para las secciones que no lo traen').fill('4');
  await carga.getByText('2 secciones').waitFor();
  await carga.getByText('DF 4').waitFor();
  await carga.getByRole('button', { name: 'Guardar muestra' }).click();
  await texto('Muestra guardada: 2 secciones, 4 entrevistas.').waitFor();
  ok('carga la muestra desde un archivo y completa el distrito federal');
  const enMuestra = admin.getByRole('group', { name: 'Entrevistas dentro de la muestra' });
  afirmar(
    /1 ?de 4/.test((await enMuestra.innerText()).replace(/\s+/g, ' ')),
    'cuenta las entrevistas ya levantadas contra la muestra',
  );
  await admin.getByRole('row').filter({ hasText: '1450' }).getByText('Completa').waitFor();
  ok('marca como completa la sección que llegó a su tope');
  await captura(admin, '14-muestra');

  await ir('Tablero');
  await texto('Avance de la muestra por sección').waitFor();
  ok('el tablero mide el avance contra el tope de cada sección');

  // ===== 7. Mapa ================================================================
  console.log('\n10. Mapa de entrevistas');
  await ir('Mapa');
  const mapa = admin.getByRole('region', { name: 'Mapa de entrevistas' });
  await mapa.and(admin.locator('[data-listo]')).waitFor();
  const descripcion = await texto(/entrevistas en el mapa/).innerText();
  const enMapa = Number(descripcion.match(/^(\d+)/)?.[1]);
  afirmar(enMapa >= 2, `pone en el mapa las entrevistas con GPS (${enMapa})`);
  // Todas se levantaron en el mismo punto: aparecen agrupadas con su total.
  const grupo = mapa.locator('.grupo-mapa');
  afirmar((await grupo.innerText()).trim() === String(enMapa), 'agrupa los pines cercanos y muestra cuántos son');
  afirmar((await mapa.getByText('OpenStreetMap').count()) > 0, 'muestra la atribución de OpenStreetMap');
  const leyenda = admin.getByRole('list', { name: 'Leyenda' });
  await leyenda.getByText('Pendiente').waitFor();
  await leyenda.getByText('Con alerta').waitFor();
  ok('la leyenda explica los colores y las alertas');
  // Al tocar el grupo se abre (acerca o despliega) hasta poder tocar un pin.
  const pin = mapa.locator('path.pin-mapa').first();
  for (let i = 0; i < 6 && !(await pin.isVisible()); i++) {
    await grupo.first().click();
    await admin.waitForTimeout(700);
  }
  await pin.click({ force: true });
  const globo = mapa.locator('.leaflet-popup');
  await globo.getByText(ENCUESTADOR.nombre).waitFor();
  ok('al tocar un pin se ve quién la levantó');
  await globo.getByRole('button', { name: 'Ver detalle' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Validar' }).waitFor();
  ok('desde el pin se abre el detalle de la entrevista');
  await captura(admin, '16-mapa');
  await admin.keyboard.press('Escape');
  await admin.getByRole('combobox', { name: 'Periodo' }).selectOption('ayer');
  await texto(/^0 entrevistas en el mapa/).waitFor();
  ok('los filtros quitan del mapa lo que no corresponde');
  await admin.getByRole('combobox', { name: 'Periodo' }).selectOption('todo');

  // --- En campo -----------------------------------------------------------------
  await campo.getByRole('button', { name: 'Actualizar' }).click();
  await campo.getByRole('button', { name: 'Nueva entrevista' }).filter({ visible: true }).first().click();
  const seccion = campo.getByRole('textbox', { name: 'Sección electoral' }).filter({ visible: true });
  await seccion.fill('1450');
  await campo.getByText('Tope completo').filter({ visible: true }).waitFor();
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await campo
    .getByText(/ya completó su tope \(1 de 1 entrevistas\)/)
    .filter({ visible: true })
    .waitFor();
  ok('no deja iniciar una entrevista en una sección que ya llegó a su tope');
  await seccion.fill('9999');
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await campo
    .getByText(/no está en la muestra/)
    .filter({ visible: true })
    .first()
    .waitFor();
  ok('rechaza una sección fuera de la muestra');
  await seccion.fill('1452');
  await campo.getByText('Es el reemplazo de la sección 1451').filter({ visible: true }).waitFor();
  await campo.getByText('El equipo lleva').filter({ visible: true }).waitFor();
  ok('acepta la sección de reemplazo con aviso y muestra el avance del equipo');
  await campo.getByRole('button', { name: 'Ver secciones de la muestra' }).click();
  const lista = campo.getByRole('dialog');
  await lista.getByText('0/3').waitFor();
  afirmar(
    (await lista.getByRole('button', { name: /^1450/ }).count()) === 0,
    'la lista de secciones oculta las que ya completaron su tope',
  );
  await lista.getByRole('button', { name: /^1451/ }).click();
  afirmar((await seccion.inputValue()) === '1451', 'elegir de la lista llena la sección');
  await captura(campo, '15-seccion-muestra');
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await campo.getByRole('button', { name: 'Iniciar preguntas' }).waitFor();
  ok('inicia la entrevista en una sección de la muestra con lugar disponible');
}
