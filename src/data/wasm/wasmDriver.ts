// SqlDriver sobre postMessage: cada petición lleva un id y su respuesta resuelve la promesa de ese id.
// Los errores vuelven serializados y aquí se reconstruyen como DomainError, SqlError o DataError.
// El mutex, las transacciones y la traducción de RAISE los pone createSerialDriver.
import { DomainError, isErrorCode } from '../../core/errors';
import type { Row } from '../../core/ports';
import { DataError, type DataErrorCode, SqlError } from '../errors';
import { createSerialDriver, type SerialDriver, type SqlBackend } from '../serialDriver';
import {
  isWorkerEvent,
  type OpenResult,
  type SerializedError,
  type StorageMode,
  type WorkerEvent,
  type WorkerMessage,
  type WorkerRequest,
  type WorkerRequestBody,
  type WorkerResultMap,
} from './protocol';

/** Lo que se necesita de un Worker (o de un MessagePort en las pruebas). */
export interface WorkerPortLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate?(): void;
}

const DATA_ERROR_CODES: readonly DataErrorCode[] = [
  'database_closed',
  'database_released',
  'transaction_finished',
  'worker_failed',
  'storage_unavailable',
  'tauri_driver_pending',
];

export function deserializeError(error: SerializedError): Error {
  if (error.name === 'DomainError' && isErrorCode(error.code)) return new DomainError(error.code, error.details);
  if (error.name === 'DataError' && DATA_ERROR_CODES.includes(error.code as DataErrorCode)) {
    return new DataError(error.code as DataErrorCode, error.message, error.details);
  }
  if (error.name === 'SqlError') return new SqlError(error.message, error.resultCode ?? null);
  const err = new Error(error.message);
  err.name = error.name;
  return err;
}

type Op = WorkerRequestBody['op'];

export class WorkerClient {
  #port: WorkerPortLike;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  #dead: Error | null = null;
  #listeners = new Set<(event: WorkerEvent) => void>();

  constructor(port: WorkerPortLike) {
    this.#port = port;
    port.addEventListener('message', (event) => this.#onMessage(event.data));
    port.addEventListener('error', (event) => {
      const detail = (event as Partial<ErrorEvent>).message;
      const message = typeof detail === 'string' && detail ? detail : 'El worker de la base de datos falló';
      this.#fail(new DataError('worker_failed', message));
    });
  }

  onEvent(listener: (event: WorkerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  request<K extends Op>(body: Extract<WorkerRequestBody, { op: K }>): Promise<WorkerResultMap[K]> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#nextId++;
    return new Promise<WorkerResultMap[K]>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.#port.postMessage({ ...body, id } as WorkerRequest);
      } catch (err) {
        this.#pending.delete(id);
        reject(new DataError('worker_failed', err instanceof Error ? err.message : String(err)));
      }
    });
  }

  terminate(): void {
    this.#fail(new DataError('database_closed'));
    this.#port.terminate?.();
  }

  #onMessage(message: WorkerMessage): void {
    if (isWorkerEvent(message)) {
      for (const listener of this.#listeners) listener(message);
      return;
    }
    const entry = this.#pending.get(message.id);
    if (!entry) return;
    this.#pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(deserializeError(message.error));
  }

  #fail(err: Error): void {
    this.#dead ??= err;
    for (const entry of this.#pending.values()) entry.reject(err);
    this.#pending.clear();
  }
}

export interface WasmDriver extends SerialDriver {
  /** Modo efectivo en el worker. */
  readonly mode: StorageMode;
  /** memory-idb: se recuperó una copia de IndexedDB. */
  readonly restored: boolean;
  /** Vuelca ya a IndexedDB (memory-idb); en OPFS no hace nada. */
  flush(): Promise<void>;
  /**
   * Cede la base a otra pestaña: espera lo que esté en curso, vuelca, cierra y libera OPFS.
   * Después, toda llamada falla con DataError('database_released').
   */
  release(): Promise<void>;
  onWorkerEvent(listener: (event: WorkerEvent) => void): () => void;
}

/** Abre la base en el worker y devuelve el driver. Si el modo falla, el error sale tal cual. */
export async function openWasmDriver(
  client: WorkerClient,
  options: { mode: StorageMode; filename?: string },
): Promise<WasmDriver> {
  const opened: OpenResult = await client.request({
    op: 'open',
    mode: options.mode,
    filename: options.filename ?? '/cuadra.sqlite3',
  });

  const backend: SqlBackend = {
    info: opened.info,
    all: (sql, params) => client.request({ op: 'all', sql, ...(params ? { params } : {}) }) as Promise<Row[]>,
    get: (sql, params) => client.request({ op: 'get', sql, ...(params ? { params } : {}) }),
    run: (sql, params) => client.request({ op: 'run', sql, ...(params ? { params } : {}) }),
    runMany: (sql, rows) => client.request({ op: 'runMany', sql, rows }),
    exec: (sql) => client.request({ op: 'exec', sql }),
    exportBytes: () => client.request({ op: 'export' }),
    close: async () => {
      try {
        await client.request({ op: 'close' });
      } finally {
        client.terminate();
      }
    },
  };

  const serial = createSerialDriver(backend);
  const mode: StorageMode = opened.info.kind === 'wasm-opfs' ? 'opfs' : 'memory-idb';

  const driver: WasmDriver = Object.assign(serial, {
    mode,
    restored: opened.restored,
    async flush() {
      if (!serial.isOpen) return;
      await client.request({ op: 'flush' });
    },
    release() {
      return serial.retire('database_released', async () => {
        try {
          await client.request({ op: 'pause' });
        } finally {
          client.terminate();
        }
      });
    },
    onWorkerEvent: (listener: (event: WorkerEvent) => void) => client.onEvent(listener),
  });
  return driver;
}

/** Crea el worker real (Vite lo empaqueta como chunk propio junto con sqlite3.wasm). */
export function spawnDbWorker(): Worker {
  return new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module', name: 'cuadra-db' });
}
