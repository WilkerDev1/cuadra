// Mensajes entre wasmDriver (hilo principal) y db.worker.ts. Cada petición lleva un id; la respuesta
// repite el id con ok/result o con un error serializado que el cliente reconstruye con su clase.
import type { Row, SqlDriverInfo, SqlParams, SqlStep } from '../../core/ports';

export type StorageMode = 'opfs' | 'memory-idb';

export type WorkerRequestBody =
  | { op: 'open'; mode: StorageMode; filename: string }
  | { op: 'all'; sql: string; params?: SqlParams }
  | { op: 'get'; sql: string; params?: SqlParams }
  | { op: 'run'; sql: string; params?: SqlParams }
  | { op: 'runMany'; sql: string; rows: readonly SqlParams[] }
  /** Sentencias distintas en orden, atómicas (SAVEPOINT): reservar seq + insertar, fila a fila, en un viaje. */
  | { op: 'runSeries'; steps: readonly SqlStep[] }
  | { op: 'exec'; sql: string }
  | { op: 'export' }
  /** Vuelca ya a IndexedDB (modo memory-idb). En OPFS no hace nada. */
  | { op: 'flush' }
  /** Cierra la conexión y libera los access handles de OPFS (pauseVfs) para cederla a otra pestaña. */
  | { op: 'pause' }
  | { op: 'close' };

export type WorkerRequest = WorkerRequestBody & { id: number };

export interface OpenResult {
  info: SqlDriverInfo;
  /** memory-idb: true si se hidrató desde una copia previa en IndexedDB. */
  restored: boolean;
}

export interface WorkerResultMap {
  open: OpenResult;
  all: Row[];
  get: Row | undefined;
  run: { changes: number };
  runMany: { changes: number };
  runSeries: { changes: number[] };
  exec: undefined;
  export: Uint8Array;
  flush: undefined;
  pause: undefined;
  close: undefined;
}

export interface SerializedError {
  /** 'DomainError' | 'SqlError' | 'DataError' | otro nombre de Error. */
  name: string;
  message: string;
  /** DomainError/DataError: su código. */
  code?: string;
  /** SqlError: código extendido de SQLite. */
  resultCode?: number | null;
  details?: Record<string, unknown>;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };

/** Avisos que el worker manda sin que nadie pregunte. */
export type WorkerEvent = { event: 'persist_error'; message: string } | { event: 'persisted'; bytes: number };

export type WorkerMessage = WorkerResponse | WorkerEvent;

export function isWorkerEvent(message: WorkerMessage): message is WorkerEvent {
  return 'event' in message;
}
