import { describe, expect, it } from 'vitest';
import { runSeries, type SqlExecutor } from './ports';

describe('ports: runSeries', () => {
  it('sin runSeries en el adaptador (p. ej. Tauri) ejecuta las sentencias una a una, en orden', async () => {
    const calls: Array<[string, unknown]> = [];
    const exec: SqlExecutor = {
      all: async () => [],
      get: async () => undefined,
      run: async (sql, params) => {
        calls.push([sql, params]);
        return { changes: calls.length };
      },
      runMany: async () => ({ changes: 0 }),
    };
    expect(await runSeries(exec, [{ sql: 'A', params: [1] }, { sql: 'B' }])).toEqual({ changes: [1, 2] });
    expect(calls).toEqual([['A', [1]], ['B', undefined]]);
    expect(await runSeries(exec, [])).toEqual({ changes: [] });
  });

  it('con runSeries en el adaptador lo usa en una sola llamada', async () => {
    let series = 0;
    const exec: SqlExecutor = {
      all: async () => [],
      get: async () => undefined,
      run: async () => {
        throw new Error('no debería');
      },
      runMany: async () => ({ changes: 0 }),
      runSeries: async (steps) => {
        series++;
        return { changes: steps.map(() => 1) };
      },
    };
    expect(await runSeries(exec, [{ sql: 'A' }, { sql: 'B' }])).toEqual({ changes: [1, 1] });
    expect(series).toBe(1);
  });
});
