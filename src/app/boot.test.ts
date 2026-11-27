import { describe, expect, it } from 'vitest';
import { DataError, type OpenDatabaseOptions, type OpenedDatabase } from '../data';
import { migrate } from '../data/migrate';
import { openNodeDriver } from '../data/node/nodeDriver';
import { boot, type BootState } from './boot';

async function fakeDb(): Promise<OpenedDatabase> {
  const driver = await openNodeDriver({ path: ':memory:' });
  const schema = await migrate(driver);
  return Object.assign(driver, {
    storage: {
      kind: driver.info.kind,
      persistent: false,
      persistGranted: null,
      fallbackReason: null,
      restored: false,
      tabLock: true,
    },
    schema,
    flush: async () => undefined,
  });
}

function collect() {
  const states: BootState[] = [];
  return { states, onState: (s: BootState) => states.push(s), last: () => states.at(-1) };
}

describe('boot', () => {
  it('abre la base migrada y entrega la fachada con la versión de esquema', async () => {
    const c = collect();
    await boot({ onState: c.onState, open: () => fakeDb() });
    expect(c.states.map((s) => s.status)).toEqual(['loading', 'ready']);
    const ready = c.last();
    if (ready?.status !== 'ready') throw new Error('no arrancó');
    expect(ready.cuadra.info.schemaVersion).toBe(1);
    expect(ready.info.schema.to).toBe(1);
    expect(ready.info.storage.persistent).toBe(false);
    expect(ready.info.sqliteVersion).toMatch(/^3\./);
  });

  it('si otra pestaña tiene el libro muestra «Usar aquí» y, al pulsarlo, sigue abriendo', async () => {
    const c = collect();
    let release!: () => void;
    const open = (o: OpenDatabaseOptions) =>
      new Promise<OpenedDatabase>((resolve) => {
        o.onBlocked?.(() => release());
        release = () => void fakeDb().then(resolve);
      });
    const done = boot({ onState: c.onState, open });
    await Promise.resolve();
    const blocked = c.last();
    if (blocked?.status !== 'blocked') throw new Error('no se bloqueó');
    blocked.takeOver();
    await done;
    expect(c.states.map((s) => s.status)).toEqual(['loading', 'blocked', 'loading', 'ready']);
  });

  it('al reabrir tras ceder el libro, lo pide sin volver a preguntar', async () => {
    const c = collect();
    let took = 0;
    const open = (o: OpenDatabaseOptions) =>
      new Promise<OpenedDatabase>((resolve) => {
        o.onBlocked?.(() => {
          took += 1;
          void fakeDb().then(resolve);
        });
      });
    void boot({ onState: c.onState, open, takeOverImmediately: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(took).toBe(1);
    expect(c.states.map((s) => s.status)).toEqual(['loading', 'ready']);
  });

  it('cedido a otra pestaña: estado released con reopen, también si ocurre mientras abría', async () => {
    const c = collect();
    await boot({
      onState: c.onState,
      open: async (o) => {
        o.onReleaseRequested?.();
        throw new DataError('database_released');
      },
    });
    expect(c.states.map((s) => s.status)).toEqual(['loading', 'released']);
    const released = c.last();
    if (released?.status !== 'released') throw new Error('no cedió');
    expect(typeof released.reopen).toBe('function');
  });

  it('un fallo al abrir queda como estado de error con la causa', async () => {
    const c = collect();
    const cause = new DataError('storage_unavailable');
    await boot({ onState: c.onState, open: () => Promise.reject(cause) });
    expect(c.last()).toEqual({ status: 'error', error: cause });
  });
});
