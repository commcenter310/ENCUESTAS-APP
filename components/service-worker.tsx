'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Registra el service worker (public/sw.js), que guarda el apartado del
 * encuestador en el dispositivo para que abra aunque no haya señal.
 * Solo en producción: en desarrollo estorbaría con la recarga en caliente.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}

function suscribir(avisar: () => void) {
  window.addEventListener('online', avisar);
  window.addEventListener('offline', avisar);
  return () => {
    window.removeEventListener('online', avisar);
    window.removeEventListener('offline', avisar);
  };
}

/** ¿El dispositivo dice tener conexión? (Puede decir que sí con mala señal.) */
export function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  );
}
