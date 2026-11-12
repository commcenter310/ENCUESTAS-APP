'use client';

import { useState } from 'react';
import { TituloDeBloque } from '@/components/admin/comunes';
import { Medidor } from '@/components/admin/graficas';
import { Entrada, Insignia, Selector, Tarjeta, Vacio } from '@/components/ui';
import { entero } from '@/lib/formato';
import type { EstadoDeSeccion, FilaDeAvance } from '@/lib/muestra-avance';

type Filtro = 'todas' | 'pendientes' | 'completas' | 'excedidas';

const ESTADOS_DEL_FILTRO: Record<Filtro, EstadoDeSeccion[] | null> = {
  todas: null,
  pendientes: ['sin_iniciar', 'en_curso'],
  completas: ['completa', 'excedida'],
  excedidas: ['excedida'],
};

function InsigniaDeEstado({ fila }: { fila: FilaDeAvance }) {
  switch (fila.estado) {
    case 'excedida':
      return <Insignia tono="aviso">+{fila.levantadas - fila.meta} sobre el tope</Insignia>;
    case 'completa':
      return <Insignia tono="bien">Completa</Insignia>;
    case 'en_curso':
      return <Insignia tono="marca">En curso</Insignia>;
    case 'sin_iniciar':
      return <Insignia>Sin iniciar</Insignia>;
  }
}

export function TablaDeSecciones({ filas }: { filas: FilaDeAvance[] }) {
  const [dl, setDl] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busqueda, setBusqueda] = useState('');

  const distritos = [...new Set(filas.map((f) => f.distrito_local))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const estados = ESTADOS_DEL_FILTRO[filtro];
  const visibles = filas.filter(
    (f) =>
      (!dl || String(f.distrito_local) === dl) &&
      (!estados || estados.includes(f.estado)) &&
      (!busqueda || f.seccion.startsWith(busqueda) || f.reemplazo?.startsWith(busqueda)),
  );

  return (
    <Tarjeta className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-5">
        <div className="mr-auto">
          <TituloDeBloque detalle={`${entero(visibles.length)} de ${entero(filas.length)}`}>Secciones</TituloDeBloque>
        </div>
        <Selector
          aria-label="Distrito local"
          className="h-10 w-auto text-sm"
          value={dl}
          onChange={(e) => setDl(e.target.value)}
        >
          <option value="">Todo distrito local</option>
          {distritos.map((d) => (
            <option key={String(d)} value={String(d)}>
              DL {d ?? 'sin dato'}
            </option>
          ))}
        </Selector>
        <Selector
          aria-label="Avance"
          className="h-10 w-auto text-sm"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as Filtro)}
        >
          <option value="todas">Todas</option>
          <option value="pendientes">Por completar</option>
          <option value="completas">Completas</option>
          <option value="excedidas">Sobre el tope</option>
        </Selector>
        <Entrada
          aria-label="Buscar sección"
          placeholder="Buscar sección"
          inputMode="numeric"
          className="h-10 w-36 text-sm"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {visibles.length === 0 ? (
        <Vacio titulo="No hay secciones con estos filtros" />
      ) : (
        <div className="mt-2 max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 border-b border-linea bg-superficie text-left text-tinta-2">
              <tr>
                <th className="px-5 py-2 font-medium">Sección</th>
                <th className="px-3 py-2 text-right font-medium">DL</th>
                <th className="px-3 py-2 text-right font-medium">DF</th>
                <th className="px-3 py-2 font-medium">Estrato</th>
                <th className="px-3 py-2 text-right font-medium">Lista nominal</th>
                <th className="px-3 py-2 text-right font-medium">Factor</th>
                <th className="px-3 py-2 font-medium">Reemplazo</th>
                <th className="w-48 px-3 py-2 font-medium">Avance</th>
                <th className="px-5 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {visibles.map((f) => (
                <tr key={f.seccion} className="border-b border-linea last:border-0">
                  <th scope="row" className="px-5 py-2 text-left font-semibold">
                    {f.seccion}
                  </th>
                  <td className="px-3 py-2 text-right">{f.distrito_local ?? '–'}</td>
                  <td className="px-3 py-2 text-right">{f.distrito_federal ?? '–'}</td>
                  <td className="px-3 py-2">{f.estrato ?? '–'}</td>
                  <td className="px-3 py-2 text-right">{f.lista_nominal === null ? '–' : entero(f.lista_nominal)}</td>
                  <td className="px-3 py-2 text-right">
                    {f.factor_ponderacion === null ? '–' : f.factor_ponderacion.toFixed(3)}
                  </td>
                  <td className="px-3 py-2">
                    {f.reemplazo ?? '–'}
                    {f.enReemplazo > 0 && <span className="text-tinta-3"> ({f.enReemplazo})</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Medidor valor={f.levantadas} meta={f.meta} etiqueta={`Sección ${f.seccion}`} />
                      </div>
                      <span className="w-14 text-right">
                        {f.levantadas}/{f.meta}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-2">
                    <InsigniaDeEstado fila={f} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}
