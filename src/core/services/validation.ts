// Validaciones duras y suaves de movimientos (ARCHITECTURE.md 3.5, pruebas 83–85). Interno: lo usan
// transactions, batches e importCsv dentro de su transacción.
//
// - Duras: lanzan DomainError antes de escribir (invalid_amount, invalid_date, description_required,
//   account_archived, workspace_archived, workspace_mismatch, field_inactive, option_inactive…). Las del
//   esquema (UNIQUE, CHECK, GLOB de fechas) se adelantan aquí para que nunca lleguen como SqlError.
// - Suaves: avisos que no bloquean (zero_amount, far_date, possible_duplicate, before_opening,
//   negative_balance). Se calculan por lotes: pocas consultas aunque haya miles de filas.
import { diffDays, isIsoDate } from '../dates';
import { DomainError } from '../errors';
import { MAX_MINOR, Money } from '../money';
import type { SqlExecutor } from '../ports';
import {
  groupFieldValues,
  selectColumns,
  type AccountRecord,
  type FieldValueRecord,
  type FieldOptionRecord,
  type FieldRecord,
  type WorkspaceRecord,
} from '../sql/rows';
import { editDistance, normalizeSearch } from '../text';
import type { Direction, FieldValue, FieldValues, Id, IsoDate, Minor, TxKind, Warning } from '../types';
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

// ── Contexto del espacio ─────────────────────────────────────────────────────────────

/** Lo que hace falta para validar en memoria: espacio, sus cuentas y sus campos/opciones. */
export interface WorkspaceContext {
  workspace: WorkspaceRecord;
  accounts: Map<Id, AccountRecord>;
  fields: Map<Id, FieldRecord>;
  options: Map<Id, FieldOptionRecord>;
  /** Cuentas pedidas que existen pero son de otro espacio. */
  foreignAccounts: Set<Id>;
}

/** Tres consultas, sea cual sea el tamaño del lote. `not_found` si el espacio no existe. */
export async function loadWorkspaceContext(tx: SqlExecutor, workspaceId: Id): Promise<WorkspaceContext> {
  const workspace = await tx.get<WorkspaceRecord>(`SELECT ${selectColumns('workspaces')} FROM workspaces WHERE id = ?`, [
    workspaceId,
  ]);
  if (!workspace) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
  const accounts = await tx.all<AccountRecord>(`SELECT ${selectColumns('accounts')} FROM accounts WHERE workspace_id = ?`, [
    workspaceId,
  ]);
  const fields = await tx.all<FieldRecord>(`SELECT ${selectColumns('fields')} FROM fields WHERE workspace_id = ?`, [
    workspaceId,
  ]);
  const options = await tx.all<FieldOptionRecord>(
    `SELECT ${selectColumns('field_options', 'o')} FROM field_options o JOIN fields f ON f.id = o.field_id
     WHERE f.workspace_id = ?`,
    [workspaceId],
  );
  return {
    workspace,
    accounts: new Map(accounts.map((a) => [a.id, a])),
    fields: new Map(fields.map((f) => [f.id, f])),
    options: new Map(options.map((o) => [o.id, o])),
    foreignAccounts: new Set(),
  };
}

/** Marca en el contexto qué cuentas desconocidas existen en otro espacio (una consulta). */
export async function resolveForeignAccounts(tx: SqlExecutor, ctx: WorkspaceContext, accountIds: Iterable<Id>): Promise<void> {
  const unknown = [...new Set(accountIds)].filter((id) => !ctx.accounts.has(id) && !ctx.foreignAccounts.has(id));
  if (unknown.length === 0) return;
  const rows = await tx.all<{ id: string }>(
    `SELECT id FROM accounts WHERE id IN (${unknown.map(() => '?').join(', ')})`,
    unknown,
  );
  for (const r of rows) ctx.foreignAccounts.add(r.id);
}

/** Espacio de una cuenta (inmutable), o `not_found`. */
export async function workspaceOfAccount(ex: Pick<SqlExecutor, 'get'>, accountId: Id): Promise<Id> {
  const row = await ex.get<{ workspace_id: string }>('SELECT workspace_id FROM accounts WHERE id = ?', [accountId]);
  if (!row) throw new DomainError('not_found', { entity: 'account', id: accountId });
  return row.workspace_id;
}

// ── Filas normalizadas ───────────────────────────────────────────────────────────────

/** Un lado de movimiento tal como se va a guardar (una fila de `transactions`). */
export interface Leg {
  accountId: Id;
  kind: TxKind;
  direction: Direction;
  amountMinor: Minor;
  date: IsoDate;
  description: string;
  notes: string;
  values: FieldValues;
}

/** Texto vacío = sin valor. Devuelve una copia con las claves en el orden recibido. */
export function normalizeValues(values: Readonly<Record<Id, FieldValue | null>> | undefined): Record<Id, FieldValue | null> {
  const out: Record<Id, FieldValue | null> = {};
  if (!values) return out;
  for (const [fieldId, v] of Object.entries(values)) {
    if (v === null || v === undefined) {
      out[fieldId] = null;
    } else if (v.type === 'text' && typeof v.value === 'string' && v.value.trim() === '') {
      out[fieldId] = null;
    } else {
      out[fieldId] = v;
    }
  }
  return out;
}

/** Quita los null (para un alta). */
export function presentValues(values: Readonly<Record<Id, FieldValue | null>>): FieldValues {
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(values)) if (v !== null) out[k] = v;
  return out;
}

export function fieldValueEquals(a: FieldValue | null | undefined, b: FieldValue | null | undefined): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null);
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'list':
      return a.optionId === (b as typeof a).optionId;
    default:
      return Object.is(a.value, (b as typeof a).value);
  }
}

// ── Validaciones duras (en memoria, con el contexto ya cargado) ───────────────────────

/** Fecha real del calendario y dentro del rango que admite el esquema (años 1000–2999). */
export function isStorableDate(value: unknown): value is IsoDate {
  return isIsoDate(value) && (value.startsWith('1') || value.startsWith('2'));
}

export function assertAmount(amount: unknown, details?: Record<string, unknown>): asserts amount is Minor {
  if (!Money.isValidAmount(amount)) throw new DomainError('invalid_amount', { ...details, amount });
}

export function assertDate(date: unknown, details?: Record<string, unknown>): asserts date is IsoDate {
  if (!isStorableDate(date)) throw new DomainError('invalid_date', { ...details, date });
}

export function assertDescription(description: unknown, details?: Record<string, unknown>): void {
  if (typeof description !== 'string' || description.trim() === '') {
    throw new DomainError('description_required', details);
  }
}

/** La cuenta es del espacio; si `isNew`, ni ella ni el espacio están archivados. */
export function assertAccount(ctx: WorkspaceContext, accountId: Id, opts: { isNew: boolean }): AccountRecord {
  const account = ctx.accounts.get(accountId);
  if (!account) {
    if (ctx.foreignAccounts.has(accountId)) throw new DomainError('workspace_mismatch', { accountId });
    throw new DomainError('not_found', { entity: 'account', id: accountId });
  }
  if (opts.isNew) {
    if (ctx.workspace.archived_at !== null) throw new DomainError('workspace_archived', { workspaceId: ctx.workspace.id });
    if (account.archived_at !== null) throw new DomainError('account_archived', { accountId });
  }
  return account;
}

function valueShapeOk(field: FieldRecord, v: FieldValue, ctx: WorkspaceContext): boolean {
  if (v.type !== field.type) return false;
  switch (v.type) {
    case 'text':
      return typeof v.value === 'string';
    case 'number':
      return typeof v.value === 'number' && Number.isFinite(v.value);
    case 'date':
      return isStorableDate(v.value);
    case 'bool':
      return typeof v.value === 'boolean';
    case 'list':
      return ctx.options.get(v.optionId)?.field_id === field.id;
  }
}

/**
 * Valores de campos: el campo es del espacio, el valor usa su tipo, la opción es del campo.
 * Un valor NUEVO (distinto del que ya tenía el movimiento) no puede usar un campo ni una opción
 * inactivos; uno que no cambia se conserva (F-56: editar un movimiento viejo).
 */
export function assertValues(
  ctx: WorkspaceContext,
  values: Readonly<Record<Id, FieldValue | null>>,
  previous: FieldValues = {},
): void {
  for (const [fieldId, v] of Object.entries(values)) {
    const field = ctx.fields.get(fieldId);
    if (!field) throw new DomainError('not_found', { entity: 'field', id: fieldId });
    if (v === null) continue; // vaciar siempre se puede
    if (!valueShapeOk(field, v, ctx)) throw new DomainError('field_value_type_mismatch', { fieldId });
    if (fieldValueEquals(previous[fieldId], v)) continue;
    if (field.deactivated_at !== null) throw new DomainError('field_inactive', { fieldId });
    if (v.type === 'list' && ctx.options.get(v.optionId)?.deactivated_at !== null) {
      throw new DomainError('option_inactive', { fieldId, optionId: v.optionId });
    }
  }
}

/**
 * Techo de volumen del espacio: la suma de los montos de TODOS sus movimientos (activos y anulados, que se
 * pueden restaurar; una transferencia cuenta sus dos lados) no pasa de MAX_MINOR. Así cualquier saldo, total o
 * grupo —que es una suma con signo de un subconjunto de esas filas— cabe en un entero seguro y nunca rompe
 * Money.add ni la lectura de SUM(). 2^53 en unidad menor son unos 90 billones de pesos: no limita a nadie.
 * La comparación se hace dentro de SQLite (enteros de 64 bits exactos), no en JS.
 */
export async function assertWorkspaceCapacity(
  tx: Pick<SqlExecutor, 'get'>,
  workspaceId: Id,
  addedMinor: number,
): Promise<void> {
  if (!(addedMinor > 0)) return;
  if (!Number.isSafeInteger(addedMinor)) throw new DomainError('invalid_amount', { reason: 'workspace_total_too_large' });
  const row = await tx.get<{ over: number }>(
    'SELECT (COALESCE(SUM(amount_minor), 0) + ?) > ? AS over FROM transactions WHERE workspace_id = ?',
    [addedMinor, MAX_MINOR, workspaceId],
  );
  if (Number(row?.over ?? 0) !== 0) {
    throw new DomainError('invalid_amount', { reason: 'workspace_total_too_large', max: MAX_MINOR });
  }
}

/** Suma exacta de montos que ya son enteros seguros válidos; si se pasa de MAX_MINOR, invalid_amount. */
export function sumAmountsOrThrow(amounts: Iterable<number>): Minor {
  let total = 0n;
  for (const a of amounts) total += BigInt(a);
  if (total > BigInt(MAX_MINOR)) throw new DomainError('invalid_amount', { reason: 'workspace_total_too_large', max: MAX_MINOR });
  return Number(total);
}

/** Todas las comprobaciones duras de un lado. */
export function assertLeg(
  ctx: WorkspaceContext,
  leg: Leg,
  opts: { isNew: boolean; previousValues?: FieldValues; rawValues?: Readonly<Record<Id, FieldValue | null>> },
): void {
  assertAccount(ctx, leg.accountId, { isNew: opts.isNew });
  assertAmount(leg.amountMinor);
  assertDate(leg.date);
  assertDescription(leg.description);
  if (leg.kind === 'income' && leg.direction !== 'in') throw new DomainError('kind_change_forbidden', { kind: leg.kind });
  if (leg.kind === 'expense' && leg.direction !== 'out') throw new DomainError('kind_change_forbidden', { kind: leg.kind });
  assertValues(ctx, opts.rawValues ?? leg.values, opts.previousValues);
}

// ── Avisos suaves ────────────────────────────────────────────────────────────────────

/** ¿Dos descripciones son "parecidas"? Sin mayúsculas ni tildes; igual, contenida o con ≤ 1–2 erratas. */
export function similarDescriptions(a: string, b: string): boolean {
  const x = normalizeSearch(a);
  const y = normalizeSearch(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  if (shorter >= 4 && (x.includes(y) || y.includes(x))) return true;
  const longer = Math.max(x.length, y.length);
  const tolerance = longer >= 8 ? 2 : longer >= 4 ? 1 : 0;
  return tolerance > 0 && Math.abs(x.length - y.length) <= tolerance && editDistance(x, y) <= tolerance;
}

/** Contribución con signo de un lado al saldo de su cuenta. */
export interface Contribution {
  accountId: Id;
  signedMinor: Minor;
}

/** Un guardado sobre el que calcular avisos. */
export interface WarnItem {
  /** Lados que quedan activos tras el guardado (lo nuevo). */
  legs: readonly Leg[];
  /** Lo que deja de contar en el saldo (estado activo anterior de lo que se edita o anula). */
  previous?: readonly Contribution[];
  /** Movimientos que no cuentan como duplicado ni como saldo inicial previo (los que se editan). */
  excludeIds?: readonly Id[];
}

export interface WarnOptions {
  today: IsoDate;
  /** zero_amount, far_date, before_opening. Por defecto true. */
  basic?: boolean;
  /** possible_duplicate (una consulta por lote). Por defecto true. */
  duplicates?: boolean;
  /** negative_balance con saldo corrido en el orden de los items. Por defecto true. */
  negative?: boolean;
}

type DuplicateCandidate = {
  id: string;
  seq: number;
  account_id: string;
  direction: string;
  amount_minor: number;
  date: string;
  description: string;
};

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * Avisos de varios guardados en orden (captura en tabla: el saldo corre fila a fila). Tolera borradores a
 * medio escribir: lo que no es válido simplemente no avisa. Como mucho tres consultas.
 */
export async function computeWarnings(tx: SqlExecutor, items: readonly WarnItem[], opts: WarnOptions): Promise<Warning[][]> {
  const basic = opts.basic ?? true;
  const duplicates = opts.duplicates ?? true;
  const negative = opts.negative ?? true;
  const accountIds = [
    ...new Set(items.flatMap((it) => [...it.legs.map((l) => l.accountId), ...(it.previous ?? []).map((p) => p.accountId)])),
  ];
  const out: Warning[][] = items.map(() => []);
  if (accountIds.length === 0) return out;
  const excluded = new Set(items.flatMap((it) => it.excludeIds ?? []));

  // Saldos actuales (todo lo activo, de cualquier fecha: I-1).
  const balances = new Map<Id, Minor>();
  if (negative) {
    const rows = await tx.all<{ account_id: string; b: number }>(
      `SELECT account_id, SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END) AS b
       FROM transactions WHERE status = 'active' AND account_id IN (${placeholders(accountIds.length)})
       GROUP BY account_id`,
      accountIds,
    );
    for (const r of rows) balances.set(r.account_id, Number(r.b));
  }

  // Saldos iniciales activos (los del propio lote mandan sobre los guardados).
  const openings = new Map<Id, IsoDate>();
  if (basic) {
    const rows = await tx.all<{ id: string; account_id: string; date: string }>(
      `SELECT id, account_id, date FROM transactions
       WHERE kind = 'opening' AND status = 'active' AND account_id IN (${placeholders(accountIds.length)})`,
      accountIds,
    );
    for (const r of rows) if (!excluded.has(r.id)) openings.set(r.account_id, r.date);
    for (const it of items) {
      for (const l of it.legs) if (l.kind === 'opening' && isStorableDate(l.date)) openings.set(l.accountId, l.date);
    }
  }

  // Candidatos a duplicado: misma cuenta, ventana de fechas del lote ± 3 días.
  const candidates = new Map<string, DuplicateCandidate[]>();
  if (duplicates) {
    const dates = items.flatMap((it) => it.legs.filter((l) => l.kind !== 'opening').map((l) => l.date)).filter(isStorableDate);
    if (dates.length > 0) {
      const min = dates.reduce((a, b) => (b < a ? b : a));
      const max = dates.reduce((a, b) => (b > a ? b : a));
      const rows = await tx.all<DuplicateCandidate>(
        `SELECT id, seq, account_id, direction, amount_minor, date, description FROM transactions
         WHERE status = 'active' AND kind <> 'opening' AND account_id IN (${placeholders(accountIds.length)})
           AND date BETWEEN date(?, '-${DUPLICATE_WINDOW_DAYS} days') AND date(?, '+${DUPLICATE_WINDOW_DAYS} days')`,
        [...accountIds, min, max],
      );
      for (const r of rows) {
        if (excluded.has(r.id)) continue;
        const key = `${r.account_id}|${r.direction}|${Number(r.amount_minor)}`;
        const list = candidates.get(key);
        if (list) list.push(r);
        else candidates.set(key, [r]);
      }
    }
  }

  const running = new Map(balances);
  items.forEach((it, index) => {
    const warnings = out[index]!;
    const seen = new Set<string>();
    const push = (w: Warning) => {
      const key = JSON.stringify(w);
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(w);
      }
    };

    if (basic) {
      for (const leg of it.legs) {
        if (leg.amountMinor === 0) push({ code: 'zero_amount' });
        if (!isStorableDate(leg.date)) continue;
        const days = diffDays(opts.today, leg.date);
        if (Math.abs(days) > FAR_DATE_DAYS) push({ code: 'far_date', days });
        const openingDate = openings.get(leg.accountId);
        if (leg.kind !== 'opening' && openingDate !== undefined && leg.date < openingDate) {
          push({ code: 'before_opening', openingDate });
        }
      }
    }

    if (duplicates) {
      for (const leg of it.legs) {
        if (leg.kind === 'opening' || !isStorableDate(leg.date) || !Money.isValidAmount(leg.amountMinor)) continue;
        const list = candidates.get(`${leg.accountId}|${leg.direction}|${leg.amountMinor}`) ?? [];
        let best: { c: DuplicateCandidate; gap: number } | null = null;
        for (const c of list) {
          const gap = Math.abs(diffDays(c.date, leg.date));
          if (gap > DUPLICATE_WINDOW_DAYS || !similarDescriptions(c.description, leg.description)) continue;
          if (!best || gap < best.gap || (gap === best.gap && Number(c.seq) > Number(best.c.seq))) best = { c, gap };
        }
        if (best) push({ code: 'possible_duplicate', transactionId: best.c.id, seq: Number(best.c.seq) });
      }
    }

    if (negative) {
      const delta = new Map<Id, Minor>();
      for (const leg of it.legs) {
        if (!Money.isValidAmount(leg.amountMinor)) continue;
        delta.set(leg.accountId, Money.add(delta.get(leg.accountId) ?? 0, Money.signed(leg.amountMinor, leg.direction)));
      }
      for (const p of it.previous ?? []) {
        delta.set(p.accountId, Money.sub(delta.get(p.accountId) ?? 0, p.signedMinor));
      }
      for (const [accountId, d] of delta) {
        const after = Money.add(running.get(accountId) ?? 0, d);
        running.set(accountId, after);
        if (d < 0 && after < 0) push({ code: 'negative_balance', accountId, balanceAfterMinor: after });
      }
    }
  });
  return out;
}

// ── Borrador → lados (para assertDraft/warnings y para el servicio de movimientos) ───────

/** Lados de un borrador de entrada/salida o de transferencia (sin validar). */
export function draftLegs(draft: TxDraft | TransferDraft): Leg[] {
  const notes = (draft.notes ?? '').trim();
  const values = presentValues(normalizeValues(draft.values));
  const description = typeof draft.description === 'string' ? draft.description.trim() : '';
  if ('fromAccountId' in draft) {
    const common = { kind: 'transfer' as const, amountMinor: draft.amountMinor, date: draft.date, description, notes, values };
    return [
      { ...common, accountId: draft.fromAccountId, direction: 'out' },
      { ...common, accountId: draft.toAccountId, direction: 'in' },
    ];
  }
  return [
    {
      accountId: draft.accountId,
      kind: draft.kind,
      direction: draft.kind === 'income' ? 'in' : 'out',
      amountMinor: draft.amountMinor,
      date: draft.date,
      description,
      notes,
      values,
    },
  ];
}

type EditingState = {
  ids: Id[];
  previous: Contribution[];
  values: FieldValues;
};

async function loadEditing(tx: SqlExecutor, editingId: Id | undefined): Promise<EditingState | null> {
  if (editingId === undefined) return null;
  const rows = await tx.all<{ id: string; account_id: string; direction: string; amount_minor: number; status: string }>(
    `SELECT id, account_id, direction, amount_minor, status FROM transactions
     WHERE id = ? OR (transfer_group_id IS NOT NULL
       AND transfer_group_id = (SELECT transfer_group_id FROM transactions WHERE id = ?))`,
    [editingId, editingId],
  );
  if (rows.length === 0) return null;
  const valueRows = await tx.all<FieldValueRecord>(
    `SELECT ${selectColumns('transaction_field_values')} FROM transaction_field_values WHERE transaction_id = ?`,
    [editingId],
  );
  const values = groupFieldValues(valueRows).get(editingId) ?? {};
  return {
    ids: rows.map((r) => r.id),
    previous: rows
      .filter((r) => r.status === 'active')
      .map((r) => ({ accountId: r.account_id, signedMinor: Money.signed(Number(r.amount_minor), r.direction as Direction) })),
    values,
  };
}

export function createValidationService(deps: Pick<CoreDeps, 'clock'>): ValidationService {
  return {
    async assertDraft(tx, workspaceId, draft, opts = {}) {
      const ctx = await loadWorkspaceContext(tx, workspaceId);
      const legs = draftLegs(draft);
      if ('fromAccountId' in draft && draft.fromAccountId === draft.toAccountId) {
        throw new DomainError('transfer_same_account', { accountId: draft.fromAccountId });
      }
      await resolveForeignAccounts(tx, ctx, legs.map((l) => l.accountId));
      const editing = await loadEditing(tx, opts.editingId);
      const rawValues = normalizeValues(draft.values);
      for (const leg of legs) {
        assertLeg(ctx, leg, {
          isNew: editing === null,
          rawValues,
          ...(editing ? { previousValues: editing.values } : {}),
        });
      }
    },

    async warnings(tx, workspaceId, draft, opts = {}) {
      const legs = draftLegs(draft);
      // Cuentas de otro espacio: el guardado las rechazaría; aquí no se avisa de nada.
      const owned = await tx.all<{ id: string }>(
        `SELECT id FROM accounts WHERE workspace_id = ? AND id IN (${placeholders(legs.length)})`,
        [workspaceId, ...legs.map((l) => l.accountId)],
      );
      const ownedIds = new Set(owned.map((r) => r.id));
      if (!legs.every((l) => ownedIds.has(l.accountId))) return [];
      const editing = await loadEditing(tx, opts.editingId);
      const [warnings] = await computeWarnings(
        tx,
        [{ legs, previous: editing?.previous ?? [], excludeIds: editing?.ids ?? [] }],
        { today: deps.clock.today() },
      );
      return warnings ?? [];
    },
  };
}
