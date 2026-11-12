'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Download, FileUp, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { Encabezado } from '@/components/admin/comunes';
import { mensajeDeError, usePanel } from '@/components/admin/contexto';
import {
  Aviso,
  AreaTexto,
  Boton,
  Campo,
  Cargando,
  Entrada,
  Insignia,
  Modal,
  Selector,
  Tarjeta,
  Vacio,
} from '@/components/ui';
import { todasLasPreguntas } from '@/lib/encuesta/motor';
import { revisarDefinicion } from '@/lib/encuesta/revisar';
import {
  type DefinicionEncuesta,
  type Encuesta,
  ESTADOS_ENCUESTA,
  type TipoEncuesta,
  TIPOS_ENCUESTA,
  estadoDeEncuesta,
  nombreDeTipo,
} from '@/lib/encuesta/tipos';
import { descargar } from '@/lib/exportar';
import { entero } from '@/lib/formato';
import { supabase } from '@/lib/supabase';

type Edicion = { tipo: 'nueva' } | { tipo: 'editar'; encuesta: Encuesta };

function aClave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Alta de una encuesta desde su definición JSON, o edición de una existente. */
function Formulario({
  edicion,
  alCerrar,
  alGuardar,
}: {
  edicion: Edicion;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const actual = edicion.tipo === 'editar' ? edicion.encuesta : null;
  const [titulo, setTitulo] = useState(actual?.titulo ?? '');
  const [descripcion, setDescripcion] = useState(actual?.descripcion ?? '');
  const [meta, setMeta] = useState(actual?.meta_muestra ? String(actual.meta_muestra) : '');
  const [tipo, setTipo] = useState<TipoEncuesta | ''>(actual?.tipo ?? '');
  const [json, setJson] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  async function leerArchivo(archivo: File | undefined) {
    if (!archivo) return;
    setJson(await archivo.text());
    setErrores([]);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErrores([]);
    if (!tipo) {
      setErrores(['Indica si la encuesta es de rigor científico o de posicionamiento.']);
      return;
    }
    let definicion: DefinicionEncuesta | null = null;
    if (json.trim()) {
      let dato: unknown;
      try {
        dato = JSON.parse(json);
      } catch {
        setErrores(['El texto no es JSON válido. Revisa comas y llaves.']);
        return;
      }
      const problemas = revisarDefinicion(dato);
      if (problemas.length > 0) {
        setErrores(problemas.slice(0, 8));
        return;
      }
      definicion = dato as DefinicionEncuesta;
    } else if (!actual) {
      setErrores(['Pega o sube la definición de la encuesta.']);
      return;
    }

    setEnviando(true);
    const comunes = {
      titulo: titulo.trim(),
      tipo,
      descripcion: descripcion.trim() || null,
      meta_muestra: meta ? Number(meta) : null,
      ...(definicion ? { definicion } : {}),
    };
    const { error } = actual
      ? await supabase().from('encuestas').update(comunes).eq('id', actual.id).select('id').single()
      : await supabase()
          .from('encuestas')
          .insert({
            ...comunes,
            clave: `${aClave(titulo) || 'encuesta'}-${Date.now().toString(36)}`,
            estado: 'borrador',
          })
          .select('id')
          .single();
    setEnviando(false);
    if (error) setErrores([mensajeDeError(error)]);
    else alGuardar();
  }

  return (
    <Modal abierto alCerrar={alCerrar} ancho="max-w-2xl" titulo={actual ? 'Editar encuesta' : 'Nueva encuesta'}>
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        <Campo etiqueta="Título">
          {(p) => <Entrada {...p} value={titulo} onChange={(e) => setTitulo(e.target.value)} />}
        </Campo>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-tinta-2">Tipo de encuesta</legend>
          <div role="radiogroup" aria-label="Tipo de encuesta" className="grid gap-2 sm:grid-cols-2">
            {TIPOS_ENCUESTA.map((t) => (
              <button
                key={t.valor}
                type="button"
                role="radio"
                aria-checked={tipo === t.valor}
                onClick={() => setTipo(t.valor)}
                className={`flex gap-3 rounded-xl border p-3 text-left transition-colors ${
                  tipo === t.valor ? 'border-marca-600 bg-marca-50' : 'border-eje bg-white hover:bg-plano'
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    tipo === t.valor ? 'border-marca-600 bg-marca-600 text-white' : 'border-eje'
                  }`}
                >
                  {tipo === t.valor && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span>
                  <span className="block font-semibold">{t.nombre}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-tinta-2">{t.ayuda}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <Campo etiqueta="Descripción (opcional)">
          {(p) => <Entrada {...p} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Meta de entrevistas efectivas (opcional)">
          {(p) => (
            <Entrada
              {...p}
              inputMode="numeric"
              className="max-w-40"
              value={meta}
              onChange={(e) => setMeta(e.target.value.replace(/\D/g, '').slice(0, 7))}
            />
          )}
        </Campo>
        <Campo
          etiqueta={actual ? 'Reemplazar el cuestionario (opcional)' : 'Cuestionario en formato JSON'}
          ayuda={
            actual
              ? 'Déjalo vacío para conservar el cuestionario actual.'
              : 'Pega la definición o sube el archivo .json. Nace como borrador para que la revises antes de activarla.'
          }
        >
          {(p) => (
            <AreaTexto
              {...p}
              className="min-h-40 font-mono text-[13px]"
              spellCheck={false}
              placeholder='{ "formato": 1, "versiones": ["A"], ... }'
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          )}
        </Campo>
        <label className="flex cursor-pointer items-center gap-2 self-start rounded-xl border border-eje bg-white px-3 py-2 text-sm font-medium hover:bg-plano">
          <FileUp className="size-4" aria-hidden />
          Subir archivo .json
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => leerArchivo(e.target.files?.[0])}
          />
        </label>
        {actual && json.trim() && (
          <Aviso tono="aviso">
            Si ya hay entrevistas, no cambies los identificadores de preguntas y opciones: los resultados se leen con el
            cuestionario vigente.
          </Aviso>
        )}
        {errores.length > 0 && (
          <Aviso tono="grave" titulo="No se pudo guardar">
            <ul className="list-disc pl-4">
              {errores.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Aviso>
        )}
        <div className="flex justify-end gap-3">
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando} disabled={titulo.trim().length < 3 || !tipo}>
            {actual ? 'Guardar cambios' : 'Crear como borrador'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export default function PaginaEncuestas() {
  const { encuestas, cargando, recargar, elegir } = usePanel();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'bien' | 'grave'; texto: string } | null>(null);
  const [porBorrar, setPorBorrar] = useState<Encuesta | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  async function cambiarEstado(encuesta: Encuesta, estado: string) {
    setOcupada(encuesta.id);
    setAviso(null);
    const { error } = await supabase().from('encuestas').update({ estado }).eq('id', encuesta.id).select('id').single();
    setOcupada(null);
    if (error) setAviso({ tono: 'grave', texto: mensajeDeError(error) });
    else recargar();
  }

  async function borrar(encuesta: Encuesta) {
    setOcupada(encuesta.id);
    const { error } = await supabase().from('encuestas').delete().eq('id', encuesta.id).select('id').single();
    setOcupada(null);
    setPorBorrar(null);
    if (error) {
      setAviso({
        tono: 'grave',
        texto:
          error.code === '23503'
            ? 'No se puede borrar: ya tiene entrevistas. Ciérrala para que no se levante más.'
            : mensajeDeError(error),
      });
    } else {
      setAviso({ tono: 'bien', texto: 'Encuesta borrada.' });
      recargar();
    }
  }

  return (
    <>
      <Encabezado titulo="Encuestas" descripcion="Cuestionarios disponibles y su estado.">
        <Boton onClick={() => setEdicion({ tipo: 'nueva' })}>
          <Plus className="size-4" aria-hidden />
          Nueva encuesta
        </Boton>
      </Encabezado>

      {aviso && (
        <Aviso tono={aviso.tono} className="mb-4">
          {aviso.texto}
        </Aviso>
      )}

      {cargando ? (
        <Cargando />
      ) : encuestas.length === 0 ? (
        <Tarjeta>
          <Vacio titulo="Todavía no hay encuestas">Importa la primera con el botón de arriba.</Vacio>
        </Tarjeta>
      ) : (
        <div className="flex flex-col gap-4">
          {encuestas.map((e) => {
            const estado = estadoDeEncuesta(e.estado);
            const preguntas = todasLasPreguntas(e.definicion).length;
            return (
              <Tarjeta key={e.id} role="group" aria-label={e.titulo} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg leading-snug font-semibold">{e.titulo}</h2>
                    {e.descripcion && <p className="mt-0.5 text-sm text-tinta-2">{e.descripcion}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tinta-3">
                      <Insignia tono={estado.tono}>{estado.nombre}</Insignia>
                      <Insignia tono="marca">{nombreDeTipo(e.tipo)}</Insignia>
                      <span>{preguntas} preguntas</span>
                      <span>{e.secciones ? `Muestra: ${entero(e.secciones)} secciones` : 'Sin muestra cargada'}</span>
                      <span>Versiones {e.definicion.versiones.join(', ')}</span>
                      {e.meta_muestra && <span>Meta: {entero(e.meta_muestra)}</span>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Selector
                      aria-label={`Estado de ${e.titulo}`}
                      className="h-10 w-auto text-sm"
                      value={e.estado}
                      disabled={ocupada === e.id}
                      onChange={(ev) => cambiarEstado(e, ev.target.value)}
                    >
                      {ESTADOS_ENCUESTA.map((x) => (
                        <option key={x.valor} value={x.valor}>
                          {x.nombre}
                        </option>
                      ))}
                    </Selector>
                    <span className="text-xs text-tinta-3">{estado.ayuda}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-linea pt-4">
                  <Boton variante="secundario" tamano="chico" onClick={() => elegir(e.id)}>
                    Ver en el panel
                  </Boton>
                  <Link
                    href="/admin/muestra"
                    onClick={() => elegir(e.id)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-eje bg-white px-3 text-sm font-semibold hover:bg-plano"
                  >
                    <MapPinned className="size-3.5" aria-hidden />
                    {e.secciones ? 'Ver muestra' : 'Cargar muestra'}
                  </Link>
                  <Boton
                    variante="secundario"
                    tamano="chico"
                    onClick={() => setEdicion({ tipo: 'editar', encuesta: e })}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Editar
                  </Boton>
                  <Boton
                    variante="secundario"
                    tamano="chico"
                    onClick={() =>
                      descargar(`${e.clave}.json`, JSON.stringify(e.definicion, null, 2), 'application/json')
                    }
                  >
                    <Download className="size-3.5" aria-hidden />
                    Descargar cuestionario
                  </Boton>
                  <Boton variante="peligro" tamano="chico" onClick={() => setPorBorrar(e)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    Borrar
                  </Boton>
                </div>
              </Tarjeta>
            );
          })}
        </div>
      )}

      {edicion && (
        <Formulario
          key={edicion.tipo === 'editar' ? edicion.encuesta.id : 'nueva'}
          edicion={edicion}
          alCerrar={() => setEdicion(null)}
          alGuardar={() => {
            setAviso({
              tono: 'bien',
              texto:
                edicion.tipo === 'nueva'
                  ? 'Encuesta creada como borrador. Carga su muestra y actívala cuando esté lista.'
                  : 'Cambios guardados.',
            });
            setEdicion(null);
            recargar();
          }}
        />
      )}

      <Modal abierto={porBorrar !== null} titulo="Borrar encuesta" alCerrar={() => setPorBorrar(null)}>
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-snug">
            Se borrará <strong className="font-semibold">{porBorrar?.titulo}</strong>. Solo es posible si no tiene
            entrevistas. Esto no se puede deshacer.
          </p>
          <Boton
            variante="peligro"
            ancho
            cargando={ocupada === porBorrar?.id}
            onClick={() => porBorrar && borrar(porBorrar)}
          >
            Sí, borrar
          </Boton>
          <Boton variante="secundario" ancho onClick={() => setPorBorrar(null)}>
            Cancelar
          </Boton>
        </div>
      </Modal>
    </>
  );
}
