// Hooks propios de la captura: modo de teclado, fecha de hoy, avisos suaves, sugerencias y categorías frecuentes.
// Todo el acceso a datos va por `useCuadraQuery` / hooks de app/data sobre los servicios del núcleo.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCuadraQuery } from '../../app/data/useCuadraQuery';
import { useSetting, useWorkspace, useWorkspaceId } from '../../app/data/hooks';
import { useBreakpoint } from '../../app/state/breakpoint';
import { systemClock, type Currency, type FieldValues, type Id, type IsoDate, type Minor, type TransferDraft, type TxDraft, type TxKind, type Warning } from '../../core';
import { getLocale } from '../../i18n/format';
import { amountParts, DEFAULT_CURRENCY } from '../../ui';

// ── Entorno ───────────────────────────────────────────────────────────────────────────

const COARSE = '(pointer: coarse)';
function subscribeCoarse(cb: () => void) {
  if (typeof matchMedia === 'undefined') return () => undefined;
  const mq = matchMedia(COARSE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const isCoarse = () => (typeof matchMedia === 'undefined' ? false : matchMedia(COARSE).matches);

/** Teclado propio en pantalla: en móvil (compacta) y con puntero táctil (tableta). En escritorio, campo de texto. */
export function useKeypadMode(): boolean {
  const breakpoint = useBreakpoint();
  const coarse = useSyncExternalStore(subscribeCoarse, isCoarse, () => false);
  // Ajustes › «Usar el teclado del sistema para montos»: formulario con campo de monto normal en cualquier ancho.
  const [systemKeyboard] = useSetting('capture.systemKeyboard');
  if (systemKeyboard === true) return false;
  return breakpoint === 'compact' || coarse;
}

/** Hoy según el reloj del núcleo (fecha local del usuario). */
export function useToday(): IsoDate {
  return systemClock.today();
}

/**
 * El valor tras `ms` sin cambios. Compara por contenido (JSON), no por identidad: los borradores se rearman en cada
 * render y, comparando por identidad, el temporizador no pararía nunca.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const key = JSON.stringify(value) ?? '';
  const [shown, setShown] = useState<{ key: string; value: T }>({ key, value });
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (key === shown.key) return;
    const id = setTimeout(() => setShown({ key, value: latest.current }), ms);
    return () => clearTimeout(id);
  }, [key, ms, shown.key]);
  return shown.value;
}

export function useCurrency(): Currency {
  return useWorkspace().data?.currency ?? DEFAULT_CURRENCY;
}

/** `−RD$1,850.00` / `+RD$1,850.00` con el signo correcto (U+2212), para avisos y textos. */
export function useSignedAmount(): (minor: Minor, kind?: TxKind) => string {
  const currency = useCurrency();
  return useCallback((minor, kind) => amountParts(minor, { locale: getLocale(), currency, kind }).text, [currency]);
}

// ── Lecturas ──────────────────────────────────────────────────────────────────────────

/** Avisos suaves de `transactions.check` mientras se escribe (con espera de 350 ms; nunca bloquean). */
export function useSoftWarnings(draft: TxDraft | TransferDraft | null, editingId?: Id): Warning[] {
  const ws = useWorkspaceId();
  const debounced = useDebounced(draft, 350);
  const q = useCuadraQuery({
    key: ['capture.check', ws, debounced, editingId ?? null],
    tables: ['transactions', 'transaction_field_values', 'accounts'],
    fn: (c) => c.transactions.check(ws, debounced!, editingId === undefined ? {} : { editingId }),
    enabled: debounced !== null,
    keepPrevious: true,
  });
  if (draft === null || debounced === null) return [];
  return q.data ?? [];
}

export interface DescriptionSuggestion {
  description: string;
  uses: number;
  lastValues: FieldValues;
}

/** Conceptos recientes que empiezan por lo escrito (los más usados primero). */
export function useSuggestions(prefix: string, kind: 'income' | 'expense'): DescriptionSuggestion[] {
  const ws = useWorkspaceId();
  const debounced = useDebounced(prefix.trim(), 150);
  const q = useCuadraQuery({
    key: ['capture.suggest', ws, debounced, kind],
    tables: ['transactions', 'transaction_field_values'],
    fn: (c) => c.transactions.suggestDescriptions(ws, debounced, { kind, limit: 8 }),
    keepPrevious: true,
  });
  return q.data ?? [];
}

/** Cuántos movimientos usan cada opción de la categoría en los últimos 12 meses (para los chips frecuentes). */
export function useOptionCounts(fieldId: Id | undefined, kind: 'income' | 'expense'): Array<{ key: string | null; count: number }> {
  const ws = useWorkspaceId();
  const q = useCuadraQuery({
    key: ['capture.optionCounts', ws, fieldId ?? null, kind],
    tables: ['transactions', 'transaction_field_values', 'field_options'],
    fn: (c) =>
      c.queries.summarize(ws, {
        filter: { period: { preset: 'last_12_months' }, kinds: [kind] },
        groupBy: { by: 'field', fieldId: fieldId! },
      }),
    enabled: fieldId !== undefined,
  });
  return q.data?.groups ?? [];
}
