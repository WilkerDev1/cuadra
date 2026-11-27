import { createContext, useContext } from 'react';
import type { BootInfo } from '../boot';

/** Datos del arranque (modo de almacenamiento, esquema). Privado del shell. */
export const BootInfoContext = createContext<BootInfo | null>(null);

export function useBootInfo(): BootInfo {
  const info = useContext(BootInfoContext);
  if (info === null) throw new Error('useBootInfo debe usarse dentro de <App>');
  return info;
}
