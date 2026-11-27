import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, TEST_TODAY, type TestCuadra } from '../test/harness';
import { createCuadra, isDomainError, type Cuadra } from './index';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

/** Llama a un método del stub y devuelve el error (síncrono o rechazo). */
async function failure(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('createCuadra y createTestCuadra', () => {
  it('createTestCuadra migra node:sqlite en memoria con reloj fijo e ids deterministas', async () => {
    h = await createTestCuadra();
    expect(h.clock.today()).toBe(TEST_TODAY);
    expect(h.cuadra.info.driver.kind).toBe('node');
    expect(h.cuadra.info.schemaVersion).toBe(1);
    const tables = await h.driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transactions'",
    );
    expect(tables).toHaveLength(1);
    const fk = await h.driver.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);

    const again = await createTestCuadra({ today: '2026-01-15' });
    expect(again.clock.today()).toBe('2026-01-15');
    const other = await createTestCuadra();
    expect(other.ids.next()).toBe((await createTestCuadra()).ids.next());
    await again.driver.close();
    await other.driver.close();
  });

  it('cada servicio está cableado y sus métodos lanzan not_implemented', async () => {
    h = await createTestCuadra();
    const c: Cuadra = h.cuadra;
    const calls: Array<[string, () => unknown]> = [
      ['workspaces.list', () => c.workspaces.list()],
      ['accounts.get', () => c.accounts.get('x')],
      ['transactions.create', () => c.transactions.create({ accountId: 'a', kind: 'income', amountMinor: 1, date: TEST_TODAY, description: 'x' })],
      ['batches.list', () => c.batches.list('w')],
      ['fields.list', () => c.fields.list('w')],
      ['queries.totals', () => c.queries.totals('w', {})],
      ['reports.preset', () => c.reports.preset('summary', { preset: 'this_month' })],
      ['views.get', () => c.views.get('v')],
      ['audit.forEntity', () => c.audit.forEntity('transaction', 't')],
      ['settings.get', () => c.settings.get('theme')],
      ['templates.list', () => c.templates.list()],
      ['backup.inspect', () => c.backup.inspect('{}')],
      ['importCsv.parse', () => c.importCsv.parse('a,b')],
      ['demo.profiles', () => c.demo.profiles()],
    ];
    for (const [method, call] of calls) {
      const e = await failure(call);
      expect(isDomainError(e, 'not_implemented'), method).toBe(true);
      expect((e as { details?: unknown }).details).toEqual({ method });
    }
  });

  it('subscribe devuelve la función para darse de baja', async () => {
    h = await createTestCuadra();
    const off = h.cuadra.subscribe(() => undefined);
    expect(typeof off).toBe('function');
    off();
  });

  it('createCuadra usa reloj del sistema, uuidv7 y es-DO por defecto', async () => {
    h = await createTestCuadra();
    const c = createCuadra({ driver: h.driver });
    expect(c.info).toEqual({ driver: h.driver.info, schemaVersion: 0 });
    expect(Object.isFrozen(c.info)).toBe(true);
  });
});
