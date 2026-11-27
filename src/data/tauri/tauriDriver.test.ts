// El driver de Tauri con un `invoke` simulado que registra las llamadas (sin ventana ni Rust).
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../core/errors';
import { DataError, SqlError } from '../errors';
import { openTauriDriver, saveFileDialog, type TauriInvoke } from './tauriDriver';

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function fake(handler: (cmd: string, args?: Record<string, unknown>) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const invoke: TauriInvoke = async <T>(cmd: string, args?: Record<string, unknown>) => {
    calls.push(args === undefined ? { cmd } : { cmd, args });
    return (await handler(cmd, args)) as T;
  };
  return { calls, invoke };
}

const open = (cmd: string): unknown => (cmd === 'db_open' ? { sqlite_version: '3.54.1', path: '/x/cuadra.sqlite3' } : undefined);

describe('tauriDriver', () => {
  it('abre con db_open e informa kind tauri, persistente y versión', async () => {
    const { calls, invoke } = fake(open);
    const db = await openTauriDriver({ invoke });
    expect(calls).toEqual([{ cmd: 'db_open' }]);
    expect(db.info).toEqual({ kind: 'tauri', persistent: true, sqliteVersion: '3.54.1' });
  });

  it('all/get/run envían sql y params; get devuelve la primera fila o undefined', async () => {
    const { calls, invoke } = fake((cmd) => {
      if (cmd === 'db_all') return [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
      if (cmd === 'db_run') return { changes: 3 };
      return open(cmd);
    });
    const db = await openTauriDriver({ invoke });
    expect(await db.all('SELECT * FROM t WHERE x = ?', [7])).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    expect(await db.get('SELECT * FROM t')).toEqual({ id: 1, name: 'a' });
    expect(await db.run('UPDATE t SET a = :a', { a: 1 })).toEqual({ changes: 3 });
    expect(calls.slice(1)).toEqual([
      { cmd: 'db_all', args: { sql: 'SELECT * FROM t WHERE x = ?', params: [7] } },
      { cmd: 'db_all', args: { sql: 'SELECT * FROM t', params: null } },
      { cmd: 'db_run', args: { sql: 'UPDATE t SET a = :a', params: { a: 1 } } },
    ]);
  });

  it('get sin filas devuelve undefined', async () => {
    const { invoke } = fake((cmd) => (cmd === 'db_all' ? [] : open(cmd)));
    const db = await openTauriDriver({ invoke });
    expect(await db.get('SELECT 1 WHERE 0')).toBeUndefined();
  });

  it('los BLOB viajan como listas de bytes y vuelven como Uint8Array', async () => {
    const { calls, invoke } = fake((cmd) => (cmd === 'db_all' ? [{ b: [1, 2, 255] }] : cmd === 'db_run' ? { changes: 1 } : open(cmd)));
    const db = await openTauriDriver({ invoke });
    await db.run('INSERT INTO t VALUES (?)', [new Uint8Array([9, 8])]);
    expect(calls[1]).toEqual({ cmd: 'db_run', args: { sql: 'INSERT INTO t VALUES (?)', params: [[9, 8]] } });
    const row = await db.get<{ b: Uint8Array }>('SELECT b FROM t');
    expect(row!.b).toBeInstanceOf(Uint8Array);
    expect(Array.from(row!.b)).toEqual([1, 2, 255]);
  });

  it('runMany manda una fila de parámetros por elemento', async () => {
    const { calls, invoke } = fake((cmd) => (cmd === 'db_run_many' ? { changes: 2 } : open(cmd)));
    const db = await openTauriDriver({ invoke });
    expect(await db.runMany('INSERT INTO t VALUES (?, ?)', [[1, 'a'], [2, null]])).toEqual({ changes: 2 });
    expect(calls[1]).toEqual({ cmd: 'db_run_many', args: { sql: 'INSERT INTO t VALUES (?, ?)', rows: [[1, 'a'], [2, null]] } });
  });

  it('transaction: BEGIN IMMEDIATE, sentencias, COMMIT; si fn lanza, ROLLBACK', async () => {
    const { calls, invoke } = fake((cmd) => (cmd === 'db_run' ? { changes: 1 } : open(cmd)));
    const db = await openTauriDriver({ invoke });
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (1)');
    });
    expect(calls.slice(1).map((c) => (c.cmd === 'db_exec' ? String(c.args?.sql) : c.cmd))).toEqual(['BEGIN IMMEDIATE', 'db_run', 'COMMIT']);

    calls.length = 0;
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (2)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls.map((c) => (c.cmd === 'db_exec' ? String(c.args?.sql) : c.cmd))).toEqual(['BEGIN IMMEDIATE', 'db_run', 'ROLLBACK']);
  });

  it('el mutex serializa: una llamada suelta espera a que termine la transacción', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { invoke } = fake(async (cmd, args) => {
      if (cmd === 'db_exec') order.push(`exec:${String(args?.sql)}`);
      if (cmd === 'db_all') {
        order.push('all');
        return [];
      }
      if (cmd === 'db_run') {
        await gate;
        order.push('run');
        return { changes: 1 };
      }
      return open(cmd);
    });
    const db = await openTauriDriver({ invoke });
    const tx = db.transaction(async (t) => {
      await t.run('INSERT INTO t VALUES (1)');
    });
    const outside = db.all('SELECT 1');
    await Promise.resolve();
    release();
    await Promise.all([tx, outside]);
    expect(order).toEqual(['exec:BEGIN IMMEDIATE', 'run', 'exec:COMMIT', 'all']);
  });

  it('los errores de Rust { message, code } pasan a SqlError con su código', async () => {
    const { invoke } = fake((cmd) => {
      if (cmd === 'db_run') throw { message: 'UNIQUE constraint failed: t.id', code: 1555 };
      return open(cmd);
    });
    const db = await openTauriDriver({ invoke });
    const err = await db.run('INSERT INTO t VALUES (1)').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SqlError);
    expect((err as SqlError).resultCode).toBe(1555);
  });

  it('un RAISE de trigger llega como DomainError con su código', async () => {
    const { invoke } = fake((cmd) => {
      if (cmd === 'db_run') throw { message: 'delete_forbidden', code: 1811 };
      return open(cmd);
    });
    const db = await openTauriDriver({ invoke });
    const err = await db.run('DELETE FROM t').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('delete_forbidden');
  });

  it('exec, exportBytes (ArrayBuffer o lista) y close', async () => {
    let asList = false;
    const { calls, invoke } = fake((cmd) => {
      if (cmd === 'db_export') return asList ? [83, 81] : new Uint8Array([83, 81, 76]).buffer;
      return open(cmd);
    });
    const db = await openTauriDriver({ invoke });
    await db.exec('CREATE TABLE t (a)');
    expect(Array.from(await db.exportBytes())).toEqual([83, 81, 76]);
    asList = true;
    expect(Array.from(await db.exportBytes())).toEqual([83, 81]);
    await db.close();
    expect(calls.map((c) => c.cmd)).toEqual(['db_open', 'db_exec', 'db_export', 'db_export', 'db_close']);
    await expect(db.all('SELECT 1')).rejects.toBeInstanceOf(DataError);
  });

  it('saveFileDialog codifica texto en UTF-8 y devuelve la ruta (o null al cancelar)', async () => {
    const { calls, invoke } = fake(() => '/home/u/respaldo.json');
    expect(await saveFileDialog('respaldo.json', 'ñ', { invoke })).toBe('/home/u/respaldo.json');
    expect(calls[0]).toEqual({ cmd: 'save_file', args: { suggestedName: 'respaldo.json', data: [195, 177] } });
    const cancelled = fake(() => null);
    expect(await saveFileDialog('x.csv', new Uint8Array([1]), { invoke: cancelled.invoke })).toBeNull();
  });
});
