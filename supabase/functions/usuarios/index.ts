/**
 * Edge Function "usuarios": alta y administración de cuentas.
 *
 * Es el único lugar que usa la llave secreta de Supabase (la inyecta la
 * plataforma; no está en el repositorio ni en Vercel). Acciones:
 *
 *   instalar    Crea el primer administrador. No requiere sesión, pero sí el
 *               código de instalación y que todavía no exista un administrador.
 *   crear       Da de alta un usuario (encuestador o administrador).
 *   actualizar  Cambia nombre, correo, rol o estado activo de un usuario.
 *   password    Restablece la contraseña de un usuario.
 *
 * Salvo "instalar", todas exigen que quien llama sea un administrador activo.
 * La verificación se hace aquí (verify_jwt = false en supabase/config.toml).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'encuestador'] as const;
type Rol = (typeof ROLES)[number];

/** Bloqueo de inicio de sesión para cuentas desactivadas (~100 años). */
const BLOQUEO = '876000h';

class ErrorDeUsuario extends Error {
  constructor(
    mensaje: string,
    public estado = 400,
  ) {
    super(mensaje);
  }
}

function responder(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Llave secreta: formato nuevo (diccionario JSON) o, si no existe, la heredada. */
function llaveSecreta(): string {
  const crudo = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (crudo) {
    try {
      const llaves = JSON.parse(crudo) as Record<string, string>;
      if (llaves.default) return llaves.default;
    } catch {
      // Se intenta con la llave heredada.
    }
  }
  const heredada = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!heredada) throw new Error('No hay llave secreta disponible en el entorno');
  return heredada;
}

function clienteAdmin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, llaveSecreta(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// --- Validación de datos de entrada -----------------------------------------

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function validarNombre(valor: unknown): string {
  const nombre = texto(valor);
  if (nombre.length < 2 || nombre.length > 80) {
    throw new ErrorDeUsuario('Escribe el nombre completo (de 2 a 80 caracteres).');
  }
  return nombre;
}

function validarCorreo(valor: unknown): string {
  const correo = texto(valor).toLowerCase();
  if (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
    throw new ErrorDeUsuario('Escribe un correo válido.');
  }
  return correo;
}

function validarPassword(valor: unknown): string {
  const password = typeof valor === 'string' ? valor : '';
  if (password.length < 8 || password.length > 72) {
    throw new ErrorDeUsuario('La contraseña debe tener de 8 a 72 caracteres.');
  }
  return password;
}

function validarRol(valor: unknown): Rol {
  if (!ROLES.includes(valor as Rol)) throw new ErrorDeUsuario('Rol no válido.');
  return valor as Rol;
}

function validarId(valor: unknown): string {
  const id = texto(valor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ErrorDeUsuario('Usuario no válido.');
  }
  return id;
}

/** Traduce los errores más comunes de Supabase Auth. */
function traducir(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('already been registered') || m.includes('already registered') || m.includes('already exists')) {
    return 'Ya existe una cuenta con ese correo.';
  }
  if (m.includes('invalid') && m.includes('email')) return 'El servidor rechazó ese correo. Prueba con otro.';
  if (m.includes('password')) return 'La contraseña no cumple los requisitos de seguridad. Prueba con una más larga.';
  if (m.includes('not found')) return 'No se encontró el usuario.';
  return `No se pudo completar la operación (${mensaje}).`;
}

// --- Autorización -------------------------------------------------------------

/** Exige que la petición venga de un administrador activo. Devuelve su id. */
async function exigirAdmin(admin: SupabaseClient, req: Request): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new ErrorDeUsuario('Inicia sesión para continuar.', 401);

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ErrorDeUsuario('Tu sesión venció. Inicia sesión de nuevo.', 401);

  const { data: perfil } = await admin
    .from('perfiles')
    .select('rol, activo')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== 'admin' || !perfil.activo) {
    throw new ErrorDeUsuario('Solo un administrador puede hacer esto.', 403);
  }
  return data.user.id;
}

async function leerPerfil(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from('perfiles')
    .select('id, nombre, correo, rol, activo, creado_en')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) throw new ErrorDeUsuario('No se encontró el usuario.', 404);
  return data;
}

// --- Acciones -----------------------------------------------------------------

async function crearCuenta(
  admin: SupabaseClient,
  datos: { nombre: string; correo: string; password: string; rol: Rol },
) {
  const { data, error } = await admin.auth.admin.createUser({
    email: datos.correo,
    password: datos.password,
    email_confirm: true,
    user_metadata: { nombre: datos.nombre },
  });
  if (error || !data.user) throw new ErrorDeUsuario(traducir(error?.message ?? 'sin respuesta'));

  // El disparador de la base ya creó el perfil como encuestador inactivo.
  // Aquí se le da el rol pedido y se activa.
  const { data: perfil, error: errorPerfil } = await admin
    .from('perfiles')
    .update({ nombre: datos.nombre, correo: datos.correo, rol: datos.rol, activo: true })
    .eq('id', data.user.id)
    .select('id, nombre, correo, rol, activo, creado_en')
    .maybeSingle();
  if (errorPerfil || !perfil) {
    // Sin perfil activo la cuenta no sirve: se deshace el alta.
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(errorPerfil?.message ?? 'No se creó el perfil del usuario');
  }
  return perfil;
}

async function instalar(admin: SupabaseClient, cuerpo: Record<string, unknown>) {
  const nombre = validarNombre(cuerpo.nombre);
  const correo = validarCorreo(cuerpo.correo);
  const password = validarPassword(cuerpo.password);
  const codigo = texto(cuerpo.codigo);
  if (!codigo) throw new ErrorDeUsuario('Escribe el código de instalación.');

  const { data: valido, error } = await admin.rpc('verificar_instalacion', { p_codigo: codigo });
  if (error) throw new Error(error.message);
  if (valido !== true) {
    throw new ErrorDeUsuario('El código de instalación no es válido o la instalación ya se hizo.', 403);
  }
  return crearCuenta(admin, { nombre, correo, password, rol: 'admin' });
}

async function crear(admin: SupabaseClient, cuerpo: Record<string, unknown>) {
  return crearCuenta(admin, {
    nombre: validarNombre(cuerpo.nombre),
    correo: validarCorreo(cuerpo.correo),
    password: validarPassword(cuerpo.password),
    rol: validarRol(cuerpo.rol ?? 'encuestador'),
  });
}

async function actualizar(admin: SupabaseClient, quien: string, cuerpo: Record<string, unknown>) {
  const id = validarId(cuerpo.id);
  const actual = await leerPerfil(admin, id);

  const nombre = cuerpo.nombre === undefined ? actual.nombre : validarNombre(cuerpo.nombre);
  const correo = cuerpo.correo === undefined ? actual.correo : validarCorreo(cuerpo.correo);
  const rol = cuerpo.rol === undefined ? (actual.rol as Rol) : validarRol(cuerpo.rol);
  const activo = cuerpo.activo === undefined ? actual.activo : cuerpo.activo === true;

  if (id === quien && (rol !== 'admin' || !activo)) {
    throw new ErrorDeUsuario('No puedes quitarte a ti mismo el acceso de administrador.');
  }

  const { error } = await admin.auth.admin.updateUserById(id, {
    ...(correo !== actual.correo ? { email: correo, email_confirm: true } : {}),
    user_metadata: { nombre },
    // Una cuenta desactivada tampoco puede iniciar sesión ni renovar la suya.
    ban_duration: activo ? 'none' : BLOQUEO,
  });
  if (error) throw new ErrorDeUsuario(traducir(error.message));

  const { error: errorPerfil } = await admin
    .from('perfiles')
    .update({ nombre, correo, rol, activo })
    .eq('id', id);
  if (errorPerfil) throw new Error(errorPerfil.message);

  return leerPerfil(admin, id);
}

async function cambiarPassword(admin: SupabaseClient, cuerpo: Record<string, unknown>) {
  const id = validarId(cuerpo.id);
  const password = validarPassword(cuerpo.password);
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) throw new ErrorDeUsuario(traducir(error.message));
  return leerPerfil(admin, id);
}

// --- Entrada ------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  try {
    const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!cuerpo || typeof cuerpo !== 'object') throw new ErrorDeUsuario('Petición no válida.');

    const admin = clienteAdmin();
    const accion = texto(cuerpo.accion);

    if (accion === 'instalar') {
      return responder({ usuario: await instalar(admin, cuerpo) });
    }

    const quien = await exigirAdmin(admin, req);
    switch (accion) {
      case 'crear':
        return responder({ usuario: await crear(admin, cuerpo) });
      case 'actualizar':
        return responder({ usuario: await actualizar(admin, quien, cuerpo) });
      case 'password':
        return responder({ usuario: await cambiarPassword(admin, cuerpo) });
      default:
        throw new ErrorDeUsuario('Acción desconocida.');
    }
  } catch (e) {
    if (e instanceof ErrorDeUsuario) return responder({ error: e.message }, e.estado);
    console.error('usuarios:', e);
    return responder({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
  }
});
