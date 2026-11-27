// get/put de bytes en IndexedDB. Sirve para dos cosas:
// 1) el modo de respaldo sin OPFS (:memory: hidratado desde aquí y volcado tras cada escritura);
// 2) las copias automáticas del archivo SQLite antes de migrar o restaurar.
// Funciona igual en el hilo principal y dentro del worker.

/** Almacén mínimo de bytes por clave. El worker lo recibe así para poder probarlo con un Map. */
export interface ByteStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const IDB_NAME = 'cuadra';
export const IDB_STORE = 'bytes';
/** Clave de la base en modo memory-idb. */
export const MEMORY_DB_KEY = 'db:main';
/** Prefijo de las copias automáticas; se conservan las MAX_AUTO_SNAPSHOTS más recientes. */
export const SNAPSHOT_PREFIX = 'snapshot:';
export const MAX_AUTO_SNAPSHOTS = 3;

export function isIndexedDbAvailable(factory: IDBFactory | undefined = globalThis.indexedDB): boolean {
  return typeof factory !== 'undefined' && factory !== null;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_error'));
  });
}

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
    req.onblocked = () => reject(new Error('indexeddb_blocked'));
  });
}

export async function openIdbStore(
  options: { name?: string; factory?: IDBFactory } = {},
): Promise<ByteStore> {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!isIndexedDbAvailable(factory)) throw new Error('indexeddb_unavailable');
  const db = await openDb(factory, options.name ?? IDB_NAME);

  const withStore = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = db.transaction(IDB_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb_tx_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb_tx_aborted'));
    });
    const result = await request(fn(tx.objectStore(IDB_STORE)));
    await done; // en escritura, solo damos por guardado lo que la transacción confirmó
    return result;
  };

  return {
    async get(key) {
      const value = await withStore<unknown>('readonly', (s) => s.get(key));
      if (value === undefined) return undefined;
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      throw new Error(`indexeddb_unexpected_value:${key}`);
    },
    async put(key, bytes) {
      await withStore('readwrite', (s) => s.put(bytes, key));
    },
    async delete(key) {
      await withStore('readwrite', (s) => s.delete(key));
    },
    async keys() {
      const keys = await withStore('readonly', (s) => s.getAllKeys());
      return keys.map(String);
    },
  };
}

/**
 * Guarda una copia automática con clave ordenable por fecha y poda las más antiguas.
 * Devuelve la clave usada.
 */
export async function saveSnapshot(store: ByteStore, label: string, bytes: Uint8Array, at: Date = new Date()): Promise<string> {
  const key = `${SNAPSHOT_PREFIX}${at.toISOString()}:${label}`;
  await store.put(key, bytes);
  const snapshots = (await store.keys()).filter((k) => k.startsWith(SNAPSHOT_PREFIX)).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_AUTO_SNAPSHOTS))) {
    await store.delete(old);
  }
  return key;
}

/** Store en memoria con la misma interfaz (pruebas y entornos sin IndexedDB). */
export function createMemoryByteStore(): ByteStore {
  const map = new Map<string, Uint8Array>();
  return {
    get: async (key) => map.get(key),
    put: async (key, bytes) => {
      map.set(key, bytes.slice());
    },
    delete: async (key) => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
}
