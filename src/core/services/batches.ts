// Lotes y captura rápida (ARCHITECTURE.md 3.5, F-44/45/46, I-14).
// - capture: valida fila a fila (las vacías se ignoran), suma solo las válidas, compara con el total de
//   control y, si cuadra o se acepta el descuadre, guarda todo en UN lote con UNA acción de historial.
// - void/restore: anulan o restauran el lote entero en una acción; restaurar solo revive lo que anuló el
//   lote (voided_with_batch = 1), nunca lo anulado a mano antes.
import { DomainError, isDomainError, type ErrorCode } from '../errors';
import { MAX_MINOR, Money, type MoneyParseError } from '../money';
import type { SqlExecutor } from '../ports';
import { selectColumns, toBatch, type BatchRecord } from '../sql/rows';
import type { Batch, FieldValues, Id, IsoDate, Minor, Mutation, Warning } from '../types';
import { mutate, readTx, type CoreDeps } from '../uow';
import { insertBatch, type TxDraft } from './transactions';
import {
  assertAccount,
  assertAmount,
  assertLeg,
  computeWarnings,
  draftLegs,
  isStorableDate,
  loadWorkspaceContext,
  normalizeValues,
  resolveForeignAccounts,
  type Leg,
  type WorkspaceContext,
} from './validation';

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

// ── Captura: filas → borradores ──────────────────────────────────────────────────────

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Fila vacía: sin monto, sin descripción, sin notas y sin valores. Se ignora sin error. */
function isEmptyRow(row: CaptureRow): boolean {
  return (
    isBlank(row.amount) &&
    isBlank(row.description) &&
    isBlank(row.notes) &&
    Object.values(normalizeValues(row.values)).every((v) => v === null)
  );
}

interface ParsedCapture {
  ws: WorkspaceContext;
  valid: Array<{ index: number; draft: TxDraft }>;
  rowErrors: CaptureRowError[];
  sumMinor: Minor;
  control: Minor | null;
}

/** Validación de cabecera (lanza) y de filas (se recogen). No escribe. */
async function parseCapture(tx: SqlExecutor, deps: Pick<CoreDeps, 'locale'>, input: CaptureInput): Promise<ParsedCapture> {
  if (input.kind !== 'income' && input.kind !== 'expense') {
    throw new DomainError('kind_change_forbidden', { kind: input.kind });
  }
  const ws = await loadWorkspaceContext(tx, input.workspaceId);
  await resolveForeignAccounts(tx, ws, [input.accountId]);
  assertAccount(ws, input.accountId, { isNew: true });
  const control = input.controlTotalMinor ?? null;
  if (control !== null) assertAmount(control, { field: 'controlTotalMinor' });

  const currency = {
    code: ws.workspace.currency_code,
    minorDigits: (ws.workspace.minor_digits === 0 || ws.workspace.minor_digits === 3 ? ws.workspace.minor_digits : 2) as 0 | 2 | 3,
    ...(ws.workspace.currency_symbol ? { symbol: ws.workspace.currency_symbol } : {}),
  };
  const valid: ParsedCapture['valid'] = [];
  const rowErrors: CaptureRowError[] = [];
  // Suma exacta: una fila que haría pasar la suma del lote de MAX_MINOR se marca too_large (no RangeError).
  let running = 0n;
  input.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    let amountMinor: Minor;
    if (typeof row.amount === 'number') {
      if (!Money.isValidAmount(row.amount)) {
        rowErrors.push({ index, error: 'invalid_amount' });
        return;
      }
      amountMinor = row.amount;
    } else {
      const parsed = Money.parseExpression(typeof row.amount === 'string' ? row.amount : '', { locale: deps.locale, currency });
      if (!parsed.ok) {
        rowErrors.push({ index, error: parsed.error });
        return;
      }
      amountMinor = parsed.value;
    }
    const date = row.date ?? input.date;
    if (!isStorableDate(date)) {
      rowErrors.push({ index, error: 'invalid_date' });
      return;
    }
    const draft: TxDraft = {
      accountId: input.accountId,
      kind: input.kind,
      amountMinor,
      date,
      description: typeof row.description === 'string' ? row.description.trim() : '',
      notes: (row.notes ?? '').trim(),
      ...(row.values ? { values: row.values } : {}),
    };
    try {
      for (const leg of draftLegs(draft)) assertLeg(ws, leg, { isNew: true, rawValues: normalizeValues(row.values) });
    } catch (error) {
      if (isDomainError(error)) {
        rowErrors.push({ index, error: error.code });
        return;
      }
      throw error;
    }
    if (running + BigInt(amountMinor) > BigInt(MAX_MINOR)) {
      rowErrors.push({ index, error: 'too_large' });
      return;
    }
    running += BigInt(amountMinor);
    valid.push({ index, draft });
  });
  return { ws, valid, rowErrors, sumMinor: Number(running), control };
}

// ── Lectura de lotes ─────────────────────────────────────────────────────────────────

/** Conteos lógicos: una transferencia cuenta como un movimiento. */
const BATCH_SELECT = `SELECT ${selectColumns('batches', 'b')},
  (SELECT COUNT(DISTINCT COALESCE(t.transfer_group_id, t.id)) FROM transactions t
     WHERE t.batch_id = b.id AND t.status = 'active') AS active_count,
  (SELECT COUNT(DISTINCT COALESCE(t.transfer_group_id, t.id)) FROM transactions t
     WHERE t.batch_id = b.id AND t.status = 'voided') AS voided_count,
  (SELECT COUNT(DISTINCT COALESCE(t.transfer_group_id, t.id)) FROM transactions t
     WHERE t.batch_id = b.id AND t.status = 'voided' AND t.voided_with_batch = 1) AS restorable_count
  FROM batches b`;

type BatchRow = BatchRecord & { active_count: number; voided_count: number; restorable_count: number };

async function loadBatch(ex: SqlExecutor, id: Id): Promise<Batch> {
  const r = await ex.get<BatchRow>(`${BATCH_SELECT} WHERE b.id = ?`, [id]);
  if (!r) throw new DomainError('not_found', { entity: 'batch', id });
  return toBatch(r);
}

async function workspaceOfBatch(ex: Pick<SqlExecutor, 'get'>, id: Id): Promise<Id> {
  const r = await ex.get<{ workspace_id: string }>('SELECT workspace_id FROM batches WHERE id = ?', [id]);
  if (!r) throw new DomainError('not_found', { entity: 'batch', id });
  return r.workspace_id;
}

type BatchTxRow = { id: string; account_id: string; direction: 'in' | 'out'; amount_minor: number; transfer_group_id: string | null };

/** Lado mínimo para calcular el saldo tras restaurar (solo cuenta, sentido y monto importan). */
const restoredLeg = (r: BatchTxRow): Leg => ({
  accountId: r.account_id,
  kind: 'income',
  direction: r.direction,
  amountMinor: Number(r.amount_minor),
  date: '',
  description: '',
  notes: '',
  values: {},
});

const logicalCount = (rows: readonly BatchTxRow[]) => new Set(rows.map((r) => r.transfer_group_id ?? r.id)).size;

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createBatchesService(deps: CoreDeps): BatchesService {
  return {
    async capture(input) {
      const m = await mutate(deps, input.workspaceId, 'batches.capture', async (ctx): Promise<CaptureResult> => {
        const parsed = await parseCapture(ctx.tx, deps, input);
        if (parsed.valid.length === 0) return { status: 'nothing_to_save', rowErrors: parsed.rowErrors };
        const mismatch = parsed.control !== null && parsed.control !== parsed.sumMinor;
        if (mismatch && input.acceptControlMismatch !== true) {
          return {
            status: 'control_mismatch',
            sumMinor: parsed.sumMinor,
            controlTotalMinor: parsed.control!,
            differenceMinor: Money.sub(parsed.sumMinor, parsed.control!),
          };
        }
        // Avisos por fila con el saldo corriendo en el orden de la tabla (antes de escribir).
        const perRow = await computeWarnings(
          ctx.tx,
          parsed.valid.map((v) => ({ legs: draftLegs(v.draft) })),
          { today: ctx.clock.today() },
        );
        const result = await insertBatch(
          { ...ctx, warn: () => undefined }, // los avisos van por fila, no en la mutación
          {
            workspaceId: input.workspaceId,
            batch: {
              source: 'capture',
              accountId: input.accountId,
              label: (input.label ?? '').trim(),
              controlTotalMinor: parsed.control,
              controlMismatchAccepted: mismatch,
            },
            drafts: parsed.valid.map((v) => v.draft),
          },
        );
        await ctx.audit.record(ctx.tx, {
          workspaceId: input.workspaceId,
          action: 'batch_create',
          entityType: 'batch',
          entityId: result.batchId,
          accountId: input.accountId,
          batchId: result.batchId,
          message: 'audit.batch.capture',
          params: {
            count: parsed.valid.length,
            sumMinor: parsed.sumMinor,
            kind: input.kind,
            source: 'capture',
            controlTotalMinor: parsed.control,
            controlMismatchAccepted: mismatch,
          },
          changes: [],
        });
        return {
          status: 'saved',
          batchId: result.batchId,
          savedRowIndexes: parsed.valid.map((v) => v.index),
          rowErrors: parsed.rowErrors,
          warnings: parsed.valid
            .map((v, i) => ({ index: v.index, warnings: perRow[i] ?? [] }))
            .filter((w) => w.warnings.length > 0),
        };
      });
      return m.value;
    },

    async previewCapture(input) {
      return readTx(deps, async (tx) => {
        const parsed = await parseCapture(tx, deps, input);
        return {
          sumMinor: parsed.sumMinor,
          differenceMinor: parsed.control === null ? null : Money.sub(parsed.sumMinor, parsed.control),
          rowErrors: parsed.rowErrors,
          validCount: parsed.valid.length,
        };
      });
    },

    async list(workspaceId, opts = {}) {
      const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), 1000);
      return readTx(deps, async (tx) => {
        const rows = await tx.all<BatchRow>(
          `${BATCH_SELECT} WHERE b.workspace_id = ? ${opts.source ? 'AND b.source = ?' : ''}
           ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
          opts.source ? [workspaceId, opts.source, limit] : [workspaceId, limit],
        );
        return rows.map(toBatch);
      });
    },

    async get(id) {
      return readTx(deps, (tx) => loadBatch(tx, id));
    },

    async void(id, reason) {
      const why = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
      const workspaceId = await workspaceOfBatch(deps.driver, id);
      return mutate(deps, workspaceId, 'batches.void', async (ctx) => {
        const batch = await loadBatch(ctx.tx, id);
        const rows = await ctx.tx.all<BatchTxRow>(
          `SELECT id, account_id, direction, amount_minor, transfer_group_id FROM transactions
           WHERE batch_id = ? AND status = 'active' ORDER BY account_id, seq`,
          [id],
        );
        if (rows.length === 0) throw new DomainError('already_voided', { batchId: id });
        const [warnings = []] = await computeWarnings(
          ctx.tx,
          [{ legs: [], previous: rows.map((r) => ({ accountId: r.account_id, signedMinor: Money.signed(Number(r.amount_minor), r.direction) })) }],
          { today: ctx.clock.today(), basic: false, duplicates: false },
        );
        for (const w of warnings) ctx.warn(w);
        const now = ctx.clock.now().toISOString();
        await ctx.tx.run(
          `UPDATE transactions SET status = 'voided', void_reason = ?, voided_at = ?, voided_with_batch = 1, updated_at = ?
           WHERE batch_id = ? AND status = 'active'`,
          [why, now, now, id],
        );
        const voidedCount = logicalCount(rows);
        await ctx.audit.record(ctx.tx, {
          workspaceId,
          action: 'batch_void',
          entityType: 'batch',
          entityId: id,
          accountId: batch.accountId,
          batchId: id,
          message: 'audit.batch.void',
          params: { count: voidedCount, reason: why, label: batch.label, source: batch.source },
          changes: rows.map((r) => ({ entityId: r.id, path: 'status', old: 'active', new: 'voided' })),
        });
        ctx.touch('transactions');
        return { voidedCount };
      });
    },

    async restore(id) {
      const workspaceId = await workspaceOfBatch(deps.driver, id);
      return mutate(deps, workspaceId, 'batches.restore', async (ctx) => {
        const batch = await loadBatch(ctx.tx, id);
        const rows = await ctx.tx.all<BatchTxRow>(
          `SELECT id, account_id, direction, amount_minor, transfer_group_id FROM transactions
           WHERE batch_id = ? AND status = 'voided' AND voided_with_batch = 1 ORDER BY account_id, seq`,
          [id],
        );
        if (rows.length === 0) throw new DomainError('not_voided', { batchId: id });
        const [warnings = []] = await computeWarnings(
          ctx.tx,
          [{ legs: rows.map((r) => restoredLeg(r)) }],
          { today: ctx.clock.today(), basic: false, duplicates: false },
        );
        for (const w of warnings) ctx.warn(w);
        const now = ctx.clock.now().toISOString();
        await ctx.tx.run(
          `UPDATE transactions SET status = 'active', void_reason = NULL, voided_at = NULL, voided_with_batch = 0, updated_at = ?
           WHERE batch_id = ? AND status = 'voided' AND voided_with_batch = 1`,
          [now, id],
        );
        const restoredCount = logicalCount(rows);
        await ctx.audit.record(ctx.tx, {
          workspaceId,
          action: 'batch_restore',
          entityType: 'batch',
          entityId: id,
          accountId: batch.accountId,
          batchId: id,
          message: 'audit.batch.restore',
          params: { count: restoredCount, label: batch.label, source: batch.source },
          changes: rows.map((r) => ({ entityId: r.id, path: 'status', old: 'voided', new: 'active' })),
        });
        ctx.touch('transactions');
        return { restoredCount };
      });
    },
  };
}
