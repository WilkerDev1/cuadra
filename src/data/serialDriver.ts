// SqlDriver común a todos los adaptadores: mutex, transacciones BEGIN IMMEDIATE/COMMIT/ROLLBACK,
// normalización de errores y cierre. Cada adaptador solo aporta un SqlBackend que ejecuta SQL
// sobre su única conexión (node:sqlite, worker WASM, invoke de Tauri).
import type { Row, SqlDriver, SqlDriverInfo, SqlExecutor, SqlParams } from '../core/ports';
import { DataError, type DataErrorCode, normalizeSqlError } from './errors';
import { Mutex } from './mutex';

/** Ejecución cruda sobre una conexión. No sabe de mutex ni de transacciones. */
export interface SqlBackend {
  readonly info: SqlDriverInfo;
  all(sql: string, params?: SqlParams): Promise<Row[]>;
  get(sql: string, params?: SqlParams): Promise<Row | undefined>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  /** Atómico: o se aplican todas las filas o ninguna (el backend usa un SAVEPOINT). */
  runMany(sql: string, rows: readonly SqlParams[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface SerialDriver extends SqlDriver {
  /**
   * Espera a que termine lo que esté en curso, ejecuta `finalize` y deja el driver inutilizable:
   * las llamadas posteriores fallan con DataError(code). close() es retire('database_closed').
   */
  retire(code: DataErrorCode, finalize: () => Promise<void>): Promise<void>;
  /** true mientras el driver acepte llamadas. */
  readonly isOpen: boolean;
}

export interface SerialDriverHooks {
  /** Se llama tras cada COMMIT y tras cada escritura suelta (run/runMany/exec fuera de transacción). */
  afterWrite?: () => void;
}

export function createSerialDriver(backend: SqlBackend, hooks: SerialDriverHooks = {}): SerialDriver {
  const mutex = new Mutex();
  let retired: DataErrorCode | null = null;

  const guard = (): void => {
    if (retired) throw new DataError(retired);
  };

  const call = async <T>(op: () => Promise<T>): Promise<T> => {
    try {
      return await op();
    } catch (err) {
      throw normalizeSqlError(err);
    }
  };

  const serial = <T>(op: () => Promise<T>, write: boolean): Promise<T> =>
    mutex.run(async () => {
      guard();
      const result = await call(op);
      if (write) hooks.afterWrite?.();
      return result;
    });

  const driver: SerialDriver = {
    info: backend.info,
    get isOpen() {
      return retired === null;
    },
    all: <T extends Row = Row>(sql: string, params?: SqlParams) =>
      serial(() => backend.all(sql, params) as Promise<T[]>, false),
    get: <T extends Row = Row>(sql: string, params?: SqlParams) =>
      serial(() => backend.get(sql, params) as Promise<T | undefined>, false),
    run: (sql, params) => serial(() => backend.run(sql, params), true),
    runMany: (sql, rows) => serial(() => backend.runMany(sql, rows), true),
    exec: (sql) => serial(() => backend.exec(sql), true),
    exportBytes: () => serial(() => backend.exportBytes(), false),

    transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return mutex.run(async () => {
        guard();
        await call(() => backend.exec('BEGIN IMMEDIATE'));
        let active = true;
        const inTx = async <R>(op: () => Promise<R>): Promise<R> => {
          if (!active) throw new DataError('transaction_finished');
          return call(op);
        };
        const tx: SqlExecutor = {
          all: <R extends Row = Row>(sql: string, params?: SqlParams) =>
            inTx(() => backend.all(sql, params) as Promise<R[]>),
          get: <R extends Row = Row>(sql: string, params?: SqlParams) =>
            inTx(() => backend.get(sql, params) as Promise<R | undefined>),
          run: (sql, params) => inTx(() => backend.run(sql, params)),
          runMany: (sql, rows) => inTx(() => backend.runMany(sql, rows)),
        };
        try {
          const result = await fn(tx);
          active = false;
          await call(() => backend.exec('COMMIT'));
          hooks.afterWrite?.();
          return result;
        } catch (err) {
          active = false;
          try {
            await backend.exec('ROLLBACK');
          } catch {
            // SQLite pudo haber deshecho ya la transacción (p. ej. tras SQLITE_FULL): nada que hacer.
          }
          // Lo que viene de `tx` o del COMMIT ya pasó por `call` (normalizado). Lo demás es del llamador
          // (UowError, TypeError, reglas propias): sale tal cual para no perder su clase.
          throw err;
        }
      });
    },

    retire(code, finalize) {
      return mutex.run(async () => {
        if (retired) return;
        retired = code;
        await finalize();
      });
    },

    close() {
      return driver.retire('database_closed', () => backend.close());
    },
  };
  return driver;
}
