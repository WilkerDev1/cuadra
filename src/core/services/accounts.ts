// Cuentas (ARCHITECTURE.md 3.5): dónde está el dinero (Caja, Banco, tarjeta). Saldo propio = Σ con signo de
// sus movimientos activos de todo tipo (I-1). Se archivan, no se borran; el orden es manual.
import { isIsoDate } from '../dates';
import { DomainError } from '../errors';
import { Money } from '../money';
import type { SqlExecutor } from '../ports';
import { insertSql, recordValues, selectColumns, toAccount, type AccountRecord } from '../sql/rows';
import { buildSearchText } from '../text';
import type { Account, AccountType, AccountWithBalance, Direction, Id, IsoDate, Minor, Mutation } from '../types';
import { mutate, readTx, type CoreDeps, type UowCtx } from '../uow';
import { assertWorkspaceCapacity, isStorableDate } from './validation';
import { requireWorkspace } from './workspaces';

export interface OpeningInput {
  amountMinor: Minor;
  direction: Direction;
  date: IsoDate;
}

export interface AccountsService {
  list(workspaceId: Id, opts?: { includeArchived?: boolean; asOf?: IsoDate }): Promise<AccountWithBalance[]>;
  get(id: Id): Promise<AccountWithBalance>;
  create(input: {
    workspaceId: Id;
    name: string;
    type?: AccountType;
    color?: string;
    icon?: string;
    opening?: OpeningInput;
  }): Promise<Mutation<Account>>; // opening con 0 → no se crea
  update(id: Id, patch: Partial<Pick<Account, 'name' | 'type' | 'color' | 'icon'>>): Promise<Mutation<Account>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Account>>; // conserva movimientos; rechaza nuevos
  unarchive(id: Id): Promise<Mutation<Account>>;
}

export const ACCOUNT_TYPES: readonly AccountType[] = ['cash', 'bank', 'card', 'savings', 'wallet', 'other'];
/** Descripción del movimiento de saldo inicial que crea el núcleo. */
export const OPENING_DESCRIPTION = 'Saldo inicial';

// ── Ayudas internas (las reutilizan plantillas y espacios dentro de su propia transacción) ──

export async function requireAccount(tx: SqlExecutor, id: Id): Promise<AccountRecord> {
  const r = await tx.get<AccountRecord>(`SELECT ${selectColumns('accounts')} FROM accounts WHERE id = ?`, [id]);
  if (r === undefined) throw new DomainError('not_found', { entity: 'account', id });
  return r;
}

/** Nombre obligatorio, recortado. */
export function cleanName(name: unknown, what: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') throw new DomainError('name_required', { field: what });
  return trimmed;
}

/** Mismo criterio que el índice único (NOCASE) y algo más estricto: sin distinguir mayúsculas. */
async function assertNameFree(tx: SqlExecutor, workspaceId: Id, name: string, exceptId: Id | null): Promise<void> {
  const rows = await tx.all<{ id: string; name: string }>(
    'SELECT id, name FROM accounts WHERE workspace_id = ? AND archived_at IS NULL',
    [workspaceId],
  );
  const wanted = name.toLocaleLowerCase('es');
  const clash = rows.find((r) => r.id !== exceptId && r.name.toLocaleLowerCase('es') === wanted);
  if (clash) throw new DomainError('duplicate_label', { entity: 'account', name, existingId: clash.id });
}

function assertType(type: unknown): asserts type is AccountType {
  if (!ACCOUNT_TYPES.includes(type as AccountType)) throw new RangeError(`tipo de cuenta inválido: ${String(type)}`);
}

/** Valida un saldo inicial (monto entero ≥ 0, dirección, fecha real). */
export function validateOpening(opening: OpeningInput): void {
  if (!Money.isValidAmount(opening.amountMinor)) throw new DomainError('invalid_amount', { amountMinor: opening.amountMinor });
  if (opening.direction !== 'in' && opening.direction !== 'out') {
    throw new DomainError('invalid_amount', { direction: opening.direction });
  }
  if (!isStorableDate(opening.date)) throw new DomainError('invalid_date', { date: opening.date });
}

/** Inserta una cuenta dentro de la transacción del llamador (sin historial). */
export async function insertAccountTx(
  ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids'>,
  input: { workspaceId: Id; name: string; type: AccountType; color: string | null; icon: string | null; sortOrder?: number },
): Promise<Account> {
  const now = ctx.clock.now().toISOString();
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const max = await ctx.tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM accounts WHERE workspace_id = ?', [
      input.workspaceId,
    ]);
    sortOrder = max?.m === null || max?.m === undefined ? 0 : max.m + 1;
  }
  const record: AccountRecord = {
    id: ctx.ids.next(),
    workspace_id: input.workspaceId,
    name: input.name,
    type: input.type,
    color: input.color,
    icon: input.icon,
    sort_order: sortOrder,
    next_seq: 1,
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
  await ctx.tx.run(insertSql('accounts'), recordValues('accounts', record));
  return toAccount(record);
}

/**
 * Crea el único saldo inicial de una cuenta nueva (reserva su seq en la misma transacción). Para editar
 * uno existente está transactions.setOpening; aquí solo se usa al crear cuentas y aplicar plantillas.
 */
export async function insertOpeningTx(
  ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids'>,
  input: { workspaceId: Id; accountId: Id; opening: OpeningInput },
): Promise<Id> {
  validateOpening(input.opening);
  const existing = await ctx.tx.get<{ id: string }>("SELECT id FROM transactions WHERE account_id = ? AND kind = 'opening'", [
    input.accountId,
  ]);
  if (existing) throw new DomainError('opening_exists', { accountId: input.accountId, transactionId: existing.id });
  await assertWorkspaceCapacity(ctx.tx, input.workspaceId, input.opening.amountMinor);
  const reserved = await ctx.tx.get<{ seq: number }>(
    'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
    [input.accountId],
  );
  if (reserved === undefined) throw new DomainError('not_found', { entity: 'account', id: input.accountId });
  const id = ctx.ids.next();
  const now = ctx.clock.now().toISOString();
  await ctx.tx.run(
    insertSql('transactions'),
    recordValues('transactions', {
      id,
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      seq: reserved.seq,
      kind: 'opening',
      direction: input.opening.direction,
      amount_minor: input.opening.amountMinor,
      date: input.opening.date,
      description: OPENING_DESCRIPTION,
      notes: '',
      search_text: buildSearchText(OPENING_DESCRIPTION, ''),
      status: 'active',
      void_reason: null,
      voided_at: null,
      voided_with_batch: 0,
      batch_id: null,
      transfer_group_id: null,
      recorded_at: now,
      updated_at: now,
    }),
  );
  return id;
}

/** Cuentas con saldo, última fecha y saldo inicial. `asOf` limita el saldo a esa fecha (incluida). */
export async function accountsWithBalance(
  tx: SqlExecutor,
  where: { workspaceId?: Id; accountId?: Id; includeArchived: boolean; asOf: IsoDate | null },
): Promise<AccountWithBalance[]> {
  const conds: string[] = [];
  const params: Record<string, string | null> = { asOf: where.asOf };
  if (where.workspaceId !== undefined) {
    conds.push('a.workspace_id = :ws');
    params['ws'] = where.workspaceId;
  }
  if (where.accountId !== undefined) {
    conds.push('a.id = :id');
    params['id'] = where.accountId;
  }
  if (!where.includeArchived) conds.push('a.archived_at IS NULL');
  const rows = await tx.all<AccountRecord & { balance_minor: number; last_date: string | null; opening_id: string | null }>(
    `SELECT ${selectColumns('accounts', 'a')},
       COALESCE((SELECT SUM(CASE t.direction WHEN 'in' THEN t.amount_minor ELSE -t.amount_minor END)
                 FROM transactions t
                 WHERE t.account_id = a.id AND t.status = 'active' AND (:asOf IS NULL OR t.date <= :asOf)), 0) AS balance_minor,
       (SELECT MAX(t.date) FROM transactions t
        WHERE t.account_id = a.id AND t.status = 'active' AND (:asOf IS NULL OR t.date <= :asOf)) AS last_date,
       (SELECT t.id FROM transactions t WHERE t.account_id = a.id AND t.kind = 'opening') AS opening_id
     FROM accounts a
     ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY a.sort_order, a.created_at, a.id`,
    params,
  );
  return rows.map((r) => {
    const balance = Number(r.balance_minor);
    return {
      ...toAccount(r),
      balanceMinor: balance,
      lastMovementDate: r.last_date,
      isNegative: balance < 0,
      openingTransactionId: r.opening_id,
    };
  });
}

type AccountPatch = Partial<Pick<Account, 'name' | 'type' | 'color' | 'icon'>>;

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createAccountsService(deps: CoreDeps): AccountsService {
  async function audited(
    ctx: UowCtx,
    record: AccountRecord,
    action: 'create' | 'edit' | 'archive' | 'unarchive',
    message: string,
    changes: Array<{ path: string; old?: unknown; new?: unknown }>,
    params: Record<string, unknown> | null = null,
  ): Promise<void> {
    await ctx.audit.record(ctx.tx, {
      workspaceId: record.workspace_id,
      action,
      entityType: 'account',
      entityId: record.id,
      accountId: record.id,
      batchId: null,
      message,
      params: params ?? { name: record.name },
      changes: changes.map((c) => ({ entityId: record.id, ...c })),
    });
  }

  async function setArchived(id: Id, archived: boolean): Promise<Mutation<Account>> {
    const before = await readTx(deps, (tx) => requireAccount(tx, id));
    return mutate(deps, before.workspace_id, archived ? 'account.archive' : 'account.unarchive', async (ctx) => {
      const current = await requireAccount(ctx.tx, id);
      if ((current.archived_at !== null) === archived) return toAccount(current);
      if (!archived) await assertNameFree(ctx.tx, current.workspace_id, current.name, id);
      const now = ctx.clock.now().toISOString();
      const archivedAt = archived ? now : null;
      await ctx.tx.run('UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?', [archivedAt, now, id]);
      const next = { ...current, archived_at: archivedAt, updated_at: now };
      await audited(ctx, next, archived ? 'archive' : 'unarchive', archived ? 'audit.account.archive' : 'audit.account.unarchive', [
        { path: 'archived_at', old: current.archived_at, new: archivedAt },
      ]);
      ctx.touch('accounts');
      return toAccount(next);
    });
  }

  return {
    async list(workspaceId, opts = {}) {
      if (opts.asOf !== undefined && !isIsoDate(opts.asOf)) throw new DomainError('invalid_date', { asOf: opts.asOf });
      return readTx(deps, async (tx) => {
        await requireWorkspace(tx, workspaceId);
        return accountsWithBalance(tx, {
          workspaceId,
          includeArchived: opts.includeArchived ?? false,
          asOf: opts.asOf ?? null,
        });
      });
    },

    async get(id) {
      return readTx(deps, async (tx) => {
        const [row] = await accountsWithBalance(tx, { accountId: id, includeArchived: true, asOf: null });
        if (row === undefined) throw new DomainError('not_found', { entity: 'account', id });
        return row;
      });
    },

    async create(input) {
      const name = cleanName(input.name, 'name');
      const type = input.type ?? 'cash';
      assertType(type);
      const opening = input.opening;
      if (opening !== undefined) validateOpening(opening);
      return mutate(deps, input.workspaceId, 'account.create', async (ctx) => {
        const ws = await requireWorkspace(ctx.tx, input.workspaceId);
        if (ws.archived_at !== null) throw new DomainError('workspace_archived', { workspaceId: ws.id });
        await assertNameFree(ctx.tx, ws.id, name, null);
        const account = await insertAccountTx(ctx, {
          workspaceId: ws.id,
          name,
          type,
          color: input.color ?? null,
          icon: input.icon ?? null,
        });
        ctx.touch('accounts');
        let openingId: Id | null = null;
        if (opening !== undefined && opening.amountMinor > 0) {
          openingId = await insertOpeningTx(ctx, { workspaceId: ws.id, accountId: account.id, opening });
          ctx.touch('transactions');
        }
        const snapshot: Record<string, unknown> = { name, type, color: account.color, icon: account.icon };
        if (openingId !== null && opening !== undefined) {
          snapshot['opening'] = {
            transactionId: openingId,
            amountMinor: opening.amountMinor,
            direction: opening.direction,
            date: opening.date,
          };
        }
        const record = await requireAccount(ctx.tx, account.id);
        await audited(ctx, record, 'create', 'audit.account.create', [{ path: '*', new: snapshot }]);
        return toAccount(record);
      });
    },

    async update(id, patch) {
      const before = await readTx(deps, (tx) => requireAccount(tx, id));
      return mutate(deps, before.workspace_id, 'account.update', async (ctx) => {
        const current = await requireAccount(ctx.tx, id);
        const next: AccountRecord = { ...current };
        const p = patch as AccountPatch;
        if (p.name !== undefined) next.name = cleanName(p.name, 'name');
        if (p.type !== undefined) {
          assertType(p.type);
          next.type = p.type;
        }
        if (p.color !== undefined) next.color = p.color;
        if (p.icon !== undefined) next.icon = p.icon;
        const changes: Array<{ path: string; old: unknown; new: unknown }> = [];
        for (const key of ['name', 'type', 'color', 'icon'] as const) {
          if (next[key] !== current[key]) changes.push({ path: key, old: current[key], new: next[key] });
        }
        if (changes.length === 0) return toAccount(current);
        if (next.name.toLocaleLowerCase('es') !== current.name.toLocaleLowerCase('es') && current.archived_at === null) {
          await assertNameFree(ctx.tx, current.workspace_id, next.name, id);
        }
        next.updated_at = ctx.clock.now().toISOString();
        await ctx.tx.run('UPDATE accounts SET name = ?, type = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?', [
          next.name,
          next.type,
          next.color,
          next.icon,
          next.updated_at,
          id,
        ]);
        const renamed = changes.some((c) => c.path === 'name');
        await audited(ctx, next, 'edit', renamed ? 'audit.account.rename' : 'audit.account.edit', changes, {
          name: next.name,
          ...(renamed ? { oldName: current.name } : {}),
        });
        ctx.touch('accounts');
        return toAccount(next);
      });
    },

    async reorder(workspaceId, ids) {
      await mutate(deps, workspaceId, 'account.reorder', async (ctx) => {
        await requireWorkspace(ctx.tx, workspaceId);
        const rows = await ctx.tx.all<{ id: string }>('SELECT id FROM accounts WHERE workspace_id = ?', [workspaceId]);
        const known = new Set(rows.map((r) => r.id));
        const unknown = ids.find((id) => !known.has(id));
        if (unknown !== undefined) throw new DomainError('not_found', { entity: 'account', id: unknown });
        if (new Set(ids).size !== ids.length) throw new RangeError('ids repetidos al ordenar cuentas');
        await ctx.tx.runMany(
          'UPDATE accounts SET sort_order = ? WHERE id = ? AND sort_order <> ?',
          ids.map((id, i) => [i, id, i]),
        );
        ctx.touch('accounts');
      });
    },

    archive: (id) => setArchived(id, true),
    unarchive: (id) => setArchived(id, false),
  };
}
