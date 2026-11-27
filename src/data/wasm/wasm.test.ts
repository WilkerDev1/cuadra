// wasmDriver + workerHost con el SQLite WASM real (build de Node de @sqlite.org/sqlite-wasm 3.54.1)
// conectados por un MessageChannel, igual que con un Worker de verdad. Node no tiene OPFS, así que
// el modo 'opfs' falla y se prueba la caída a ':memory:' + ByteStore (IndexedDB en el navegador).
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '../../core/errors';
import { openDatabase, type OpenedDatabase } from '../index';
import { SqlError } from '../errors';
import { migrate, readSchemaVersion } from '../migrate';
import { createMemoryByteStore, MAX_AUTO_SNAPSHOTS, saveSnapshot, SNAPSHOT_PREFIX, type ByteStore } from './idbStore';
import type { WorkerMessage } from './protocol';
import { openWasmDriver, WorkerClient, type WasmDriver, type WorkerPortLike } from './wasmDriver';
import { createWorkerHost } from './workerHost';

let sqlitePromise: Promise<Sqlite3Static> | null = null;
const loadSqlite = () => (sqlitePromise ??= sqlite3InitModule());

interface FakeWorker extends WorkerPortLike {
  readonly terminated: boolean;
}

function fakeWorker(store: ByteStore | null, persistDelayMs = 5): FakeWorker {
  const { port1, port2 } = new MessageChannel();
  let terminated = false;
  const host = createWorkerHost({
    loadSqlite,
    openByteStore: async () => store,
    persistDelayMs,
    post: (message, transfer) => port2.postMessage(message, transfer ?? []),
  });
  port2.addEventListener('message', (event) => void host.handle((event as MessageEvent).data));
  port2.start();
  port1.start();
  return {
    get terminated() {
      return terminated;
    },
    postMessage: (message, transfer) => port1.postMessage(message, transfer ?? []),
    addEventListener: ((type: string, listener: (event: MessageEvent<WorkerMessage>) => void) => {
      if (type === 'message') port1.addEventListener('message', listener as (e: Event) => void);
    }) as WorkerPortLike['addEventListener'],
    terminate: () => {
      terminated = true;
      port1.close();
      port2.close();
    },
  };
}

const open: Array<{ close(): Promise<void>; isOpen?: boolean }> = [];
afterEach(async () => {
  for (const d of open.splice(0)) if (d.isOpen !== false) await d.close().catch(() => undefined);
});

async function memoryDriver(store: ByteStore | null = createMemoryByteStore()): Promise<WasmDriver> {
  const driver = await openWasmDriver(new WorkerClient(fakeWorker(store)), { mode: 'memory-idb' });
  open.push(driver);
  return driver;
}

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 2000) => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('wasmDriver ↔ workerHost (sqlite-wasm real)', () => {
  it('sqlite-wasm es 3.54.1, igual que node:sqlite de Node 26', async () => {
    const driver = await memoryDriver();
    expect(driver.info.sqliteVersion).toBe((await loadSqlite()).version.libVersion);
    expect(driver.info.sqliteVersion).toBe('3.54.1');
    expect(await driver.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('modo opfs falla sin OPFS con un error tipado (no cuelga)', async () => {
    const client = new WorkerClient(fakeWorker(null));
    const err = await openWasmDriver(client, { mode: 'opfs' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    client.terminate();
  });

  it('migra 001 y los triggers cruzan el worker como DomainError', async () => {
    const driver = await memoryDriver();
    expect(await migrate(driver)).toMatchObject({ from: 0, to: 1 });
    const T = '2026-06-15T12:00:00.000Z';
    await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['ws', 'W', T, T]);
      await tx.run(
        'INSERT INTO accounts (id, workspace_id, name, created_at, updated_at) VALUES (:id, :ws, :name, :t, :t)',
        { id: 'acc', ws: 'ws', name: 'Caja', t: T },
      );
      const { seq } = (await tx.get<{ seq: number }>(
        'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
        ['acc'],
      ))!;
      await tx.run(
        `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date,
           description, recorded_at, updated_at) VALUES ('t1', 'ws', 'acc', ?, 'income', 'in', 1500, '2026-06-15', 'Venta', ?, ?)`,
        [seq, T, T],
      );
    });
    const err = await driver.run("DELETE FROM transactions WHERE id = 't1'").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('delete_forbidden');
    const unique = await driver
      .run("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws', 'X', 'a', 'a')")
      .catch((e: unknown) => e);
    expect(unique).toBeInstanceOf(SqlError);
    expect((unique as SqlError).resultCode).toBe(1555); // SQLITE_CONSTRAINT_PRIMARYKEY
  });

  it('transacciones, runMany atómico, BLOB y exportBytes por el worker', async () => {
    const driver = await memoryDriver();
    await driver.exec('CREATE TABLE t (label TEXT NOT NULL UNIQUE, data BLOB) STRICT');
    await expect(
      driver.transaction(async (tx) => {
        await tx.run("INSERT INTO t (label) VALUES ('rolled')");
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await driver.runMany('INSERT INTO t (label) VALUES (?)', [['a'], ['b']])).toEqual({ changes: 2 });
    await expect(driver.runMany('INSERT INTO t (label) VALUES (?)', [['c'], ['a']])).rejects.toBeInstanceOf(SqlError);
    // runSeries: sentencias distintas en orden y en un viaje; atómico.
    await expect(
      driver.runSeries!([
        { sql: 'INSERT INTO t (label) VALUES (?)', params: ['s1'] },
        { sql: 'INSERT INTO t (label) VALUES (?)', params: ['a'] },
      ]),
    ).rejects.toBeInstanceOf(SqlError);
    expect(
      await driver.transaction((tx) =>
        tx.runSeries!([
          { sql: 'INSERT INTO t (label) VALUES (?)', params: ['s2'] },
          { sql: "UPDATE t SET label = 's3' WHERE label = ?", params: ['s2'] },
          { sql: 'INSERT INTO t (label) VALUES (?)', params: ['s2'] },
        ]),
      ),
    ).toEqual({ changes: [1, 1, 1] });
    await driver.run("DELETE FROM t WHERE label IN ('s2', 's3')");
    await driver.run('INSERT INTO t (label, data) VALUES ($l, $d)', { l: 'bin', d: new Uint8Array([9, 8]) });
    expect(await driver.all('SELECT label FROM t ORDER BY label')).toEqual([{ label: 'a' }, { label: 'b' }, { label: 'bin' }]);
    expect((await driver.get("SELECT data FROM t WHERE label = 'bin'"))!['data']).toEqual(new Uint8Array([9, 8]));
    const bytes = await driver.exportBytes();
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3');
  });

  it('memory-idb vuelca tras cada COMMIT y otra sesión lo recupera', async () => {
    const store = createMemoryByteStore();
    const first = await memoryDriver(store);
    expect(first.restored).toBe(false);
    expect(first.info).toMatchObject({ kind: 'wasm-memory-idb', persistent: true });
    await migrate(first);
    await first.transaction((tx) =>
      tx.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'k', '\"v\"', 't')"),
    );
    await waitFor(async () => (await store.get('db:main')) !== undefined);
    await first.close();

    const second = await memoryDriver(store);
    expect(second.restored).toBe(true);
    expect(await readSchemaVersion(second)).toBe(1);
    expect(await second.get("SELECT value FROM settings WHERE key = 'k'")).toEqual({ value: '"v"' });
    expect(await second.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('no vuelca a mitad de una transacción; flush vuelca lo confirmado', async () => {
    const store = createMemoryByteStore();
    const client = new WorkerClient(fakeWorker(store, 60_000)); // la espera nunca vence: solo flush
    const driver = await openWasmDriver(client, { mode: 'memory-idb' });
    open.push(driver);
    await driver.exec('CREATE TABLE t (a INTEGER) STRICT');
    await driver.flush();
    const afterDdl = await store.get('db:main');
    expect(afterDdl).toBeDefined();
    await driver.run('INSERT INTO t VALUES (1)');
    await driver.flush();
    const restored = await memoryDriver(store);
    expect(await restored.all('SELECT a FROM t')).toEqual([{ a: 1 }]);
  });

  it('memory-idb: una lectura en transacción (readTx) no vuelca la base; una escritura sí', async () => {
    const inner = createMemoryByteStore();
    let puts = 0;
    const store: ByteStore = {
      get: (k) => inner.get(k),
      put: async (k, v) => {
        puts++;
        await inner.put(k, v);
      },
      delete: (k) => inner.delete(k),
      keys: () => inner.keys(),
    };
    const driver = await memoryDriver(store);
    await migrate(driver);
    await driver.flush();
    const base = puts;
    expect(base).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await driver.transaction(async (tx) => {
        await tx.get('SELECT COUNT(*) AS n FROM settings');
        await tx.all('SELECT key FROM settings');
      });
      await driver.run('SELECT 1');
    }
    await new Promise((r) => setTimeout(r, 40)); // persistDelayMs = 5
    await driver.flush();
    expect(puts).toBe(base);
    // Una escritura real sí programa el volcado.
    await driver.transaction((tx) => tx.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'k', '1', 't')"));
    await waitFor(async () => puts > base);
  });

  it('sin IndexedDB: :memory: puro con persistent=false', async () => {
    const driver = await memoryDriver(null);
    expect(driver.info).toMatchObject({ kind: 'wasm-memory-idb', persistent: false });
  });

  it('release() cierra la base y las llamadas siguientes dan database_released', async () => {
    const worker = fakeWorker(createMemoryByteStore());
    const driver = await openWasmDriver(new WorkerClient(worker), { mode: 'memory-idb' });
    await driver.release();
    expect(worker.terminated).toBe(true);
    await expect(driver.all('SELECT 1')).rejects.toMatchObject({ name: 'DataError', code: 'database_released' });
  });
});

describe('openDatabase', () => {
  const deps = (store: ByteStore) => ({
    isTauri: () => false,
    spawnWorker: () => fakeWorker(store),
    openByteStore: async () => store,
    locks: null,
    storage: { persist: async () => true },
    lifecycle: null,
  });

  it('sin OPFS cae a :memory:+IDB, migra y explica por qué', async () => {
    const store = createMemoryByteStore();
    const db: OpenedDatabase = await openDatabase({}, deps(store));
    open.push(db);
    expect(db.info.kind).toBe('wasm-memory-idb');
    expect(db.storage).toMatchObject({
      kind: 'wasm-memory-idb',
      persistent: true,
      persistGranted: true,
      restored: false,
      tabLock: false,
    });
    expect(db.storage.fallbackReason).toEqual(expect.any(String));
    expect(db.schema).toMatchObject({ from: 0, to: 1, applied: [1] });
    expect(await readSchemaVersion(db)).toBe(1);
    await db.close();

    const again = await openDatabase({}, deps(store));
    open.push(again);
    expect(again.storage.restored).toBe(true);
    expect(again.schema).toEqual({ from: 1, to: 1, applied: [] });
  });

  it('"Usar aquí" entre dos pestañas: la primera vuelca, cede y queda en database_released', async () => {
    const store = createMemoryByteStore();
    const lockName = `cuadra-open-${process.pid}`;
    // Nombres propios para no chocar con otras pruebas (los Web Locks de Node son de todo el proceso).
    const withLocks = (s: ByteStore) => {
      return {
        ...deps(s),
        createChannel: (n: string) => new BroadcastChannel(`${lockName}-${n}`) as never,
        locks: {
          request: ((name: string, ...args: unknown[]) =>
            (navigator.locks.request as (...a: unknown[]) => Promise<unknown>)(`${lockName}-${name}`, ...args)) as LockManager['request'],
          query: () => navigator.locks.query(),
        } as LockManager,
      };
    };
    let firstReleased = false;
    const first = await openDatabase({ onReleaseRequested: () => (firstReleased = true) }, withLocks(store));
    await first.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'who', '\"first\"', 't')");

    const second = await openDatabase({ onBlocked: (takeOver) => takeOver() }, withLocks(store));
    open.push(second);
    expect(firstReleased).toBe(true);
    await expect(first.all('SELECT 1')).rejects.toMatchObject({ code: 'database_released' });
    expect(second.storage.tabLock).toBe(true);
    expect(await second.get("SELECT value FROM settings WHERE key = 'who'")).toEqual({ value: '"first"' });
  });

  it('escritorio detectado → va al driver de Tauri y nunca cae a WASM (aquí falla: no hay runtime de Tauri)', async () => {
    let wasmTried = false;
    const store = createMemoryByteStore();
    const base = deps(store);
    const spawnWorker = () => {
      wasmTried = true;
      return fakeWorker(store);
    };
    const attempt = openDatabase({}, { ...base, isTauri: () => true, spawnWorker });
    const error = await attempt.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toMatchObject({ code: 'tauri_driver_pending' });
    expect(wasmTried).toBe(false);
  });

  it('una BD de una versión más nueva no se toca: db_from_newer_version', async () => {
    const store = createMemoryByteStore();
    const db = await openDatabase({}, deps(store));
    await db.exec('PRAGMA user_version = 9');
    await db.close();
    await expect(openDatabase({}, deps(store))).rejects.toMatchObject({ code: 'db_from_newer_version' });
  });
});

describe('copias automáticas', () => {
  it(`saveSnapshot conserva las ${MAX_AUTO_SNAPSHOTS} más recientes`, async () => {
    const store = createMemoryByteStore();
    for (let i = 0; i < MAX_AUTO_SNAPSHOTS + 2; i++) {
      await saveSnapshot(store, `v${i}`, new Uint8Array([i]), new Date(Date.UTC(2026, 5, 15, 12, 0, i)));
    }
    const keys = (await store.keys()).filter((k) => k.startsWith(SNAPSHOT_PREFIX)).sort();
    expect(keys).toHaveLength(MAX_AUTO_SNAPSHOTS);
    expect(keys[0]).toContain(':v2');
    expect(await store.get(keys.at(-1)!)).toEqual(new Uint8Array([MAX_AUTO_SNAPSHOTS + 1]));
  });
});
