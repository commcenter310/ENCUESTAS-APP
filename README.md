# Encuestas

App web para levantar encuestas en campo y monitorearlas.

- **Encuestador** (`/encuestador`): captura en celular, una pregunta por pantalla, rotación de versiones (A/B/C), GPS y tiempos automáticos. Funciona sin conexión: las entrevistas se guardan en el teléfono y se envían solas al volver la señal.
- **Administrador** (`/admin`): tablero de avance (meta, por día, por encuestador, por sección, alertas), resultados por pregunta con y sin NS/NC, revisión de entrevistas (validar/anular), usuarios, encuestas y exportación a Excel (CSV).

Hecha con Next.js (Vercel) y Supabase (base de datos, cuentas y una Edge Function).

## Cómo está armada

| Carpeta | Qué hay |
|---|---|
| `app/` | Pantallas: `login`, `instalar`, `encuestador`, `admin/*` |
| `components/` | Piezas de interfaz (`campo/` captura, `admin/` panel) |
| `lib/encuesta/` | Motor de encuestas: formato (`tipos.ts`), lógica (`motor.ts`) y pruebas |
| `lib/campo.ts` | Borrador, cola sin conexión y sincronización |
| `encuestas/` | Cuestionarios en JSON (ej. `guasave-ims.json`) |
| `supabase/migrations/` | Tablas, seguridad (RLS) y funciones de monitoreo |
| `supabase/functions/usuarios/` | Alta y administración de cuentas (usa la llave secreta, que nunca sale de Supabase) |
| `public/sw.js` | Service worker: abre el apartado del encuestador sin señal |
| `pruebas/` | Prueba de punta a punta con navegador |

**Seguridad:** el navegador usa solo la llave pública. Todo permiso lo deciden las políticas RLS de la base (ver comentarios en la migración inicial). Las cuentas nacen inactivas; solo un administrador las activa.

## Variables

Ver `.env.example`. En Vercel se configuran las mismas dos variables.

## Desarrollo local

```bash
npm install
npm run db:start     # Supabase local (requiere Docker)
npm run db:reset     # aplica migraciones; código de instalación local: instalacion-local
npx supabase functions serve
npm run dev
```

Pruebas:

```bash
npm test             # motor de encuestas
npm run build && npm run start   # en otra terminal
npm run e2e          # recorrido completo en navegador (solo en local, con base recién reiniciada)
```

## Muestra por sección

Cada encuesta puede tener una **muestra**: las secciones que se levantan, su distrito local y federal, y el tope de entrevistas de cada una (panel → **Muestra → Cargar muestra**).

- Acepta Excel (.xlsx) o CSV. Toma todas las hojas que tengan una columna de sección y una de entrevistas (p. ej. "Grandes" y "Aleatorias"); las hojas que solo traen sección y distritos (p. ej. "Zona de aplicación") se usan para completar distritos. Si aun así falta el distrito federal o local, se indica uno para todas al cargar.
- Columnas reconocidas: SECCIÓN, DTTO/DISTRITO LOCAL, DTTO/DISTRITO FEDERAL, ENTREVISTAS (o ENTREVISTAS A LEVANTAR, CUOTA, META), y opcionales ESTRATO, LISTA NOMINAL, FACTOR DE PONDERACIÓN, REEMPLAZO. Hay una plantilla CSV descargable.
- En campo, con muestra cargada: solo se aceptan secciones de la muestra; la de reemplazo se acepta con aviso y cuenta para su titular; una sección que llegó a su tope no deja iniciar entrevistas. El conteo es de todo el equipo, según la última vez que el teléfono tuvo señal, así que sin conexión puede haber algún excedente: el panel lo marca.
- Los distritos se llenan solos en las preguntas indicadas en `monitoreo.autollenar` de la definición.

## Tipo de encuesta

Al crear una encuesta se elige si es de **rigor científico** o de **posicionamiento** (columna `encuestas.tipo`).

## Agregar otra encuesta

En el panel: **Encuestas → Nueva encuesta**, elige el tipo y pega el JSON del cuestionario (formato documentado en `lib/encuesta/tipos.ts`; ejemplo completo en `encuestas/guasave-ims.json`). Nace como borrador; actívala cuando esté lista.

## Primer administrador

La pantalla `/instalar` crea al primer administrador con un código de un solo uso guardado (como hash) en `privado.instalacion`. Deja de funcionar en cuanto existe un administrador.
