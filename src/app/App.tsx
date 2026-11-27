import { useMemo } from 'react';
import { matchRoutes } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { Cuadra } from '../core';
import type { BootInfo } from './boot';
import { CuadraProvider } from './data/CuadraProvider';
import { createQueryClient } from './data/queryClient';
import { buildRoutes, createRouter } from './router';
import { features } from './registry/collect';
import { BootInfoContext } from './data/bootInfo';
import { LockGate } from './shell/LockGate';

export function App({ cuadra, info }: { cuadra: Cuadra; info: BootInfo }) {
  const router = useMemo(() => createRouter(), []);
  // Una caché por fachada: si el libro se cede y se vuelve a abrir, no quedan datos de la conexión vieja.
  const queryClient = useMemo(() => createQueryClient(), [cuadra]);
  return (
    <BootInfoContext.Provider value={info}>
      <CuadraProvider cuadra={cuadra} queryClient={queryClient}>
        <LockGate>
          <RouterProvider router={router} />
        </LockGate>
      </CuadraProvider>
    </BootInfoContext.Provider>
  );
}

/**
 * Pide ya el código de la ruta con la que se abre la app (`#/e/…/movimientos`), sin esperar a que la base esté
 * lista ni a que el router la cargue: el router hará el mismo import() y lo encontrará resuelto.
 */
export function prefetchInitialRoute(hash: string): void {
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  for (const match of matchRoutes(buildRoutes(features), path) ?? []) {
    const lazy = match.route.lazy;
    if (typeof lazy === 'function') void lazy().catch(() => undefined);
  }
}
