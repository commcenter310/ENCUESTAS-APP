#!/usr/bin/env node
/**
 * Prueba de punta a punta con un navegador real (Playwright).
 *
 * Recorre la app como lo harían las personas: configuración inicial, alta de
 * un encuestador, entrevistas completas en un "celular" (con y sin conexión),
 * filtros de elegibilidad, y el panel del administrador.
 *
 * Requisitos (todo local, nunca contra producción):
 *   1. npx supabase start && npx supabase db reset     (base de datos limpia)
 *   2. npm run build && npm run start                   (app en el puerto 3000)
 *   3. node pruebas/e2e.mjs
 *
 * Guarda capturas de pantalla en pruebas/capturas/.
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:3000';
const CAPTURAS = new URL('./capturas/', import.meta.url).pathname;
const ADMIN = { nombre: 'Ana Administradora', correo: 'admin@prueba.mx', password: 'clave-segura-1' };
const ENCUESTADOR = { nombre: 'Luis Encuestador', correo: 'luis@prueba.mx', password: 'clave-segura-2' };

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`Esta prueba crea usuarios y entrevistas: solo corre en local, no en ${BASE}.`);
  process.exit(1);
}
mkdirSync(CAPTURAS, { recursive: true });

let pasos = 0;
function ok(mensaje) {
  pasos++;
  console.log(`  ✓ ${mensaje}`);
}
function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(`Falló: ${mensaje}`);
  ok(mensaje);
}
/**
 * Next conserva ocultas (display: none) las últimas pantallas visitadas, así
 * que al buscar por etiqueta o por texto hay que quedarse con lo visible.
 */
const campoDe = (pagina, etiqueta, opciones) => pagina.getByLabel(etiqueta, opciones).filter({ visible: true });
const textoEn = (pagina, texto) => pagina.getByText(texto).filter({ visible: true }).first();

async function captura(pagina, nombre) {
  await pagina.screenshot({ path: `${CAPTURAS}${nombre}.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
// Ayudantes de la entrevista
// ---------------------------------------------------------------------------

/** Texto del encabezado: identifica en qué pantalla está la entrevista. */
async function encabezado(pagina) {
  return (await pagina.locator('header').filter({ visible: true }).first().innerText()).replace(/\s+/g, ' ').trim();
}

/**
 * Responde lo que haya en pantalla: en cada grupo de opciones sin respuesta
 * elige una, y llena los campos de texto vacíos. `elegir` decide qué opción
 * (por defecto la primera); recibe el nombre del grupo y sus opciones.
 */
async function responderPantalla(pagina, elegir = () => 0) {
  for (let vuelta = 0; vuelta < 60; vuelta++) {
    const antes = await encabezado(pagina);
    const grupos = pagina.locator('main [role="radiogroup"]').filter({ visible: true });
    const total = await grupos.count();
    let respondio = false;
    for (let i = 0; i < total; i++) {
      const grupo = grupos.nth(i);
      if ((await grupo.locator('[aria-checked="true"]').count()) > 0) continue;
      const opciones = await grupo.locator('[role="radio"]').allInnerTexts();
      if (opciones.length === 0) continue;
      const nombre = (await grupo.getAttribute('aria-label')) ?? '';
      // "Sin respuesta" es el NS/NC de las escalas: no hace falta si ya hay número.
      if (nombre === 'Sin respuesta') continue;
      await grupo.locator('[role="radio"]').nth(elegir(nombre, opciones)).click();
      respondio = true;
      break; // La pantalla pudo cambiar (avance automático o nuevas opciones).
    }
    if (!respondio) break;
    await pagina.waitForTimeout(320);
    if ((await encabezado(pagina)) !== antes) return true; // avanzó sola
  }
  for (const campo of await pagina.locator('main input:not([type="checkbox"]), main textarea').filter({ visible: true }).all()) {
    if ((await campo.inputValue()) !== '') continue;
    const numerico = (await campo.getAttribute('inputmode')) === 'numeric';
    await campo.fill(numerico ? '35' : 'Respuesta de prueba');
  }
  return false;
}

/** Recorre el cuestionario hasta llegar al cierre o a un fin por filtro. */
async function recorrerCuestionario(pagina, elegir) {
  const vistas = [];
  for (let i = 0; i < 80; i++) {
    if (await pagina.getByRole('button', { name: 'Guardar entrevista' }).isVisible()) return vistas;
    if (await pagina.getByRole('button', { name: 'Registrar y terminar' }).isVisible()) return vistas;
    const antes = await encabezado(pagina);
    vistas.push(antes);
    const avanzoSola = await responderPantalla(pagina, elegir);
    if (!avanzoSola && (await encabezado(pagina)) === antes) {
      await pagina.getByRole('button', { name: /Siguiente|Iniciar preguntas|Comenzar/ }).click();
    }
    await pagina
      .waitForFunction(
        (texto) => {
          const visibles = (selector) => [...document.querySelectorAll(selector)].filter((e) => e.offsetParent !== null);
          const cabecera = visibles('header')[0];
          return cabecera?.innerText.replace(/\s+/g, ' ').trim() !== texto || visibles('main [role="alert"]').length > 0;
        },
        antes,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    const alerta = pagina.locator('main [role="alert"]').filter({ visible: true });
    if ((await alerta.count()) > 0 && (await encabezado(pagina)) === antes) {
      await captura(pagina, 'error-atorado');
      throw new Error(`La entrevista se atoró en "${antes}": ${await alerta.first().innerText()}`);
    }
  }
  throw new Error('El cuestionario no terminó en 80 pantallas');
}

async function iniciarEntrevista(pagina, seccion) {
  await pagina.getByRole('button', { name: 'Nueva entrevista' }).first().click();
  await pagina.getByRole('textbox', { name: 'Sección electoral' }).fill(String(seccion));
  await pagina.getByRole('button', { name: 'Comenzar' }).click();
  await pagina.getByRole('button', { name: 'Iniciar preguntas' }).click();
}

async function guardarEntrevista(pagina) {
  await pagina.getByRole('checkbox').check();
  await pagina.getByRole('button', { name: 'Guardar entrevista' }).click();
  await textoEn(pagina, 'Entrevista guardada.').waitFor({ timeout: 15000 });
}

async function entrar(pagina, usuario) {
  await pagina.goto(`${BASE}/login`);
  await campoDe(pagina, 'Correo').fill(usuario.correo);
  await campoDe(pagina, 'Contraseña').fill(usuario.password);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

const navegador = await chromium.launch();
const errores = [];

/** Candado: si la app compilada apunta a un Supabase en internet, la prueba se detiene. */
async function soloLocal(contexto) {
  await contexto.route(/^https:\/\/[^/]*supabase\.(co|com)\//, (ruta) => {
    errores.push(`La app intentó usar un Supabase en internet (${new URL(ruta.request().url()).host}). Compila con el Supabase local.`);
    return ruta.abort();
  });
}
try {
  // ===== 1. Configuración inicial (escritorio) ================================
  console.log('\n1. Configuración inicial');
  const escritorio = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX' });
  await soloLocal(escritorio);
  const admin = await escritorio.newPage();
  admin.on('pageerror', (e) => errores.push(`admin: ${e.message}`));

  await admin.goto(`${BASE}/`);
  await admin.waitForURL('**/login');
  await admin.waitForTimeout(1500);
  if (errores.length > 0) throw new Error(errores.join('\n'));
  ok('sin sesión, la portada manda a iniciar sesión');
  await admin.getByRole('link', { name: 'Configurar la app' }).click();
  await admin.waitForURL('**/instalar');
  await campoDe(admin, 'Código de instalación').fill('codigo-equivocado');
  await campoDe(admin, 'Tu nombre').fill(ADMIN.nombre);
  await campoDe(admin, 'Correo').fill(ADMIN.correo);
  await campoDe(admin, 'Contraseña', { exact: true }).fill(ADMIN.password);
  await campoDe(admin, 'Repite la contraseña').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Crear administrador' }).click();
  await textoEn(admin, 'El código de instalación no es válido').waitFor();
  ok('rechaza un código de instalación equivocado');
  await campoDe(admin, 'Código de instalación').fill('instalacion-local');
  await admin.getByRole('button', { name: 'Crear administrador' }).click();
  await admin.waitForURL('**/admin');
  ok('crea al administrador y entra al panel');

  if (process.env.E2E_SOLO_CAMPO !== '1') {
    // ===== 2. Alta de un encuestador ============================================
    console.log('\n2. Alta de encuestador');
    await admin.getByRole('link', { name: 'Usuarios' }).click();
    await admin.getByRole('button', { name: 'Nuevo usuario' }).click();
    await campoDe(admin, 'Nombre completo').fill(ENCUESTADOR.nombre);
    await campoDe(admin, 'Correo').fill(ENCUESTADOR.correo);
    await campoDe(admin, 'Contraseña').fill(ENCUESTADOR.password);
    await admin.getByRole('button', { name: 'Crear usuario' }).click();
    await admin.getByRole('cell', { name: ENCUESTADOR.nombre }).waitFor();
    ok('el administrador da de alta a un encuestador');
    await captura(admin, '01-usuarios');
  }

  // ===== 3. Entrevistas en un celular ==========================================
  console.log('\n3. Encuestador en celular');
  const celular = await navegador.newContext({
    ...devices['Pixel 7'],
    locale: 'es-MX',
    geolocation: { latitude: 25.5744, longitude: -108.4706, accuracy: 12 },
    permissions: ['geolocation'],
  });
  await soloLocal(celular);
  const campo = await celular.newPage();
  campo.on('pageerror', (e) => errores.push(`campo: ${e.message}`));

  await entrar(campo, process.env.E2E_SOLO_CAMPO === '1' ? ADMIN : ENCUESTADOR);
  if (process.env.E2E_SOLO_CAMPO === '1') {
    // El administrador también puede levantar entrevistas (sirve para probar).
    await campo.waitForURL('**/admin');
    await campo.goto(`${BASE}/encuestador`);
  }
  await campo.waitForURL('**/encuestador');
  await campo.getByRole('heading', { name: 'Encuesta Municipal Guasave' }).waitFor();
  ok('el encuestador entra y ve la encuesta activa');
  await captura(campo, '02-encuestador-inicio');

  // --- 3a. Entrevista completa -------------------------------------------------
  await campo.getByRole('button', { name: 'Nueva entrevista' }).first().click();
  await textoEn(campo, 'Cuestionario versión A').waitFor();
  await captura(campo, '03-arranque');
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await campo.locator('main [role="alert"]').filter({ visible: true }).waitFor();
  ok('no deja comenzar sin la sección');
  await campo.getByRole('textbox', { name: 'Sección electoral' }).fill('1450');
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await textoEn(campo, `Mi nombre es ${process.env.E2E_SOLO_CAMPO === '1' ? ADMIN.nombre : ENCUESTADOR.nombre}`).waitFor();
  ok('la introducción lleva el nombre del encuestador');
  await captura(campo, '04-introduccion');
  await campo.getByRole('button', { name: 'Iniciar preguntas' }).click();

  let opcionesP19 = null;
  let elegidaP18 = null;
  const vistas = await recorrerCuestionario(campo, (nombre, opciones) => {
    // P1: "Otro" (pide anotar cuál). P18: segunda opción. P19: se revisa la lista.
    if (nombre.startsWith('¿Cuál considera usted que es el principal problema que afecta')) {
      return opciones.findIndex((o) => o.startsWith('Otro'));
    }
    if (nombre.startsWith('De las siguientes personas, ¿quién le gustaría')) {
      elegidaP18 = opciones[1];
      return 1;
    }
    if (nombre === '¿Y en segundo lugar?') opcionesP19 = opciones;
    return 0;
  });
  afirmar(vistas.length >= 28, `recorre las ${vistas.length} pantallas del cuestionario`);
  afirmar(elegidaP18 && opcionesP19 && !opcionesP19.includes(elegidaP18), 'la 19 no ofrece a quien ya se eligió en la 18');
  afirmar(!vistas.some((v) => v.includes('sociodemográficos') && /^S1\b/.test(v)), 'S1 (grupo de edad) no se pregunta: se calcula');
  await captura(campo, '05-cierre');
  await textoEn(campo, 'Ubicación registrada').waitFor({ timeout: 20000 });
  ok('registra la ubicación GPS');
  afirmar(await campo.getByRole('button', { name: 'Guardar entrevista' }).isDisabled(), 'no deja guardar sin aceptar la declaración');
  await guardarEntrevista(campo);
  await textoEn(campo, 'Todo está enviado').waitFor({ timeout: 15000 });
  ok('guarda y envía la entrevista');

  // --- 3b. Persona no elegible -------------------------------------------------
  await campo.getByRole('button', { name: 'Nueva entrevista' }).first().click();
  await textoEn(campo, 'Cuestionario versión B').waitFor();
  ok('la segunda entrevista usa la versión B (rotación)');
  afirmar((await campo.getByRole('textbox', { name: 'Sección electoral' }).inputValue()) === '1450', 'recuerda la sección anterior');
  await textoEn(campo, 'Llevas 1 de 10 entrevistas en sección 1450').waitFor({ timeout: 10000 });
  ok('muestra el avance en la sección');
  await campo.getByRole('button', { name: 'Comenzar' }).click();
  await campo.getByRole('button', { name: 'Iniciar preguntas' }).click();
  await campo.getByRole('radio', { name: 'No', exact: true }).click();
  await textoEn(campo, 'La persona no cumple los requisitos').waitFor();
  await captura(campo, '06-no-elegible');
  await campo.getByRole('button', { name: 'Registrar y terminar' }).click();
  await textoEn(campo, 'Se registró que la persona no cumplía los requisitos.').waitFor();
  ok('el filtro F1 termina la entrevista y la registra como no elegible');

  // --- 3c. Entrevista a medias: se conserva al recargar --------------------------
  await iniciarEntrevista(campo, 1451);
  await campo.getByRole('radio', { name: 'Sí', exact: true }).click(); // F1
  await textoEn(campo, 'credencial para votar').waitFor();
  await campo.getByRole('radio', { name: 'Sí', exact: true }).click(); // F2
  await textoEn(campo, '¿Qué edad tiene usted?').waitFor();
  await campo.reload();
  await textoEn(campo, 'Tienes una entrevista sin terminar').waitFor();
  await campo.getByRole('button', { name: 'Continuar entrevista' }).click();
  await textoEn(campo, '¿Qué edad tiene usted?').waitFor();
  ok('al recargar, la entrevista a medias continúa donde iba');
  await campo.getByRole('textbox', { name: '¿Qué edad tiene usted?' }).fill('17');
  await campo.getByRole('button', { name: 'Siguiente' }).click();
  await textoEn(campo, 'Menor de 18 años').waitFor();
  ok('el filtro F3 detecta a un menor de edad');
  await campo.getByRole('button', { name: 'Corregir' }).click();
  await campo.getByRole('textbox', { name: '¿Qué edad tiene usted?' }).fill('67');
  await campo.getByRole('button', { name: 'Siguiente' }).click();

  // --- 3d. Sin conexión: se guarda en el dispositivo y se envía después ----------
  await celular.setOffline(true);
  await recorrerCuestionario(campo, (_nombre, opciones) => opciones.length - 1);
  await guardarEntrevista(campo);
  await textoEn(campo, '1 entrevista por enviar').waitFor();
  await textoEn(campo, 'Sin conexión').waitFor();
  ok('sin conexión, la entrevista queda guardada en el dispositivo');
  await captura(campo, '07-sin-conexion');
  await celular.setOffline(false);
  await textoEn(campo, 'Todo está enviado').waitFor({ timeout: 20000 });
  ok('al volver la señal se envía sola');

  // --- 3e. Salir y continuar después con el botón "atrás" del teléfono -----------
  await iniciarEntrevista(campo, 1451);
  await campo.goBack();
  await textoEn(campo, 'Tienes una entrevista sin terminar').waitFor();
  ok('el botón atrás del teléfono no pierde la entrevista');
  await campo.getByRole('button', { name: 'Descartar' }).click();
  await campo.getByRole('button', { name: 'Descartarla' }).click();
  await textoEn(campo, 'Tienes una entrevista sin terminar').waitFor({ state: 'detached' });
  ok('se puede descartar una entrevista a medias');
  await captura(campo, '08-encuestador-final');

  if (process.env.E2E_SOLO_CAMPO !== '1') {
    await import('./e2e-admin.mjs').then((m) => m.probarPanel({ admin, campo, celular, ok, afirmar, captura, BASE, ADMIN, ENCUESTADOR }));
  }

  if (errores.length > 0) throw new Error(`Errores de JavaScript en la página:\n${errores.join('\n')}`);
  console.log(`\nTodo bien: ${pasos} comprobaciones.\n`);
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  for (const contexto of navegador.contexts()) {
    for (const [i, pagina] of contexto.pages().entries()) {
      await pagina.screenshot({ path: `${CAPTURAS}fallo-${i}-${Date.now()}.png`, fullPage: true }).catch(() => undefined);
      console.error(`   página abierta: ${pagina.url()}`);
    }
  }
  process.exitCode = 1;
} finally {
  await navegador.close();
}
