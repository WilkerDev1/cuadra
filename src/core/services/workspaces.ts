// Espacios (ARCHITECTURE.md 3.5): un libro independiente por negocio o por cliente del despacho, con su
// propia moneda. Se archivan y se recuperan; el borrado definitivo (F-03) exige escribir el nombre exacto
// y corre en modo mantenimiento dentro de una sola transacción.
import { DomainError } from '../errors';
import type { SqlExecutor } from '../ports';
import { insertSql, recordValues, selectColumns, toWorkspace, type WorkspaceRecord } from '../sql/rows';
import type { Currency, Id, Mutation, Workspace, WorkspaceSummary } from '../types';
import { mutate, readTx, type CoreDeps, type UowCtx } from '../uow';

export interface WorkspacesService {
  list(opts?: { includeArchived?: boolean }): Promise<WorkspaceSummary[]>;
  get(id: Id): Promise<Workspace>;
  create(input: { name: string; ownerName?: string; currency?: Currency; color?: string }): Promise<Mutation<Workspace>>;
  update(
    id: Id,
    patch: Partial<Pick<Workspace, 'name' | 'ownerName' | 'logoDataUrl' | 'color'>> & {
      currency?: Currency; // minorDigits solo cambia si no hay movimientos → 'currency_locked'
    },
  ): Promise<Mutation<Workspace>>;
  reorder(ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Workspace>>;
  unarchive(id: Id): Promise<Mutation<Workspace>>;
  /** F-03: exige escribir el nombre exacto; el llamador hace antes una copia automática. */
  purge(id: Id, confirmName: string): Promise<void>;
}

export const DEFAULT_CURRENCY: Currency = Object.freeze({ code: 'DOP', minorDigits: 2 }) as Currency;
const MAINTENANCE_KEY = 'sys.maintenance';

// ── Ayudas internas ──────────────────────────────────────────────────────────────────

export async function requireWorkspace(tx: SqlExecutor, id: Id): Promise<WorkspaceRecord> {
  const r = await tx.get<WorkspaceRecord>(`SELECT ${selectColumns('workspaces')} FROM workspaces WHERE id = ?`, [id]);
  if (r === undefined) throw new DomainError('not_found', { entity: 'workspace', id });
  return r;
}

/** Comprueba y normaliza una moneda (código ISO de tres letras, 0/2/3 decimales, símbolo corto). */
export function normalizeCurrency(c: Currency): Currency {
  const code = typeof c?.code === 'string' ? c.code.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) throw new DomainError('invalid_currency', { code: String(c?.code) });
  if (c.minorDigits !== 0 && c.minorDigits !== 2 && c.minorDigits !== 3) {
    throw new DomainError('invalid_currency', { minorDigits: c.minorDigits });
  }
  const out: Currency = { code, minorDigits: c.minorDigits };
  const symbol = typeof c.symbol === 'string' ? c.symbol.trim() : '';
  if (symbol !== '') out.symbol = symbol;
  return out;
}

function cleanWorkspaceName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') throw new DomainError('name_required', { field: 'name' });
  return trimmed;
}

function assertLogo(logo: string | null): void {
  if (logo !== null && !logo.startsWith('data:image/')) throw new RangeError('el logo debe ser una imagen data:image/…');
}

/** Inserta un espacio dentro de la transacción del llamador (sin historial). */
export async function insertWorkspaceTx(
  ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids'>,
  input: {
    id?: Id;
    name: string;
    ownerName?: string;
    currency?: Currency;
    color?: string | null;
    templateId?: string | null;
    isDemo?: boolean;
  },
): Promise<WorkspaceRecord> {
  const now = ctx.clock.now().toISOString();
  const currency = normalizeCurrency(input.currency ?? DEFAULT_CURRENCY);
  const max = await ctx.tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM workspaces');
  const record: WorkspaceRecord = {
    id: input.id ?? ctx.ids.next(),
    name: cleanWorkspaceName(input.name),
    owner_name: (input.ownerName ?? '').trim(),
    template_id: input.templateId ?? null,
    currency_code: currency.code,
    currency_symbol: currency.symbol ?? null,
    minor_digits: currency.minorDigits,
    logo_data_url: null,
    color: input.color ?? null,
    sort_order: max?.m === null || max?.m === undefined ? 0 : max.m + 1,
    is_demo: input.isDemo ? 1 : 0,
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
  await ctx.tx.run(insertSql('workspaces'), recordValues('workspaces', record));
  return record;
}

/** Instantánea legible para el historial ('*' al crear). */
export function workspaceSnapshot(r: WorkspaceRecord): Record<string, unknown> {
  return {
    name: r.name,
    ownerName: r.owner_name,
    templateId: r.template_id,
    currency: { code: r.currency_code, minorDigits: r.minor_digits, symbol: r.currency_symbol },
    color: r.color,
    isDemo: r.is_demo === 1,
  };
}

// Orden de borrado: de las hojas a la raíz (inverso de las claves foráneas).
const PURGE_STATEMENTS: readonly string[] = [
  'DELETE FROM audit_log_changes WHERE action_id IN (SELECT id FROM audit_log WHERE workspace_id = :ws)',
  'DELETE FROM audit_log WHERE workspace_id = :ws',
  'DELETE FROM transaction_field_values WHERE transaction_id IN (SELECT id FROM transactions WHERE workspace_id = :ws)',
  'DELETE FROM transactions WHERE workspace_id = :ws',
  'DELETE FROM batches WHERE workspace_id = :ws',
  'UPDATE field_options SET merged_into_id = NULL WHERE field_id IN (SELECT id FROM fields WHERE workspace_id = :ws)',
  'DELETE FROM field_options WHERE field_id IN (SELECT id FROM fields WHERE workspace_id = :ws)',
  'DELETE FROM fields WHERE workspace_id = :ws',
  'DELETE FROM saved_views WHERE workspace_id = :ws',
  'DELETE FROM accounts WHERE workspace_id = :ws',
  'DELETE FROM settings WHERE scope_id = :ws',
  'DELETE FROM workspaces WHERE id = :ws',
];

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createWorkspacesService(deps: CoreDeps): WorkspacesService {
  async function setArchived(id: Id, archived: boolean): Promise<Mutation<Workspace>> {
    return mutate(deps, id, archived ? 'workspace.archive' : 'workspace.unarchive', async (ctx) => {
      const current = await requireWorkspace(ctx.tx, id);
      if ((current.archived_at !== null) === archived) return toWorkspace(current);
      const now = ctx.clock.now().toISOString();
      const archivedAt = archived ? now : null;
      await ctx.tx.run('UPDATE workspaces SET archived_at = ?, updated_at = ? WHERE id = ?', [archivedAt, now, id]);
      await ctx.audit.record(ctx.tx, {
        workspaceId: id,
        action: archived ? 'archive' : 'unarchive',
        entityType: 'workspace',
        entityId: id,
        accountId: null,
        batchId: null,
        message: archived ? 'audit.workspace.archive' : 'audit.workspace.unarchive',
        params: { name: current.name },
        changes: [{ entityId: id, path: 'archived_at', old: current.archived_at, new: archivedAt }],
      });
      ctx.touch('workspaces');
      return toWorkspace({ ...current, archived_at: archivedAt, updated_at: now });
    });
  }

  return {
    async list(opts = {}) {
      const rows = await deps.driver.all<
        WorkspaceRecord & { balance_minor: number; account_count: number; last_date: string | null }
      >(
        `SELECT ${selectColumns('workspaces', 'w')},
           COALESCE((SELECT SUM(CASE t.direction WHEN 'in' THEN t.amount_minor ELSE -t.amount_minor END)
                     FROM transactions t WHERE t.workspace_id = w.id AND t.status = 'active'), 0) AS balance_minor,
           (SELECT COUNT(*) FROM accounts a WHERE a.workspace_id = w.id AND a.archived_at IS NULL) AS account_count,
           (SELECT MAX(t.date) FROM transactions t WHERE t.workspace_id = w.id AND t.status = 'active') AS last_date
         FROM workspaces w
         ${opts.includeArchived ? '' : 'WHERE w.archived_at IS NULL'}
         ORDER BY w.archived_at IS NOT NULL, w.sort_order, w.created_at, w.id`,
      );
      return rows.map((r) => ({
        ...toWorkspace(r),
        balanceMinor: Number(r.balance_minor),
        accountCount: Number(r.account_count),
        lastMovementDate: r.last_date,
      }));
    },

    async get(id) {
      return toWorkspace(await readTx(deps, (tx) => requireWorkspace(tx, id)));
    },

    async create(input) {
      const name = cleanWorkspaceName(input.name);
      const currency = normalizeCurrency(input.currency ?? DEFAULT_CURRENCY);
      // El id se reserva antes para que el evento ya lleve el espacio nuevo.
      const id = deps.ids.next();
      return mutate(deps, id, 'workspace.create', async (ctx) => {
        const record = await insertWorkspaceTx(ctx, {
          id,
          name,
          currency,
          color: input.color ?? null,
          ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
        });
        await ctx.audit.record(ctx.tx, {
          workspaceId: record.id,
          action: 'create',
          entityType: 'workspace',
          entityId: record.id,
          accountId: null,
          batchId: null,
          message: 'audit.workspace.create',
          params: { name: record.name },
          changes: [{ entityId: record.id, path: '*', new: workspaceSnapshot(record) }],
        });
        ctx.touch('workspaces');
        return toWorkspace(record);
      });
    },

    async update(id, patch) {
      return mutate(deps, id, 'workspace.update', async (ctx) => {
        const current = await requireWorkspace(ctx.tx, id);
        const next: WorkspaceRecord = { ...current };
        if (patch.name !== undefined) next.name = cleanWorkspaceName(patch.name);
        if (patch.ownerName !== undefined) next.owner_name = patch.ownerName.trim();
        if (patch.logoDataUrl !== undefined) {
          assertLogo(patch.logoDataUrl);
          next.logo_data_url = patch.logoDataUrl;
        }
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.currency !== undefined) {
          const c = normalizeCurrency(patch.currency);
          next.currency_code = c.code;
          next.currency_symbol = c.symbol ?? null;
          next.minor_digits = c.minorDigits;
        }
        const columns = [
          ['name', 'name'],
          ['owner_name', 'ownerName'],
          ['logo_data_url', 'logoDataUrl'],
          ['color', 'color'],
          ['currency_code', 'currency.code'],
          ['currency_symbol', 'currency.symbol'],
          ['minor_digits', 'currency.minorDigits'],
        ] as const;
        const changes = columns
          .filter(([col]) => next[col] !== current[col])
          .map(([col, path]) => ({ entityId: id, path, old: current[col], new: next[col] }));
        if (changes.length === 0) return toWorkspace(current);
        if (next.minor_digits !== current.minor_digits) {
          const used = await ctx.tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ?', [id]);
          if ((used?.n ?? 0) > 0) throw new DomainError('currency_locked', { workspaceId: id, transactions: used?.n });
        }
        next.updated_at = ctx.clock.now().toISOString();
        await ctx.tx.run(
          `UPDATE workspaces SET name = ?, owner_name = ?, logo_data_url = ?, color = ?, currency_code = ?,
             currency_symbol = ?, minor_digits = ?, updated_at = ? WHERE id = ?`,
          [
            next.name,
            next.owner_name,
            next.logo_data_url,
            next.color,
            next.currency_code,
            next.currency_symbol,
            next.minor_digits,
            next.updated_at,
            id,
          ],
        );
        await ctx.audit.record(ctx.tx, {
          workspaceId: id,
          action: 'edit',
          entityType: 'workspace',
          entityId: id,
          accountId: null,
          batchId: null,
          message: changes.some((c) => c.path === 'name') ? 'audit.workspace.rename' : 'audit.workspace.edit',
          params: { name: next.name },
          changes,
        });
        ctx.touch('workspaces');
        return toWorkspace(next);
      });
    },

    async reorder(ids) {
      await mutate(deps, null, 'workspace.reorder', async (ctx) => {
        const rows = await ctx.tx.all<{ id: string }>('SELECT id FROM workspaces');
        const known = new Set(rows.map((r) => r.id));
        const unknown = ids.find((id) => !known.has(id));
        if (unknown !== undefined) throw new DomainError('not_found', { entity: 'workspace', id: unknown });
        if (new Set(ids).size !== ids.length) throw new RangeError('ids repetidos al ordenar espacios');
        await ctx.tx.runMany(
          'UPDATE workspaces SET sort_order = ? WHERE id = ? AND sort_order <> ?',
          ids.map((id, i) => [i, id, i]),
        );
        ctx.touch('workspaces');
      });
    },

    archive: (id) => setArchived(id, true),
    unarchive: (id) => setArchived(id, false),

    async purge(id, confirmName) {
      await mutate(deps, id, 'workspace.purge', async (ctx) => {
        const current = await requireWorkspace(ctx.tx, id);
        if (confirmName !== current.name) {
          throw new DomainError('confirmation_mismatch', { expected: current.name });
        }
        const counts = await ctx.tx.get<{ accounts: number; transactions: number }>(
          `SELECT (SELECT COUNT(*) FROM accounts WHERE workspace_id = :ws) AS accounts,
                  (SELECT COUNT(*) FROM transactions WHERE workspace_id = :ws) AS transactions`,
          { ws: id },
        );
        const now = ctx.clock.now().toISOString();
        await ctx.tx.run('INSERT INTO settings (scope_id, key, value, updated_at) VALUES (?, ?, ?, ?)', [
          '',
          MAINTENANCE_KEY,
          JSON.stringify({ reason: 'workspace_purge', workspaceId: id }),
          now,
        ]);
        for (const sql of PURGE_STATEMENTS) await ctx.tx.run(sql, { ws: id });
        await ctx.tx.run(
          "UPDATE settings SET value = 'null', updated_at = ? WHERE scope_id = '' AND key = 'workspace.lastOpened' AND value = ?",
          [now, JSON.stringify(id)],
        );
        await ctx.tx.run("DELETE FROM settings WHERE scope_id = '' AND key = ?", [MAINTENANCE_KEY]);
        // Queda constancia en el historial de instalación (el del espacio se fue con él).
        await ctx.audit.record(ctx.tx, {
          workspaceId: null,
          action: 'config',
          entityType: 'workspace',
          entityId: id,
          accountId: null,
          batchId: null,
          message: 'audit.workspace.purge',
          params: { name: current.name, accounts: counts?.accounts ?? 0, transactions: counts?.transactions ?? 0 },
          changes: [{ entityId: id, path: '*', old: workspaceSnapshot(current) }],
        });
        ctx.touch(
          'workspaces',
          'accounts',
          'transactions',
          'transaction_field_values',
          'batches',
          'fields',
          'field_options',
          'saved_views',
          'settings',
        );
      });
    },
  };
}
