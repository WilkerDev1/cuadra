// Saldo inicial: único por cuenta en toda su vida (I-6), cuenta en el saldo pero no en entradas (I-3).
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Id } from '../types';
import { balanceOf, codeOf, countRows, seedAccount, seedWorkspace, totalsOf } from './movements.testkit';

let t: TestCuadra;
let ws: Id;
let cash: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
});

describe('saldo inicial', () => {
  it('segundo saldo inicial en la misma cuenta → opening_exists; setOpening edita el existente', async () => {
    const first = await t.cuadra.transactions.setOpening(cash, { amountMinor: 100_000, direction: 'in', date: '2026-01-01' });
    expect(first.value.kind).toBe('opening');
    expect(first.value.seq).toBe(1);

    // Un segundo por createMany (o dos en el mismo lote) se rechaza antes de tocar la BD.
    const second = t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'import', accountId: cash, label: 'x' },
      drafts: [{ kind: 'opening', accountId: cash, amountMinor: 5, direction: 'in', date: '2026-01-02' }],
      audit: { action: 'import', message: 'audit.batch.import' },
    });
    expect(await codeOf(second)).toBe('opening_exists');
    const other = await seedAccount(t, ws, { name: 'Banco' });
    const twice = t.cuadra.transactions.createMany({
      workspaceId: ws,
      batch: { source: 'import', accountId: other, label: 'x' },
      drafts: [
        { kind: 'opening', accountId: other, amountMinor: 5, direction: 'in', date: '2026-01-02' },
        { kind: 'opening', accountId: other, amountMinor: 6, direction: 'in', date: '2026-01-03' },
      ],
      audit: { action: 'import', message: 'audit.batch.import' },
    });
    expect(await codeOf(twice)).toBe('opening_exists');

    const edited = await t.cuadra.transactions.setOpening(cash, { amountMinor: 250_000, direction: 'in', date: '2025-12-31' });
    expect(edited.value.id).toBe(first.value.id);
    expect(edited.value.seq).toBe(1);
    expect(edited.value.amountMinor).toBe(250_000);
    expect(edited.value.date).toBe('2025-12-31');
    expect(await countRows(t.driver, 'transactions', "kind = 'opening'")).toBe(1);
    const history = await t.cuadra.transactions.history(first.value.id);
    expect(history.map((h) => h.action)).toEqual(['edit', 'create']);
    expect(history[0]!.changes.map((c) => c.path).sort()).toEqual(['amount_minor', 'date']);
  });

  it('saldo inicial cuenta en el saldo pero no en entradas', async () => {
    await t.cuadra.transactions.setOpening(cash, { amountMinor: 500_000, direction: 'in', date: '2026-06-01' });
    await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 10_000, date: '2026-06-02', description: 'Venta',
    });
    expect(await balanceOf(t.driver, cash)).toBe(510_000);
    const totals = await totalsOf(t.driver, ws);
    expect(totals.inMinor).toBe(10_000);
    expect(totals.openingsMinor).toBe(500_000);

    // Con los servicios de consultas y cuentas ya integrados, lo mismo por la fachada.
    const q = await t.cuadra.queries.totals(ws, {});
    expect(q.inMinor).toBe(10_000);
    expect(q.openingsMinor).toBe(500_000);

    const acc = await t.cuadra.accounts.get(cash);
    expect(acc.balanceMinor).toBe(510_000);
  });

  it('movimiento con fecha anterior al saldo inicial → aviso before_opening', async () => {
    await t.cuadra.transactions.setOpening(cash, { amountMinor: 500_000, direction: 'in', date: '2026-06-01' });
    const draft = { accountId: cash, kind: 'expense' as const, amountMinor: 1_000, date: '2026-05-20', description: 'Hielo' };
    expect(await t.cuadra.transactions.check(ws, draft)).toContainEqual({ code: 'before_opening', openingDate: '2026-06-01' });
    const saved = await t.cuadra.transactions.create(draft);
    expect(saved.warnings).toContainEqual({ code: 'before_opening', openingDate: '2026-06-01' });
    const later = await t.cuadra.transactions.create({ ...draft, date: '2026-06-01' });
    expect(later.warnings.some((w) => w.code === 'before_opening')).toBe(false);
  });

  it('anular el saldo inicial lo quita del saldo; restaurar lo devuelve', async () => {
    const opening = await t.cuadra.transactions.setOpening(cash, { amountMinor: 75_000, direction: 'in', date: '2026-06-01' });
    await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 5_000, date: '2026-06-02', description: 'Venta',
    });
    expect(await balanceOf(t.driver, cash)).toBe(80_000);
    const voided = await t.cuadra.transactions.void(opening.value.id, 'Monto equivocado');
    expect(voided.value.status).toBe('voided');
    expect(await balanceOf(t.driver, cash)).toBe(5_000);
    const restored = await t.cuadra.transactions.restore(opening.value.id);
    expect(restored.value.status).toBe('active');
    expect(await balanceOf(t.driver, cash)).toBe(80_000);
    // Sigue siendo el único: anularlo no abre la puerta a un segundo.
    expect(await countRows(t.driver, 'transactions', "kind = 'opening'")).toBe(1);
  });

  it('saldo inicial negativo (direction out) para una tarjeta con deuda', async () => {
    const card = await seedAccount(t, ws, { name: 'Tarjeta', type: 'card' });
    const opening = await t.cuadra.transactions.setOpening(card, { amountMinor: 1_500_000, direction: 'out', date: '2026-06-01' });
    expect(opening.value.direction).toBe('out');
    expect(opening.value.amountMinor).toBe(1_500_000);
    expect(await balanceOf(t.driver, card)).toBe(-1_500_000);
    expect((await totalsOf(t.driver, ws)).openingsMinor).toBe(-1_500_000);
    // Cambiar el sentido es una edición del mismo saldo inicial.
    const flipped = await t.cuadra.transactions.setOpening(card, { amountMinor: 1_500_000, direction: 'in', date: '2026-06-01' });
    expect(flipped.value.id).toBe(opening.value.id);
    expect(await balanceOf(t.driver, card)).toBe(1_500_000);
  });
});
