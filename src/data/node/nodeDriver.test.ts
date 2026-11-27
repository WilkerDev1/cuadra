// Contrato del SqlDriver (ARCHITECTURE.md 3.1) sobre node:sqlite. createSerialDriver es común a todos
// los adaptadores, así que esto cubre también la semántica de transacciones del worker y de Tauri.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../../core/errors';
import type { SqlDriver, SqlExecutor } from '../../core/ports';
import { DataError, SqlError } from '../errors';
import { openNodeDriver } from './nodeDriver';

let db: SqlDriver;
beforeEach(async () => {
  db = await openNodeDriver();
  await db.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE, data BLOB) STRICT;
    CREATE TABLE guarded (id INTEGER PRIMARY KEY) STRICT;
    CREATE TRIGGER guarded_no_delete BEFORE DELETE ON guarded BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END;
  `);
});
afterEach(async () => {
  if ((db as { isOpen?: boolean }).isOpen !== false) await db.close();
});

const count = async () => Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM t'))!.n);

describe('nodeDriver', () => {
  it('informa kind node, persistencia y versión de SQLite', () => {
    expect(db.info.kind).toBe('node');
    expect(db.info.persistent).toBe(false);
    expect(db.info.sqliteVersion).toMatch(/^3\.\d+\.\d+$/);
  });

  it('all/get/run con parámetros posicionales y con nombre (con o sin prefijo)', async () => {
    expect(await db.run('INSERT INTO t (label) VALUES (?)', ['a'])).toEqual({ changes: 1 });
    expect(await db.run('INSERT INTO t (label) VALUES (:label)', { label: 'b' })).toEqual({ changes: 1 });
    expect(await db.run('INSERT INTO t (label) VALUES ($label)', { label: 'c' })).toEqual({ changes: 1 });
    expect(await db.all('SELECT label FROM t ORDER BY id')).toEqual([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);
    expect(await db.get('SELECT label FROM t WHERE label = ?1', ['b'])).toEqual({ label: 'b' });
    expect(await db.get('SELECT label FROM t WHERE label = ?', ['zzz'])).toBeUndefined();
    expect(await db.get('INSERT INTO t (label) VALUES (?) RETURNING id', ['d'])).toEqual({ id: 4 });
  });

  it('las filas son objetos planos y los BLOB llegan como Uint8Array', async () => {
    await db.run('INSERT INTO t (label, data) VALUES (?, ?)', ['bin', new Uint8Array([1, 2, 3])]);
    const row = await db.get('SELECT label, data FROM t');
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(row!['data']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('transaction hace COMMIT y devuelve el valor de fn', async () => {
    const value = await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (label) VALUES ('x')");
      return tx.get<{ n: number }>('SELECT count(*) AS n FROM t');
    });
    expect(value).toEqual({ n: 1 });
    expect(await count()).toBe(1);
  });

  it('transaction hace ROLLBACK si fn lanza y deja la conexión usable', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t (label) VALUES ('x')");
        throw new Error('fallo de negocio');
      }),
    ).rejects.toThrow('fallo de negocio');
    expect(await count()).toBe(0);
    await db.transaction((tx) => tx.run("INSERT INTO t (label) VALUES ('y')"));
    expect(await count()).toBe(1);
  });

  it('las llamadas de fuera esperan a que termine la transacción (mutex)', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const txDone = db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (label) VALUES ('in-tx')");
      order.push('tx:inserted');
      await gate;
      order.push('tx:commit');
    });
    const outside = db.all('SELECT label FROM t').then((rows) => {
      order.push(`outside:${rows.length}`);
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['tx:inserted']);
    release();
    await Promise.all([txDone, outside]);
    expect(order).toEqual(['tx:inserted', 'tx:commit', 'outside:1']);
  });

  it('usar el tx de una transacción terminada → DataError transaction_finished', async () => {
    let leaked: SqlExecutor | null = null;
    await db.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked!.run("INSERT INTO t (label) VALUES ('late')")).rejects.toMatchObject({
      name: 'DataError',
      code: 'transaction_finished',
    });
  });

  it('runMany aplica todas las filas o ninguna, dentro y fuera de transacción', async () => {
    expect(await db.runMany('INSERT INTO t (label) VALUES (?)', [['a'], ['b'], ['c']])).toEqual({ changes: 3 });
    await expect(db.runMany('INSERT INTO t (label) VALUES (?)', [['d'], ['a'], ['e']])).rejects.toBeInstanceOf(SqlError);
    expect(await count()).toBe(3);

    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (label) VALUES ('f')");
      await expect(tx.runMany('INSERT INTO t (label) VALUES (?)', [['g'], ['f']])).rejects.toBeInstanceOf(SqlError);
      // El fallo de runMany no deshace lo anterior de la transacción.
      await tx.run("INSERT INTO t (label) VALUES ('h')");
    });
    expect((await db.all('SELECT label FROM t ORDER BY id')).map((r) => r['label'])).toEqual(['a', 'b', 'c', 'f', 'h']);
  });

  it('RAISE(ABORT, código conocido) llega como DomainError; el resto como SqlError con resultCode', async () => {
    await db.run('INSERT INTO guarded (id) VALUES (1)');
    const err = await db.run('DELETE FROM guarded').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('delete_forbidden');

    await db.run("INSERT INTO t (label) VALUES ('dup')");
    const unique = await db.run("INSERT INTO t (label) VALUES ('dup')").catch((e: unknown) => e);
    expect(unique).toBeInstanceOf(SqlError);
    expect((unique as SqlError).resultCode).toBe(2067); // SQLITE_CONSTRAINT_UNIQUE
    expect((unique as SqlError).message).toMatch(/UNIQUE/);
  });

  it('un DomainError dentro de la transacción hace ROLLBACK y sale como DomainError', async () => {
    await db.run('INSERT INTO guarded (id) VALUES (1)');
    const err = await db
      .transaction(async (tx) => {
        await tx.run("INSERT INTO t (label) VALUES ('x')");
        await tx.run('DELETE FROM guarded');
      })
      .catch((e: unknown) => e);
    expect((err as DomainError).code).toBe('delete_forbidden');
    expect(await count()).toBe(0);
  });

  it('un error propio de fn (no de SQLite) hace ROLLBACK y sale con su clase original', async () => {
    class CallerError extends Error {}
    const own = new CallerError('regla del llamador');
    const err = await db
      .transaction(async (tx) => {
        await tx.run("INSERT INTO t (label) VALUES ('x')");
        throw own;
      })
      .catch((e: unknown) => e);
    expect(err).toBe(own);
    const typeErr = await db
      .transaction(async () => {
        (null as unknown as { x: number }).x;
      })
      .catch((e: unknown) => e);
    expect(typeErr).toBeInstanceOf(TypeError);
    expect(await count()).toBe(0);
  });

  it('un error de SQLite capturado y relanzado dentro de fn ya sale normalizado', async () => {
    await db.run("INSERT INTO t (label) VALUES ('dup')");
    const err = await db
      .transaction(async (tx) => {
        try {
          await tx.run("INSERT INTO t (label) VALUES ('dup')");
        } catch (e) {
          throw e;
        }
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SqlError);
  });

  it('exportBytes devuelve un archivo SQLite válido', async () => {
    await db.run("INSERT INTO t (label) VALUES ('x')");
    const bytes = await db.exportBytes();
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3');
  });

  it('después de close() toda llamada falla con DataError database_closed', async () => {
    await db.close();
    await expect(db.all('SELECT 1')).rejects.toBeInstanceOf(DataError);
    await expect(db.transaction(async () => 1)).rejects.toMatchObject({ code: 'database_closed' });
    await db.close(); // idempotente
  });

  it('SQLite más viejo que el mínimo → DomainError sqlite_too_old', async () => {
    await expect(openNodeDriver({ minSqliteVersion: '99.0.0' })).rejects.toMatchObject({
      name: 'DomainError',
      code: 'sqlite_too_old',
    });
  });

  it('abre con foreign_keys=ON y busy_timeout=3000', async () => {
    expect(await db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(await db.get('PRAGMA busy_timeout')).toEqual({ timeout: 3000 });
  });
});
