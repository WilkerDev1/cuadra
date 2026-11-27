// Movimientos (ARCHITECTURE.md 3.5): entradas, salidas, transferencias y saldo inicial.
//
// Reglas que este módulo hace cumplir (4.1):
// - I-6  un único saldo inicial por cuenta en toda su vida (se edita, se anula y se restaura).
// - I-7  seq por cuenta reservado con UPDATE … RETURNING en la misma transacción del INSERT: sin huecos,
//        sin reutilización; la cuenta y el seq de un movimiento no cambian nunca.
// - I-9  una transferencia son dos filas out/in con el mismo grupo; editar o anular afecta a las dos.
// - I-10 un guardado = una transacción SQL + como mucho una acción de historial (mutate).
// Todo error previsible sale como DomainError ANTES de escribir: nunca dejamos que un UNIQUE o un CHECK
// del esquema llegue como SqlError.
import { DomainError } from '../errors';
import { Money } from '../money';
import type { SqlExecutor } from '../ports';
import {
  fieldValueToRecord,
  groupFieldValues,
  insertSql,
  recordValues,
  selectColumns,
  toJson,
  toTransaction,
  type FieldValueRecord,
  type TransactionRecord,
} from '../sql/rows';
import { buildSearchText, escapeLike, normalizeSearch } from '../text';
import type {
  AuditEntry,
  Batch,
  Direction,
  FieldValue,
  FieldValues,
  Id,
  IsoDate,
  Minor,
  Mutation,
  Transaction,
  TxKind,
  Warning,
} from '../types';
import { mutate, readTx, type CoreDeps, type UowCtx } from '../uow';
import { OPENING_DESCRIPTION, type OpeningInput } from './accounts';
import { diffTransaction, transactionHistory } from './audit';
import {
  assertAccount,
  assertAmount,
  assertDate,
  assertLeg,
  assertWorkspaceCapacity,
  computeWarnings,
  createValidationService,
  draftLegs,
  fieldValueEquals,
  loadWorkspaceContext,
  normalizeValues,
  resolveForeignAccounts,
  sumAmountsOrThrow,
  workspaceOfAccount,
  type Contribution,
  type Leg,
  type WarnItem,
  type WorkspaceContext,
} from './validation';

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

// ── Lectura ──────────────────────────────────────────────────────────────────────────

interface Loaded {
  record: TransactionRecord;
  tx: Transaction;
  /** El otro lado si es transferencia. */
  other: { record: TransactionRecord; tx: Transaction } | null;
}

const TX_COLUMNS = selectColumns('transactions');

async function loadOne(ex: SqlExecutor, id: Id): Promise<Loaded> {
  const record = await ex.get<TransactionRecord>(`SELECT ${TX_COLUMNS} FROM transactions WHERE id = ?`, [id]);
  if (!record) throw new DomainError('not_found', { entity: 'transaction', id });
  const otherRecord =
    record.transfer_group_id === null
      ? undefined
      : await ex.get<TransactionRecord>(`SELECT ${TX_COLUMNS} FROM transactions WHERE transfer_group_id = ? AND id <> ?`, [
          record.transfer_group_id,
          id,
        ]);
  const ids = otherRecord ? [id, otherRecord.id] : [id];
  const values = groupFieldValues(
    await ex.all<FieldValueRecord>(
      `SELECT ${selectColumns('transaction_field_values')} FROM transaction_field_values
       WHERE transaction_id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    ),
  );
  const cp = (r: TransactionRecord) => ({ accountId: r.account_id, transactionId: r.id, seq: Number(r.seq) });
  const tx = toTransaction(record, values.get(id) ?? {}, otherRecord ? cp(otherRecord) : null);
  const other = otherRecord ? { record: otherRecord, tx: toTransaction(otherRecord, values.get(otherRecord.id) ?? {}, cp(record)) } : null;
  return { record, tx, other };
}

/** Espacio de un movimiento (inmutable: se puede leer fuera de la transacción). */
async function workspaceOfTransaction(ex: Pick<SqlExecutor, 'get'>, id: Id): Promise<Id> {
  const row = await ex.get<{ workspace_id: string }>('SELECT workspace_id FROM transactions WHERE id = ?', [id]);
  if (!row) throw new DomainError('not_found', { entity: 'transaction', id });
  return row.workspace_id;
}

const legsOf = (l: Loaded): Transaction[] => (l.other ? [l.tx, l.other.tx] : [l.tx]);

const contributionOf = (t: Pick<Transaction, 'accountId' | 'amountMinor' | 'direction' | 'status'>): Contribution[] =>
  t.status === 'active' ? [{ accountId: t.accountId, signedMinor: Money.signed(t.amountMinor, t.direction) }] : [];

const asLeg = (t: Transaction): Leg => ({
  accountId: t.accountId,
  kind: t.kind,
  direction: t.direction,
  amountMinor: t.amountMinor,
  date: t.date,
  description: t.description,
  notes: t.notes,
  values: t.values,
});

// ── Escritura de filas nuevas ────────────────────────────────────────────────────────

/** Fila nueva aún sin seq. */
interface PendingRow extends Leg {
  id: Id;
  transferGroupId: Id | null;
  status: 'active' | 'voided';
  voidReason: string | null;
}

/** Elemento normalizado: 1 fila (entrada/salida/saldo inicial) o 2 (transferencia, out primero). */
interface PendingItem {
  type: 'tx' | 'transfer' | 'opening';
  rows: PendingRow[];
  rawValues: Record<Id, FieldValue | null>;
}

function normalizeItem(draft: CreateManyDraft | TxDraft | TransferDraft, ids: UowCtx['ids']): PendingItem {
  const rawValues = normalizeValues('values' in draft ? draft.values : undefined);
  const base = { status: 'active' as const, voidReason: null };
  if ('fromAccountId' in draft) {
    const groupId = ids.next();
    const [out, inn] = draftLegs(draft) as [Leg, Leg];
    return {
      type: 'transfer',
      rawValues,
      rows: [
        { ...out, ...base, id: ids.next(), transferGroupId: groupId },
        { ...inn, ...base, id: ids.next(), transferGroupId: groupId },
      ],
    };
  }
  if (draft.kind === 'opening') {
    const description = (draft.description ?? '').trim() || OPENING_DESCRIPTION;
    return {
      type: 'opening',
      rawValues,
      rows: [
        {
          accountId: draft.accountId,
          kind: 'opening',
          direction: draft.direction,
          amountMinor: draft.amountMinor,
          date: draft.date,
          description,
          notes: '',
          values: {},
          ...base,
          id: ids.next(),
          transferGroupId: null,
        },
      ],
    };
  }
  if (draft.kind !== 'income' && draft.kind !== 'expense') {
    throw new DomainError('kind_change_forbidden', { kind: (draft as { kind: unknown }).kind });
  }
  const [leg] = draftLegs(draft) as [Leg];
  return { type: 'tx', rawValues, rows: [{ ...leg, ...base, id: ids.next(), transferGroupId: null }] };
}

/** Validación dura de todos los elementos en memoria (más una consulta para saldos iniciales). */
async function assertItems(tx: SqlExecutor, ctx: WorkspaceContext, items: readonly PendingItem[]): Promise<void> {
  await resolveForeignAccounts(tx, ctx, items.flatMap((it) => it.rows.map((r) => r.accountId)));
  const openingAccounts = new Set<Id>();
  items.forEach((it, index) => {
    try {
      if (it.type === 'transfer' && it.rows[0]!.accountId === it.rows[1]!.accountId) {
        throw new DomainError('transfer_same_account', { accountId: it.rows[0]!.accountId });
      }
      if (it.type === 'opening') {
        const row = it.rows[0]!;
        if (row.direction !== 'in' && row.direction !== 'out') throw new DomainError('invalid_amount', { direction: row.direction });
        if (openingAccounts.has(row.accountId)) throw new DomainError('opening_exists', { accountId: row.accountId });
        openingAccounts.add(row.accountId);
      }
      for (const row of it.rows) assertLeg(ctx, row, { isNew: true, rawValues: it.rawValues });
    } catch (error) {
      if (error instanceof DomainError && items.length > 1) throw new DomainError(error.code, { ...error.details, index });
      throw error;
    }
  });
  if (openingAccounts.size > 0) {
    const ids = [...openingAccounts];
    const existing = await tx.get<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM transactions WHERE kind = 'opening' AND account_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`,
      ids,
    );
    if (existing) {
      throw new DomainError('opening_exists', { accountId: existing.account_id, transactionId: existing.id });
    }
  }
  // Techo de volumen del espacio: saldos y totales siempre en enteros seguros (antes de calcular avisos).
  await assertWorkspaceCapacity(tx, ctx.workspace.id, sumAmountsOrThrow(items.flatMap((it) => it.rows.map((r) => r.amountMinor))));
}

/**
 * Inserta las filas: reserva cada seq con UPDATE … RETURNING justo antes de su INSERT (el trigger
 * tx_seq_reserved exige seq = next_seq − 1) y los valores de campos en un solo runMany.
 * Devuelve los registros tal como quedaron.
 */
async function insertRows(
  uow: Pick<UowCtx, 'tx' | 'clock' | 'touch'>,
  workspaceId: Id,
  rows: readonly PendingRow[],
  batchId: Id | null,
): Promise<TransactionRecord[]> {
  const now = uow.clock.now().toISOString();
  const records: TransactionRecord[] = [];
  const values: FieldValueRecord[] = [];
  for (const row of rows) {
    const reserved = await uow.tx.get<{ seq: number }>(
      'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
      [row.accountId],
    );
    if (!reserved) throw new DomainError('not_found', { entity: 'account', id: row.accountId });
    const record: TransactionRecord = {
      id: row.id,
      workspace_id: workspaceId,
      account_id: row.accountId,
      seq: Number(reserved.seq),
      kind: row.kind,
      direction: row.direction,
      amount_minor: row.amountMinor,
      date: row.date,
      description: row.description,
      notes: row.notes,
      search_text: buildSearchText(row.description, row.notes),
      status: row.status,
      void_reason: row.status === 'voided' ? row.voidReason : null,
      voided_at: row.status === 'voided' ? now : null,
      voided_with_batch: 0,
      batch_id: batchId,
      transfer_group_id: row.transferGroupId,
      recorded_at: now,
      updated_at: now,
    };
    await uow.tx.run(insertSql('transactions'), recordValues('transactions', record));
    records.push(record);
    for (const [fieldId, v] of Object.entries(row.values)) values.push(fieldValueToRecord(row.id, fieldId, v));
  }
  if (values.length > 0) {
    await uow.tx.runMany(
      insertSql('transaction_field_values'),
      values.map((v) => recordValues('transaction_field_values', v)),
    );
    uow.touch('transaction_field_values');
  }
  uow.touch('transactions', 'accounts');
  return records;
}

/** Instantánea para la línea '*' del historial al crear. */
function snapshot(r: TransactionRecord, values: FieldValues): Record<string, unknown> {
  return {
    accountId: r.account_id,
    seq: Number(r.seq),
    kind: r.kind,
    direction: r.direction,
    amountMinor: Number(r.amount_minor),
    date: r.date,
    description: r.description,
    notes: r.notes,
    status: r.status,
    values,
  };
}

function toTransactions(records: readonly TransactionRecord[], rows: readonly PendingRow[]): Transaction[] {
  return records.map((r, i) => {
    const other = r.transfer_group_id === null ? undefined : records.find((o) => o.transfer_group_id === r.transfer_group_id && o.id !== r.id);
    return toTransaction(r, rows[i]!.values, other ? { accountId: other.account_id, transactionId: other.id, seq: Number(other.seq) } : null);
  });
}

// ── Lote (createMany) dentro de una unidad de trabajo ajena ───────────────────────────

export interface InsertBatchResult {
  batchId: Id;
  /** Un id por borrador, en el mismo orden (transferencia → su lado de salida). */
  ids: Id[];
  /** Todas las filas creadas (transferencia: dos), en orden. */
  transactions: Transaction[];
  sumMinor: Minor;
}

/**
 * createMany sin abrir transacción ni escribir historial: valida TODO antes de escribir, crea el lote y
 * las filas con ctx.tx y marca las tablas tocadas. Para servicios que componen un guardado mayor con UNA
 * sola acción propia (importCsv.commit crea opciones + lote; demo). Añade a ctx los avisos de saldo final
 * negativo por cuenta; los avisos por fila los calcula quien llama (computeWarnings).
 */
export async function insertBatch(
  ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids' | 'touch' | 'warn'>,
  input: Omit<CreateManyInput, 'audit'>,
): Promise<InsertBatchResult> {
  if (input.drafts.length === 0) throw new DomainError('batch_empty');
  const ws = await loadWorkspaceContext(ctx.tx, input.workspaceId);
  if (input.batch.accountId !== null) {
    await resolveForeignAccounts(ctx.tx, ws, [input.batch.accountId]);
    assertAccount(ws, input.batch.accountId, { isNew: true });
  }
  const items = input.drafts.map((d) => normalizeItem(d, ctx.ids));
  await assertItems(ctx.tx, ws, items);

  const sumMinor = sumAmountsOrThrow(items.map((it) => it.rows[0]!.amountMinor));
  const control = input.batch.controlTotalMinor ?? null;
  let mismatch = false;
  if (control !== null) {
    assertAmount(control, { field: 'controlTotalMinor' });
    mismatch = control !== sumMinor;
    if (mismatch && input.batch.controlMismatchAccepted !== true) {
      throw new DomainError('control_total_mismatch', {
        sumMinor,
        controlTotalMinor: control,
        differenceMinor: Money.sub(sumMinor, control),
      });
    }
  }
  for (const v of input.voids ?? []) {
    const item = items[v.index];
    if (!Number.isInteger(v.index) || item === undefined) throw new DomainError('not_found', { entity: 'draft', index: v.index });
    const reason = typeof v.reason === 'string' && v.reason.trim() !== '' ? v.reason.trim() : null;
    for (const row of item.rows) {
      row.status = 'voided';
      row.voidReason = reason;
    }
  }

  const batchId = ctx.ids.next();
  await ctx.tx.run(
    insertSql('batches'),
    recordValues('batches', {
      id: batchId,
      workspace_id: input.workspaceId,
      account_id: input.batch.accountId,
      source: input.batch.source,
      label: input.batch.label ?? '',
      control_total_minor: control,
      control_mismatch_accepted: mismatch && input.batch.controlMismatchAccepted === true ? 1 : 0,
      meta: input.batch.meta === undefined ? null : toJson(input.batch.meta),
      created_at: ctx.clock.now().toISOString(),
    }),
  );
  ctx.touch('batches');

  const rows = items.flatMap((it) => it.rows);
  const records = await insertRows(ctx, input.workspaceId, rows, batchId);

  // Saldo final negativo por cuenta (una consulta).
  const deltas = new Map<Id, Minor>();
  for (const r of rows) {
    if (r.status !== 'active') continue;
    deltas.set(r.accountId, Money.add(deltas.get(r.accountId) ?? 0, Money.signed(r.amountMinor, r.direction)));
  }
  const accountIds = [...deltas.keys()];
  if (accountIds.length > 0) {
    const balances = await ctx.tx.all<{ account_id: string; b: number }>(
      `SELECT account_id, SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END) AS b
       FROM transactions WHERE status = 'active' AND account_id IN (${accountIds.map(() => '?').join(', ')})
       GROUP BY account_id`,
      accountIds,
    );
    for (const b of balances) {
      if ((deltas.get(b.account_id) ?? 0) < 0 && Number(b.b) < 0) {
        ctx.warn({ code: 'negative_balance', accountId: b.account_id, balanceAfterMinor: Number(b.b) });
      }
    }
  }

  return {
    batchId,
    ids: items.map((it) => it.rows[0]!.id),
    transactions: toTransactions(records, rows),
    sumMinor,
  };
}

// ── Actualizaciones ──────────────────────────────────────────────────────────────────

/** Escribe el estado `after` de un lado (y sus valores de campos que cambiaron). */
async function writeEdits(
  uow: Pick<UowCtx, 'tx' | 'touch'>,
  before: Transaction,
  after: Transaction,
  now: string,
): Promise<void> {
  // voided_with_batch vuelve a 0: anular o restaurar a mano deja de ser "cosa del lote".
  await uow.tx.run(
    `UPDATE transactions SET kind = ?, direction = ?, amount_minor = ?, date = ?, description = ?, notes = ?,
       search_text = ?, status = ?, void_reason = ?, voided_at = ?, voided_with_batch = 0, updated_at = ?
     WHERE id = ?`,
    [
      after.kind,
      after.direction,
      after.amountMinor,
      after.date,
      after.description,
      after.notes,
      buildSearchText(after.description, after.notes),
      after.status,
      after.voidReason,
      after.voidedAt,
      now,
      after.id,
    ],
  );
  const fieldIds = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
  for (const fieldId of fieldIds) {
    const oldV = before.values[fieldId];
    const newV = after.values[fieldId];
    if (fieldValueEquals(oldV, newV)) continue;
    if (newV === undefined) {
      await uow.tx.run('DELETE FROM transaction_field_values WHERE transaction_id = ? AND field_id = ?', [after.id, fieldId]);
    } else {
      const r = fieldValueToRecord(after.id, fieldId, newV);
      await uow.tx.run(
        `${insertSql('transaction_field_values')}
         ON CONFLICT (transaction_id, field_id) DO UPDATE SET value_text = excluded.value_text,
           value_number = excluded.value_number, value_date = excluded.value_date,
           value_option_id = excluded.value_option_id, value_bool = excluded.value_bool`,
        recordValues('transaction_field_values', r),
      );
    }
    uow.touch('transaction_field_values');
  }
  uow.touch('transactions');
}

function auditTarget(l: Loaded): { entityType: 'transaction' | 'transfer'; entityId: Id; accountId: Id } {
  if (l.tx.transferGroupId !== null) {
    const out = l.tx.direction === 'out' ? l.tx : (l.other?.tx ?? l.tx);
    return { entityType: 'transfer', entityId: l.tx.transferGroupId, accountId: out.accountId };
  }
  return { entityType: 'transaction', entityId: l.tx.id, accountId: l.tx.accountId };
}

const messageKey = (l: Loaded, verb: 'create' | 'edit' | 'void' | 'restore') =>
  `audit.${l.tx.kind === 'transfer' ? 'transfer' : l.tx.kind === 'opening' ? 'opening' : 'tx'}.${verb}`;

function auditParams(t: Transaction, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { seq: t.seq, kind: t.kind, amountMinor: t.amountMinor, description: t.description, date: t.date, ...extra };
}

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createTransactionsService(deps: CoreDeps): TransactionsService {
  const validation = createValidationService(deps);

  /** Crea uno (entrada/salida, transferencia o saldo inicial) con avisos completos y su acción 'create'. */
  async function createOne(draft: TxDraft | TransferDraft | CreateManyDraft, reason: string): Promise<Mutation<Transaction[]>> {
    const firstAccount = 'fromAccountId' in draft ? draft.fromAccountId : draft.accountId;
    const workspaceId = await workspaceOfAccount(deps.driver, firstAccount);
    return mutate(deps, workspaceId, reason, async (ctx) => {
      const ws = await loadWorkspaceContext(ctx.tx, workspaceId);
      const item = normalizeItem(draft, ctx.ids);
      await assertItems(ctx.tx, ws, [item]);
      const [warnings = []] = await computeWarnings(ctx.tx, [{ legs: item.rows }], { today: ctx.clock.today() });
      for (const w of warnings) ctx.warn(w);
      const records = await insertRows(ctx, workspaceId, item.rows, null);
      const created = toTransactions(records, item.rows);
      const first = created[0]!;
      const loaded: Loaded = { record: records[0]!, tx: first, other: created[1] ? { record: records[1]!, tx: created[1] } : null };
      const target = auditTarget(loaded);
      await ctx.audit.record(ctx.tx, {
        workspaceId,
        action: 'create',
        ...target,
        batchId: null,
        message: messageKey(loaded, 'create'),
        params: auditParams(first, created[1] ? { toAccountId: created[1].accountId } : {}),
        changes: records.map((r, i) => ({ entityId: r.id, path: '*', new: snapshot(r, item.rows[i]!.values) })),
      });
      return created;
    });
  }

  /** Aplica un cambio de estado o de contenido a un movimiento (y a su otro lado) con una acción. */
  async function change(
    id: Id,
    reason: string,
    verb: 'edit' | 'void' | 'restore',
    build: (l: Loaded, ws: WorkspaceContext, now: string) => { afters: Transaction[]; params?: Record<string, unknown> },
  ): Promise<Mutation<Transaction>> {
    const workspaceId = await workspaceOfTransaction(deps.driver, id);
    return mutate(deps, workspaceId, reason, async (ctx) => {
      const loaded = await loadOne(ctx.tx, id);
      const ws = await loadWorkspaceContext(ctx.tx, workspaceId);
      const now = ctx.clock.now().toISOString();
      const befores = legsOf(loaded);
      const { afters, params } = build(loaded, ws, now);
      const changes = befores.flatMap((b, i) => diffTransaction(b, afters[i]!).map((c) => ({ entityId: b.id, ...c })));
      if (changes.length === 0) return loaded.tx;
      const grown =
        sumAmountsOrThrow(afters.map((a) => a.amountMinor)) - sumAmountsOrThrow(befores.map((b) => b.amountMinor));
      await assertWorkspaceCapacity(ctx.tx, workspaceId, grown);

      const item: WarnItem = {
        legs: afters.filter((a) => a.status === 'active').map(asLeg),
        previous: befores.flatMap(contributionOf),
        excludeIds: befores.map((b) => b.id),
      };
      const [warnings = []] = await computeWarnings(ctx.tx, [item], {
        today: ctx.clock.today(),
        basic: verb === 'edit',
        duplicates: verb === 'edit',
      });
      for (const w of warnings) ctx.warn(w);

      for (const [i, b] of befores.entries()) await writeEdits(ctx, b, afters[i]!, now);
      const target = auditTarget(loaded);
      await ctx.audit.record(ctx.tx, {
        workspaceId,
        action: verb,
        ...target,
        batchId: loaded.tx.batchId,
        message: messageKey(loaded, verb),
        params: auditParams(afters[0]!, params),
        changes,
      });
      const counterpart = loaded.tx.counterpart;
      return { ...afters[0]!, counterpart };
    });
  }

  const service: TransactionsService = {
    async get(id) {
      return (await readTx(deps, (tx) => loadOne(tx, id))).tx;
    },

    async check(workspaceId, draft, opts = {}) {
      return readTx(deps, (tx) => validation.warnings(tx, workspaceId, draft, opts));
    },

    async create(draft) {
      const m = await createOne({ ...draft }, 'transactions.create');
      return { ...m, value: m.value[0]! };
    },

    async createTransfer(draft) {
      const m = await createOne({ ...draft }, 'transactions.createTransfer');
      const [out, inn] = m.value as [Transaction, Transaction];
      return { ...m, value: { out, in: inn } };
    },

    async setOpening(accountId, input) {
      if (input.direction !== 'in' && input.direction !== 'out') {
        throw new DomainError('invalid_amount', { direction: input.direction });
      }
      const existing = await deps.driver.get<{ id: string }>(
        "SELECT id FROM transactions WHERE account_id = ? AND kind = 'opening'",
        [accountId],
      );
      if (!existing) {
        const m = await createOne({ kind: 'opening', accountId, ...input }, 'transactions.setOpening');
        return { ...m, value: m.value[0]! };
      }
      return change(existing.id, 'transactions.setOpening', 'edit', (l, _ws, now) => {
        assertAmount(input.amountMinor);
        assertDate(input.date);
        const restored = l.tx.status === 'voided';
        const after: Transaction = {
          ...l.tx,
          amountMinor: input.amountMinor,
          direction: input.direction,
          date: input.date,
          status: 'active',
          voidReason: null,
          voidedAt: null,
          updatedAt: now,
        };
        return { afters: [after], params: restored ? { restored: true } : {} };
      });
    },

    async update(id, patch) {
      return change(id, 'transactions.update', 'edit', (l, ws, now) => {
        const p = patch as TxPatch & { accountId?: unknown; fromAccountId?: unknown; toAccountId?: unknown };
        const accounts = new Set(legsOf(l).map((t) => t.accountId));
        for (const key of ['accountId', 'fromAccountId', 'toAccountId'] as const) {
          if (p[key] !== undefined && !accounts.has(p[key] as Id)) {
            throw new DomainError('account_change_forbidden', { id });
          }
        }
        if (l.tx.status === 'voided') throw new DomainError('already_voided', { id });
        let kind: TxKind = l.tx.kind;
        if (p.kind !== undefined && p.kind !== l.tx.kind) {
          const allowed = (k: unknown) => k === 'income' || k === 'expense';
          if (!allowed(l.tx.kind) || !allowed(p.kind)) {
            throw new DomainError('kind_change_forbidden', { from: l.tx.kind, to: p.kind });
          }
          kind = p.kind;
        }
        const rawValues = normalizeValues(p.values);
        const afters = legsOf(l).map((b) => {
          const values: FieldValues = { ...b.values };
          for (const [fieldId, v] of Object.entries(rawValues)) {
            if (v === null) delete values[fieldId];
            else values[fieldId] = v;
          }
          const direction: Direction = kind === 'income' ? 'in' : kind === 'expense' ? 'out' : b.direction;
          const after: Transaction = {
            ...b,
            kind,
            direction,
            amountMinor: p.amountMinor ?? b.amountMinor,
            date: p.date ?? b.date,
            description: p.description !== undefined ? (typeof p.description === 'string' ? p.description.trim() : '') : b.description,
            notes: p.notes !== undefined ? (p.notes ?? '').trim() : b.notes,
            values,
            updatedAt: now,
          };
          assertLeg(ws, asLeg(after), { isNew: false, previousValues: b.values, rawValues });
          return after;
        });
        return { afters };
      });
    },

    async void(id, reason) {
      const why = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
      return change(id, 'transactions.void', 'void', (l, _ws, now) => {
        if (l.tx.status === 'voided') throw new DomainError('already_voided', { id });
        const afters = legsOf(l).map((b) => ({ ...b, status: 'voided' as const, voidReason: why, voidedAt: now, updatedAt: now }));
        return { afters, params: { reason: why } };
      });
    },

    async restore(id) {
      return change(id, 'transactions.restore', 'restore', (l, _ws, now) => {
        if (l.tx.status === 'active') throw new DomainError('not_voided', { id });
        const afters = legsOf(l).map((b) => ({ ...b, status: 'active' as const, voidReason: null, voidedAt: null, updatedAt: now }));
        return { afters };
      });
    },

    async duplicate(id, opts = {}) {
      if (opts.date !== undefined) assertDate(opts.date);
      return readTx(deps, async (tx) => {
        const l = await loadOne(tx, id);
        if (l.tx.kind === 'opening') throw new DomainError('opening_exists', { accountId: l.tx.accountId, transactionId: id });
        const ws = await loadWorkspaceContext(tx, l.tx.workspaceId);
        const values: FieldValues = {};
        for (const [fieldId, v] of Object.entries(l.tx.values)) {
          const field = ws.fields.get(fieldId);
          if (!field || field.deactivated_at !== null) continue;
          if (v.type === 'list' && ws.options.get(v.optionId)?.deactivated_at !== null) continue;
          values[fieldId] = v;
        }
        const date = opts.date ?? deps.clock.today();
        const common = { amountMinor: l.tx.amountMinor, date, description: l.tx.description, notes: l.tx.notes, values };
        if (l.tx.kind === 'transfer') {
          const out = l.tx.direction === 'out' ? l.tx : l.other!.tx;
          const inn = l.tx.direction === 'in' ? l.tx : l.other!.tx;
          return { fromAccountId: out.accountId, toAccountId: inn.accountId, ...common } satisfies TransferDraft;
        }
        return { accountId: l.tx.accountId, kind: l.tx.kind as 'income' | 'expense', ...common } satisfies TxDraft;
      });
    },

    async history(id) {
      return readTx(deps, async (tx) => {
        await workspaceOfTransaction(tx, id);
        return transactionHistory(tx, id);
      });
    },

    async suggestDescriptions(workspaceId, prefix, opts = {}) {
      const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 8), 1), 50);
      const kinds: TxKind[] = opts.kind ? [opts.kind] : ['income', 'expense'];
      const pattern = `${escapeLike(normalizeSearch(prefix))}%`;
      return readTx(deps, async (tx) => {
        const rows = await tx.all<{ id: string; description: string; uses: number }>(
          `SELECT id, description, uses FROM (
             SELECT t.id, t.description, t.date, t.recorded_at,
               COUNT(*) OVER (PARTITION BY lower(t.description)) AS uses,
               ROW_NUMBER() OVER (PARTITION BY lower(t.description)
                                  ORDER BY t.date DESC, t.recorded_at DESC, t.id DESC) AS rn
             FROM transactions t
             WHERE t.workspace_id = ? AND t.status = 'active'
               AND t.kind IN (${kinds.map(() => '?').join(', ')})
               AND t.search_text LIKE ? ESCAPE '\\'
           ) WHERE rn = 1
           ORDER BY uses DESC, date DESC, recorded_at DESC
           LIMIT ?`,
          [workspaceId, ...kinds, pattern, limit],
        );
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const values = groupFieldValues(
          await tx.all<FieldValueRecord>(
            `SELECT ${selectColumns('transaction_field_values', 'v')} FROM transaction_field_values v
             JOIN fields f ON f.id = v.field_id AND f.deactivated_at IS NULL
             LEFT JOIN field_options o ON o.id = v.value_option_id
             WHERE v.transaction_id IN (${ids.map(() => '?').join(', ')})
               AND (v.value_option_id IS NULL OR o.deactivated_at IS NULL)`,
            ids,
          ),
        );
        return rows.map((r) => ({ description: r.description, uses: Number(r.uses), lastValues: values.get(r.id) ?? {} }));
      });
    },

    async createMany(input) {
      return mutate(deps, input.workspaceId, 'transactions.createMany', async (ctx) => {
        const result = await insertBatch(ctx, input);
        const params = input.audit.params;
        await ctx.audit.record(ctx.tx, {
          workspaceId: input.workspaceId,
          action: input.audit.action,
          entityType: 'batch',
          entityId: result.batchId,
          accountId: input.batch.accountId,
          batchId: result.batchId,
          message: input.audit.message,
          params: {
            count: input.drafts.length,
            sumMinor: result.sumMinor,
            source: input.batch.source,
            ...(params !== null && typeof params === 'object' && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : params === undefined
                ? {}
                : { value: params }),
          },
          changes: [],
        });
        return { batchId: result.batchId, ids: result.ids };
      });
    },
  };
  return service;
}
