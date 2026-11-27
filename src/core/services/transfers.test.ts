// Transferencias: dos filas enlazadas out/in del mismo espacio, mismo monto, fecha y estado (I-4, I-9).
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Id } from '../types';
import { balanceOf, codeOf, countRows, seedAccount, seedField, seedWorkspace, totalsOf } from './movements.testkit';

let t: TestCuadra;
let ws: Id;
let cash: Id;
let bank: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
  bank = await seedAccount(t, ws, { name: 'Banco', type: 'bank' });
});

const transfer = (amountMinor = 30_000) =>
  t.cuadra.transactions.createTransfer({
    fromAccountId: cash, toAccountId: bank, amountMinor, date: '2026-06-10', description: 'Depósito al banco',
  });

describe('transferencias', () => {
  it('transferencia crea dos filas enlazadas, out/in, con seq propio en cada cuenta', async () => {
    await t.cuadra.transactions.create({ accountId: cash, kind: 'income', amountMinor: 50_000, date: '2026-06-01', description: 'Venta' });
    await t.cuadra.transactions.create({ accountId: cash, kind: 'income', amountMinor: 20_000, date: '2026-06-02', description: 'Venta' });
    const { value } = await transfer();
    expect(value.out).toMatchObject({ accountId: cash, kind: 'transfer', direction: 'out', amountMinor: 30_000, seq: 3 });
    expect(value.in).toMatchObject({ accountId: bank, kind: 'transfer', direction: 'in', amountMinor: 30_000, seq: 1 });
    expect(value.out.transferGroupId).not.toBeNull();
    expect(value.out.transferGroupId).toBe(value.in.transferGroupId);
    expect(value.out.counterpart).toEqual({ accountId: bank, transactionId: value.in.id, seq: 1 });
    expect(value.in.counterpart).toEqual({ accountId: cash, transactionId: value.out.id, seq: 3 });
    expect(await countRows(t.driver, 'transactions', 'transfer_group_id = ?', [value.out.transferGroupId!])).toBe(2);
    expect(await balanceOf(t.driver, cash)).toBe(40_000);
    expect(await balanceOf(t.driver, bank)).toBe(30_000);
    // Leer cualquiera de los lados trae al otro.
    expect((await t.cuadra.transactions.get(value.in.id)).counterpart?.transactionId).toBe(value.out.id);
  });

  it('transferencias no cuentan en entradas ni salidas del espacio y salen en su línea', async () => {
    await t.cuadra.transactions.create({ accountId: cash, kind: 'income', amountMinor: 50_000, date: '2026-06-01', description: 'Venta' });
    await transfer();
    const totals = await totalsOf(t.driver, ws);
    expect(totals.inMinor).toBe(50_000);
    expect(totals.outMinor).toBe(0);
    expect(totals.transfersInMinor).toBe(30_000);
    expect(totals.transfersOutMinor).toBe(30_000);
    const q = await t.cuadra.queries.totals(ws, {});
    expect(q).toMatchObject({ inMinor: 50_000, outMinor: 0, transfersInMinor: 30_000, transfersOutMinor: 30_000 });

  });

  it('editar el monto de un lado cambia los dos en una sola acción de historial', async () => {
    const { value } = await transfer();
    const before = await countRows(t.driver, 'audit_log');
    const edited = await t.cuadra.transactions.update(value.in.id, { amountMinor: 45_000, description: 'Depósito corregido' });
    expect(await countRows(t.driver, 'audit_log')).toBe(before + 1);
    expect(edited.auditActionId).not.toBeNull();
    const out = await t.cuadra.transactions.get(value.out.id);
    const inn = await t.cuadra.transactions.get(value.in.id);
    for (const side of [out, inn]) {
      expect(side.amountMinor).toBe(45_000);
      expect(side.description).toBe('Depósito corregido');
    }
    expect(await balanceOf(t.driver, cash)).toBe(-45_000);
    expect(await balanceOf(t.driver, bank)).toBe(45_000);
    // El historial de cualquiera de los lados muestra la misma acción, con líneas de ambos lados.
    const [lastOut] = await t.cuadra.transactions.history(value.out.id);
    const [lastIn] = await t.cuadra.transactions.history(value.in.id);
    expect(lastOut!.id).toBe(edited.auditActionId);
    expect(lastIn!.id).toBe(edited.auditActionId);
    expect(lastIn!.entityType).toBe('transfer');
    expect(new Set(lastIn!.changes.map((c) => c.entityId))).toEqual(new Set([value.out.id, value.in.id]));
  });

  it('anular un lado anula los dos; restaurar restaura los dos', async () => {
    const { value } = await transfer();
    const voided = await t.cuadra.transactions.void(value.out.id, 'Se duplicó');
    expect(voided.value.status).toBe('voided');
    expect((await t.cuadra.transactions.get(value.in.id)).status).toBe('voided');
    expect((await t.cuadra.transactions.get(value.in.id)).voidReason).toBe('Se duplicó');
    expect(await balanceOf(t.driver, cash)).toBe(0);
    expect(await balanceOf(t.driver, bank)).toBe(0);
    expect(await codeOf(t.cuadra.transactions.void(value.in.id))).toBe('already_voided');

    await t.cuadra.transactions.restore(value.in.id);
    expect((await t.cuadra.transactions.get(value.out.id)).status).toBe('active');
    expect((await t.cuadra.transactions.get(value.in.id)).status).toBe('active');
    expect(await balanceOf(t.driver, cash)).toBe(-30_000);
    expect(await codeOf(t.cuadra.transactions.restore(value.out.id))).toBe('not_voided');
  });

  it('transferencia a la misma cuenta → transfer_same_account', async () => {
    const err = await codeOf(
      t.cuadra.transactions.createTransfer({ fromAccountId: cash, toAccountId: cash, amountMinor: 1, date: '2026-06-10', description: 'x' }),
    );
    expect(err).toBe('transfer_same_account');
    expect(await countRows(t.driver, 'transactions')).toBe(0);
  });

  it('transferencia hacia una cuenta de otro espacio → workspace_mismatch', async () => {
    const otherWs = await seedWorkspace(t, { name: 'Otro' });
    const foreign = await seedAccount(t, otherWs, { name: 'Ajena' });
    const err = await codeOf(
      t.cuadra.transactions.createTransfer({ fromAccountId: cash, toAccountId: foreign, amountMinor: 1, date: '2026-06-10', description: 'x' }),
    );
    expect(err).toBe('workspace_mismatch');
    expect(await countRows(t.driver, 'transactions')).toBe(0);
    expect(await codeOf(
      t.cuadra.transactions.createTransfer({ fromAccountId: cash, toAccountId: 'no-existe', amountMinor: 1, date: '2026-06-10', description: 'x' }),
    )).toBe('not_found');
  });

  it('los valores de campos van en los dos lados y se editan juntos', async () => {
    const fund = await seedField(t, ws, { key: 'fondo', type: 'list', options: ['General', 'Obra'] });
    const { value } = await t.cuadra.transactions.createTransfer({
      fromAccountId: cash, toAccountId: bank, amountMinor: 1_000, date: '2026-06-10', description: 'Traspaso',
      values: { [fund.id]: { type: 'list', optionId: fund.options['General']! } },
    });
    expect(value.in.values[fund.id]).toEqual({ type: 'list', optionId: fund.options['General'] });
    await t.cuadra.transactions.update(value.out.id, { values: { [fund.id]: { type: 'list', optionId: fund.options['Obra']! } } });
    expect((await t.cuadra.transactions.get(value.in.id)).values[fund.id]).toEqual({ type: 'list', optionId: fund.options['Obra'] });
  });

  it('una transferencia no puede cambiar de tipo', async () => {
    const { value } = await transfer();
    expect(await codeOf(t.cuadra.transactions.update(value.out.id, { kind: 'income' }))).toBe('kind_change_forbidden');
  });
});
