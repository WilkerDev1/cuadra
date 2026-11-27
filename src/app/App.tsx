import { useEffect, useMemo } from 'react';
import { RouterProvider } from 'react-router/dom';
import type { Cuadra } from '../core';
import type { BootInfo } from './boot';
import { CuadraProvider } from './data/CuadraProvider';
import { createQueryClient } from './data/queryClient';
import { createRouter } from './router';
import { BootInfoContext } from './shell/bootInfo';
import { useUiStore } from './state/uiStore';

export function App({ cuadra, info }: { cuadra: Cuadra; info: BootInfo }) {
  const theme = useUiStore((s) => s.theme);
  const router = useMemo(() => createRouter(), []);
  // Una caché por fachada: si el libro se cede y se vuelve a abrir, no quedan datos de la conexión vieja.
  const queryClient = useMemo(() => createQueryClient(), [cuadra]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return (
    <BootInfoContext.Provider value={info}>
      <CuadraProvider cuadra={cuadra} queryClient={queryClient}>
        <RouterProvider router={router} />
      </CuadraProvider>
    </BootInfoContext.Provider>
  );
}
