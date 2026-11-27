import { createContext, useContext } from 'react';

/**
 * Datos del arranque (dónde se guarda el libro, versión del esquema). Público: cualquier feature puede leerlo
 * (por ejemplo, Respaldo muestra si el almacenamiento es persistente). Forma estructural: `app/boot.ts` entrega
 * un objeto compatible, así esta capa no importa los adaptadores.
 */
export interface BootInfo {
  storage: {
    kind: 'wasm-opfs' | 'wasm-memory-idb' | 'node' | 'tauri';
    persistent: boolean;
    /** Resultado de `navigator.storage.persist()`, o null si no aplica. */
    persistGranted: boolean | null;
    fallbackReason: string | null;
    restored: boolean;
    /** false si el navegador no tiene Web Locks (sin protección entre pestañas). */
    tabLock: boolean;
  };
  schema: { from: number; to: number; applied: readonly number[] };
  sqliteVersion: string;
}

export const BootInfoContext = createContext<BootInfo | null>(null);

/** `useBootInfo()`: lanza si se usa fuera de `<App>`. */
export function useBootInfo(): BootInfo {
  const info = useContext(BootInfoContext);
  if (info === null) throw new Error('useBootInfo debe usarse dentro de <App>');
  return info;
}
