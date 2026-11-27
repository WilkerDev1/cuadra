import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '../core/errors';
import type { SqlDriver } from '../core/ports';
import { migrate, migrationChecksum, readSchemaVersion } from './migrate';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, type Migration } from './migrations';
import { openNodeDriver } from './node/nodeDriver';

const drivers: SqlDriver[] = [];
async function fresh(): Promise<SqlDriver> {
  const driver = await openNodeDriver();
  drivers.push(driver);
  return driver;
}
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.close()));
});

async function domainCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return (err as DomainError).code;
  }
  throw new Error('se esperaba un DomainError');
}

const tableExists = async (driver: SqlDriver, name: string) =>
  (await driver.get("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?", [name])) !== undefined;

describe('migrate', () => {
  it('BD vacía aplica 001, deja user_version=1 y fila en schema_migrations', async () => {
    const driver = await fresh();
    const result = await migrate(driver, { now: () => new Date('2026-06-15T12:00:00.000Z') });

    expect(result).toEqual({ from: 0, to: 1, applied: [1] });
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(await readSchemaVersion(driver)).toBe(1);
    const rows = await driver.all('SELECT version, name, checksum, applied_at FROM schema_migrations');
    expect(rows).toEqual([
      {
        version: 1,
        name: 'init',
        checksum: migrationChecksum(MIGRATIONS[0]!),
        applied_at: '2026-06-15T12:00:00.000Z',
      },
    ]);
    expect(migrationChecksum(MIGRATIONS[0]!)).toMatch(/^[0-9a-f]{64}$/);
    for (const table of ['settings', 'workspaces', 'accounts', 'transactions', 'audit_log', 'audit_log_changes']) {
      expect(await tableExists(driver, table)).toBe(true);
    }
  });

  it('migrar dos veces no hace nada la segunda', async () => {
    const driver = await fresh();
    await migrate(driver);
    const before = await driver.exportBytes();
    let called = false;
    const second = await migrate(driver, {
      beforeMigrate: async () => {
        called = true;
      },
    });
    expect(second).toEqual({ from: 1, to: 1, applied: [] });
    expect(called).toBe(false);
    expect(await driver.exportBytes()).toEqual(before);
    expect((await driver.all('SELECT version FROM schema_migrations')).length).toBe(1);
  });

  it('una migración que falla hace ROLLBACK y user_version no cambia', async () => {
    const driver = await fresh();
    await migrate(driver);
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: 2, name: 'broken', sql: 'CREATE TABLE half_done (a INTEGER) STRICT; INSERT INTO nope VALUES (1);' },
    ];
    const snapshots: Array<{ from: number; to: number }> = [];
    const code = await domainCode(
      migrate(driver, {
        migrations: broken,
        beforeMigrate: async (info) => {
          snapshots.push(info);
        },
      }),
    );

    expect(code).toBe('migration_failed');
    expect(snapshots).toEqual([{ from: 1, to: 2 }]);
    expect(await readSchemaVersion(driver)).toBe(1);
    expect(await tableExists(driver, 'half_done')).toBe(false);
    expect((await driver.all('SELECT version FROM schema_migrations')).map((r) => r['version'])).toEqual([1]);
    // La conexión queda usable y fuera de transacción.
    await driver.transaction(async (tx) => {
      await tx.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'a', '1', 'x')");
    });
  });

  it('una migración que falla en BD vacía no deja ni el esquema a medias', async () => {
    const driver = await fresh();
    const code = await domainCode(
      migrate(driver, {
        migrations: [{ version: 1, name: 'init', sql: MIGRATIONS[0]!.sql + '\nSELECT * FROM missing_table;' }],
      }),
    );
    expect(code).toBe('migration_failed');
    expect(await readSchemaVersion(driver)).toBe(0);
    expect(await tableExists(driver, 'transactions')).toBe(false);
    expect(await tableExists(driver, 'schema_migrations')).toBe(false);
  });

  it('aplica en orden varias migraciones pendientes', async () => {
    const driver = await fresh();
    const extra: Migration[] = [
      ...MIGRATIONS,
      { version: 2, name: 'extra', sql: 'CREATE TABLE extra_two (a INTEGER) STRICT;' },
      { version: 3, name: 'extra3', sql: 'CREATE TABLE extra_three (a INTEGER) STRICT;' },
    ];
    expect(await migrate(driver, { migrations: extra })).toEqual({ from: 0, to: 3, applied: [1, 2, 3] });
    expect(await readSchemaVersion(driver)).toBe(3);
  });

  it('BD con user_version mayor que la app → db_from_newer_version', async () => {
    const driver = await fresh();
    await migrate(driver);
    await driver.exec('PRAGMA user_version = 7');
    expect(await domainCode(migrate(driver))).toBe('db_from_newer_version');
    expect(await readSchemaVersion(driver)).toBe(7);
  });

  it('checksum distinto de una migración aplicada → migration_checksum', async () => {
    const driver = await fresh();
    await migrate(driver);
    const edited: Migration[] = [{ ...MIGRATIONS[0]!, sql: MIGRATIONS[0]!.sql + '\n-- editada' }];
    expect(await domainCode(migrate(driver, { migrations: edited }))).toBe('migration_checksum');
  });

  it('foreign_keys está activo al abrir (PRAGMA foreign_keys = 1)', async () => {
    const driver = await fresh();
    expect(await driver.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    await migrate(driver);
    expect(await driver.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('rechaza una lista de migraciones con huecos', async () => {
    const driver = await fresh();
    await expect(
      migrate(driver, { migrations: [...MIGRATIONS, { version: 3, name: 'x', sql: 'SELECT 1;' }] }),
    ).rejects.toThrow(/mal ordenadas/);
  });
});
