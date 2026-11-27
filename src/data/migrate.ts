// Runner de migraciones. Fuente de verdad de la versión: PRAGMA user_version (vive en la cabecera del
// archivo y es transaccional). schema_migrations guarda nombre, checksum y fecha de cada una aplicada.
//
// - Idempotente: sin pendientes no escribe nada.
// - Cada migración va en su propia transacción (BEGIN IMMEDIATE … COMMIT): DDL + fila en
//   schema_migrations + user_version. Si algo falla, ROLLBACK y DomainError('migration_failed').
// - BD de una versión más nueva que la app → DomainError('db_from_newer_version'): nunca se toca.
// - Una migración aplicada cuyo SQL cambió → DomainError('migration_checksum').
//
// Se ejecuta antes de entregar el driver a la app (openDatabase), así que usa exec() para el
// BEGIN/COMMIT: el SQL de una migración tiene varias sentencias y SqlExecutor no tiene exec().
import { DomainError } from '../core/errors';
import type { SqlDriver } from '../core/ports';
import { MIGRATIONS, type Migration } from './migrations';
import { sha256Hex } from './sha256';

export interface MigrateOptions {
  migrations?: readonly Migration[];
  now?: () => Date;
  /**
   * Se llama una vez antes de aplicar migraciones sobre una BD que ya tenía esquema (from > 0).
   * openDatabase la usa para guardar una copia automática con exportBytes().
   */
  beforeMigrate?: (info: { from: number; to: number }) => Promise<void>;
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: number[];
}

const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  TEXT NOT NULL
) STRICT;`;

export function migrationChecksum(migration: Migration): string {
  return sha256Hex(migration.sql);
}

function assertWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new Error(`Migraciones mal ordenadas: se esperaba la versión ${index + 1} y llegó ${m.version}`);
    }
  });
}

export async function readSchemaVersion(driver: Pick<SqlDriver, 'get'>): Promise<number> {
  const row = await driver.get<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

export async function migrate(driver: SqlDriver, options: MigrateOptions = {}): Promise<MigrateResult> {
  const migrations = options.migrations ?? MIGRATIONS;
  const now = options.now ?? (() => new Date());
  assertWellFormed(migrations);

  const latest = migrations.length;
  const from = await readSchemaVersion(driver);

  if (from > latest) {
    throw new DomainError('db_from_newer_version', { current: from, supported: latest });
  }

  if (from > 0) await verifyApplied(driver, migrations.slice(0, from));

  const pending = migrations.slice(from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  if (from > 0 && options.beforeMigrate) await options.beforeMigrate({ from, to: latest });

  const applied: number[] = [];
  for (const migration of pending) {
    await applyOne(driver, migration, now());
    applied.push(migration.version);
  }
  return { from, to: latest, applied };
}

async function verifyApplied(driver: SqlDriver, migrations: readonly Migration[]): Promise<void> {
  const table = await driver.get(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  const rows = table
    ? await driver.all<{ version: number; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      )
    : [];
  const byVersion = new Map(rows.map((r) => [Number(r.version), String(r.checksum)]));
  for (const migration of migrations) {
    const expected = migrationChecksum(migration);
    const actual = byVersion.get(migration.version) ?? null;
    if (actual !== expected) {
      throw new DomainError('migration_checksum', { version: migration.version, name: migration.name, expected, actual });
    }
  }
}

async function applyOne(driver: SqlDriver, migration: Migration, at: Date): Promise<void> {
  await driver.exec('BEGIN IMMEDIATE');
  try {
    await driver.exec(SCHEMA_MIGRATIONS_DDL);
    await driver.exec(migration.sql);
    await driver.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [
      migration.version,
      migration.name,
      migrationChecksum(migration),
      at.toISOString(),
    ]);
    const violations = await driver.all('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(`foreign_key_check devolvió ${violations.length} filas`);
    }
    // PRAGMA no admite parámetros; version es un entero validado arriba.
    await driver.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
    await driver.exec('COMMIT');
  } catch (err) {
    try {
      await driver.exec('ROLLBACK');
    } catch {
      // La transacción ya pudo haberse deshecho sola.
    }
    throw new DomainError('migration_failed', {
      version: migration.version,
      name: migration.name,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
