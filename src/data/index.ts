// Punto de entrada de la capa de datos para el shell (src/app/boot.ts). Elige adaptador, protege la
// base con el candado entre pestañas, migra y devuelve el SqlDriver con el modo de persistencia.
//
// Orden (ARCHITECTURE.md 7.3 y ADR-9):
//   1. '__TAURI_INTERNALS__' in window → driver de Tauri (src/data/tauri, Oleada 3G).
//   2. Candado 'cuadra-db' (navigator.locks); si otra pestaña lo tiene → onBlocked(takeOver).
//   3. Worker con opfs-sahpool. 4. Si OPFS falla → ':memory:' + IndexedDB en el mismo worker.
//   5. Copia automática en IndexedDB antes de migrar una BD existente. 6. migrate().
import type { SqlDriver, SqlDriverInfo } from '../core/ports';
import { DomainError } from '../core/errors';
import { DataError } from './errors';
import { migrate, type MigrateResult } from './migrate';
import { openIdbStore, saveSnapshot, type ByteStore } from './wasm/idbStore';
import { acquireTabLock, type TabLockHandle, type TabLockOptions } from './wasm/tabLock';
import { openWasmDriver, spawnDbWorker, WorkerClient, type WasmDriver, type WorkerPortLike } from './wasm/wasmDriver';

export type { Row, SqlDriver, SqlDriverInfo, SqlExecutor, SqlParams, SqlValue } from '../core/ports';
export { DataError, SqlError, type DataErrorCode } from './errors';
export { LATEST_SCHEMA_VERSION } from './migrations';

export interface OpenDatabaseOptions {
  /**
   * Otra pestaña tiene la base abierta. La UI muestra "Cuadra está abierta en otra pestaña · Usar aquí"
   * y llama a takeOver() con el botón. openDatabase() sigue esperando hasta obtener el candado.
   */
  onBlocked?: (takeOver: () => void) => void;
  /**
   * Otra pestaña pidió "Usar aquí". Cuando se llama, esta pestaña YA cerró su base: todas las llamadas
   * fallan con DataError('database_released'). La UI muestra la pantalla de bloqueo.
   */
  onReleaseRequested?: () => void;
  /** Falló un volcado a IndexedDB (modo memory-idb). */
  onPersistError?: (message: string) => void;
}

export interface StorageStatus {
  kind: SqlDriverInfo['kind'];
  /** Igual que info.persistent: OPFS/archivo nativo true; :memory:+IDB true con riesgo; :memory: puro false. */
  persistent: boolean;
  /** Resultado de navigator.storage.persist(): true/false, o null si no existe o no aplica. */
  persistGranted: boolean | null;
  /** Por qué no se usó OPFS (mensaje del error), o null si se usó. */
  fallbackReason: string | null;
  /** memory-idb: se recuperaron datos guardados en IndexedDB. */
  restored: boolean;
  /** false si el navegador no tiene Web Locks (sin protección entre pestañas). */
  tabLock: boolean;
}

export interface OpenedDatabase extends SqlDriver {
  readonly storage: StorageStatus;
  readonly schema: MigrateResult;
  /** Vuelca ya lo pendiente (memory-idb). En OPFS y Tauri no hace nada. */
  flush(): Promise<void>;
}

/** Inyectables para pruebas; en la app se usan los del navegador. */
export interface OpenDatabaseDeps {
  isTauri?: () => boolean;
  spawnWorker?: () => WorkerPortLike;
  openByteStore?: () => Promise<ByteStore>;
  locks?: LockManager | null;
  createChannel?: TabLockOptions['createChannel'];
  storage?: Pick<StorageManager, 'persist'> | null;
  /** Para escuchar visibilitychange/pagehide; null en pruebas. */
  lifecycle?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

type TauriModule = { openTauriDriver: () => Promise<SqlDriver> };
// Si src/data/tauri/tauriDriver.ts no existe, el glob queda vacío y el build no se rompe.
// Cuando 3G lo cree con `export async function openTauriDriver(): Promise<SqlDriver>`, entra solo.
const tauriLoaders = import.meta.glob<TauriModule>('./tauri/tauriDriver.ts');

function detectTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function loadTauriDriver(): Promise<SqlDriver> {
  const load = tauriLoaders['./tauri/tauriDriver.ts'];
  if (!load) {
    throw new DataError('tauri_driver_pending', 'Escritorio detectado, pero el driver de Tauri está pendiente');
  }
  const mod = await load();
  return mod.openTauriDriver();
}

async function requestPersistence(storage: Pick<StorageManager, 'persist'> | null | undefined): Promise<boolean | null> {
  const manager = storage === undefined ? (typeof navigator !== 'undefined' ? navigator.storage : undefined) : storage;
  if (!manager || typeof manager.persist !== 'function') return null;
  try {
    return await manager.persist();
  } catch {
    return null;
  }
}

async function snapshotBefore(
  driver: SqlDriver,
  openStore: () => Promise<ByteStore>,
  label: string,
): Promise<void> {
  try {
    const store = await openStore();
    await saveSnapshot(store, label, await driver.exportBytes());
  } catch {
    // Sin IndexedDB no hay copia automática; migrar sigue siendo transaccional.
  }
}

function withExtras(
  driver: SqlDriver,
  storage: StorageStatus,
  schema: MigrateResult,
  flush: () => Promise<void>,
  onClose: () => void,
): OpenedDatabase {
  const close = driver.close.bind(driver);
  return Object.assign(driver, {
    storage,
    schema,
    flush,
    async close() {
      try {
        await close();
      } finally {
        onClose();
      }
    },
  });
}

export async function openDatabase(options: OpenDatabaseOptions = {}, deps: OpenDatabaseDeps = {}): Promise<OpenedDatabase> {
  const openStore = deps.openByteStore ?? (() => openIdbStore());

  if ((deps.isTauri ?? detectTauri)()) {
    const driver = await loadTauriDriver();
    const schema = await migrateOrClose(driver, openStore);
    const storage: StorageStatus = {
      kind: driver.info.kind,
      persistent: driver.info.persistent,
      persistGranted: null,
      fallbackReason: null,
      restored: false,
      tabLock: false,
    };
    return withExtras(driver, storage, schema, async () => undefined, () => undefined);
  }

  let driver: WasmDriver | null = null;
  let released = false;
  const lock: TabLockHandle = await acquireTabLock({
    ...(deps.locks !== undefined ? { locks: deps.locks } : {}),
    ...(deps.createChannel !== undefined ? { createChannel: deps.createChannel } : {}),
    ...(options.onBlocked ? { onBlocked: options.onBlocked } : {}),
    onReleaseRequested: async () => {
      released = true;
      if (driver) await driver.release();
      options.onReleaseRequested?.();
    },
  });

  try {
    const persistGranted = await requestPersistence(deps.storage);
    const client = new WorkerClient((deps.spawnWorker ?? spawnDbWorker)());
    client.onEvent((event) => {
      if (event.event === 'persist_error') options.onPersistError?.(event.message);
    });

    let fallbackReason: string | null = null;
    try {
      driver = await openWasmDriver(client, { mode: 'opfs' });
    } catch (err) {
      if (err instanceof DomainError) throw err; // sqlite_too_old: no tiene sentido reintentar
      fallbackReason = err instanceof Error ? err.message : String(err);
      try {
        driver = await openWasmDriver(client, { mode: 'memory-idb' });
      } catch (fallbackErr) {
        client.terminate();
        if (fallbackErr instanceof DomainError) throw fallbackErr;
        throw new DataError('storage_unavailable', 'No se pudo abrir la base de datos', {
          opfs: fallbackReason,
          memory: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }
    }
    const opened = driver;
    if (released) {
      // Otra pestaña pidió la base mientras abríamos.
      await opened.release();
      throw new DataError('database_released');
    }

    const schema = await migrateOrClose(opened, openStore);

    const lifecycle =
      deps.lifecycle === undefined ? (typeof window !== 'undefined' ? window : null) : deps.lifecycle;
    const flushOnHide = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'hidden') void opened.flush().catch(() => undefined);
    };
    const flushNow = (): void => {
      void opened.flush().catch(() => undefined);
    };
    if (opened.mode === 'memory-idb' && lifecycle) {
      lifecycle.addEventListener('visibilitychange', flushOnHide);
      lifecycle.addEventListener('pagehide', flushNow);
    }

    const storage: StorageStatus = {
      kind: opened.info.kind,
      persistent: opened.info.persistent,
      persistGranted,
      fallbackReason,
      restored: opened.restored,
      tabLock: lock.supported,
    };
    return withExtras(
      opened,
      storage,
      schema,
      () => opened.flush(),
      () => {
        lifecycle?.removeEventListener('visibilitychange', flushOnHide);
        lifecycle?.removeEventListener('pagehide', flushNow);
        lock.release();
      },
    );
  } catch (err) {
    lock.release();
    throw err;
  }
}

async function migrateOrClose(driver: SqlDriver, openStore: () => Promise<ByteStore>): Promise<MigrateResult> {
  try {
    return await migrate(driver, {
      beforeMigrate: ({ from, to }) => snapshotBefore(driver, openStore, `before-migrate-v${from}-to-v${to}`),
    });
  } catch (err) {
    await driver.close().catch(() => undefined);
    throw err;
  }
}
