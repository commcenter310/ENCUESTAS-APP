import type { Metadata, Viewport } from 'next';
import { ProveedorSesion } from '@/components/sesion';
import { RegistrarServiceWorker } from '@/components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Encuestas', template: '%s · Encuestas' },
  description: 'Levantamiento y monitoreo de encuestas en campo.',
  applicationName: 'Encuestas',
  appleWebApp: { capable: true, title: 'Encuestas', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f9f9f7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className="h-full">
      <body className="min-h-full">
        <ProveedorSesion>{children}</ProveedorSesion>
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
