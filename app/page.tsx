'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { inicioDe, useSesion } from '@/components/sesion';
import { PantallaCargando } from '@/components/ui';

/** Portada: manda a cada quien a su apartado, o al acceso si no hay sesión. */
export default function Portada() {
  const { cargando, identidad } = useSesion();
  const router = useRouter();

  useEffect(() => {
    if (cargando) return;
    router.replace(identidad?.activo ? inicioDe(identidad.rol) : '/login');
  }, [cargando, identidad, router]);

  return <PantallaCargando />;
}
