// Historial (ARCHITECTURE.md 3.5). Solo-añadir: una acción por guardado y sus líneas de cambio
// (valor anterior y nuevo por campo). El escritor lo usa la unidad de trabajo; la lectura sirve el
// historial general (P-12, con filtros y paginación) y el de cada entidad (P-09).
import { addDays, fromIsoDate, isIsoDate } from '../dates';
import { DomainError } from '../errors';
import type { Clock, IdGen, SqlExecutor, SqlValue } from '../ports';
import {
  insertSql,
  recordValues,
  selectColumns,
  toAuditEntry,
  toJson,
  type AuditChangeRecord,
  type AuditLogRecord,
} from '../sql/rows';
import type { AuditAction, AuditEntry, FieldValue, Id, IsoDate, Page, Transaction } from '../types';
import { readTx, type CoreDeps } from '../uow';

export type { AuditAction, AuditEntry } from '../types';

export interface AuditService {
  list(
    workspaceId: Id,
    input: {
      from?: IsoDate;
      to?: IsoDate;
      accountId?: Id;
      actions?: AuditAction[];
      entityType?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<AuditEntry>>;
  forEntity(entityType: string, entityId: Id): Promise<AuditEntry[]>;
}

export type AuditRecordInput = Omit<AuditEntry, 'id' | 'at' | 'changes'> & {
  changes: Array<{ entityId?: Id; path: string; old?: unknown; new?: unknown }>;
};

// Interno, lo usan todos los servicios dentro de la misma transacción:
export interface AuditWriter {
  record(tx: SqlExecutor, entry: AuditRecordInput): Promise<Id>;
}

/** Escribe audit_log + audit_log_changes con el tx recibido. `old`/`new` undefined → NULL. */
export function createAuditWriter(deps: { clock: Clock; ids: IdGen }): AuditWriter {
  return {
    async record(tx, entry) {
      const id = deps.ids.next();
      await tx.run(
        insertSql('audit_log'),
        recordValues('audit_log', {
          id,
          workspace_id: entry.workspaceId,
          at: deps.clock.now().toISOString(),
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          account_id: entry.accountId,
          batch_id: entry.batchId,
          message: entry.message,
          params: entry.params === null ? null : toJson(entry.params),
          meta: null,
        }),
      );
      if (entry.changes.length > 0) {
        await tx.runMany(
          insertSql('audit_log_changes'),
          entry.changes.map((c, ord) =>
            recordValues('audit_log_changes', {
              action_id: id,
              ord,
              entity_id: c.entityId ?? null,
              path: c.path,
              old_value: toJson(c.old),
              new_value: toJson(c.new),
            }),
          ),
        );
      }
      return id;
    },
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────────────

function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'list') return a.optionId === (b as typeof a).optionId;
  return Object.is(a.value, (b as typeof a).value);
}

/**
 * Diff de dos instantáneas → líneas de cambio. Si no hay líneas, el servicio NO escribe acción.
 * Rutas: kind | direction (solo si el tipo no cambió: saldo inicial) | amount_minor | date | description |
 * notes | status | void_reason | field:<fieldId>. Un valor ausente es null (en ambos lados).
 */
export function diffTransaction(before: Transaction, after: Transaction): Array<{ path: string; old: unknown; new: unknown }> {
  const lines: Array<{ path: string; old: unknown; new: unknown }> = [];
  const push = (path: string, old: unknown, next: unknown) => {
    if (!Object.is(old, next)) lines.push({ path, old, new: next });
  };
  if (before.kind !== after.kind) push('kind', before.kind, after.kind);
  else push('direction', before.direction, after.direction);
  push('amount_minor', before.amountMinor, after.amountMinor);
  push('date', before.date, after.date);
  push('description', before.description, after.description);
  push('notes', before.notes, after.notes);
  push('status', before.status, after.status);
  push('void_reason', before.voidReason ?? null, after.voidReason ?? null);
  const fieldIds = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])].sort();
  for (const fieldId of fieldIds) {
    const a = before.values[fieldId];
    const b = after.values[fieldId];
    if (!sameValue(a, b)) lines.push({ path: `field:${fieldId}`, old: a ?? null, new: b ?? null });
  }
  return lines;
}

// ── Lectura ──────────────────────────────────────────────────────────────────────────

const AUDIT_COLUMNS = selectColumns('audit_log', 'a');
const CHANGE_COLUMNS = selectColumns('audit_log_changes');
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Acciones de lote que "crean" sus movimientos sin líneas por fila: el historial de cada uno las incluye. */
const BATCH_CREATE_ACTIONS: readonly AuditAction[] = ['batch_create', 'import', 'demo_seed', 'template_apply'];

/** Entradas con sus líneas (opcionalmente solo las de ciertas entidades). Orden de `records`. */
async function withChanges(
  ex: SqlExecutor,
  records: readonly AuditLogRecord[],
  onlyEntities?: readonly Id[],
): Promise<AuditEntry[]> {
  if (records.length === 0) return [];
  const ids = records.map((r) => r.id);
  let sql = `SELECT ${CHANGE_COLUMNS} FROM audit_log_changes WHERE action_id IN (${marks(ids.length)})`;
  const params: SqlValue[] = [...ids];
  if (onlyEntities && onlyEntities.length > 0) {
    sql += ` AND (entity_id IS NULL OR entity_id IN (${marks(onlyEntities.length)}))`;
    params.push(...onlyEntities);
  }
  const changes = await ex.all<AuditChangeRecord>(`${sql} ORDER BY action_id, ord`, params);
  const byAction = new Map<Id, AuditChangeRecord[]>();
  for (const c of changes) {
    const list = byAction.get(c.action_id);
    if (list) list.push(c);
    else byAction.set(c.action_id, [c]);
  }
  return records.map((r) => toAuditEntry(r, byAction.get(r.id) ?? []));
}

/**
 * Historial de un movimiento, más reciente primero: sus acciones propias, las de su transferencia (los dos
 * lados), las de lote que lo tocaron (anular/restaurar lote, con su línea) y la que creó su lote.
 */
export async function transactionHistory(ex: SqlExecutor, id: Id): Promise<AuditEntry[]> {
  const tx = await ex.get<{ id: string; transfer_group_id: string | null; batch_id: string | null }>(
    'SELECT id, transfer_group_id, batch_id FROM transactions WHERE id = ?',
    [id],
  );
  if (!tx) return [];
  const sides = tx.transfer_group_id
    ? (await ex.all<{ id: string }>('SELECT id FROM transactions WHERE transfer_group_id = ?', [tx.transfer_group_id])).map((r) => r.id)
    : [id];
  const records = await ex.all<AuditLogRecord>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log a
     WHERE (a.entity_type = 'transaction' AND a.entity_id IN (${marks(sides.length)}))
        OR (a.entity_type = 'transfer' AND a.entity_id = ?)
        OR a.id IN (SELECT c.action_id FROM audit_log_changes c WHERE c.entity_id IN (${marks(sides.length)}))
        OR (a.batch_id = ? AND a.action IN (${marks(BATCH_CREATE_ACTIONS.length)}))
     ORDER BY a.at DESC, a.id DESC`,
    [...sides, tx.transfer_group_id, ...sides, tx.batch_id, ...BATCH_CREATE_ACTIONS],
  );
  return withChanges(ex, records, sides);
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function encodeCursor(r: Pick<AuditLogRecord, 'at' | 'id'>): string {
  return `${r.at}|${r.id}`;
}
function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined || cursor === '') return null;
  const i = cursor.indexOf('|');
  if (i <= 0 || i === cursor.length - 1) throw new DomainError('not_found', { entity: 'cursor', cursor });
  return { at: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

/** Inicio del día local `iso` como marca UTC (el historial guarda `at` en UTC). */
function localDayStart(iso: IsoDate): string {
  return fromIsoDate(iso).toISOString();
}

export function createAuditService(deps: CoreDeps): AuditService {
  return {
    async list(workspaceId, input) {
      const where: string[] = ['a.workspace_id = :ws'];
      const params: Record<string, SqlValue> = { ws: workspaceId };
      if (input.from !== undefined) {
        if (!isIsoDate(input.from)) throw new DomainError('invalid_date', { from: input.from });
        where.push('a.at >= :from');
        params['from'] = localDayStart(input.from);
      }
      if (input.to !== undefined) {
        if (!isIsoDate(input.to)) throw new DomainError('invalid_date', { to: input.to });
        where.push('a.at < :to');
        params['to'] = localDayStart(addDays(input.to, 1));
      }
      if (input.actions && input.actions.length > 0) {
        const keys = input.actions.map((action, i) => {
          params[`act${i}`] = action;
          return `:act${i}`;
        });
        where.push(`a.action IN (${keys.join(', ')})`);
      }
      if (input.entityType !== undefined) {
        where.push('a.entity_type = :et');
        params['et'] = input.entityType;
      }
      if (input.accountId !== undefined) {
        // La cuenta de la acción, la de cualquier movimiento que la acción tocó (otro lado de una
        // transferencia, filas de un lote anulado) o la de los movimientos de un lote multi-cuenta.
        where.push(`(a.account_id = :acc
          OR EXISTS (SELECT 1 FROM audit_log_changes c JOIN transactions t ON t.id = c.entity_id
                     WHERE c.action_id = a.id AND t.account_id = :acc)
          OR (a.account_id IS NULL AND a.batch_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM transactions t WHERE t.batch_id = a.batch_id AND t.account_id = :acc)))`);
        params['acc'] = input.accountId;
      }
      const cursor = decodeCursor(input.cursor);
      if (cursor) {
        where.push('(a.at < :cat OR (a.at = :cat AND a.id < :cid))');
        params['cat'] = cursor.at;
        params['cid'] = cursor.id;
      }
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
      params['lim'] = limit + 1;
      return readTx(deps, async (tx) => {
        const records = await tx.all<AuditLogRecord>(
          `SELECT ${AUDIT_COLUMNS} FROM audit_log a WHERE ${where.join(' AND ')}
           ORDER BY a.at DESC, a.id DESC LIMIT :lim`,
          params,
        );
        const page = records.slice(0, limit);
        const items = await withChanges(tx, page);
        const last = page[page.length - 1];
        return { items, nextCursor: records.length > limit && last ? encodeCursor(last) : null };
      });
    },

    async forEntity(entityType, entityId) {
      return readTx(deps, async (tx) => {
        if (entityType === 'transaction') return transactionHistory(tx, entityId);
        const records = await tx.all<AuditLogRecord>(
          `SELECT ${AUDIT_COLUMNS} FROM audit_log a
           WHERE (a.entity_type = ? AND a.entity_id = ?)
              OR a.id IN (SELECT c.action_id FROM audit_log_changes c WHERE c.entity_id = ?)
           ORDER BY a.at DESC, a.id DESC`,
          [entityType, entityId, entityId],
        );
        return withChanges(tx, records);
      });
    },
  };
}
