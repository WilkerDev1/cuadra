import { useMemo } from 'react';
import { RouterProvider } from 'react-router/dom';
import type { Cuadra } from '../core';
import type { BootInfo } from './boot';
import { CuadraProvider } from './data/CuadraProvider';
import { createQueryClient } from './data/queryClient';
import { createRouter } from './router';
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
