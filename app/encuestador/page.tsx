'use client';

import { InicioEncuestador } from '@/components/campo/inicio';
import { useAcceso } from '@/components/sesion';
import { PantallaCargando } from '@/components/ui';

/** Apartado del encuestador. El administrador también puede entrar para probar. */
export default function PaginaEncuestador() {
  const identidad = useAcceso(['encuestador', 'admin']);
  if (!identidad) return <PantallaCargando />;
  return <InicioEncuestador identidad={identidad} />;
}
