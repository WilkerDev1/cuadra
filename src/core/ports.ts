// Puerto de datos del núcleo (ARCHITECTURE.md 3.1). Vive aquí por inversión de dependencias:
// los servicios dependen del puerto y los adaptadores de src/data lo implementan.
import type { IsoDate } from './types';

export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;
export type Row = Record<string, SqlValue>;

/** Lo mínimo para ejecutar SQL. Dentro de una transacción se recibe uno de estos. */
export interface SqlExecutor {
  all<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T[]>;
  get<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T | undefined>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  /** Mismo SQL con muchas filas de parámetros, en una sola ida al worker. */
  runMany(sql: string, rows: readonly SqlParams[]): Promise<{ changes: number }>;
  /**
   * Sentencias DISTINTAS en orden, en una sola ida al worker, atómicas (o todas o ninguna). Devuelve las filas
   * cambiadas por cada una. Opcional: los adaptadores que no lo tienen se sustituyen con `runSeries()` de abajo.
   */
  runSeries?(steps: readonly SqlStep[]): Promise<{ changes: number[] }>;
}

export interface SqlStep {
  sql: string;
  params?: SqlParams;
}

/**
 * Ejecuta `steps` con `exec.runSeries` si el adaptador lo tiene (una ida) o, si no, una a una. Dentro de una
 * transacción el resultado es el mismo: si una falla, la transacción entera se deshace.
 */
export async function runSeries(exec: SqlExecutor, steps: readonly SqlStep[]): Promise<{ changes: number[] }> {
  if (steps.length === 0) return { changes: [] };
  if (exec.runSeries) return exec.runSeries(steps);
  const changes: number[] = [];
  for (const s of steps) changes.push((await exec.run(s.sql, s.params)).changes);
  return { changes };
}

export interface SqlDriverInfo {
  kind: 'wasm-opfs' | 'wasm-memory-idb' | 'node' | 'tauri';
  persistent: boolean; // OPFS/archivo nativo: true; :memory:+IDB: true con riesgo; :memory: puro: false
  sqliteVersion: string;
}

export interface SqlDriver extends SqlExecutor {
  readonly info: SqlDriverInfo;
  /** Varias sentencias sin parámetros (migraciones). */
  exec(sql: string): Promise<void>;
  /**
   * BEGIN IMMEDIATE … COMMIT, o ROLLBACK si fn lanza. Todas las llamadas de fn van por `tx`.
   * Las llamadas al driver desde fuera esperan (mutex). Anidar: `tx` no tiene transaction();
   * los servicios componen pasando `tx` (ver uow.ts).
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Archivo SQLite completo (copias automáticas antes de migrar/restaurar). */
  exportBytes(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface Clock {
  now(): Date; // marcas del sistema
  today(): IsoDate; // fecha local del usuario (no UTC)
}

export interface IdGen {
  next(): string; // uuidv7
}
