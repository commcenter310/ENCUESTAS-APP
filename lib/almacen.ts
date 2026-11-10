/**
 * Almacenamiento local del dispositivo (localStorage) con manejo de errores.
 * Aquí viven la identidad en caché, las encuestas descargadas, la entrevista
 * en curso y la cola de entrevistas pendientes de enviar.
 */
const PREFIJO = 'encuestas:';

type Oyente = () => void;
const oyentes = new Map<string, Set<Oyente>>();

function avisar(clave: string): void {
  oyentes.get(clave)?.forEach((oyente) => oyente());
}

/** Texto tal cual está guardado (o null). Sirve como "foto" estable del valor. */
export function leerCrudo(clave: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREFIJO + clave);
  } catch {
    return null;
  }
}

/** Avisa cuando cambia una clave, en esta pestaña o en otra. */
export function suscribir(clave: string, oyente: Oyente): () => void {
  const grupo = oyentes.get(clave) ?? new Set<Oyente>();
  oyentes.set(clave, grupo);
  grupo.add(oyente);
  const deOtraPestana = (e: StorageEvent) => {
    if (e.key === null || e.key === PREFIJO + clave) oyente();
  };
  window.addEventListener('storage', deOtraPestana);
  return () => {
    grupo.delete(oyente);
    window.removeEventListener('storage', deOtraPestana);
  };
}

export function leer<T>(clave: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const crudo = window.localStorage.getItem(PREFIJO + clave);
    return crudo === null ? null : (JSON.parse(crudo) as T);
  } catch {
    return null;
  }
}

/** Guarda un valor. Devuelve false si el dispositivo no pudo guardarlo. */
export function guardar(clave: string, valor: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    avisar(clave);
    return true;
  } catch {
    return false;
  }
}

export function borrar(clave: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIJO + clave);
    avisar(clave);
  } catch {
    // Sin acceso al almacenamiento no hay nada que borrar.
  }
}

/** Pide al navegador que no borre los datos locales si falta espacio. */
export function pedirPersistencia(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  navigator.storage.persist().catch(() => undefined);
}
