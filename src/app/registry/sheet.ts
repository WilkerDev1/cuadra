import { createContext, useContext } from 'react';

/**
 * Lo que el shell ofrece a una pantalla con `presentation: 'sheet'` (hoja o inspector). Fuera de una hoja, los
 * valores son neutros: `close` no hace nada y `mode` es `null`.
 */
export interface SheetApi {
  /** `sheet`: hoja modal; `inspector`: panel fijo (≥ 1280 px); `null`: la pantalla no está en una hoja. */
  mode: 'sheet' | 'inspector' | null;
  /** Cierra la hoja y vuelve a la pantalla de detrás (o al inicio del espacio si se llegó por enlace directo). */
  close(): void;
  /** Con `true`, cerrar pide confirmación («¿Descartar los cambios?»). Llámalo con cada cambio de borrador. */
  setDirty(dirty: boolean): void;
  /** Título ya traducido que sustituye al `titleKey` de la ruta (p. ej. «Editar movimiento»); `null` vuelve al de la ruta. */
  setTitle(title: string | null): void;
}

export const SheetContext = createContext<SheetApi>({
  mode: null,
  close: () => undefined,
  setDirty: () => undefined,
  setTitle: () => undefined,
});

export function useSheet(): SheetApi {
  return useContext(SheetContext);
}
