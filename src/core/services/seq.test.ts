// seq por cuenta: 1..n sin huecos, nunca se reutiliza ni cambia, los anulados lo conservan (I-7, ADR-5).
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Id } from '../types';
import { codeOf, countRows, nextSeqOf, seedAccount, seedWorkspace } from './movements.testkit';
import type { TxDraft, TxPatch } from './transactions';

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

const sale = (accountId: Id, i = 0): TxDraft => ({
  accountId, kind: 'income', amountMinor: 1_000 + i, date: '2026-06-10', description: `Venta ${i}`,
});

describe('seq por cuenta', () => {
  it('seq empieza en 1 y es consecutivo por cuenta', async () => {
    const seqs: Array<[Id, number]> = [];
    for (const [i, acc] of [cash, bank, cash, cash, bank].entries()) {
      const { value } = await t.cuadra.transactions.create(sale(acc, i));
      seqs.push([acc, value.seq]);
    }
    expect(seqs.filter(([a]) => a === cash).map(([, s]) => s)).toEqual([1, 2, 3]);
    expect(seqs.filter(([a]) => a === bank).map(([, s]) => s)).toEqual([1, 2]);
    expect(await nextSeqOf(t.driver, cash)).toBe(4);
  });

  it('un anulado conserva su seq y el siguiente recibe seq+1', async () => {
    await t.cuadra.transactions.create(sale(cash, 1));
    const second = await t.cuadra.transactions.create(sale(cash, 2));
    const voided = await t.cuadra.transactions.void(second.value.id);
    expect(voided.value.seq).toBe(2);
    const third = await t.cuadra.transactions.create(sale(cash, 3));
    expect(third.value.seq).toBe(3);
    const restored = await t.cuadra.transactions.restore(second.value.id);
    expect(restored.value.seq).toBe(2);
  });

  it('UPDATE de seq, account_id o recorded_at lo rechaza la BD (immutable_column)', async () => {
    const { value } = await t.cuadra.transactions.create(sale(cash));
    expect(await codeOf(t.driver.run('UPDATE transactions SET seq = 9 WHERE id = ?', [value.id]))).toBe('immutable_column');
    expect(await codeOf(t.driver.run('UPDATE transactions SET account_id = ? WHERE id = ?', [bank, value.id]))).toBe('immutable_column');
    expect(await codeOf(t.driver.run("UPDATE transactions SET recorded_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [value.id]))).toBe(
      'immutable_column',
    );
  });

  it('DELETE de un movimiento lo rechaza la BD (delete_forbidden)', async () => {
    const { value } = await t.cuadra.transactions.create(sale(cash));
    expect(await codeOf(t.driver.run('DELETE FROM transactions WHERE id = ?', [value.id]))).toBe('delete_forbidden');
    expect(await countRows(t.driver, 'transactions')).toBe(1);
  });

  it('un INSERT con seq no reservado lo rechaza la BD (seq_not_reserved)', async () => {
    await t.cuadra.transactions.create(sale(cash));
    const at = t.clock.now().toISOString();
    const insert = (seq: number) =>
      t.driver.transaction((tx) =>
        tx.run(
          `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date, description,
             recorded_at, updated_at) VALUES (?, ?, ?, ?, 'income', 'in', 100, '2026-06-10', 'Coló', ?, ?)`,
          [t.ids.next(), ws, cash, seq, at, at],
        ),
      );
    expect(await codeOf(insert(2))).toBe('seq_not_reserved'); // sin reservar
    expect(await codeOf(insert(7))).toBe('seq_not_reserved'); // saltarse números
    // Reutilizar el último número coincide con next_seq − 1: lo para UNIQUE (account_id, seq).
    expect(await codeOf(insert(1))).toMatch(/^sql:UNIQUE/);
    expect(await countRows(t.driver, 'transactions')).toBe(1);
  });

  it('createMany de 50 filas deja seq 1..50 sin huecos; si falla una, no queda ninguna', async () => {
    const drafts = Array.from({ length: 50 }, (_, i) => sale(cash, i));
    const ok = await t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'capture', accountId: cash, label: 'Ventas' },
      drafts,
      audit: { action: 'batch_create', message: 'audit.batch.capture' },
    });
    expect(ok.value.ids).toHaveLength(50);
    const seqs = await t.driver.all<{ seq: number }>('SELECT seq FROM transactions WHERE account_id = ? ORDER BY seq', [cash]);
    expect(seqs.map((r) => Number(r.seq))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await nextSeqOf(t.driver, cash)).toBe(51);
    expect(await countRows(t.driver, 'audit_log')).toBe(1);

    const auditBefore = await countRows(t.driver, 'audit_log');
    const batchesBefore = await countRows(t.driver, 'batches');
    const bad = [...drafts];
    bad[30] = { ...sale(cash, 30), date: '2026-02-30' }; // fecha que no existe
    const err = await codeOf(
      t.cuadra.transactions.createMany({
        workspaceId: ws,
        batch: { source: 'capture', accountId: cash, label: 'Ventas 2' },
        drafts: bad,
        audit: { action: 'batch_create', message: 'audit.batch.capture' },
      }),
    );
    expect(err).toBe('invalid_date');
    expect(await countRows(t.driver, 'transactions')).toBe(50);
    expect(await nextSeqOf(t.driver, cash)).toBe(51);
    expect(await countRows(t.driver, 'batches')).toBe(batchesBefore);
    expect(await countRows(t.driver, 'audit_log')).toBe(auditBefore);
    // El siguiente número sigue siendo el 51: no quedó hueco.
    expect((await t.cuadra.transactions.create(sale(cash, 99))).value.seq).toBe(51);
  });

  it('createMany no hace un viaje por fila: lote y pares reserva+INSERT van juntos (runSeries), con seq correctos', async () => {
    await t.cuadra.transactions.create(sale(bank, 0)); // Banco ya va por el 2
    const calls: string[] = [];
    const original = t.driver.transaction.bind(t.driver);
    t.driver.transaction = ((fn: (tx: never) => Promise<unknown>) =>
      original((tx) => {
        const counted = Object.fromEntries(
          (['all', 'get', 'run', 'runMany', 'runSeries'] as const)
            .filter((op) => tx[op] !== undefined)
            .map((op) => [op, (...a: unknown[]) => (calls.push(op), (tx[op] as (...x: unknown[]) => unknown)(...a))]),
        );
        return fn(counted as never);
      })) as typeof t.driver.transaction;
    const drafts = Array.from({ length: 300 }, (_, i) => sale(i % 3 === 0 ? bank : cash, i));
    const ok = await t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'import', accountId: null, label: 'Muchas' },
      drafts,
      audit: { action: 'import', message: 'audit.import' },
    });
    expect(ok.value.ids).toHaveLength(300);
    expect(calls.filter((c) => c === 'runSeries')).toHaveLength(1);
    expect(calls.length).toBeLessThan(12);
    const seqs = async (a: Id) =>
      (await t.driver.all<{ seq: number }>('SELECT seq FROM transactions WHERE account_id = ? ORDER BY seq', [a])).map((r) => Number(r.seq));
    expect(await seqs(bank)).toEqual(Array.from({ length: 101 }, (_, i) => i + 1));
    expect(await seqs(cash)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(await nextSeqOf(t.driver, bank)).toBe(102);
  });

  it('cambiar la cuenta de un movimiento → account_change_forbidden', async () => {
    const { value } = await t.cuadra.transactions.create(sale(cash));
    const patch = { accountId: bank } as unknown as TxPatch;
    expect(await codeOf(t.cuadra.transactions.update(value.id, patch))).toBe('account_change_forbidden');
    // Mandar la misma cuenta no es un cambio.
    const same = { accountId: cash, description: 'Venta mayor' } as unknown as TxPatch;
    expect((await t.cuadra.transactions.update(value.id, same)).value.description).toBe('Venta mayor');
  });
});
