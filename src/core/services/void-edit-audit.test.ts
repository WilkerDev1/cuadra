// Anular, editar e historial (I-8, I-10, F-57, F-58).
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { ChangeEvent } from '../events';
import type { Id } from '../types';
import { balanceOf, codeOf, countRows, seedAccount, seedField, seedWorkspace, totalsOf } from './movements.testkit';
import type { TxPatch } from './transactions';

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

const income = (amountMinor: number, description = 'Venta', accountId = cash) =>
  t.cuadra.transactions.create({ accountId, kind: 'income', amountMinor, date: '2026-06-10', description });


describe('anular, editar e historial', () => {
  it('anulado queda fuera de saldo, totales, resumen e informe, y aparece con status voided', async () => {
    await income(10_000);
    const gone = await income(7_000, 'Venta anulada');
    await t.cuadra.transactions.void(gone.value.id, 'Error de captura');
    expect(await balanceOf(t.driver, cash)).toBe(10_000);
    expect(await totalsOf(t.driver, ws)).toMatchObject({ inMinor: 10_000, count: 1 });
    expect((await t.cuadra.transactions.get(gone.value.id)).status).toBe('voided');

    // Cuando 2B/2C estén integrados, lo mismo por cada consumidor.
    const acc = await t.cuadra.accounts.get(cash);
    expect(acc.balanceMinor).toBe(10_000);
    const totals = await t.cuadra.queries.totals(ws, {});
    expect(totals.inMinor).toBe(10_000);
    const summary = await t.cuadra.queries.summarize(ws, { filter: {}, groupBy: { by: 'kind' } });
    expect(summary.totals.inMinor).toBe(10_000);
    const report = await t.cuadra.reports.build(ws, t.cuadra.reports.preset('summary', { preset: 'all' }));
    expect(report.statement.inMinor).toBe(10_000);
    const list = await t.cuadra.queries.listTransactions(ws, { filter: { status: 'all' } });
    expect(list.items.find((r) => r.id === gone.value.id)?.status).toBe('voided');
  });

  it('anular guarda el motivo y lo registra en el historial', async () => {
    const { value } = await income(5_000);
    const voided = await t.cuadra.transactions.void(value.id, '  Cliente devolvió  ');
    expect(voided.value.voidReason).toBe('Cliente devolvió');
    expect(voided.value.voidedAt).toBe(t.clock.now().toISOString());
    const [last] = await t.cuadra.transactions.history(value.id);
    expect(last!.id).toBe(voided.auditActionId);
    expect(last!.action).toBe('void');
    expect(last!.params).toMatchObject({ reason: 'Cliente devolvió' });
    expect(last!.changes).toContainEqual({ entityId: value.id, path: 'status', old: 'active', new: 'voided' });
    expect(last!.changes).toContainEqual({ entityId: value.id, path: 'void_reason', old: null, new: 'Cliente devolvió' });
    // Sin motivo también se puede, y restaurar limpia el motivo.
    await t.cuadra.transactions.restore(value.id);
    expect((await t.cuadra.transactions.get(value.id)).voidReason).toBeNull();
    const bare = await t.cuadra.transactions.void(value.id);
    expect(bare.value.voidReason).toBeNull();
  });

  it('editar tres campos en un guardado produce una acción con tres líneas (F-57)', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Ventas', 'Servicios'] });
    const { value } = await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 5_000, date: '2026-06-10', description: 'Venta',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Ventas']! } },
    });
    const edited = await t.cuadra.transactions.update(value.id, {
      amountMinor: 5_500,
      description: 'Venta al por mayor',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Servicios']! } },
    });
    expect(edited.value.amountMinor).toBe(5_500);
    const entries = await t.cuadra.audit.forEntity('transaction', value.id);
    expect(entries.map((e) => e.action)).toEqual(['edit', 'create']);
    const edit = entries[0]!;
    expect(edit.id).toBe(edited.auditActionId);
    expect(edit.changes).toHaveLength(3);
    expect(edit.changes).toEqual(
      expect.arrayContaining([
        { entityId: value.id, path: 'amount_minor', old: 5_000, new: 5_500 },
        { entityId: value.id, path: 'description', old: 'Venta', new: 'Venta al por mayor' },
        {
          entityId: value.id,
          path: `field:${cat.id}`,
          old: { type: 'list', optionId: cat.options['Ventas'] },
          new: { type: 'list', optionId: cat.options['Servicios'] },
        },
      ]),
    );
  });

  it('editar sin cambios reales no escribe historial ni emite evento', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Ventas'] });
    const { value } = await t.cuadra.transactions.create({
      accountId: cash, kind: 'income', amountMinor: 5_000, date: '2026-06-10', description: 'Venta', notes: '',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Ventas']! } },
    });
    const events: ChangeEvent[] = [];
    const off = t.cuadra.subscribe((e) => events.push(e));
    const auditBefore = await countRows(t.driver, 'audit_log');
    const result = await t.cuadra.transactions.update(value.id, {
      amountMinor: 5_000,
      description: 'Venta',
      kind: 'income',
      notes: '',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Ventas']! } },
    });
    off();
    expect(result.auditActionId).toBeNull();
    expect(result.value.updatedAt).toBe(value.updatedAt);
    expect(events).toEqual([]);
    expect(await countRows(t.driver, 'audit_log')).toBe(auditBefore);
  });

  it('UPDATE y DELETE sobre audit_log los rechaza la BD', async () => {
    await income(1_000);
    expect(await codeOf(t.driver.run("UPDATE audit_log SET message = 'x'"))).toBe('audit_append_only');
    expect(await codeOf(t.driver.run('DELETE FROM audit_log'))).toBe('audit_append_only');
    expect(await codeOf(t.driver.run("UPDATE audit_log_changes SET path = 'x'"))).toBe('audit_append_only');
    expect(await codeOf(t.driver.run('DELETE FROM audit_log_changes'))).toBe('audit_append_only');
    expect(await countRows(t.driver, 'audit_log')).toBe(1);
  });

  it('renombrar cuenta, desactivar campo y fusionar opciones quedan en el historial (F-58)', async () => {
    const wsReal = (await t.cuadra.workspaces.create({ name: 'Taller' })).value.id;
    const acc = (await t.cuadra.accounts.create({ workspaceId: wsReal, name: 'Caja chica' })).value;
    const field = (
      await t.cuadra.fields.create({
        workspaceId: wsReal, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }, { label: 'Electricidad' }],
      })
    ).value;
    const [luz, electricidad] = field.options;
    await t.cuadra.transactions.create({
      accountId: acc.id, kind: 'expense', amountMinor: 900, date: '2026-06-10', description: 'Factura',
      values: { [field.id]: { type: 'list', optionId: luz!.id } },
    });

    const renamed = await t.cuadra.accounts.update(acc.id, { name: 'Caja principal' });
    const deactivated = await t.cuadra.fields.deactivate(field.id);
    const merged = await t.cuadra.fields.mergeOptions(luz!.id, electricidad!.id);
    for (const m of [renamed, deactivated, merged]) expect(m.auditActionId).not.toBeNull();

    const accountHistory = await t.cuadra.audit.forEntity('account', acc.id);
    expect(accountHistory[0]!.changes.some((c) => c.old === 'Caja chica' && c.new === 'Caja principal')).toBe(true);
    expect((await t.cuadra.audit.forEntity('field', field.id)).some((e) => e.id === deactivated.auditActionId)).toBe(true);
    const page = await t.cuadra.audit.list(wsReal, { actions: ['merge'] });
    expect(page.items.map((e) => e.id)).toEqual([merged.auditActionId]);
  });

  it('historial general filtra por cuenta y por tipo de acción', async () => {
    const a = await income(1_000, 'Venta caja');
    const b = await income(2_000, 'Venta banco', bank);
    await t.cuadra.transactions.update(a.value.id, { amountMinor: 1_100 });
    await t.cuadra.transactions.void(b.value.id, 'Duplicado');
    const tr = await t.cuadra.transactions.createTransfer({
      fromAccountId: cash, toAccountId: bank, amountMinor: 500, date: '2026-06-11', description: 'Depósito',
    });

    const all = await t.cuadra.audit.list(ws, {});
    expect(all.items).toHaveLength(5);
    // Más reciente primero.
    expect(all.items[0]!.id).toBe(tr.auditActionId);

    const byCash = await t.cuadra.audit.list(ws, { accountId: cash });
    expect(byCash.items.map((e) => e.action)).toEqual(['create', 'edit', 'create']);
    const byBank = await t.cuadra.audit.list(ws, { accountId: bank });
    // La transferencia aparece también en la cuenta de destino.
    expect(byBank.items.map((e) => e.action)).toEqual(['create', 'void', 'create']);
    expect(byBank.items[0]!.id).toBe(tr.auditActionId);

    const voids = await t.cuadra.audit.list(ws, { actions: ['void'] });
    expect(voids.items.map((e) => e.entityId)).toEqual([b.value.id]);
    const cashEdits = await t.cuadra.audit.list(ws, { accountId: cash, actions: ['edit', 'void'] });
    expect(cashEdits.items.map((e) => e.entityId)).toEqual([a.value.id]);
    const transfers = await t.cuadra.audit.list(ws, { entityType: 'transfer' });
    expect(transfers.items).toHaveLength(1);
  });

  it('cambiar income↔expense está permitido; a transfer u opening no (kind_change_forbidden)', async () => {
    const { value } = await income(4_000);
    const flipped = await t.cuadra.transactions.update(value.id, { kind: 'expense' });
    expect(flipped.value).toMatchObject({ kind: 'expense', direction: 'out' });
    expect(await balanceOf(t.driver, cash)).toBe(-4_000);
    const back = await t.cuadra.transactions.update(value.id, { kind: 'income' });
    expect(back.value).toMatchObject({ kind: 'income', direction: 'in' });

    for (const kind of ['transfer', 'opening']) {
      const patch = { kind } as unknown as TxPatch;
      expect(await codeOf(t.cuadra.transactions.update(value.id, patch))).toBe('kind_change_forbidden');
    }
    const opening = await t.cuadra.transactions.setOpening(bank, { amountMinor: 1, direction: 'in', date: '2026-06-01' });
    expect(await codeOf(t.cuadra.transactions.update(opening.value.id, { kind: 'income' }))).toBe('kind_change_forbidden');
    expect((await t.cuadra.transactions.get(value.id)).kind).toBe('income');
  });
});
