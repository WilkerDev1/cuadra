// Validaciones duras (DomainError) y suaves (avisos que no bloquean) de los movimientos.
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Id } from '../types';
import {
  archiveAccount,
  codeOf,
  countRows,
  deactivateField,
  deactivateOption,
  seedAccount,
  seedField,
  seedWorkspace,
} from './movements.testkit';
import type { TxDraft } from './transactions';

let t: TestCuadra;
let ws: Id;
let cash: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
});

const draft = (over: Partial<TxDraft> = {}): TxDraft => ({
  accountId: cash, kind: 'income', amountMinor: 12_500, date: '2026-06-14', description: 'Venta de refrescos', ...over,
});

describe('avisos suaves', () => {
  it('monto cero → aviso zero_amount, se guarda', async () => {
    expect(await t.cuadra.transactions.check(ws, draft({ amountMinor: 0 }))).toContainEqual({ code: 'zero_amount' });
    const saved = await t.cuadra.transactions.create(draft({ amountMinor: 0 }));
    expect(saved.warnings).toContainEqual({ code: 'zero_amount' });
    expect(saved.value.amountMinor).toBe(0);
    expect(await countRows(t.driver, 'transactions')).toBe(1);
    expect((await t.cuadra.transactions.create(draft())).warnings).toEqual([]);
  });

  it('fecha a más de 90 días de hoy → aviso far_date', async () => {
    // Hoy es 2026-06-15.
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-09-14' }))).toContainEqual({ code: 'far_date', days: 91 });
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-03-16' }))).toContainEqual({ code: 'far_date', days: -91 });
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-09-13' }))).toEqual([]);
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-03-17' }))).toEqual([]);
    const saved = await t.cuadra.transactions.create(draft({ date: '2027-06-15' }));
    expect(saved.warnings).toContainEqual({ code: 'far_date', days: 365 });
  });

  it('mismo monto, cuenta y descripción parecida en ±3 días → aviso possible_duplicate', async () => {
    const first = await t.cuadra.transactions.create(draft({ date: '2026-06-10' }));
    const dup = { code: 'possible_duplicate', transactionId: first.value.id, seq: 1 };
    // Descripción con otra capitalización, sin tilde y con una errata.
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-06-13', description: 'venta de refrescos' }))).toContainEqual(dup);
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-06-07', description: 'Venta de refescos' }))).toContainEqual(dup);
    const saved = await t.cuadra.transactions.create(draft({ date: '2026-06-12' }));
    expect(saved.warnings).toContainEqual(dup);
    // No lo es: cuatro días, otro monto, otra cuenta, otra descripción, o es él mismo al editarse.
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-06-03' }))).toEqual([]);
    const bank = await seedAccount(t, ws, { name: 'Banco' });
    expect(await t.cuadra.transactions.check(ws, draft({ accountId: bank, date: '2026-06-10' }))).toEqual([]);
    expect(await t.cuadra.transactions.check(ws, draft({ amountMinor: 12_501, date: '2026-06-10' }))).toEqual([]);
    expect(await t.cuadra.transactions.check(ws, draft({ description: 'Pago de luz', date: '2026-06-10' }))).toEqual([]);
    const self = await t.cuadra.transactions.check(ws, draft({ date: '2026-06-10' }), { editingId: saved.value.id });
    expect(self).toEqual([dup]);
    // Un anulado no cuenta como duplicado.
    await t.cuadra.transactions.void(first.value.id);
    expect(await t.cuadra.transactions.check(ws, draft({ date: '2026-06-01' }))).toEqual([]);
  });

  it('una salida que deja la cuenta en negativo avisa negative_balance; una entrada no', async () => {
    await t.cuadra.transactions.create(draft({ amountMinor: 1_000 }));
    const out = await t.cuadra.transactions.create(draft({ kind: 'expense', amountMinor: 1_500, description: 'Compra' }));
    expect(out.warnings).toContainEqual({ code: 'negative_balance', accountId: cash, balanceAfterMinor: -500 });
    const back = await t.cuadra.transactions.create(draft({ amountMinor: 100, description: 'Otra venta' }));
    expect(back.warnings).toEqual([]);
    // Anular una entrada también puede dejarla en negativo.
    const voided = await t.cuadra.transactions.void(back.value.id);
    expect(voided.warnings).toContainEqual({ code: 'negative_balance', accountId: cash, balanceAfterMinor: -500 });
  });
});

describe('validaciones duras', () => {
  it('monto, fecha y descripción inválidos se rechazan sin escribir', async () => {
    expect(await codeOf(t.cuadra.transactions.create(draft({ amountMinor: -1 })))).toBe('invalid_amount');
    expect(await codeOf(t.cuadra.transactions.create(draft({ amountMinor: 1.5 })))).toBe('invalid_amount');
    expect(await codeOf(t.cuadra.transactions.create(draft({ amountMinor: Number.MAX_SAFE_INTEGER + 1 })))).toBe('invalid_amount');
    expect(await codeOf(t.cuadra.transactions.create(draft({ date: '2026-02-29' })))).toBe('invalid_date');
    expect(await codeOf(t.cuadra.transactions.create(draft({ date: '2026-13-01' })))).toBe('invalid_date');
    expect(await codeOf(t.cuadra.transactions.create(draft({ date: '15/06/2026' })))).toBe('invalid_date');
    expect(await codeOf(t.cuadra.transactions.create(draft({ description: '   ' })))).toBe('description_required');
    expect(await countRows(t.driver, 'transactions')).toBe(0);
    expect(await countRows(t.driver, 'audit_log')).toBe(0);
  });

  it('cuenta inexistente, archivada, de otro espacio o espacio archivado se rechazan', async () => {
    expect(await codeOf(t.cuadra.transactions.create(draft({ accountId: 'no-existe' })))).toBe('not_found');
    const old = await seedAccount(t, ws, { name: 'Vieja' });
    await archiveAccount(t, old);
    expect(await codeOf(t.cuadra.transactions.create(draft({ accountId: old })))).toBe('account_archived');
    const archivedWs = await seedWorkspace(t, { name: 'Cerrado', archived: true });
    const inArchived = await seedAccount(t, archivedWs);
    expect(await codeOf(t.cuadra.transactions.create(draft({ accountId: inArchived })))).toBe('workspace_archived');
    // check() con una cuenta de otro espacio no da avisos: el guardado la rechazaría.
    const otherWs = await seedWorkspace(t, { name: 'Otro' });
    const foreign = await seedAccount(t, otherWs);
    expect(await codeOf(t.cuadra.transactions.createTransfer({
      fromAccountId: foreign, toAccountId: cash, amountMinor: 1, date: '2026-06-14', description: 'x',
    }))).toBe('workspace_mismatch');
  });

  it('valores de campos: tipo, opción del campo, campo y opción inactivos', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Ventas', 'Vieja'] });
    const other = await seedField(t, ws, { key: 'fondo', type: 'list', options: ['General'] });
    const units = await seedField(t, ws, { key: 'unidades', type: 'number' });
    const create = (values: TxDraft['values']) => t.cuadra.transactions.create(draft(values ? { values } : {}));
    expect(await codeOf(create({ [units.id]: { type: 'text', value: '3' } }))).toBe('field_value_type_mismatch');
    expect(await codeOf(create({ [units.id]: { type: 'number', value: Number.NaN } }))).toBe('field_value_type_mismatch');
    expect(await codeOf(create({ [cat.id]: { type: 'list', optionId: other.options['General']! } }))).toBe('field_value_type_mismatch');
    expect(await codeOf(create({ 'no-existe': { type: 'text', value: 'x' } }))).toBe('not_found');

    const old = await create({ [cat.id]: { type: 'list', optionId: cat.options['Vieja']! }, [units.id]: { type: 'number', value: 2.5 } });
    expect(old.value.values[units.id]).toEqual({ type: 'number', value: 2.5 });
    await deactivateOption(t, cat.options['Vieja']!);
    expect(await codeOf(create({ [cat.id]: { type: 'list', optionId: cat.options['Vieja']! } }))).toBe('option_inactive');
    await deactivateField(t, units.id);
    expect(await codeOf(create({ [units.id]: { type: 'number', value: 1 } }))).toBe('field_inactive');

    // Editar un movimiento viejo conserva sus valores inactivos; cambiarlos a otro valor inactivo no.
    const edited = await t.cuadra.transactions.update(old.value.id, {
      description: 'Venta vieja',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Vieja']! }, [units.id]: { type: 'number', value: 2.5 } },
    });
    expect(edited.value.values).toEqual(old.value.values);
    expect(await codeOf(t.cuadra.transactions.update(old.value.id, { values: { [units.id]: { type: 'number', value: 9 } } }))).toBe(
      'field_inactive',
    );
    // Vaciar un valor sí se puede, aunque el campo esté inactivo.
    const cleared = await t.cuadra.transactions.update(old.value.id, { values: { [units.id]: null } });
    expect(cleared.value.values[units.id]).toBeUndefined();
    expect(await countRows(t.driver, 'transaction_field_values', 'transaction_id = ?', [old.value.id])).toBe(1);
  });

  it('editar un anulado se rechaza (already_voided)', async () => {
    const { value } = await t.cuadra.transactions.create(draft());
    await t.cuadra.transactions.void(value.id);
    expect(await codeOf(t.cuadra.transactions.update(value.id, { amountMinor: 1 }))).toBe('already_voided');
    expect(await codeOf(t.cuadra.transactions.get('no-existe'))).toBe('not_found');
  });
});
