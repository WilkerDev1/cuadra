// Adaptador de escritorio: SqlBackend sobre los comandos db_* de src-tauri (ARCHITECTURE.md 7.3).
// El mutex y las transacciones BEGIN IMMEDIATE/COMMIT/ROLLBACK son los de createSerialDriver, igual
// que en el worker WASM: Rust solo ejecuta SQL sobre su única conexión. Sin lógica de negocio aquí.
import type { Row, SqlDriver, SqlParams, SqlValue } from '../../core/ports';
import { SqlError } from '../errors';
import { createSerialDriver, type SqlBackend } from '../serialDriver';

/** Forma de `invoke` de @tauri-apps/api/core que usamos (inyectable en pruebas). */
export type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriDriverDeps {
  invoke?: TauriInvoke;
}

interface DbInfoPayload {
  sqlite_version: string;
  path: string;
}

/** Error de Rust: { message, code }. Cualquier otra cosa (string, Error) se conserva como mensaje. */
function toSqlError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'object' && err !== null) {
    const { message, code } = err as { message?: unknown; code?: unknown };
    return new SqlError(typeof message === 'string' ? message : JSON.stringify(err), typeof code === 'number' ? code : null);
  }
  return new SqlError(String(err));
}

/** Uint8Array no sobrevive a JSON como arreglo: se manda como lista de bytes (Rust la lee como BLOB). */
function encodeValue(value: SqlValue): unknown {
  return value instanceof Uint8Array ? Array.from(value) : value;
}

function encodeParams(params: SqlParams | undefined): unknown {
  if (params === undefined) return null;
  if (Array.isArray(params)) return (params as readonly SqlValue[]).map(encodeValue);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params as Record<string, SqlValue>)) out[key] = encodeValue(value);
  return out;
}

/** Los BLOB vuelven como arreglos de bytes; el resto de valores ya es JSON de SqlValue. */
function decodeRow(raw: Record<string, unknown>): Row {
  const row: Row = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    row[key] = (Array.isArray(value) ? Uint8Array.from(value as number[]) : value) as SqlValue;
  }
  return row;
}

async function defaultInvoke(): Promise<TauriInvoke> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke as TauriInvoke;
}

export async function openTauriDriver(deps: TauriDriverDeps = {}): Promise<SqlDriver> {
  const rawInvoke = deps.invoke ?? (await defaultInvoke());
  const invoke: TauriInvoke = async <T>(cmd: string, args?: Record<string, unknown>) => {
    try {
      return await rawInvoke<T>(cmd, args);
    } catch (err) {
      throw toSqlError(err);
    }
  };

  const info = await invoke<DbInfoPayload>('db_open');

  const backend: SqlBackend = {
    info: { kind: 'tauri', persistent: true, sqliteVersion: info.sqlite_version },
    all: async (sql, params) => (await invoke<Record<string, unknown>[]>('db_all', { sql, params: encodeParams(params) })).map(decodeRow),
    get: async (sql, params) => {
      const rows = await invoke<Record<string, unknown>[]>('db_all', { sql, params: encodeParams(params) });
      return rows[0] === undefined ? undefined : decodeRow(rows[0]);
    },
    run: (sql, params) => invoke<{ changes: number }>('db_run', { sql, params: encodeParams(params) }),
    runMany: (sql, rows) => invoke<{ changes: number }>('db_run_many', { sql, rows: rows.map(encodeParams) }),
    exec: (sql) => invoke<void>('db_exec', { sql }),
    exportBytes: async () => {
      const data = await invoke<ArrayBuffer | number[]>('db_export');
      return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
    },
    close: () => invoke<void>('db_close'),
  };
  return createSerialDriver(backend);
}

/**
 * «Guardar como» nativo (comando save_file de Rust). Devuelve la ruta elegida o null si se canceló.
 * Para el respaldo en escritorio; el texto se codifica en UTF-8.
 */
export async function saveFileDialog(
  suggestedName: string,
  data: string | Uint8Array,
  deps: TauriDriverDeps = {},
): Promise<string | null> {
  const invoke = deps.invoke ?? (await defaultInvoke());
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  try {
    return await invoke<string | null>('save_file', { suggestedName, data: Array.from(bytes) });
  } catch (err) {
    throw toSqlError(err);
  }
}
