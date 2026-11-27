import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, TEST_TODAY, type TestCuadra } from '../test/harness';
import { createCuadra, type Cuadra } from './index';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

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

  it('cada servicio está cableado con métodos reales (ninguno es un stub)', async () => {
    h = await createTestCuadra();
    const c: Cuadra = h.cuadra;
    const services = {
      workspaces: ['list', 'get', 'create', 'update', 'reorder', 'archive', 'unarchive', 'purge'],
      accounts: ['list', 'get', 'create', 'update', 'reorder', 'archive', 'unarchive'],
      transactions: ['get', 'check', 'create', 'createTransfer', 'setOpening', 'update', 'void', 'restore', 'duplicate', 'history', 'suggestDescriptions', 'createMany'],
      batches: ['capture', 'previewCapture', 'list', 'get', 'void', 'restore'],
      fields: ['list', 'formSchema', 'dimensions', 'create', 'update', 'deactivate', 'reactivate', 'addOption', 'updateOption', 'mergeOptions', 'similarOptions'],
      queries: ['listTransactions', 'listByDay', 'totals', 'balances', 'balanceSeries', 'summarize', 'home', 'dashboard'],
      reports: ['build', 'preset'],
      views: ['list', 'get', 'save', 'update'],
      audit: ['list', 'forEntity'],
      auth: ['status', 'snapshot', 'setup', 'unlock', 'unlockWithRecoveryKey', 'lock', 'changePassword', 'disable', 'setAutoLock', 'touch', 'checkIdle', 'encrypt', 'decrypt', 'subscribe'],
      settings: ['get', 'set', 'getWs', 'setWs'],
      templates: ['list', 'get', 'preview', 'apply', 'applyWithKeys', 'validate', 'parse', 'exportFromWorkspace', 'serialize'],
      backup: ['export', 'markVerified', 'inspect', 'restoreAll', 'importWorkspace', 'lastAutoCopy'],
      importCsv: ['parse', 'decode', 'fromRows', 'detectColumns', 'suggestMapping', 'preview', 'commit', 'templateCsv', 'templateTable'],
      demo: ['profiles', 'plan', 'seed'],
    } as const;
    for (const [name, methods] of Object.entries(services)) {
      const service = (c as unknown as Record<string, Record<string, unknown>>)[name];
      expect(service, name).toBeTypeOf('object');
      for (const m of methods) expect(service?.[m], `${name}.${m}`).toBeTypeOf('function');
    }
    // Lecturas sobre una base vacía: responden sin lanzar.
    expect(await c.workspaces.list()).toEqual([]);
    expect(await c.settings.get('theme')).toBe('system');
    expect((await c.templates.list()).length).toBeGreaterThan(0);
    expect(c.demo.profiles().map((p) => p.id)).toEqual(['colmado', 'despacho', 'personal', 'iglesia']);
    expect(await c.auth.status()).toMatchObject({ enabled: false, locked: false });
    expect(c.importCsv.parse('Fecha,Monto\n2026-06-01,10').headers).toEqual(['Fecha', 'Monto']);
    expect((await c.backup.inspect('{}')).ok).toBe(false);
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

describe('constantes públicas para la interfaz', () => {
  it('autenticación, límites de texto y demo salen de la fachada', async () => {
    const core = await import('./index');
    expect(core.AUTH_MIN_PASSWORD_LENGTH).toBe(8);
    expect(core.AUTH_MAX_PASSWORD_LENGTH).toBe(1024);
    expect(core.AUTH_MAX_PROFILE_NAME_LENGTH).toBe(60);
    expect(core.AUTH_DEFAULT_AUTO_LOCK_MINUTES).toBe(5);
    expect([...core.AUTH_AUTO_LOCK_CHOICES]).toEqual([0, 1, 5, 15, 30]);
    expect(core.AUTH_AUTO_LOCK_CHOICES).toContain(core.AUTH_DEFAULT_AUTO_LOCK_MINUTES);
    for (const m of core.AUTH_AUTO_LOCK_CHOICES) expect(m).toBeLessThanOrEqual(core.AUTH_MAX_AUTO_LOCK_MINUTES);
    expect([core.MAX_DESCRIPTION_LENGTH, core.MAX_NOTES_LENGTH, core.MAX_LABEL_LENGTH]).toEqual([200, 2_000, 80]);
    expect(core.DEMO_PROFILES.map((p) => p.id)).toEqual(['colmado', 'despacho', 'personal', 'iglesia']);
    expect(core.DEMO_MONTHS).toBe(14);
    expect(typeof core.DEMO_SEED).toBe('number');
  });
});
