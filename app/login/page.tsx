'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarcoAcceso } from '@/components/marca';
import { inicioDe, useSesion } from '@/components/sesion';
import { Aviso, Boton, Campo, Entrada } from '@/components/ui';
import { configuracionLista, supabase } from '@/lib/supabase';

export default function Acceso() {
  const { cargando, identidad, entrar } = useSesion();
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [faltaInstalar, setFaltaInstalar] = useState(false);

  // Quien ya tiene sesión no necesita esta pantalla.
  useEffect(() => {
    if (!cargando && identidad?.activo) router.replace(inicioDe(identidad.rol));
  }, [cargando, identidad, router]);

  // Si todavía no existe un administrador, se ofrece la configuración inicial.
  useEffect(() => {
    if (!configuracionLista()) return;
    let vivo = true;
    supabase()
      .rpc('requiere_instalacion')
      .then(({ data }) => {
        if (vivo && data === true) setFaltaInstalar(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const resultado = await entrar(correo, password);
    setEnviando(false);
    if (resultado.error) {
      setError(resultado.error);
    } else if (resultado.identidad) {
      // Next conserva en memoria las pantallas visitadas: la contraseña no se queda ahí.
      setPassword('');
      router.replace(inicioDe(resultado.identidad.rol));
    }
  }

  if (!configuracionLista()) {
    return (
      <MarcoAcceso titulo="Falta configurar la app">
        <Aviso tono="aviso">
          No están definidas las variables <code>NEXT_PUBLIC_SUPABASE_URL</code> y{' '}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Revisa el archivo README.
        </Aviso>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso titulo="Iniciar sesión" subtitulo="Entra con la cuenta que te dio tu coordinador.">
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {faltaInstalar && (
          <Aviso tono="marca" titulo="Primera vez">
            Todavía no hay un administrador.{' '}
            <Link href="/instalar" className="font-semibold underline underline-offset-2">
              Configurar la app
            </Link>
          </Aviso>
        )}
        <Campo etiqueta="Correo">
          {(p) => (
            <Entrada
              {...p}
              type="email"
              name="correo"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Contraseña">
          {(p) => (
            <Entrada
              {...p}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Campo>
        {error && <Aviso tono="grave">{error}</Aviso>}
        <Boton type="submit" tamano="grande" ancho cargando={enviando} disabled={!correo || !password}>
          Entrar
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
