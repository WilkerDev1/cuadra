// Historial (ARCHITECTURE.md 3.5). Solo-añadir: una acción por guardado y sus líneas de cambio.
// El escritor (AuditWriter) está implementado porque la unidad de trabajo lo necesita desde la Oleada 1;
// la lectura (AuditService) y diffTransaction los completa la Oleada 2 (2A).
import { notImplemented } from '../errors';
import type { Clock, IdGen, SqlExecutor } from '../ports';
import { insertSql, recordValues, toJson } from '../sql/rows';
import type { AuditAction, AuditEntry, Id, IsoDate, Page, Transaction } from '../types';
import type { CoreDeps } from '../uow';

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

export function createAuditService(_deps: CoreDeps): AuditService {
  return {
    list: async () => notImplemented('audit.list'),
    forEntity: async () => notImplemented('audit.forEntity'),
  };
}

/** Diff de dos instantáneas → líneas de cambio. Si no hay líneas, el servicio NO escribe acción. */
export function diffTransaction(
  _before: Transaction,
  _after: Transaction,
): Array<{ path: string; old: unknown; new: unknown }> {
  return notImplemented('audit.diffTransaction');
}
