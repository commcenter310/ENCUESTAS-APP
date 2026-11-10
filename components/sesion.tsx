'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import { borrar, guardar, leer, leerCrudo, suscribir } from '@/lib/almacen';
import { configuracionLista, esErrorDeRed, supabase } from '@/lib/supabase';

export type Rol = 'admin' | 'encuestador';

export type Identidad = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
};

type Sesion = {
  /** true mientras se averigua si hay una sesión guardada. */
  cargando: boolean;
  identidad: Identidad | null;
  entrar: (correo: string, password: string) => Promise<{ error?: string; identidad?: Identidad }>;
  salir: () => Promise<void>;
  /** Vuelve a leer el perfil del servidor (por si cambió el rol o el estado). */
  refrescar: () => Promise<Identidad | null>;
};

const Contexto = createContext<Sesion | null>(null);

const CLAVE = 'identidad';

const suscribirIdentidad = (oyente: () => void) => suscribir(CLAVE, oyente);
const identidadCruda = () => leerCrudo(CLAVE);
const sinIdentidad = () => null;

function fijar(nueva: Identidad | null): void {
  if (nueva) guardar(CLAVE, nueva);
  else borrar(CLAVE);
}

async function leerPerfil(id: string): Promise<{ identidad: Identidad | null; sinRed: boolean }> {
  const { data, error } = await supabase()
    .from('perfiles')
    .select('id, nombre, correo, rol, activo')
    .eq('id', id)
    .maybeSingle();
  if (error) return { identidad: null, sinRed: esErrorDeRed(error) };
  return { identidad: (data as Identidad | null) ?? null, sinRed: false };
}

/**
 * Mantiene la identidad del usuario. Guarda una copia en el dispositivo para
 * que la app abra al instante y siga funcionando sin conexión: los permisos
 * reales siempre los decide el servidor al sincronizar.
 */
export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  // La identidad vive en el almacenamiento del dispositivo: se lee de ahí y
  // cualquier cambio (también desde otra pestaña) vuelve a dibujar la app.
  const cruda = useSyncExternalStore(suscribirIdentidad, identidadCruda, sinIdentidad);
  const identidad = useMemo<Identidad | null>(() => {
    try {
      return cruda ? (JSON.parse(cruda) as Identidad) : null;
    } catch {
      return null;
    }
  }, [cruda]);
  const [verificada, setVerificada] = useState(false);
  const cargando = configuracionLista() && !verificada && !identidad;

  const refrescar = useCallback(async (): Promise<Identidad | null> => {
    const { data, error } = await supabase().auth.getSession();
    if (!data.session) {
      // Sin sesión guardada: se cierra. Con error (sin señal y con la sesión
      // por renovar) se conserva la identidad en caché para trabajar offline.
      if (!error) fijar(null);
      return error ? leer<Identidad>(CLAVE) : null;
    }
    const { identidad: perfil, sinRed } = await leerPerfil(data.session.user.id);
    if (perfil) {
      fijar(perfil);
      return perfil;
    }
    if (sinRed) return leer<Identidad>(CLAVE);
    // Hay sesión pero no perfil: cuenta sin acceso.
    const sinAcceso: Identidad = {
      id: data.session.user.id,
      nombre: '',
      correo: data.session.user.email ?? '',
      rol: 'encuestador',
      activo: false,
    };
    fijar(sinAcceso);
    return sinAcceso;
  }, []);

  useEffect(() => {
    if (!configuracionLista()) return;
    let vivo = true;
    refrescar()
      .catch(() => null)
      .then(() => {
        if (vivo) setVerificada(true);
      });

    const { data } = supabase().auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') fijar(null);
    });
    return () => {
      vivo = false;
      data.subscription.unsubscribe();
    };
  }, [refrescar]);

  const entrar = useCallback<Sesion['entrar']>(
    async (correo, password) => {
      const { data, error } = await supabase().auth.signInWithPassword({
        email: correo.trim().toLowerCase(),
        password,
      });
      if (error || !data.user) {
        if (esErrorDeRed(error)) return { error: 'No hay conexión. Revisa tu internet e intenta de nuevo.' };
        const codigo = (error as { code?: string } | null)?.code;
        if (codigo === 'user_banned') {
          return { error: 'Tu cuenta está desactivada. Pide acceso a tu coordinador.' };
        }
        if (codigo === 'email_not_confirmed') {
          return { error: 'Tu cuenta aún no está confirmada. Pide a tu coordinador que la active.' };
        }
        return { error: 'Correo o contraseña incorrectos.' };
      }
      const { identidad: perfil } = await leerPerfil(data.user.id);
      if (!perfil || !perfil.activo) {
        await supabase().auth.signOut({ scope: 'local' });
        fijar(null);
        return { error: 'Tu cuenta no tiene acceso todavía. Pide a tu coordinador que la active.' };
      }
      fijar(perfil);
      return { identidad: perfil };
    },
    [],
  );

  const salir = useCallback(async () => {
    // "local": cierra la sesión de este dispositivo aunque no haya señal.
    await supabase()
      .auth.signOut({ scope: 'local' })
      .catch(() => undefined);
    fijar(null);
  }, []);

  const valor = useMemo(
    () => ({ cargando, identidad, entrar, salir, refrescar }),
    [cargando, identidad, entrar, salir, refrescar],
  );

  return <Contexto value={valor}>{children}</Contexto>;
}

export function useSesion(): Sesion {
  const sesion = useContext(Contexto);
  if (!sesion) throw new Error('useSesion debe usarse dentro de <ProveedorSesion>');
  return sesion;
}

export function inicioDe(rol: Rol): string {
  return rol === 'admin' ? '/admin' : '/encuestador';
}

/**
 * Protege una zona de la app. Devuelve la identidad cuando el usuario puede
 * estar ahí; mientras tanto (o si lo redirige) devuelve null.
 * Es una comodidad de navegación: la seguridad real está en la base de datos.
 */
export function useAcceso(roles: Rol[]): Identidad | null {
  const { cargando, identidad } = useSesion();
  const router = useRouter();

  const permitido = Boolean(identidad && identidad.activo && roles.includes(identidad.rol));

  useEffect(() => {
    if (cargando) return;
    if (!identidad || !identidad.activo) router.replace('/login');
    else if (!roles.includes(identidad.rol)) router.replace(inicioDe(identidad.rol));
    // `roles` es una lista fija por pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, identidad, router]);

  return !cargando && permitido ? identidad : null;
}
