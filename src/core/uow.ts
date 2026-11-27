// Unidad de trabajo (ARCHITECTURE.md 3.6): una mutación = UNA transacción SQL + como mucho UNA acción de
// historial + UN ChangeEvent tras el COMMIT. Todo servicio que escribe pasa por `mutate`.
//
// Patrón obligatorio dentro de fn: (1) leer estado previo, (2) validar duro → DomainError, (3) escribir,
// (4) ctx.audit.record con el diff, (5) ctx.touch(...). Si no se toca ninguna tabla no hay evento.
import type { ChangeEvent, EventBus, TableName } from './events';
import type { Clock, IdGen, SqlDriver, SqlExecutor } from './ports';
import type { AuditWriter } from './services/audit';
import type { Id, Mutation, Warning } from './types';

/** Lo que reciben todos los servicios del núcleo. */
export interface CoreDeps {
  driver: SqlDriver;
  clock: Clock;
  ids: IdGen;
  events: EventBus;
  /** Escritor del historial (services/audit.ts). `mutate` lo envuelve para imponer una acción por guardado. */
  audit: AuditWriter;
  locale: string;
}

export interface UowCtx {
  tx: SqlExecutor;
  clock: Clock;
  ids: IdGen;
  audit: AuditWriter;
  touch(...tables: TableName[]): void;
  warn(w: Warning): void;
}

export class UowError extends Error {
  override readonly name = 'UowError';
}

/** Abre transacción, ejecuta fn, hace COMMIT y emite UN ChangeEvent. Todo servicio que escribe pasa por aquí. */
export async function mutate<T>(
  deps: CoreDeps,
  workspaceId: Id | null,
  reason: string,
  fn: (ctx: UowCtx) => Promise<T>,
): Promise<Mutation<T>> {
  const touched = new Set<TableName>();
  const warnings: Warning[] = [];
  const warningKeys = new Set<string>();
  let auditActionId: Id | null = null;
  let open = true;

  const value = await deps.driver.transaction(async (tx) => {
    const ctx: UowCtx = {
      tx,
      clock: deps.clock,
      ids: deps.ids,
      audit: {
        async record(executor, entry) {
          if (!open) throw new UowError('el historial se escribió fuera de su unidad de trabajo');
          if (executor !== tx) throw new UowError('el historial debe escribirse con el tx de la unidad de trabajo');
          if (auditActionId !== null) {
            throw new UowError('una unidad de trabajo escribe como mucho una acción de historial (I-10)');
          }
          const id = await deps.audit.record(executor, entry);
          auditActionId = id;
          touched.add('audit_log');
          return id;
        },
      },
      touch(...tables) {
        for (const t of tables) touched.add(t);
      },
      warn(w) {
        const key = JSON.stringify(w);
        if (!warningKeys.has(key)) {
          warningKeys.add(key);
          warnings.push(w);
        }
      },
    };
    try {
      return await fn(ctx);
    } finally {
      open = false;
    }
  });

  if (touched.size > 0) {
    const event: ChangeEvent = { workspaceId, tables: [...touched], reason };
    deps.events.emit(event);
  }
  return { value, warnings, auditActionId };
}

/** Lectura consistente: varias consultas dentro de una sola transacción, sin historial ni eventos. */
export function readTx<T>(deps: Pick<CoreDeps, 'driver'>, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  return deps.driver.transaction(fn);
}
