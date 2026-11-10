'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { useSesion } from '@/components/sesion';
import { Aviso, Boton, Campo, Entrada, Modal } from '@/components/ui';
import { esErrorDeRed, supabase } from '@/lib/supabase';

/** Botón con el nombre del usuario: cambiar contraseña y cerrar sesión. */
export function MenuCuenta({ avisoAlSalir }: { avisoAlSalir?: string | null }) {
  const { identidad, salir } = useSesion();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<'menu' | 'password'>('menu');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);
  const [enviando, setEnviando] = useState(false);

  function cerrar() {
    setAbierto(false);
    setVista('menu');
    setPassword('');
    setConfirmar('');
    setError(null);
    setHecho(false);
  }

  async function cambiarPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const { error: fallo } = await supabase().auth.updateUser({ password });
    setEnviando(false);
    if (fallo) {
      setError(
        esErrorDeRed(fallo)
          ? 'No hay conexión. Intenta de nuevo cuando tengas señal.'
          : 'No se pudo cambiar la contraseña. Usa una distinta a la actual, de al menos 8 caracteres.',
      );
      return;
    }
    setHecho(true);
    setPassword('');
    setConfirmar('');
  }

  async function cerrarSesion() {
    await salir();
    router.replace('/login');
  }

  if (!identidad) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex max-w-44 items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm font-medium text-tinta-2 hover:bg-black/5"
      >
        <UserRound className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{identidad.nombre || identidad.correo}</span>
      </button>

      <Modal abierto={abierto} titulo={vista === 'menu' ? 'Mi cuenta' : 'Cambiar contraseña'} alCerrar={cerrar}>
        {vista === 'menu' ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm">
              <p className="font-semibold text-tinta">{identidad.nombre}</p>
              <p className="text-tinta-2">{identidad.correo}</p>
              <p className="mt-0.5 text-tinta-3">{identidad.rol === 'admin' ? 'Administrador' : 'Encuestador'}</p>
            </div>
            {avisoAlSalir && <Aviso tono="aviso">{avisoAlSalir}</Aviso>}
            <Boton variante="secundario" ancho onClick={() => setVista('password')}>
              <KeyRound className="size-4" aria-hidden />
              Cambiar contraseña
            </Boton>
            <Boton variante="secundario" ancho onClick={cerrarSesion}>
              <LogOut className="size-4" aria-hidden />
              Cerrar sesión
            </Boton>
          </div>
        ) : (
          <form onSubmit={cambiarPassword} className="flex flex-col gap-4" noValidate>
            {hecho && <Aviso tono="bien">Contraseña actualizada.</Aviso>}
            <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 8 caracteres.">
              {(p) => (
                <Entrada
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Campo>
            <Campo
              etiqueta="Repite la contraseña"
              error={confirmar && password !== confirmar ? 'Las contraseñas no coinciden.' : null}
            >
              {(p) => (
                <Entrada
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                />
              )}
            </Campo>
            {error && <Aviso tono="grave">{error}</Aviso>}
            <div className="flex gap-3">
              <Boton variante="secundario" onClick={() => setVista('menu')}>
                Volver
              </Boton>
              <Boton
                type="submit"
                className="flex-1"
                cargando={enviando}
                disabled={password.length < 8 || password !== confirmar}
              >
                Guardar
              </Boton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
