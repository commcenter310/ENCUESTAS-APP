/*
 * Service worker de Encuestas.
 *
 * Objetivo: que el apartado del encuestador abra aunque el teléfono no tenga
 * señal. Guarda la página y todos los archivos que necesita; las entrevistas
 * y la sesión viven aparte, en el almacenamiento del dispositivo.
 *
 * Estrategia
 *  - Páginas de PAGINAS: primero la red (para tener siempre la versión nueva);
 *    si no responde pronto, la copia guardada.
 *  - Una página solo se guarda DESPUÉS de guardar sus archivos, así la copia
 *    guardada siempre puede arrancar completa.
 *  - Archivos con huella (/_next/static/): si están guardados se sirven de ahí.
 *  - Todo lo demás (datos de Supabase, otras páginas) no se toca.
 */
const CACHE_PAGINAS = 'encuestas-paginas-v1';
const CACHE_ARCHIVOS = 'encuestas-archivos-v1';
const PAGINAS = ['/encuestador', '/login', '/'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(
    Promise.all(
      PAGINAS.map((ruta) =>
        fetch(ruta, { credentials: 'same-origin' })
          .then((respuesta) => (respuesta.ok ? guardarPagina(ruta, respuesta) : undefined))
          .catch(() => undefined),
      ),
    ),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((n) => n.startsWith('encuestas-') && n !== CACHE_PAGINAS && n !== CACHE_ARCHIVOS)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Archivos con huella que menciona el HTML de una página. */
function archivosDe(html) {
  const encontrados = new Set();
  const patron = /\/_next\/static\/[A-Za-z0-9_\-.~%/@()[\]]+?\.(?:js|css|woff2?|ttf|png|svg|ico)/g;
  for (const coincidencia of html.match(patron) || []) encontrados.add(coincidencia);
  return [...encontrados];
}

async function guardarPagina(ruta, respuesta) {
  const html = await respuesta.clone().text();
  const archivos = archivosDe(html);
  const cacheArchivos = await caches.open(CACHE_ARCHIVOS);
  await Promise.all(
    archivos.map(async (url) => {
      if (await cacheArchivos.match(url)) return;
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`No se pudo guardar ${url}`);
      await cacheArchivos.put(url, r);
    }),
  );
  const cachePaginas = await caches.open(CACHE_PAGINAS);
  await cachePaginas.put(ruta, respuesta);
  await limpiarArchivos();
}

/** Borra archivos que ya no usa ninguna página guardada (versiones viejas). */
async function limpiarArchivos() {
  const cachePaginas = await caches.open(CACHE_PAGINAS);
  const enUso = new Set();
  for (const peticion of await cachePaginas.keys()) {
    const respuesta = await cachePaginas.match(peticion);
    if (!respuesta) continue;
    for (const url of archivosDe(await respuesta.text())) enUso.add(url);
  }
  const cacheArchivos = await caches.open(CACHE_ARCHIVOS);
  for (const peticion of await cacheArchivos.keys()) {
    if (!enUso.has(new URL(peticion.url).pathname)) await cacheArchivos.delete(peticion);
  }
}

function esperar(ms) {
  return new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('La red tardó demasiado')), ms));
}

async function servirPagina(evento, ruta) {
  const cachePaginas = await caches.open(CACHE_PAGINAS);
  const guardada = await cachePaginas.match(ruta);

  const deRed = fetch(evento.request).then((respuesta) => {
    if (respuesta.ok && !respuesta.redirected) {
      // Se actualiza la copia en segundo plano, sin detener la respuesta.
      evento.waitUntil(guardarPagina(ruta, respuesta.clone()).catch(() => undefined));
    }
    return respuesta;
  });

  if (!guardada) return deRed;
  try {
    return await Promise.race([deRed, esperar(ESPERA_RED_MS)]);
  } catch {
    return guardada;
  }
}

async function servirArchivo(peticion) {
  const cacheArchivos = await caches.open(CACHE_ARCHIVOS);
  return (await cacheArchivos.match(peticion.url)) || fetch(peticion);
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(servirArchivo(peticion));
    return;
  }

  if (peticion.mode === 'navigate') {
    const ruta = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (PAGINAS.includes(ruta)) evento.respondWith(servirPagina(evento, ruta));
  }
});
