// Lotes y captura rápida (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2A).
import { notImplemented, type ErrorCode } from '../errors';
import type { MoneyParseError } from '../money';
import type { Batch, FieldValues, Id, IsoDate, Minor, Mutation, Warning } from '../types';
import type { CoreDeps } from '../uow';

export interface CaptureRow {
  amount: string | Minor;
  description: string;
  notes?: string;
  values?: FieldValues;
  date?: IsoDate;
}
export interface CaptureInput {
  workspaceId: Id;
  accountId: Id;
  kind: 'income' | 'expense';
  date: IsoDate;
  rows: CaptureRow[];
  controlTotalMinor?: Minor | null;
  acceptControlMismatch?: boolean;
  label?: string;
}
export type CaptureRowError = { index: number; error: ErrorCode | MoneyParseError };
export type CaptureResult =
  | {
      status: 'saved';
      batchId: Id;
      savedRowIndexes: number[];
      rowErrors: CaptureRowError[];
      warnings: Array<{ index: number; warnings: Warning[] }>;
    }
  | { status: 'control_mismatch'; sumMinor: Minor; controlTotalMinor: Minor; differenceMinor: Minor } // nada guardado
  | { status: 'nothing_to_save'; rowErrors: CaptureRowError[] };

export interface BatchesService {
  /** F-44/45/46: valida por fila; filas vacías se ignoran; total de control sobre filas válidas. */
  capture(input: CaptureInput): Promise<CaptureResult>;
  /** Calcula suma/diferencia sin guardar (para el pie de la tabla en vivo). */
  previewCapture(input: CaptureInput): Promise<{
    sumMinor: Minor;
    differenceMinor: Minor | null;
    rowErrors: Array<{ index: number; error: string }>;
    validCount: number;
  }>;
  list(workspaceId: Id, opts?: { source?: Batch['source']; limit?: number }): Promise<Batch[]>;
  get(id: Id): Promise<Batch>;
  /** Anula todos los activos del lote (marca voided_with_batch=1). Una sola acción de historial. */
  void(id: Id, reason?: string): Promise<Mutation<{ voidedCount: number }>>;
  /** Restaura solo los que anuló el lote, no los anulados a mano antes. */
  restore(id: Id): Promise<Mutation<{ restoredCount: number }>>;
}

export function createBatchesService(_deps: CoreDeps): BatchesService {
  return {
    capture: async () => notImplemented('batches.capture'),
    previewCapture: async () => notImplemented('batches.previewCapture'),
    list: async () => notImplemented('batches.list'),
    get: async () => notImplemented('batches.get'),
    void: async () => notImplemented('batches.void'),
    restore: async () => notImplemented('batches.restore'),
  };
}
