import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, Cuadra } from '../../core';
import { createEventBus } from '../../core/events';
import { isAffected } from './CuadraProvider';
import { createQueryClient } from './queryClient';
import { queryDefs, TX_TABLES, type QueryDef } from './queryDefs';

/** Fachada falsa: cada método registra su llamada y devuelve el nombre, para comprobar el cableado. */
function fakeCuadra(overrides: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const method = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push([name, args]);
      return name;
    });
  const cuadra = {
    workspaces: { list: method('workspaces.list'), get: method('workspaces.get') },
    accounts: { list: method('accounts.list') },
    fields: { list: method('fields.list'), formSchema: method('fields.formSchema') },
    transactions: { get: method('transactions.get'), history: method('transactions.history') },
    queries: {
      balances: method('queries.balances'),
      balanceSeries: method('queries.balanceSeries'),
      listTransactions: method('queries.listTransactions'),
      listByDay: method('queries.listByDay'),
      totals: method('queries.totals'),
      summarize: method('queries.summarize'),
      home: method('queries.home'),
      ...overrides,
    },
    views: { list: method('views.list') },
    audit: { list: method('audit.list') },
    settings: { get: method('settings.get'), getWs: method('settings.getWs') },
  } as unknown as Cuadra;
  return { cuadra, calls };
}

const run = async <T>(d: QueryDef<T>, c: Cuadra) => d.fn(c);

describe('definiciones de consultas', () => {
  it('cada consulta de espacio lleva el id del espacio en la posición 1 de la clave', () => {
    const defs: QueryDef<unknown>[] = [
      queryDefs.accounts('w1'),
      queryDefs.balances('w1'),
      queryDefs.fields('w1'),
      queryDefs.transactions('w1', {}),
      queryDefs.transaction('w1', 't1'),
      queryDefs.totals('w1', {}),
      queryDefs.summary('w1', { filter: {}, groupBy: { by: 'kind' } }),
      queryDefs.home('w1'),
      queryDefs.dashboard('w1'),
      queryDefs.views('w1', 'filter'),
      queryDefs.audit('w1', {}),
      queryDefs.workspaceSetting('w1', 'home.cards'),
    ];
    for (const d of defs) expect(d.key[1], String(d.key[0])).toBe('w1');
  });

  it('las consultas globales dejan la posición 1 vacía para que las afecte cualquier espacio', () => {
    expect(queryDefs.workspaces().key[1]).toBeUndefined();
    expect(queryDefs.setting('theme').key[1]).toBeUndefined();
  });

  it('el listado de movimientos depende de todas las tablas que lo alteran', () => {
    expect(queryDefs.transactions('w', {}).tables).toEqual(TX_TABLES);
    for (const table of ['transactions', 'transaction_field_values', 'accounts', 'fields', 'field_options', 'batches']) {
      expect(TX_TABLES).toContain(table);
    }
    expect(queryDefs.workspaces().tables).toEqual(expect.arrayContaining(['workspaces', 'accounts', 'transactions']));
    expect(queryDefs.views('w', 'summary').tables).toEqual(['saved_views']);
    expect(queryDefs.audit('w', {}).tables).toEqual(['audit_log']);
    expect(queryDefs.home('w').tables).toContain('settings');
  });

  it('llama al servicio correcto con los argumentos del hook', async () => {
    const { cuadra, calls } = fakeCuadra();
    await run(queryDefs.accounts('w1', { includeArchived: true }), cuadra);
    await run(queryDefs.transactions('w1', { kinds: ['income'] }, { limit: 50, cursor: 'abc', sort: { by: 'date', dir: 'desc' } }), cuadra);
    await run(queryDefs.transactions('w1', {}), cuadra);
    await run(queryDefs.transaction('w1', 't9'), cuadra);
    await run(queryDefs.totals('w1', { text: 'x' }), cuadra);
    await run(queryDefs.home('w1', { month: '2026-06' }), cuadra);
    await run(queryDefs.views('w1', 'report'), cuadra);
    await run(queryDefs.setting('theme'), cuadra);
    expect(calls).toEqual([
      ['accounts.list', ['w1', { includeArchived: true }]],
      ['queries.listTransactions', ['w1', { filter: { kinds: ['income'] }, sort: { by: 'date', dir: 'desc' }, limit: 50, cursor: 'abc' }]],
      ['queries.listTransactions', ['w1', { filter: {} }]],
      ['transactions.get', ['t9']],
      ['queries.totals', ['w1', { text: 'x' }]],
      ['queries.home', ['w1', { month: '2026-06' }]],
      ['views.list', ['w1', 'report']],
      ['settings.get', ['theme']],
    ]);
  });

  it('claves distintas para filtros distintos y la misma para el mismo filtro', () => {
    const a = queryDefs.transactions('w', { kinds: ['income'] }).key;
    const b = queryDefs.transactions('w', { kinds: ['expense'] }).key;
    const c = queryDefs.transactions('w', { kinds: ['income'] }).key;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('dashboard llama a queries.dashboard con el espacio y las opciones', async () => {
    const { cuadra, calls } = fakeCuadra({
      dashboard: vi.fn(async (...args: unknown[]) => {
        calls.push(['queries.dashboard', args]);
        return 'queries.dashboard';
      }),
    });
    await expect(run(queryDefs.dashboard('w1', { months: 6 }), cuadra)).resolves.toBe('queries.dashboard');
    expect(calls).toContainEqual(['queries.dashboard', ['w1', { months: 6 }]]);
    expect(queryDefs.dashboard('w1', { months: 6 }).key).toEqual(['queries.dashboard', 'w1', { months: 6 }]);
  });
});

describe('invalidación por eventos del núcleo', () => {
  /** Reproduce el puente de CuadraProvider sin React. */
  function bridge(queryClient: QueryClient) {
    const bus = createEventBus();
    bus.subscribe((event) => {
      void queryClient.invalidateQueries({ predicate: (q) => isAffected(event, q.meta, q.queryKey) });
    });
    return bus;
  }
  async function observe<T>(client: QueryClient, d: QueryDef<T>, cuadra: Cuadra) {
    const observer = client.getQueryCache().build(client, { queryKey: d.key, queryFn: () => d.fn(cuadra), meta: { tables: d.tables } });
    await observer.fetch();
    return observer;
  }

  it('un cambio en transactions refresca el listado del mismo espacio y no el de otro', async () => {
    const { cuadra } = fakeCuadra();
    const client = createQueryClient();
    const bus = bridge(client);
    const mine = await observe(client, queryDefs.transactions('w1', {}), cuadra);
    const other = await observe(client, queryDefs.transactions('w2', {}), cuadra);
    expect(mine.state.isInvalidated).toBe(false);

    const event: ChangeEvent = { workspaceId: 'w1', tables: ['transactions'], reason: 'tx_create' };
    bus.emit(event);
    expect(mine.state.isInvalidated).toBe(true);
    expect(other.state.isInvalidated).toBe(false);
  });

  it('un cambio en una tabla ajena no toca la consulta', async () => {
    const { cuadra } = fakeCuadra();
    const client = createQueryClient();
    const bus = bridge(client);
    const views = await observe(client, queryDefs.views('w1', 'filter'), cuadra);
    bus.emit({ workspaceId: 'w1', tables: ['transactions'], reason: 'tx_create' });
    expect(views.state.isInvalidated).toBe(false);
    bus.emit({ workspaceId: 'w1', tables: ['saved_views'], reason: 'view_save' });
    expect(views.state.isInvalidated).toBe(true);
  });

  it('un evento sin espacio (workspaceId null) afecta a todos los espacios; las globales reaccionan a cualquier espacio', async () => {
    const { cuadra } = fakeCuadra();
    const client = createQueryClient();
    const bus = bridge(client);
    const w1 = await observe(client, queryDefs.accounts('w1'), cuadra);
    const w2 = await observe(client, queryDefs.accounts('w2'), cuadra);
    const list = await observe(client, queryDefs.workspaces(), cuadra);
    bus.emit({ workspaceId: null, tables: ['accounts'], reason: 'restore' });
    expect(w1.state.isInvalidated && w2.state.isInvalidated && list.state.isInvalidated).toBe(true);

    const list2 = await observe(client, queryDefs.workspaces({ includeArchived: true }), cuadra);
    bus.emit({ workspaceId: 'w9', tables: ['transactions'], reason: 'tx_create' });
    expect(list2.state.isInvalidated).toBe(true);
  });

  it('las consultas de ajustes reaccionan a la tabla settings', async () => {
    const { cuadra } = fakeCuadra();
    const client = createQueryClient();
    const bus = bridge(client);
    const theme = await observe(client, queryDefs.setting('theme'), cuadra);
    bus.emit({ workspaceId: null, tables: ['settings'], reason: 'settings_set' });
    expect(theme.state.isInvalidated).toBe(true);
  });
});
