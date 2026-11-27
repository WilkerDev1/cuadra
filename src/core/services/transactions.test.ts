// Movimientos: createMany mixto, composición con insertBatch, sugerencias, check() tolerante, eventos y
// rendimiento de la inserción masiva (riesgo señalado en la Oleada 1).
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { ChangeEvent } from '../events';
import type { Id } from '../types';
import { mutate, type CoreDeps } from '../uow';
import { createAuditWriter } from './audit';
import { balanceOf, codeOf, countRows, nextSeqOf, seedAccount, seedField, seedWorkspace } from './movements.testkit';
import { insertBatch, type CreateManyDraft } from './transactions';

let t: TestCuadra;
let ws: Id;
let cash: Id;
let bank: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
  bank = await seedAccount(t, ws, { name: 'Banco' });
});

describe('createMany', () => {
  it('mezcla saldo inicial, entradas, salidas, transferencias y anulados en un lote y una acción', async () => {
    const drafts: CreateManyDraft[] = [
      { kind: 'opening', accountId: cash, amountMinor: 100_000, direction: 'in', date: '2026-01-01' },
      { accountId: cash, kind: 'income', amountMinor: 5_000, date: '2026-01-02', description: 'Venta' },
      { kind: 'transfer', fromAccountId: cash, toAccountId: bank, amountMinor: 20_000, date: '2026-01-03', description: 'Depósito' },
      { accountId: bank, kind: 'expense', amountMinor: 1_000, date: '2026-01-04', description: 'Comisión' },
      { accountId: cash, kind: 'expense', amountMinor: 700, date: '2026-01-05', description: 'Error' },
    ];
    const events: ChangeEvent[] = [];
    t.cuadra.subscribe((e) => events.push(e));
    const m = await t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'demo', accountId: null, label: 'Demo', meta: { seed: 7 } },
      drafts,
      voids: [{ index: 4, reason: 'Registrado dos veces' }],
      audit: { action: 'demo_seed', message: 'audit.demo.seed', params: { profile: 'colmado' } },
    });
    expect(m.value.ids).toHaveLength(5);
    const rows = await t.driver.all<{ id: string; account_id: string; seq: number; kind: string; status: string; void_reason: string | null }>(
      'SELECT id, account_id, seq, kind, status, void_reason FROM transactions WHERE batch_id = ? ORDER BY recorded_at, id',
      [m.value.batchId],
    );
    expect(rows).toHaveLength(6); // la transferencia son dos filas
    expect(rows.find((r) => r.id === m.value.ids[2])).toMatchObject({ kind: 'transfer', account_id: cash });
    expect(rows.find((r) => r.id === m.value.ids[4])).toMatchObject({ status: 'voided', void_reason: 'Registrado dos veces' });
    expect(await balanceOf(t.driver, cash)).toBe(85_000);
    expect(await balanceOf(t.driver, bank)).toBe(19_000);
    expect(await nextSeqOf(t.driver, cash)).toBe(5);
    expect(await nextSeqOf(t.driver, bank)).toBe(3);

    const batch = await t.cuadra.batches.get(m.value.batchId);
    expect(batch).toMatchObject({ source: 'demo', accountId: null, activeCount: 4, voidedCount: 1 });
    const [action] = (await t.cuadra.audit.list(ws, {})).items;
    expect(action).toMatchObject({ action: 'demo_seed', entityType: 'batch', batchId: m.value.batchId, message: 'audit.demo.seed' });
    expect(action!.params).toMatchObject({ profile: 'colmado', count: 5, sumMinor: 126_700 });
    expect(await countRows(t.driver, 'audit_log')).toBe(1);
    expect(events).toHaveLength(1);
    expect(new Set(events[0]!.tables)).toEqual(new Set(['batches', 'transactions', 'accounts', 'audit_log']));
    // El historial de cada movimiento muestra la acción que creó su lote.
    expect((await t.cuadra.transactions.history(m.value.ids[1]!)).map((e) => e.action)).toEqual(['demo_seed']);
    // Anular el lote no toca el anulado de origen; restaurarlo tampoco lo revive.
    expect((await t.cuadra.batches.void(m.value.batchId)).value.voidedCount).toBe(4);
    expect((await t.cuadra.batches.restore(m.value.batchId)).value.restoredCount).toBe(4);
    expect((await t.cuadra.transactions.get(m.value.ids[4]!)).status).toBe('voided');
  });

  it('lote vacío, cuenta del lote ajena o borrador inválido se rechazan con el índice', async () => {
    const base = {
      workspaceId: ws,
      batch: { source: 'import' as const, accountId: cash, label: 'x' },
      audit: { action: 'import' as const, message: 'audit.batch.import' },
    };
    expect(await codeOf(t.cuadra.transactions.createMany({ ...base, drafts: [] }))).toBe('batch_empty');
    const otherWs = await seedWorkspace(t, { name: 'Otro' });
    const foreign = await seedAccount(t, otherWs);
    const sale = { accountId: cash, kind: 'income' as const, amountMinor: 1, date: '2026-06-01', description: 'x' };
    expect(await codeOf(t.cuadra.transactions.createMany({ ...base, batch: { ...base.batch, accountId: foreign }, drafts: [sale] }))).toBe(
      'workspace_mismatch',
    );
    const err = await t.cuadra.transactions
      .createMany({ ...base, drafts: [sale, sale, { ...sale, description: '' }] })
      .catch((e: unknown) => e as { code: string; details: Record<string, unknown> });
    expect(err).toMatchObject({ code: 'description_required', details: { index: 2 } });
    expect(await countRows(t.driver, 'transactions')).toBe(0);
  });

  it('insertBatch compone dentro de otra unidad de trabajo con UNA acción propia', async () => {
    const deps: CoreDeps = {
      driver: t.driver,
      clock: t.clock,
      ids: t.ids,
      events: { subscribe: () => () => undefined, emit: () => undefined, size: 0 },
      audit: createAuditWriter({ clock: t.clock, ids: t.ids }),
      locale: 'es-DO',
    };
    const m = await mutate(deps, ws, 'importCsv.commit', async (ctx) => {
      const r = await insertBatch(ctx, {
        workspaceId: ws,
        batch: { source: 'import', accountId: cash, label: 'banco.xlsx', meta: { fileName: 'banco.xlsx' } },
        drafts: [
          { accountId: cash, kind: 'expense', amountMinor: 3_000, date: '2026-06-01', description: 'Luz' },
          { accountId: cash, kind: 'income', amountMinor: 1_000, date: '2026-06-02', description: 'Venta' },
        ],
      });
      await ctx.audit.record(ctx.tx, {
        workspaceId: ws, action: 'import', entityType: 'batch', entityId: r.batchId, accountId: cash, batchId: r.batchId,
        message: 'audit.batch.import', params: { imported: r.ids.length }, changes: [],
      });
      return r;
    });
    expect(m.value.transactions.map((x) => x.seq)).toEqual([1, 2]);
    expect(m.value.sumMinor).toBe(4_000);
    expect(m.warnings).toEqual([{ code: 'negative_balance', accountId: cash, balanceAfterMinor: -2_000 }]);
    expect(await countRows(t.driver, 'audit_log')).toBe(1);
  });
});

describe('sugerencias, check y eventos', () => {
  it('suggestDescriptions agrupa por descripción, cuenta usos y trae los últimos valores activos', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Bebidas', 'Vieja'] });
    const mk = (description: string, date: string, optionLabel = 'Bebidas', kind: 'income' | 'expense' = 'income') =>
      t.cuadra.transactions.create({
        accountId: cash, kind, amountMinor: 100, date, description,
        values: { [cat.id]: { type: 'list', optionId: cat.options[optionLabel]! } },
      });
    await mk('Café con leche', '2026-06-01', 'Vieja');
    await mk('café con leche', '2026-06-03');
    await mk('Café negro', '2026-06-02');
    const gone = await mk('Cafetera', '2026-06-04');
    await t.cuadra.transactions.void(gone.value.id);
    await mk('Caramelos', '2026-06-01', 'Bebidas', 'expense');
    await t.driver.run('UPDATE field_options SET deactivated_at = ? WHERE id = ?', [t.clock.now().toISOString(), cat.options['Vieja']!]);

    const s = await t.cuadra.transactions.suggestDescriptions(ws, 'CAFE', { kind: 'income' });
    expect(s.map((x) => [x.description, x.uses])).toEqual([
      ['café con leche', 2],
      ['Café negro', 1],
    ]);
    expect(s[0]!.lastValues).toEqual({ [cat.id]: { type: 'list', optionId: cat.options['Bebidas'] } });
    expect((await t.cuadra.transactions.suggestDescriptions(ws, 'car')).map((x) => x.description)).toEqual(['Caramelos']);
    expect(await t.cuadra.transactions.suggestDescriptions(ws, '100%_')).toEqual([]);
    expect(await t.cuadra.transactions.suggestDescriptions(ws, '', { limit: 1 })).toHaveLength(1);
  });

  it('check() tolera borradores a medio escribir y cuentas ajenas sin lanzar', async () => {
    const otherWs = await seedWorkspace(t, { name: 'Otro' });
    const foreign = await seedAccount(t, otherWs);
    expect(
      await t.cuadra.transactions.check(ws, { accountId: cash, kind: 'expense', amountMinor: Number.NaN, date: '2026-0', description: '' }),
    ).toEqual([]);
    expect(await t.cuadra.transactions.check(ws, { accountId: foreign, kind: 'expense', amountMinor: 0, date: '2026-06-01', description: 'x' })).toEqual(
      [],
    );
    expect(
      await t.cuadra.transactions.check(ws, { fromAccountId: cash, toAccountId: bank, amountMinor: 500, date: '2026-06-15', description: 'x' }),
    ).toEqual([{ code: 'negative_balance', accountId: cash, balanceAfterMinor: -500 }]);
    expect(await countRows(t.driver, 'transactions')).toBe(0);
  });

  it('cada guardado emite un evento con las tablas tocadas y un error no emite nada', async () => {
    const events: ChangeEvent[] = [];
    t.cuadra.subscribe((e) => events.push(e));
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Ventas'] });
    const { value } = await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 100, date: '2026-06-01', description: 'Venta',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Ventas']! } },
    });
    expect(events[0]).toMatchObject({ workspaceId: ws, reason: 'transactions.create' });
    expect(new Set(events[0]!.tables)).toEqual(new Set(['transactions', 'accounts', 'transaction_field_values', 'audit_log']));
    await t.cuadra.transactions.update(value.id, { notes: 'mesa 4' });
    expect(new Set(events[1]!.tables)).toEqual(new Set(['transactions', 'audit_log']));
    await codeOf(t.cuadra.transactions.create({ accountId: cash, kind: 'income', amountMinor: -1, date: '2026-06-01', description: 'x' }));
    expect(events).toHaveLength(2);
  });

  it('las notas y la descripción alimentan la búsqueda normalizada', async () => {
    const { value } = await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 100, date: '2026-06-01', description: '  Café  ', notes: 'Señora Pérez',
    });
    expect(value.description).toBe('Café');
    const row = await t.driver.get<{ search_text: string }>('SELECT search_text FROM transactions WHERE id = ?', [value.id]);
    expect(row!.search_text).toBe('cafe senora perez');
    await t.cuadra.transactions.update(value.id, { description: 'Té' });
    expect((await t.driver.get<{ search_text: string }>('SELECT search_text FROM transactions WHERE id = ?', [value.id]))!.search_text).toBe(
      'te senora perez',
    );
  });
});

describe('rendimiento', () => {
  it('createMany de 5 000 filas con valores cabe holgado en el presupuesto (Node)', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Ventas', 'Compras'] });
    const drafts: CreateManyDraft[] = Array.from({ length: 5_000 }, (_, i) =>
      i % 10 === 9
        ? { kind: 'transfer', fromAccountId: cash, toAccountId: bank, amountMinor: 1_000 + i, date: '2026-05-01', description: `Depósito ${i}` }
        : {
            accountId: i % 2 ? cash : bank,
            kind: i % 3 ? 'income' : 'expense',
            amountMinor: 100 + i,
            date: `2026-0${1 + (i % 5)}-1${i % 10}`,
            description: `Movimiento ${i}`,
            values: { [cat.id]: { type: 'list', optionId: cat.options[i % 3 ? 'Ventas' : 'Compras']! } },
          },
    );
    const started = performance.now();
    const m = await t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'import', accountId: null, label: 'grande' },
      drafts,
      audit: { action: 'import', message: 'audit.batch.import' },
    });
    const ms = performance.now() - started;
    console.info(`[perf] createMany 5000 borradores (5500 filas): ${ms.toFixed(0)} ms`);
    expect(m.value.ids).toHaveLength(5_000);
    expect(await countRows(t.driver, 'transactions')).toBe(5_500);
    const seqs = await t.driver.all<{ n: number; mx: number }>(
      'SELECT COUNT(*) AS n, MAX(seq) AS mx FROM transactions GROUP BY account_id',
    );
    for (const s of seqs) expect(Number(s.mx)).toBe(Number(s.n)); // 1..n sin huecos

    // Referencia en la misma máquina y momento: el mínimo que exige el trigger (reservar + insertar por
    // fila, 5 500 veces). Comparar contra ella aguanta máquinas cargadas mejor que un tiempo absoluto.
    const other = await seedAccount(t, ws, { name: 'Referencia' });
    const at = t.clock.now().toISOString();
    const refStart = performance.now();
    await t.driver.transaction(async (tx) => {
      for (let i = 0; i < 5_500; i++) {
        const r = await tx.get<{ seq: number }>(
          'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
          [other],
        );
        await tx.run(
          `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date, description,
             recorded_at, updated_at) VALUES (?, ?, ?, ?, 'income', 'in', 1, '2026-06-01', 'x', ?, ?)`,
          [t.ids.next(), ws, other, r!.seq, at, at],
        );
      }
    });
    const refMs = performance.now() - refStart;
    console.info(`[perf] referencia (reservar + insertar ×5500): ${refMs.toFixed(0)} ms`);
    expect(ms).toBeLessThan(Math.max(1_500, refMs * 4));
  }, 60_000);
});
