'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinOff } from 'lucide-react';
import { BotonActualizar, ConEncuesta, Encabezado, EstadoDeConsulta } from '@/components/admin/comunes';
import { exigir, useConsulta } from '@/components/admin/contexto';
import { DetalleDeEntrevista } from '@/components/admin/detalle-entrevista';
import { Aviso, Cargando, Entrada, Selector, Tarjeta } from '@/components/ui';
import { etiquetasZona } from '@/lib/encuesta/monitoreo';
import { type Encuesta, NOMBRES_REVISION } from '@/lib/encuesta/tipos';
import { entero } from '@/lib/formato';
import {
  type Periodo,
  type PuntoEntrevista,
  alertasDe,
  colorPorEncuestador,
  colorPorRevision,
  filtrarPorPeriodo,
} from '@/lib/mapa';
import { leerPaginado, supabase } from '@/lib/supabase';

const MapaDeEntrevistas = dynamic(
  () => import('@/components/admin/mapa/mapa-entrevistas').then((m) => m.MapaDeEntrevistas),
  { ssr: false, loading: () => <Cargando texto="Cargando mapa…" className="h-[60vh]" /> },
);

const CAMPOS =
  'id, lat, lng, precision_m, zona, terminada_en, duracion_seg, resultado, revision, encuestador_id, encuestador:perfiles!entrevistas_encuestador_id_fkey(nombre)';
const CADA_MINUTO = 60_000;

const PERIODOS: { valor: Periodo; nombre: string }[] = [
  { valor: 'todo', nombre: 'Todo el levantamiento' },
  { valor: 'hoy', nombre: 'Hoy' },
  { valor: 'ayer', nombre: 'Ayer' },
  { valor: '7dias', nombre: 'Últimos 7 días' },
];

type Filtros = {
  periodo: Periodo;
  encuestador: string;
  revision: string;
  zona: string;
  color: 'revision' | 'encuestador';
};

function Mapa({ encuesta }: { encuesta: Encuesta }) {
  const [filtros, setFiltros] = useState<Filtros>({
    periodo: 'todo',
    encuestador: '',
    revision: '',
    zona: '',
    color: 'revision',
  });
  const [abierta, setAbierta] = useState<string | null>(null);
  const minimo = encuesta.definicion.monitoreo?.duracionMinimaSeg ?? 0;
  const etiquetaZona = etiquetasZona(encuesta.definicion).singular;
  const zonaHoraria = encuesta.zona_horaria;

  const consulta = useCallback(async () => {
    const [puntos, sinGps] = await Promise.all([
      leerPaginado<PuntoEntrevista>(
        async (desde, hasta) =>
          (await supabase()
            .from('entrevistas')
            .select(CAMPOS)
            .eq('encuesta_id', encuesta.id)
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .order('terminada_en')
            .order('id')
            .range(desde, hasta)) as unknown as { data: PuntoEntrevista[] | null; error: unknown },
      ),
      supabase()
        .from('entrevistas')
        .select('id', { count: 'exact', head: true })
        .eq('encuesta_id', encuesta.id)
        .or('lat.is.null,lng.is.null'),
    ]);
    if (sinGps.error) throw sinGps.error;
    return { puntos, sinGps: sinGps.count ?? 0 };
  }, [encuesta.id]);
  const { datos, cargando, error, actualizando, recargar } = useConsulta(consulta, CADA_MINUTO);

  const consultaEncuestadores = useCallback(
    async () =>
      exigir(await supabase().from('perfiles').select('id, nombre').order('nombre')) as {
        id: string;
        nombre: string;
      }[],
    [],
  );
  const encuestadores = useConsulta(consultaEncuestadores);

  const visibles = useMemo(() => {
    const zona = filtros.zona.trim();
    return filtrarPorPeriodo(datos?.puntos ?? [], filtros.periodo, zonaHoraria).filter(
      (p) =>
        (!filtros.encuestador || p.encuestador_id === filtros.encuestador) &&
        (!filtros.revision || p.revision === filtros.revision) &&
        (!zona || p.zona === zona),
    );
  }, [datos, filtros, zonaHoraria]);

  const { colorDe, leyenda } = useMemo(
    () => (filtros.color === 'revision' ? colorPorRevision(visibles) : colorPorEncuestador(visibles)),
    [visibles, filtros.color],
  );
  const alertas = useCallback((p: PuntoEntrevista) => alertasDe(p, minimo), [minimo]);
  const conAlerta = useMemo(() => visibles.filter((p) => alertas(p).length > 0).length, [visibles, alertas]);
  const encuadre = `${filtros.periodo}|${filtros.encuestador}|${filtros.revision}|${filtros.zona.trim()}`;

  function cambiar<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
    setFiltros((f) => ({ ...f, [clave]: valor }));
  }

  return (
    <>
      <Encabezado
        titulo="Mapa"
        descripcion={
          datos
            ? `${entero(visibles.length)} entrevistas en el mapa. Se actualiza cada minuto.`
            : 'Dónde se está levantando cada entrevista.'
        }
      >
        <BotonActualizar alOprimir={recargar} girando={actualizando} />
      </Encabezado>

      <Tarjeta className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Selector
          aria-label="Periodo"
          value={filtros.periodo}
          onChange={(e) => cambiar('periodo', e.target.value as Periodo)}
        >
          {PERIODOS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.nombre}
            </option>
          ))}
        </Selector>
        <Selector
          aria-label="Encuestador"
          value={filtros.encuestador}
          onChange={(e) => cambiar('encuestador', e.target.value)}
        >
          <option value="">Todos los encuestadores</option>
          {(encuestadores.datos ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </Selector>
        <Selector aria-label="Revisión" value={filtros.revision} onChange={(e) => cambiar('revision', e.target.value)}>
          <option value="">Cualquier revisión</option>
          {Object.entries(NOMBRES_REVISION).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </Selector>
        <Entrada
          aria-label={etiquetaZona}
          placeholder={`${etiquetaZona} (todas)`}
          inputMode="numeric"
          value={filtros.zona}
          onChange={(e) => cambiar('zona', e.target.value)}
        />
        <Selector
          aria-label="Color de los puntos"
          value={filtros.color}
          onChange={(e) => cambiar('color', e.target.value as Filtros['color'])}
        >
          <option value="revision">Color por revisión</option>
          <option value="encuestador">Color por encuestador</option>
        </Selector>
      </Tarjeta>

      <EstadoDeConsulta cargando={cargando} error={error} />

      {datos && (
        <>
          <Tarjeta className="overflow-hidden p-1.5">
            <MapaDeEntrevistas
              puntos={visibles}
              colorDe={colorDe}
              alertasDe={alertas}
              encuadre={encuadre}
              etiquetaZona={etiquetaZona}
              zonaHoraria={zonaHoraria}
              alAbrir={setAbierta}
            />
          </Tarjeta>

          <ul aria-label="Leyenda" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-tinta-2">
            {leyenda.map((l) => (
              <li key={l.clave} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-3 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-tinta">{l.etiqueta}</span>
                <span className="tabular-nums">{entero(l.n)}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-full border-[3px] border-grave bg-white" />
              <span className="text-tinta">Con alerta</span>
              <span className="tabular-nums">{entero(conAlerta)}</span>
            </li>
          </ul>

          {datos.sinGps > 0 && (
            <Aviso tono="aviso" className="mt-4">
              <MapPinOff className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
              {entero(datos.sinGps)} {datos.sinGps === 1 ? 'entrevista no tiene' : 'entrevistas no tienen'} ubicación
              GPS y no aparecen en el mapa.
            </Aviso>
          )}
        </>
      )}

      {abierta && (
        <DetalleDeEntrevista
          key={abierta}
          id={abierta}
          encuesta={encuesta}
          alCerrar={() => setAbierta(null)}
          alCambiar={recargar}
        />
      )}
    </>
  );
}

export default function PaginaMapa() {
  return <ConEncuesta>{(encuesta) => <Mapa encuesta={encuesta} />}</ConEncuesta>;
}
