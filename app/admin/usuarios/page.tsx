'use client';

import { useCallback, useState } from 'react';
import { Dices, KeyRound, Pencil, UserPlus } from 'lucide-react';
import { Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, useConsulta } from '@/components/admin/contexto';
import { type Rol, useSesion } from '@/components/sesion';
import { Aviso, Boton, Campo, Entrada, Insignia, Modal, Selector, Tarjeta, Vacio } from '@/components/ui';
import { mensajeDeFuncion, supabase } from '@/lib/supabase';

type Perfil = { id: string; nombre: string; correo: string; rol: Rol; activo: boolean; creado_en: string };

type Accion =
  | { tipo: 'crear' }
  | { tipo: 'editar'; perfil: Perfil }
  | { tipo: 'password'; perfil: Perfil };

/** Contraseña al azar fácil de dictar: sin 0/O ni 1/l. */
function generarPassword(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789';
  const azar = new Uint32Array(10);
  crypto.getRandomValues(azar);
  return Array.from(azar, (n) => letras[n % letras.length]).join('');
}

async function llamar(cuerpo: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase().functions.invoke('usuarios', { body: cuerpo });
  return error ? mensajeDeFuncion(error) : null;
}

function Formulario({ accion, alCerrar, alGuardar }: { accion: Accion; alCerrar: () => void; alGuardar: () => void }) {
  const perfil = accion.tipo === 'crear' ? null : accion.perfil;
  const [nombre, setNombre] = useState(perfil?.nombre ?? '');
  const [correo, setCorreo] = useState(perfil?.correo ?? '');
  const [rol, setRol] = useState<Rol>(perfil?.rol ?? 'encuestador');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const pidePassword = accion.tipo !== 'editar';
  const listo =
    (accion.tipo === 'password' || (nombre.trim().length >= 2 && correo.includes('@'))) &&
    (!pidePassword || password.length >= 8);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const fallo = await llamar(
      accion.tipo === 'crear'
        ? { accion: 'crear', nombre, correo, password, rol }
        : accion.tipo === 'editar'
          ? { accion: 'actualizar', id: accion.perfil.id, nombre, correo, rol }
          : { accion: 'password', id: accion.perfil.id, password },
    );
    setEnviando(false);
    if (fallo) setError(fallo);
    else alGuardar();
  }

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo={
        accion.tipo === 'crear'
          ? 'Nuevo usuario'
          : accion.tipo === 'editar'
            ? 'Editar usuario'
            : `Nueva contraseña para ${accion.perfil.nombre}`
      }
    >
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {accion.tipo !== 'password' && (
          <>
            <Campo etiqueta="Nombre completo" ayuda="Así aparecerá en la introducción de la entrevista.">
              {(p) => <Entrada {...p} autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Correo" ayuda="Es su usuario para entrar. No se le envía ningún mensaje.">
              {(p) => (
                <Entrada
                  {...p}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                />
              )}
            </Campo>
            <Campo etiqueta="Tipo de usuario">
              {(p) => (
                <Selector {...p} className="h-12" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                  <option value="encuestador">Encuestador (levanta entrevistas)</option>
                  <option value="admin">Administrador (ve todo y administra)</option>
                </Selector>
              )}
            </Campo>
          </>
        )}
        {pidePassword && (
          <Campo etiqueta="Contraseña" ayuda="Mínimo 8 caracteres. Anótala: después no se puede consultar.">
            {(p) => (
              <div className="flex gap-2">
                <Entrada
                  {...p}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Boton variante="secundario" className="h-12" onClick={() => setPassword(generarPassword())}>
                  <Dices className="size-4" aria-hidden />
                  Generar
                </Boton>
              </div>
            )}
          </Campo>
        )}
        {error && <Aviso tono="grave">{error}</Aviso>}
        <div className="flex justify-end gap-3">
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando} disabled={!listo}>
            {accion.tipo === 'crear' ? 'Crear usuario' : accion.tipo === 'editar' ? 'Guardar cambios' : 'Cambiar contraseña'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export default function PaginaUsuarios() {
  const { identidad } = useSesion();
  const consulta = useCallback(
    async () => exigir(await supabase().from('perfiles').select('*').order('creado_en')) as Perfil[],
    [],
  );
  const { datos, cargando, error, recargar } = useConsulta(consulta);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'bien' | 'grave'; texto: string } | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);

  async function alternar(perfil: Perfil) {
    setCambiando(perfil.id);
    setAviso(null);
    const fallo = await llamar({ accion: 'actualizar', id: perfil.id, activo: !perfil.activo });
    setCambiando(null);
    if (fallo) setAviso({ tono: 'grave', texto: fallo });
    else {
      setAviso({
        tono: 'bien',
        texto: perfil.activo
          ? `${perfil.nombre} ya no puede entrar ni enviar entrevistas.`
          : `${perfil.nombre} puede entrar de nuevo.`,
      });
      recargar();
    }
  }

  return (
    <>
      <Encabezado titulo="Usuarios" descripcion="Encuestadores y administradores con acceso a la app.">
        <Boton onClick={() => setAccion({ tipo: 'crear' })}>
          <UserPlus className="size-4" aria-hidden />
          Nuevo usuario
        </Boton>
      </Encabezado>

      {aviso && (
        <Aviso tono={aviso.tono} className="mb-4">
          {aviso.texto}
        </Aviso>
      )}

      {!datos ? (
        <EstadoDeConsulta cargando={cargando} error={error} />
      ) : (
        <Tarjeta className="overflow-hidden">
          {datos.length === 0 ? (
            <Vacio titulo="No hay usuarios" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-linea text-left text-tinta-2">
                  <tr>
                    <th className="px-5 py-2 font-medium">Nombre</th>
                    <th className="px-3 py-2 font-medium">Correo</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-5 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {datos.map((p) => (
                    <tr key={p.id} className="border-b border-linea last:border-0">
                      <td className="px-5 py-2.5 font-medium">
                        {p.nombre || 'Sin nombre'}
                        {p.id === identidad?.id && <span className="ml-1.5 font-normal text-tinta-3">(tú)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-tinta-2">{p.correo}</td>
                      <td className="px-3 py-2.5">{p.rol === 'admin' ? 'Administrador' : 'Encuestador'}</td>
                      <td className="px-3 py-2.5">
                        <Insignia tono={p.activo ? 'bien' : 'neutro'}>{p.activo ? 'Activo' : 'Inactivo'}</Insignia>
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-end gap-2">
                          <Boton variante="secundario" tamano="chico" onClick={() => setAccion({ tipo: 'editar', perfil: p })}>
                            <Pencil className="size-3.5" aria-hidden />
                            Editar
                          </Boton>
                          <Boton
                            variante="secundario"
                            tamano="chico"
                            onClick={() => setAccion({ tipo: 'password', perfil: p })}
                          >
                            <KeyRound className="size-3.5" aria-hidden />
                            Contraseña
                          </Boton>
                          {p.id !== identidad?.id && (
                            <Boton
                              variante={p.activo ? 'peligro' : 'secundario'}
                              tamano="chico"
                              cargando={cambiando === p.id}
                              onClick={() => alternar(p)}
                            >
                              {p.activo ? 'Desactivar' : 'Activar'}
                            </Boton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      )}

      {accion && (
        <Formulario
          key={accion.tipo + (accion.tipo === 'crear' ? '' : accion.perfil.id)}
          accion={accion}
          alCerrar={() => setAccion(null)}
          alGuardar={() => {
            setAviso({
              tono: 'bien',
              texto:
                accion.tipo === 'crear'
                  ? 'Usuario creado. Compártele su correo y contraseña.'
                  : accion.tipo === 'editar'
                    ? 'Cambios guardados.'
                    : 'Contraseña cambiada. Compártela con la persona.',
            });
            setAccion(null);
            recargar();
          }}
        />
      )}
    </>
  );
}
