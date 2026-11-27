// Validaciones duras y suaves de movimientos (ARCHITECTURE.md 3.5, pruebas 83–85). Interno: lo usan
// transactions, batches e importCsv dentro de su transacción. Stub de la Oleada 1 (lo implementa 2A).
import { notImplemented } from '../errors';
import type { SqlExecutor } from '../ports';
import type { Id, Warning } from '../types';
import type { CoreDeps } from '../uow';
import type { TransferDraft, TxDraft } from './transactions';

/** Aviso far_date: fecha a más de estos días de hoy (prueba 84). */
export const FAR_DATE_DAYS = 90;
/** Aviso possible_duplicate: mismo monto, cuenta y descripción parecida en ± estos días (prueba 85). */
export const DUPLICATE_WINDOW_DAYS = 3;

export interface ValidationService {
  /** Validaciones duras: lanza DomainError (invalid_amount, invalid_date, description_required, account_archived…). */
  assertDraft(tx: SqlExecutor, workspaceId: Id, draft: TxDraft | TransferDraft, opts?: { editingId?: Id }): Promise<void>;
  /** Avisos suaves que no bloquean (zero_amount, far_date, possible_duplicate, before_opening, negative_balance…). */
  warnings(tx: SqlExecutor, workspaceId: Id, draft: TxDraft | TransferDraft, opts?: { editingId?: Id }): Promise<Warning[]>;
}

export function createValidationService(_deps: CoreDeps): ValidationService {
  return {
    assertDraft: async () => notImplemented('validation.assertDraft'),
    warnings: async () => notImplemented('validation.warnings'),
  };
}
