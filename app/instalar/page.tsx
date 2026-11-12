'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarcoAcceso } from '@/components/marca';
import { useSesion } from '@/components/sesion';
import { Aviso, Boton, Campo, Cargando, Entrada } from '@/components/ui';
import { configuracionLista, mensajeDeFuncion, supabase } from '@/lib/supabase';

/**
 * Configuración inicial: crea la cuenta del primer administrador.
 * Solo funciona mientras no exista ninguno y con el código de instalación.
 */
export default function Instalar() {
  const { entrar } = useSesion();
  const router = useRouter();
  const [estado, setEstado] = useState<'revisando' | 'disponible' | 'hecha'>('revisando');
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!configuracionLista()) return;
    let vivo = true;
    supabase()
      .rpc('requiere_instalacion')
      .then(({ data, error: e }) => {
        if (vivo) setEstado(!e && data === false ? 'hecha' : 'disponible');
      });
    return () => {
      vivo = false;
    };
  }, []);

  const noCoinciden = confirmar.length > 0 && password !== confirmar;
  const listo =
    codigo.trim() &&
    nombre.trim().length >= 2 &&
    correo.includes('@') &&
    password.length >= 8 &&
    password === confirmar;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const { error: fallo } = await supabase().functions.invoke('usuarios', {
      body: { accion: 'instalar', codigo, nombre, correo, password },
    });
    if (fallo) {
      setError(await mensajeDeFuncion(fallo));
      setEnviando(false);
      return;
    }
    const acceso = await entrar(correo, password);
    setEnviando(false);
    // Next conserva en memoria las pantallas visitadas: los secretos no se quedan ahí.
    setPassword('');
    setConfirmar('');
    setCodigo('');
    if (acceso.error) {
      setError(`La cuenta se creó, pero no se pudo iniciar sesión: ${acceso.error}`);
      setEstado('hecha');
    } else {
      router.replace('/admin');
    }
  }

  if (estado === 'revisando') {
    return (
      <MarcoAcceso titulo="Configuración inicial">
        <Cargando />
      </MarcoAcceso>
    );
  }

  if (estado === 'hecha') {
    return (
      <MarcoAcceso titulo="Configuración inicial">
        <div className="flex flex-col gap-4">
          {error ? (
            <Aviso tono="aviso">{error}</Aviso>
          ) : (
            <Aviso tono="bien">La app ya está configurada y tiene un administrador.</Aviso>
          )}
          <Link href="/login" className="font-semibold text-marca-700 underline underline-offset-2">
            Ir a iniciar sesión
          </Link>
        </div>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso
      titulo="Configuración inicial"
      subtitulo="Crea la cuenta del administrador principal. Después podrás dar de alta a los encuestadores."
    >
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        <Campo etiqueta="Código de instalación" ayuda="El que recibiste al montar la app.">
          {(p) => (
            <Entrada
              {...p}
              name="codigo"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Tu nombre">
          {(p) => (
            <Entrada
              {...p}
              name="nombre"
              autoComplete="name"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          )}
        </Campo>
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
        <Campo etiqueta="Contraseña" ayuda="Mínimo 8 caracteres.">
          {(p) => (
            <Entrada
              {...p}
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Repite la contraseña" error={noCoinciden ? 'Las contraseñas no coinciden.' : null}>
          {(p) => (
            <Entrada
              {...p}
              type="password"
              name="confirmar"
              autoComplete="new-password"
              required
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
            />
          )}
        </Campo>
        {error && <Aviso tono="grave">{error}</Aviso>}
        <Boton type="submit" tamano="grande" ancho cargando={enviando} disabled={!listo}>
          Crear administrador
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
