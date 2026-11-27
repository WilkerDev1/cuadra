// Lógica del worker de SQLite, separada de `self` para poder probarla en Node con el build de
// @sqlite.org/sqlite-wasm para Node y un ByteStore en memoria. db.worker.ts solo la cablea.
//
// Modos:
// - 'opfs': VFS opfs-sahpool (sin COOP/COEP; una sola conexión). journal_mode=TRUNCATE.
// - 'memory-idb': ':memory:' hidratado desde el ByteStore (IndexedDB) y volcado con espera de
//   500 ms tras cada escritura confirmada, y al recibir 'flush' (visibilitychange/pagehide).
//   Si no hay ByteStore (IndexedDB bloqueado), ':memory:' puro con persistent=false.
import type { Database, PreparedStatement, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { DomainError } from '../../core/errors';
import type { Row, SqlParams, SqlValue } from '../../core/ports';
import { assertSqliteVersion, DataError, SqlError } from '../errors';
import type { ByteStore } from './idbStore';
import type {
  OpenResult,
  SerializedError,
  WorkerMessage,
  WorkerRequest,
  WorkerRequestBody,
} from './protocol';

export interface WorkerHostOptions {
  loadSqlite: () => Promise<Sqlite3Static>;
  /** null: sin IndexedDB. Una promesa: se abre perezosamente solo si hace falta (modo memory-idb). */
  openByteStore: () => Promise<ByteStore | null>;
  post: (message: WorkerMessage, transfer?: Transferable[]) => void;
  persistDelayMs?: number;
  /** Clave de la base en el ByteStore. */
  memoryKey?: string;
  /** Solo pruebas. */
  minSqliteVersion?: string;
}

export const SAHPOOL_NAME = 'cuadra-sahpool';
export const SAHPOOL_DIRECTORY = '.cuadra-sahpool';

type Mode = 'opfs' | 'memory-idb' | 'memory';

export interface WorkerHost {
  handle(request: WorkerRequest): Promise<void>;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof DomainError) {
    return { name: 'DomainError', message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) };
  }
  if (err instanceof DataError) {
    return { name: 'DataError', message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) };
  }
  if (err instanceof SqlError) return { name: 'SqlError', message: err.message, resultCode: err.resultCode };
  if (err instanceof Error) {
    const resultCode = (err as { resultCode?: unknown }).resultCode;
    if (typeof resultCode === 'number') return { name: 'SqlError', message: err.message, resultCode };
    return { name: err.name, message: err.message };
  }
  return { name: 'Error', message: String(err) };
}

function toSqlValue(value: unknown): SqlValue {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new SqlError(`integer_out_of_range: ${value.toString()}`);
    }
    return Number(value);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as SqlValue;
}

export function createWorkerHost(options: WorkerHostOptions): WorkerHost {
  const persistDelayMs = options.persistDelayMs ?? 500;
  const memoryKey = options.memoryKey ?? 'db:main';
  let sqlite3: Sqlite3Static | null = null;
  let pool: SAHPoolUtil | null = null;
  let db: Database | null = null;
  let mode: Mode | null = null;
  let store: ByteStore | null = null;

  // Persistencia del modo memory-idb.
  let writeCounter = 0;
  let persistedCounter = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let persisting: Promise<void> | null = null;

  const requireDb = (): Database => {
    if (!db) throw new DataError('database_closed');
    return db;
  };

  const autocommit = (): boolean => sqlite3!.capi.sqlite3_get_autocommit(requireDb().pointer!) !== 0;

  async function persistNow(): Promise<void> {
    if (mode !== 'memory-idb' || !store || !db) return;
    while (persisting) await persisting;
    if (writeCounter === persistedCounter || !autocommit()) return;
    const target = writeCounter;
    const bytes = sqlite3!.capi.sqlite3_js_db_export(db.pointer!);
    persisting = store
      .put(memoryKey, bytes)
      .then(() => {
        persistedCounter = target;
        options.post({ event: 'persisted', bytes: bytes.byteLength });
      })
      .catch((err: unknown) => {
        options.post({ event: 'persist_error', message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        persisting = null;
      });
    await persisting;
  }

  function schedulePersist(): void {
    if (mode !== 'memory-idb' || writeCounter === persistedCounter || !autocommit()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persistNow();
    }, persistDelayMs);
  }

  function bindParams(stmt: PreparedStatement, params: SqlParams | undefined): void {
    if (params === undefined) return;
    if (Array.isArray(params)) {
      if (params.length > 0) stmt.bind(params as SqlValue[]);
      return;
    }
    const record = params as Readonly<Record<string, SqlValue>>;
    for (let i = 1; i <= stmt.parameterCount; i++) {
      const name = sqlite3!.capi.sqlite3_bind_parameter_name(stmt.pointer!, i);
      if (!name) throw new SqlError(`Parámetro ${i} sin nombre en una consulta con parámetros con nombre`);
      const bare = name.slice(1);
      const value = Object.hasOwn(record, bare) ? record[bare] : record[name];
      if (value === undefined) throw new SqlError(`Falta el parámetro ${name}`);
      stmt.bind(i, value);
    }
  }

  function withStatement<T>(sql: string, fn: (stmt: PreparedStatement) => T): T {
    const stmt = requireDb().prepare(sql);
    try {
      return fn(stmt);
    } finally {
      stmt.finalize();
    }
  }

  function readRow(stmt: PreparedStatement): Row {
    const raw = stmt.get({});
    const row: Row = {};
    for (const key of Object.keys(raw)) row[key] = toSqlValue(raw[key]);
    return row;
  }

  function runStatement(stmt: PreparedStatement, params: SqlParams | undefined): number {
    bindParams(stmt, params);
    while (stmt.step()) {
      // consume RETURNING si lo hay
    }
    return sqlite3!.capi.sqlite3_changes(requireDb().pointer!);
  }

  async function open(body: Extract<WorkerRequestBody, { op: 'open' }>): Promise<OpenResult> {
    if (db) throw new Error('La base ya está abierta en este worker');
    sqlite3 ??= await options.loadSqlite();
    const version = sqlite3.version.libVersion;
    assertSqliteVersion(version, options.minSqliteVersion);

    let restored = false;
    if (body.mode === 'opfs') {
      pool ??= await sqlite3.installOpfsSAHPoolVfs({
        name: SAHPOOL_NAME,
        directory: SAHPOOL_DIRECTORY,
        initialCapacity: 6,
        preserveOnInitFailure: true,
      });
      if (pool.isPaused()) await pool.unpauseVfs();
      db = new pool.OpfsSAHPoolDb(body.filename);
      mode = 'opfs';
    } else {
      store = await options.openByteStore().catch(() => null);
      db = new sqlite3.oo1.DB(':memory:', 'c');
      mode = store ? 'memory-idb' : 'memory';
      const bytes = store ? await store.get(memoryKey) : undefined;
      if (bytes && bytes.byteLength > 0) {
        const p = sqlite3.wasm.allocFromTypedArray(bytes);
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer!,
          'main',
          p,
          bytes.byteLength,
          bytes.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        );
        db.checkRc(rc);
        restored = true;
      }
    }

    const current = db;
    current.exec('PRAGMA foreign_keys = ON');
    current.exec(mode === 'opfs' ? 'PRAGMA journal_mode = TRUNCATE' : 'PRAGMA journal_mode = MEMORY');
    current.exec('PRAGMA busy_timeout = 3000');
    writeCounter = 0;
    persistedCounter = 0;

    return {
      info: {
        kind: mode === 'opfs' ? 'wasm-opfs' : 'wasm-memory-idb',
        persistent: mode !== 'memory',
        sqliteVersion: version,
      },
      restored,
    };
  }

  async function shutdown(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (db) {
      await persistNow();
      db.close();
      db = null;
    }
  }

  async function execute(body: WorkerRequestBody): Promise<{ result: unknown; transfer?: Transferable[] }> {
    switch (body.op) {
      case 'open':
        return { result: await open(body) };
      case 'all':
        return {
          result: withStatement(body.sql, (stmt) => {
            bindParams(stmt, body.params);
            const rows: Row[] = [];
            while (stmt.step()) rows.push(readRow(stmt));
            return rows;
          }),
        };
      case 'get':
        return {
          result: withStatement(body.sql, (stmt) => {
            bindParams(stmt, body.params);
            return stmt.step() ? readRow(stmt) : undefined;
          }),
        };
      case 'run':
        writeCounter++;
        return { result: { changes: withStatement(body.sql, (stmt) => runStatement(stmt, body.params)) } };
      case 'runMany': {
        writeCounter++;
        const current = requireDb();
        current.exec('SAVEPOINT cuadra_run_many');
        try {
          const changes = withStatement(body.sql, (stmt) => {
            let total = 0;
            for (const params of body.rows) {
              stmt.reset(true);
              total += runStatement(stmt, params);
            }
            return total;
          });
          current.exec('RELEASE cuadra_run_many');
          return { result: { changes } };
        } catch (err) {
          current.exec('ROLLBACK TO cuadra_run_many');
          current.exec('RELEASE cuadra_run_many');
          throw err;
        }
      }
      case 'exec':
        writeCounter++;
        requireDb().exec(body.sql);
        return { result: undefined };
      case 'export': {
        const bytes = sqlite3!.capi.sqlite3_js_db_export(requireDb().pointer!);
        return { result: bytes, transfer: [bytes.buffer] };
      }
      case 'flush':
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await persistNow();
        return { result: undefined };
      case 'pause':
        await shutdown();
        if (pool && !pool.isPaused()) pool.pauseVfs();
        return { result: undefined };
      case 'close':
        await shutdown();
        return { result: undefined };
    }
  }

  // Las peticiones se atienden de una en una, en orden de llegada (open/flush/pause son asíncronas).
  let queue: Promise<void> = Promise.resolve();

  async function handleOne(request: WorkerRequest): Promise<void> {
    const { id, ...body } = request;
    try {
      const { result, transfer } = await execute(body as WorkerRequestBody);
      options.post({ id, ok: true, result }, transfer);
    } catch (err) {
      options.post({ id, ok: false, error: serializeError(err) });
    } finally {
      if (db && (body.op === 'run' || body.op === 'runMany' || body.op === 'exec')) schedulePersist();
    }
  }

  return {
    handle(request) {
      const next = queue.then(() => handleOne(request));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
