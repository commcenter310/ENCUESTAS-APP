'use client';

import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { NOMBRES_RESULTADO, NOMBRES_REVISION } from '@/lib/encuesta/tipos';
import { duracion, entero, fechaHora } from '@/lib/formato';
import { type Alerta, type PuntoEntrevista } from '@/lib/mapa';

const CENTRO_INICIAL: [number, number] = [25.567, -108.469];
const TEXTO_ALERTA: Record<Alerta, string> = {
  corta: 'Duró menos del mínimo',
  gps_impreciso: 'GPS impreciso',
};

type Leaf = typeof Leaflet;

/**
 * Leaflet toca `window` al importarse, así que se carga dentro del efecto.
 * El agrupador es UMD y se cuelga del `L` global: hay que definirlo antes.
 */
async function cargarLeaflet(): Promise<Leaf> {
  const L = (await import('leaflet')).default;
  (window as unknown as { L: Leaf }).L = L;
  await import('leaflet.markercluster');
  return L;
}

function linea(padre: HTMLElement, etiqueta: string, valor: string) {
  const fila = document.createElement('div');
  const e = document.createElement('span');
  e.className = 'text-tinta-3';
  e.textContent = `${etiqueta}: `;
  fila.append(e, valor);
  padre.append(fila);
}

/** Contenido del globo con textContent: los nombres vienen de usuarios. */
function globo(
  p: PuntoEntrevista,
  alertas: Alerta[],
  etiquetaZona: string,
  zonaHoraria: string,
  alAbrir: (id: string) => void,
): HTMLElement {
  const caja = document.createElement('div');
  caja.className = 'space-y-0.5 text-[13px] leading-snug';
  const titulo = document.createElement('div');
  titulo.className = 'mb-1 text-[14px] font-semibold';
  titulo.textContent = p.encuestador?.nombre || 'Sin nombre';
  caja.append(titulo);
  linea(caja, 'Fecha', fechaHora(p.terminada_en, zonaHoraria));
  if (p.zona) linea(caja, etiquetaZona, p.zona);
  linea(caja, 'Resultado', NOMBRES_RESULTADO[p.resultado]);
  linea(caja, 'Revisión', NOMBRES_REVISION[p.revision]);
  linea(caja, 'Duración', duracion(p.duracion_seg));
  if (p.precision_m !== null) linea(caja, 'Precisión GPS', `± ${entero(p.precision_m)} m`);
  for (const a of alertas) {
    const aviso = document.createElement('div');
    aviso.className = 'font-medium text-grave-texto';
    aviso.textContent = `⚠ ${TEXTO_ALERTA[a]}`;
    caja.append(aviso);
  }
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className =
    'mt-2 w-full rounded-lg bg-marca-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-marca-700';
  boton.textContent = 'Ver detalle';
  boton.addEventListener('click', () => alAbrir(p.id));
  caja.append(boton);
  return caja;
}

function iconoDeGrupo(L: Leaf, n: number) {
  const tamano = n < 10 ? 32 : n < 100 ? 38 : 44;
  return L.divIcon({
    html: `<span>${n}</span>`,
    className: 'grupo-mapa',
    iconSize: L.point(tamano, tamano),
  });
}

export function MapaDeEntrevistas({
  puntos,
  colorDe,
  alertasDe,
  encuadre,
  etiquetaZona,
  zonaHoraria,
  alAbrir,
}: {
  puntos: PuntoEntrevista[];
  colorDe: (p: PuntoEntrevista) => string;
  alertasDe: (p: PuntoEntrevista) => Alerta[];
  /** Cuando cambia, el mapa se reencuadra; la actualización automática no lo mueve. */
  encuadre: string;
  etiquetaZona: string;
  zonaHoraria: string;
  alAbrir: (id: string) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<{ L: Leaf; mapa: Leaflet.Map; grupo: Leaflet.MarkerClusterGroup } | null>(null);
  const ultimoEncuadre = useRef<string | null>(null);
  const abrir = useRef(alAbrir);
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    abrir.current = alAbrir;
  }, [alAbrir]);

  useEffect(() => {
    let vivo = true;
    cargarLeaflet()
      .then((L) => {
        if (!vivo || !contenedor.current) return;
        const m = L.map(contenedor.current, { center: CENTRO_INICIAL, zoom: 11 });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(m);
        const grupo = L.markerClusterGroup({
          maxClusterRadius: 40,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (c) => iconoDeGrupo(L, c.getChildCount()),
        }).addTo(m);
        mapa.current = { L, mapa: m, grupo };
        setListo(true);
      })
      .catch(() => {
        if (vivo) setFallo(true);
      });
    return () => {
      vivo = false;
      mapa.current?.mapa.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const actual = mapa.current;
    if (!listo || !actual) return;
    const { L, grupo } = actual;
    grupo.clearLayers();
    const marcas = puntos.map((p) => {
      const alertas = alertasDe(p);
      const marca = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        className: 'pin-mapa',
        fillColor: colorDe(p),
        fillOpacity: 0.9,
        // Las alertas llevan aro rojo grueso; el resto, aro blanco para separarse del mapa.
        color: alertas.length ? '#d03b3b' : '#ffffff',
        weight: alertas.length ? 3 : 2,
      });
      marca.bindPopup(() => globo(p, alertas, etiquetaZona, zonaHoraria, (id) => abrir.current(id)), {
        minWidth: 200,
      });
      return marca;
    });
    grupo.addLayers(marcas);

    if (puntos.length > 0 && ultimoEncuadre.current !== encuadre) {
      ultimoEncuadre.current = encuadre;
      actual.mapa.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 16 });
    }
  }, [listo, puntos, colorDe, alertasDe, encuadre, etiquetaZona, zonaHoraria]);

  if (fallo) {
    return <div className="grid h-[60vh] place-items-center text-[15px] text-tinta-2">No se pudo cargar el mapa.</div>;
  }

  return (
    <div
      ref={contenedor}
      role="region"
      aria-label="Mapa de entrevistas"
      data-listo={listo || undefined}
      className="isolate h-[60vh] min-h-80 w-full rounded-xl bg-apagado"
    />
  );
}
