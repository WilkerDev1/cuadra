// Upgraders de respaldos (ARCHITECTURE.md 3.7). Un respaldo hecho con una versión de esquema anterior se
// lleva a la actual EN MEMORIA, antes de insertar nada, aplicando en cadena un upgrader por cada migración
// que cambie la forma de las tablas respaldadas (n → n+1). La migración 001 es la primera: aún no hay
// ninguno. Al añadir la migración 002 que, por ejemplo, agregue una columna, se añade aquí su upgrader
// (archivo `<n>.ts` con un `BackupUpgrader`) y se registra en SCHEMA_UPGRADERS.
//
// Además, el sobre (formatVersion) se normaliza con FORMAT_UPGRADERS; hoy solo existe la versión 1.
import { DomainError } from '../../errors';
import type { SqlValue } from '../../ports';
import type { BackupFile, BackupTable } from '../backup';

/** Lleva un respaldo de `from` a `to` (= from + 1). Puede mutar la copia que recibe y devolverla. */
export interface BackupUpgrader {
  from: number;
  to: number;
  upgrade(file: BackupFile): BackupFile;
}

/** Normaliza el sobre de una versión antigua de formato a la siguiente. Recibe el JSON tal cual. */
export interface FormatUpgrader {
  from: number;
  to: number;
  upgrade(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Versión actual del sobre del respaldo. */
export const CURRENT_FORMAT_VERSION = 1;

/** Un upgrader por migración que cambie la forma de las tablas respaldadas. 001 no necesita ninguno. */
export const SCHEMA_UPGRADERS: readonly BackupUpgrader[] = [];

/** Upgraders del sobre. La versión 1 es la primera publicada. */
export const FORMAT_UPGRADERS: readonly FormatUpgrader[] = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Aplica los upgraders de esquema necesarios para llevar `file` a `targetSchema`. No muta la entrada.
 * Falta un eslabón de la cadena → DomainError('backup_invalid'). Más nuevo que el destino →
 * DomainError('backup_from_newer_version').
 */
export function upgradeBackup(
  file: BackupFile,
  targetSchema: number,
  upgraders: readonly BackupUpgrader[] = SCHEMA_UPGRADERS,
): BackupFile {
  if (file.schemaVersion > targetSchema) {
    throw new DomainError('backup_from_newer_version', { schemaVersion: file.schemaVersion, current: targetSchema });
  }
  let current = clone(file);
  while (current.schemaVersion < targetSchema) {
    const step = upgraders.find((u) => u.from === current.schemaVersion);
    if (step === undefined || step.to !== step.from + 1) {
      throw new DomainError('backup_invalid', { reason: 'missing_upgrader', from: current.schemaVersion });
    }
    current = step.upgrade(current);
    current.schemaVersion = step.to;
    for (const table of Object.keys(current.counts) as BackupTable[]) {
      current.counts[table] = current.tables[table]?.rows.length ?? 0;
    }
  }
  return current;
}

/** Normaliza el sobre (formatVersion) hasta la versión actual. No muta la entrada. */
export function upgradeFormat(
  raw: Record<string, unknown>,
  upgraders: readonly FormatUpgrader[] = FORMAT_UPGRADERS,
): Record<string, unknown> {
  let current = clone(raw);
  const declared = current['formatVersion'];
  if (typeof declared !== 'number' || !Number.isInteger(declared)) {
    throw new DomainError('backup_invalid', { reason: 'format_version' });
  }
  let version: number = declared;
  if (version > CURRENT_FORMAT_VERSION) {
    throw new DomainError('backup_from_newer_version', { formatVersion: version, current: CURRENT_FORMAT_VERSION });
  }
  while (version < CURRENT_FORMAT_VERSION) {
    const step = upgraders.find((u) => u.from === version);
    if (step === undefined) throw new DomainError('backup_invalid', { reason: 'missing_format_upgrader', from: version });
    current = step.upgrade(current);
    current['formatVersion'] = step.to;
    version = step.to;
  }
  return current;
}

// ── Ayudas para escribir upgraders de una línea ──────────────────────────────────────────

/** Añade una columna con un valor por defecto (si no existe). */
export function addColumn(file: BackupFile, table: BackupTable, column: string, value: SqlValue): BackupFile {
  const t = file.tables[table];
  if (!t.columns.includes(column)) {
    t.columns.push(column);
    for (const row of t.rows) row.push(value);
  }
  return file;
}

/** Renombra una columna (si existe). */
export function renameColumn(file: BackupFile, table: BackupTable, from: string, to: string): BackupFile {
  const t = file.tables[table];
  const at = t.columns.indexOf(from);
  if (at >= 0) t.columns[at] = to;
  return file;
}

/** Quita una columna (si existe). */
export function dropColumn(file: BackupFile, table: BackupTable, column: string): BackupFile {
  const t = file.tables[table];
  const at = t.columns.indexOf(column);
  if (at >= 0) {
    t.columns.splice(at, 1);
    for (const row of t.rows) row.splice(at, 1);
  }
  return file;
}
