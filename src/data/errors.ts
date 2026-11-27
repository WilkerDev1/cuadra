// Errores de la capa de datos.
// - DomainError (del núcleo): los RAISE(ABORT, '<codigo>') de los triggers y los fallos de migración.
// - SqlError: cualquier otro error de SQLite (UNIQUE, FK, sintaxis), con su código numérico.
// - DataError: fallos del propio adaptador (worker caído, base cerrada, cedida a otra pestaña...).
import { DomainError, type ErrorCode } from '../core/errors';

/** Códigos que los triggers de 001_init.sql lanzan y que el núcleo conoce como ErrorCode. */
export const TRIGGER_ERROR_CODES = [
  'workspace_mismatch',
  'seq_not_reserved',
  'immutable_column',
  'field_type_immutable',
  'field_value_type_mismatch',
  'delete_forbidden',
  'audit_append_only',
  'seq_decrease',
  'options_require_list_field',
] as const satisfies readonly ErrorCode[];

const TRIGGER_CODE_PATTERN = new RegExp(`(?:^|[\\s:])(${TRIGGER_ERROR_CODES.join('|')})\\s*$`);

export class SqlError extends Error {
  override readonly name = 'SqlError';
  constructor(
    message: string,
    /** Código extendido de SQLite (p. ej. 1811 = SQLITE_CONSTRAINT_TRIGGER, 2067 = UNIQUE). */
    readonly resultCode: number | null = null,
  ) {
    super(message);
  }
}

export type DataErrorCode =
  | 'database_closed' // se llamó al driver después de close()
  | 'database_released' // la base se cedió a otra pestaña ("Usar aquí")
  | 'transaction_finished' // se usó el `tx` de una transacción ya terminada
  | 'worker_failed' // el worker no arrancó o murió
  | 'storage_unavailable' // ni OPFS ni :memory: pudieron abrirse
  | 'tauri_driver_pending'; // escritorio detectado pero src/data/tauri aún no existe

export class DataError extends Error {
  override readonly name = 'DataError';
  constructor(
    readonly code: DataErrorCode,
    message: string = code,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Extrae el código de trigger de un mensaje de SQLite ('delete_forbidden' o '...: delete_forbidden'). */
export function triggerCodeOf(message: string): (typeof TRIGGER_ERROR_CODES)[number] | null {
  const match = TRIGGER_CODE_PATTERN.exec(message);
  return match ? (match[1] as (typeof TRIGGER_ERROR_CODES)[number]) : null;
}

/**
 * Normaliza cualquier error que salga de SQLite: un RAISE conocido pasa a DomainError(codigo);
 * DomainError/DataError/SqlError se devuelven tal cual; el resto se envuelve en SqlError.
 */
export function normalizeSqlError(err: unknown): Error {
  if (err instanceof DomainError || err instanceof DataError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code = triggerCodeOf(message);
  if (code) return new DomainError(code, { sqliteMessage: message });
  if (err instanceof SqlError) return err;
  return new SqlError(message, resultCodeOf(err));
}

function resultCodeOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const record = err as { resultCode?: unknown; errcode?: unknown };
  if (typeof record.resultCode === 'number') return record.resultCode; // sqlite-wasm
  if (typeof record.errcode === 'number') return record.errcode; // node:sqlite
  return null;
}

/** Versión mínima de SQLite (STRICT, RETURNING, ->>, json_valid). */
export const MIN_SQLITE_VERSION = '3.45.0';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** Lanza DomainError('sqlite_too_old') si la versión no llega a la mínima. */
export function assertSqliteVersion(version: string, min: string = MIN_SQLITE_VERSION): void {
  if (compareVersions(version, min) < 0) {
    throw new DomainError('sqlite_too_old', { version, min });
  }
}
