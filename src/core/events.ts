// Eventos de cambio (ARCHITECTURE.md 3.6): tras cada COMMIT el núcleo emite UN ChangeEvent con las tablas
// tocadas. La UI invalida sus consultas con esto (5.1); nadie invalida a mano.
import type { Id } from './types';

export type TableName =
  | 'workspaces'
  | 'accounts'
  | 'transactions'
  | 'transaction_field_values'
  | 'batches'
  | 'fields'
  | 'field_options'
  | 'saved_views'
  | 'audit_log'
  | 'settings';

export const TABLE_NAMES = [
  'workspaces',
  'accounts',
  'transactions',
  'transaction_field_values',
  'batches',
  'fields',
  'field_options',
  'saved_views',
  'audit_log',
  'settings',
] as const satisfies readonly TableName[];

export interface ChangeEvent {
  workspaceId: Id | null;
  tables: TableName[];
  reason: string;
}

export type ChangeListener = (e: ChangeEvent) => void;

export interface EventBus {
  subscribe(listener: ChangeListener): () => void;
  emit(e: ChangeEvent): void;
  /** Oyentes activos (diagnóstico y pruebas). */
  readonly size: number;
}

/**
 * Bus síncrono. Un oyente que lanza no impide que reciban el evento los demás ni rompe la mutación
 * (que ya hizo COMMIT): el error va a `onListenerError` (por defecto, console.error).
 */
export function createEventBus(opts: { onListenerError?: (error: unknown, e: ChangeEvent) => void } = {}): EventBus {
  const listeners = new Set<ChangeListener>();
  const onError = opts.onListenerError ?? ((error: unknown) => console.error('[cuadra] oyente de cambios falló', error));
  return {
    subscribe(listener) {
      // Un envoltorio por suscripción: suscribir dos veces la misma función da dos entregas independientes.
      const entry: ChangeListener = (e) => listener(e);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    emit(e) {
      const frozen: ChangeEvent = Object.freeze({ ...e, tables: Object.freeze([...e.tables]) as TableName[] });
      for (const listener of [...listeners]) {
        try {
          listener(frozen);
        } catch (error) {
          onError(error, frozen);
        }
      }
    },
    get size() {
      return listeners.size;
    },
  };
}
