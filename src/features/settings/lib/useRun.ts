// Ejecuta una acción del núcleo, traduce el error de dominio y avisa del efecto con un toast.
// Los errores se quedan en pantalla (Banner en la sección) porque exigen una acción; el éxito va en toast.
import { useCallback, useState } from 'react';
import type { Cuadra } from '../../../core';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';

export interface ToastSpec {
  key: string;
  params?: Record<string, string | number>;
}

export type RunResult<T> = { ok: true; value: T } | { ok: false };

export interface Runner {
  /** Último error de dominio traducido, o `null`. */
  error: string | null;
  busy: boolean;
  clearError: () => void;
  run: <T>(fn: (c: Cuadra) => Promise<T>, toast?: (value: T) => ToastSpec | null) => Promise<RunResult<T>>;
}

export function useRun(): Runner {
  const cuadra = useCuadra();
  const t = useT();
  const pushToast = useUiStore((s) => s.pushToast);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clearError = useCallback(() => setError(null), []);
  const run = useCallback<Runner['run']>(
    async (fn, toast) => {
      setError(null);
      setBusy(true);
      try {
        const value = await fn(cuadra);
        const spec = toast?.(value) ?? null;
        if (spec !== null) pushToast({ message: spec.key, ...(spec.params === undefined ? {} : { params: spec.params }) });
        return { ok: true, value };
      } catch (e) {
        setError(errorMessage(e, t));
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [cuadra, pushToast, t],
  );
  return { error, busy, clearError, run };
}
