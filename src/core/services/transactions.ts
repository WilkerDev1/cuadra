// Movimientos (ARCHITECTURE.md 3.5). Stub de la Oleada 1: firma completa, lo implementa la Oleada 2 (2A).
import { notImplemented } from '../errors';
import type { AuditEntry, Batch, FieldValue, FieldValues, Id, IsoDate, Minor, Mutation, Transaction, TxKind, Warning } from '../types';
import type { CoreDeps } from '../uow';
import type { OpeningInput } from './accounts';

export interface TxDraft {
  accountId: Id;
  kind: 'income' | 'expense';
  amountMinor: Minor;
  date: IsoDate;
  description: string;
  notes?: string;
  values?: FieldValues;
}
export interface TransferDraft {
  fromAccountId: Id;
  toAccountId: Id;
  amountMinor: Minor;
  date: IsoDate;
  description: string;
  notes?: string;
  values?: FieldValues;
}
export type TxPatch = Partial<Pick<TxDraft, 'kind' | 'amountMinor' | 'date' | 'description' | 'notes'>> & {
  values?: Record<Id, FieldValue | null>; // null = vaciar
};

/** Un elemento de createMany: movimiento, transferencia o saldo inicial. */
export type CreateManyDraft =
  | TxDraft
  | (TransferDraft & { kind: 'transfer' })
  | ({ kind: 'opening'; accountId: Id } & OpeningInput & { description?: string });

export interface CreateManyInput {
  workspaceId: Id;
  batch: {
    source: Batch['source'];
    accountId: Id | null;
    label: string;
    controlTotalMinor?: Minor | null;
    controlMismatchAccepted?: boolean;
    meta?: unknown;
  };
  drafts: CreateManyDraft[];
  voids?: Array<{ index: number; reason: string }>; // demo: anulados creíbles
  audit: { action: 'batch_create' | 'import' | 'demo_seed'; message: string; params?: unknown };
}

export interface TransactionsService {
  get(id: Id): Promise<Transaction>;
  /** Avisos suaves sin guardar (el formulario los muestra mientras se escribe). */
  check(workspaceId: Id, draft: TxDraft | TransferDraft, opts?: { editingId?: Id }): Promise<Warning[]>;
  create(draft: TxDraft): Promise<Mutation<Transaction>>;
  createTransfer(draft: TransferDraft): Promise<Mutation<{ out: Transaction; in: Transaction }>>;
  /** Crea o edita el único saldo inicial de la cuenta. */
  setOpening(accountId: Id, input: OpeningInput): Promise<Mutation<Transaction>>;
  /** En transferencias aplica a los dos lados (monto, fecha, descripción, notas, valores). */
  update(id: Id, patch: TxPatch): Promise<Mutation<Transaction>>;
  /** 'account_change_forbidden': para mover de cuenta, la UI ofrece "anular y registrar en otra". */
  void(id: Id, reason?: string): Promise<Mutation<Transaction>>;
  restore(id: Id): Promise<Mutation<Transaction>>;
  /** Devuelve un borrador (no guarda, no consume seq) con fecha de hoy y los mismos valores activos. */
  duplicate(id: Id, opts?: { date?: IsoDate }): Promise<TxDraft | TransferDraft>;
  history(id: Id): Promise<AuditEntry[]>; // incluye el otro lado si es transferencia
  suggestDescriptions(
    workspaceId: Id,
    prefix: string,
    opts?: { kind?: TxKind; limit?: number },
  ): Promise<Array<{ description: string; uses: number; lastValues: FieldValues }>>;
  /** Interno-público: inserción masiva en UNA transacción SQL y UNA acción de historial.
   *  Lo usan batches, importCsv y demo. */
  createMany(input: CreateManyInput): Promise<Mutation<{ batchId: Id; ids: Id[] }>>;
}

export function createTransactionsService(_deps: CoreDeps): TransactionsService {
  return {
    get: async () => notImplemented('transactions.get'),
    check: async () => notImplemented('transactions.check'),
    create: async () => notImplemented('transactions.create'),
    createTransfer: async () => notImplemented('transactions.createTransfer'),
    setOpening: async () => notImplemented('transactions.setOpening'),
    update: async () => notImplemented('transactions.update'),
    void: async () => notImplemented('transactions.void'),
    restore: async () => notImplemented('transactions.restore'),
    duplicate: async () => notImplemented('transactions.duplicate'),
    history: async () => notImplemented('transactions.history'),
    suggestDescriptions: async () => notImplemented('transactions.suggestDescriptions'),
    createMany: async () => notImplemented('transactions.createMany'),
  };
}
