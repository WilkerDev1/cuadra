// Adaptador node:sqlite (DatabaseSync) envuelto en Promise. SOLO para pruebas y scripts:
// nada fuera de *.test.ts, src/test/** o scripts/** debe importarlo (tsconfig.app.json lo excluye).
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { Row, SqlDriver, SqlParams, SqlValue } from '../../core/ports';
import { assertSqliteVersion, SqlError } from '../errors';
import { createSerialDriver, type SqlBackend } from '../serialDriver';

export interface NodeDriverOptions {
  /** Ruta del archivo o ':memory:' (por defecto). */
  path?: string;
  /** Solo pruebas: forzar la versión mínima exigida. */
  minSqliteVersion?: string;
}

type Method = 'all' | 'get' | 'run';

/** Posicionales como argumentos sueltos; con nombre, un objeto (node:sqlite acepta nombres sin prefijo). */
function call<M extends Method>(stmt: StatementSync, method: M, params: SqlParams | undefined): ReturnType<StatementSync[M]> {
  const fn = stmt[method].bind(stmt) as (...args: unknown[]) => ReturnType<StatementSync[M]>;
  if (params === undefined) return fn();
  if (Array.isArray(params)) return fn(...(params as SQLInputValue[]));
  return fn(params as Record<string, SQLInputValue>);
}

function toRow(raw: Record<string, unknown>): Row {
  const row: Row = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    row[key] = (typeof value === 'bigint' ? Number(value) : value) as SqlValue;
  }
  return row;
}

function wrap<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    const e = err as Error & { errcode?: number };
    return Promise.reject(new SqlError(e.message, typeof e.errcode === 'number' ? e.errcode : null));
  }
}

export async function openNodeDriver(options: NodeDriverOptions = {}): Promise<SqlDriver> {
  const db = new DatabaseSync(options.path ?? ':memory:');
  try {
    const { v } = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    assertSqliteVersion(v, options.minSqliteVersion);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 3000');

    const backend: SqlBackend = {
      info: { kind: 'node', persistent: (options.path ?? ':memory:') !== ':memory:', sqliteVersion: v },
      all: (sql, params) =>
        wrap(() => {
          return (call(db.prepare(sql), 'all', params) as Record<string, unknown>[]).map(toRow);
        }),
      get: (sql, params) =>
        wrap(() => {
          const raw = call(db.prepare(sql), 'get', params) as Record<string, unknown> | undefined;
          return raw === undefined ? undefined : toRow(raw);
        }),
      run: (sql, params) =>
        wrap(() => {
          return { changes: Number(call(db.prepare(sql), 'run', params).changes) };
        }),
      runMany: (sql, rows) =>
        wrap(() => {
          const stmt = db.prepare(sql);
          db.exec('SAVEPOINT cuadra_run_many');
          let changes = 0;
          try {
            for (const params of rows) changes += Number(call(stmt, 'run', params).changes);
            db.exec('RELEASE cuadra_run_many');
          } catch (err) {
            db.exec('ROLLBACK TO cuadra_run_many');
            db.exec('RELEASE cuadra_run_many');
            throw err;
          }
          return { changes };
        }),
      runSeries: (steps) =>
        wrap(() => {
          const prepared = new Map<string, StatementSync>();
          db.exec('SAVEPOINT cuadra_run_series');
          const changes: number[] = [];
          try {
            for (const step of steps) {
              let stmt = prepared.get(step.sql);
              if (stmt === undefined) prepared.set(step.sql, (stmt = db.prepare(step.sql)));
              changes.push(Number(call(stmt, 'run', step.params).changes));
            }
            db.exec('RELEASE cuadra_run_series');
          } catch (err) {
            db.exec('ROLLBACK TO cuadra_run_series');
            db.exec('RELEASE cuadra_run_series');
            throw err;
          }
          return { changes };
        }),
      exec: (sql) => wrap(() => db.exec(sql)),
      exportBytes: () => wrap(() => new Uint8Array(db.serialize())),
      close: () => wrap(() => db.close()),
    };
    return createSerialDriver(backend);
  } catch (err) {
    db.close();
    throw err;
  }
}
