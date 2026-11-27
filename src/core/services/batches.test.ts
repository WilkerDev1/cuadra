// Lotes y captura rápida (F-44/45/46, I-14): filas válidas en un lote, total de control, anular el lote.
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Id } from '../types';
import type { CaptureInput } from './batches';
import { balanceOf, codeOf, countRows, nextSeqOf, seedAccount, seedField, seedWorkspace } from './movements.testkit';

let t: TestCuadra;
let ws: Id;
let cash: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
});

const input = (rows: CaptureInput['rows'], extra: Partial<CaptureInput> = {}): CaptureInput => ({
  workspaceId: ws, accountId: cash, kind: 'expense', date: '2026-06-14', rows, ...extra,
});

describe('captura en lote', () => {
  it('captura guarda las filas válidas en un lote y devuelve los errores de las inválidas', async () => {
    const result = await t.cuadra.batches.capture(
      input([
        { amount: '1,250.50', description: 'Hielo' },
        { amount: 'abc', description: 'Ilegible' },
        { amount: '', description: '' }, // vacía: se ignora
        { amount: 300, description: '   ' },
        { amount: '150+75.50', description: 'Pan y leche', date: '2026-06-13' },
        { amount: '10.555', description: 'Demasiados decimales' },
      ]),
    );
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.savedRowIndexes).toEqual([0, 4]);
    expect(result.rowErrors).toEqual([
      { index: 1, error: 'not_a_number' },
      { index: 3, error: 'description_required' },
      { index: 5, error: 'too_many_decimals' },
    ]);
    const batch = await t.cuadra.batches.get(result.batchId);
    expect(batch).toMatchObject({ source: 'capture', accountId: cash, activeCount: 2, voidedCount: 0, restorableCount: 0 });
    const rows = await t.driver.all<{ amount_minor: number; date: string; batch_id: string; kind: string }>(
      'SELECT amount_minor, date, batch_id, kind FROM transactions ORDER BY seq',
    );
    expect(rows).toEqual([
      { amount_minor: 125_050, date: '2026-06-14', batch_id: result.batchId, kind: 'expense' },
      { amount_minor: 22_550, date: '2026-06-13', batch_id: result.batchId, kind: 'expense' },
    ]);
    // Una sola acción de historial para todo el lote.
    expect(await countRows(t.driver, 'audit_log')).toBe(1);
    expect((await t.cuadra.audit.list(ws, {})).items[0]).toMatchObject({ action: 'batch_create', batchId: result.batchId });
    // Avisos por fila: la cuenta queda en negativo.
    expect(result.warnings.find((w) => w.index === 4)?.warnings).toContainEqual({
      code: 'negative_balance', accountId: cash, balanceAfterMinor: -147_600,
    });
    expect((await t.cuadra.batches.list(ws)).map((b) => b.id)).toEqual([result.batchId]);

    // Nada válido → nothing_to_save y nada escrito.
    const nothing = await t.cuadra.batches.capture(input([{ amount: 'x', description: 'y' }, { amount: '', description: '' }]));
    expect(nothing).toEqual({ status: 'nothing_to_save', rowErrors: [{ index: 0, error: 'not_a_number' }] });
    expect(await countRows(t.driver, 'batches')).toBe(1);
  });

  it('total de control que no cuadra devuelve control_mismatch y no guarda nada', async () => {
    const rows = [
      { amount: '100', description: 'A' },
      { amount: '250.25', description: 'B' },
      { amount: 'mal', description: 'C' }, // no entra en la suma: solo filas válidas
    ];
    const preview = await t.cuadra.batches.previewCapture(input(rows, { controlTotalMinor: 40_000 }));
    expect(preview).toEqual({
      sumMinor: 35_025, differenceMinor: -4_975, validCount: 2, rowErrors: [{ index: 2, error: 'not_a_number' }],
    });
    const result = await t.cuadra.batches.capture(input(rows, { controlTotalMinor: 40_000 }));
    expect(result).toEqual({ status: 'control_mismatch', sumMinor: 35_025, controlTotalMinor: 40_000, differenceMinor: -4_975 });
    expect(await countRows(t.driver, 'transactions')).toBe(0);
    expect(await countRows(t.driver, 'batches')).toBe(0);
    expect(await countRows(t.driver, 'audit_log')).toBe(0);
    expect(await nextSeqOf(t.driver, cash)).toBe(1);

    // Si cuadra, se guarda sin marca de descuadre.
    const ok = await t.cuadra.batches.capture(input(rows.slice(0, 2), { controlTotalMinor: 35_025 }));
    expect(ok.status).toBe('saved');
    if (ok.status === 'saved') expect((await t.cuadra.batches.get(ok.batchId)).controlMismatchAccepted).toBe(false);
  });

  it('total de control descuadrado aceptado se guarda con control_mismatch_accepted', async () => {
    const result = await t.cuadra.batches.capture(
      input([{ amount: '100', description: 'A' }], { controlTotalMinor: 12_000, acceptControlMismatch: true, label: 'Gastos del día' }),
    );
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    const batch = await t.cuadra.batches.get(result.batchId);
    expect(batch).toMatchObject({ controlTotalMinor: 12_000, controlMismatchAccepted: true, label: 'Gastos del día' });
    // createMany directo también exige la confirmación (I-14).
    const err = await codeOf(
      t.cuadra.transactions.createMany({
        workspaceId: ws,
        batch: { source: 'capture', accountId: cash, label: '', controlTotalMinor: 1 },
        drafts: [{ accountId: cash, kind: 'expense', amountMinor: 5, date: '2026-06-14', description: 'x' }],
        audit: { action: 'batch_create', message: 'audit.batch.capture' },
      }),
    );
    expect(err).toBe('control_total_mismatch');
  });

  it('anular un lote anula sus activos en una acción; restaurar no revive los anulados a mano', async () => {
    const result = await t.cuadra.batches.capture(
      input([
        { amount: '10', description: 'A' },
        { amount: '20', description: 'B' },
        { amount: '30', description: 'C' },
      ], { kind: 'income' }),
    );
    if (result.status !== 'saved') throw new Error('no se guardó');
    const ids = (await t.driver.all<{ id: string }>('SELECT id FROM transactions ORDER BY seq')).map((r) => r.id);
    await t.cuadra.transactions.void(ids[1]!, 'A mano');
    expect(await balanceOf(t.driver, cash)).toBe(4_000);

    const auditBefore = await countRows(t.driver, 'audit_log');
    const voided = await t.cuadra.batches.void(result.batchId, 'Lote repetido');
    expect(voided.value.voidedCount).toBe(2);
    expect(await countRows(t.driver, 'audit_log')).toBe(auditBefore + 1);
    expect(await balanceOf(t.driver, cash)).toBe(0);
    // Lo anulado a mano antes NO se restaura con el lote: restorableCount solo cuenta lo que anuló el lote.
    expect(await t.cuadra.batches.get(result.batchId)).toMatchObject({ activeCount: 0, voidedCount: 3, restorableCount: 2 });
    expect(await codeOf(t.cuadra.batches.void(result.batchId))).toBe('already_voided');
    // El historial de un movimiento muestra que lo anuló el lote.
    const [last] = await t.cuadra.transactions.history(ids[0]!);
    expect(last).toMatchObject({ action: 'batch_void', batchId: result.batchId });
    expect(last!.changes).toEqual([{ entityId: ids[0], path: 'status', old: 'active', new: 'voided' }]);

    const restored = await t.cuadra.batches.restore(result.batchId);
    expect(restored.value.restoredCount).toBe(2);
    expect(await balanceOf(t.driver, cash)).toBe(4_000);
    const status = await t.driver.all<{ status: string; void_reason: string | null }>(
      'SELECT status, void_reason FROM transactions ORDER BY seq',
    );
    expect(status).toEqual([
      { status: 'active', void_reason: null },
      { status: 'voided', void_reason: 'A mano' },
      { status: 'active', void_reason: null },
    ]);
    expect(await codeOf(t.cuadra.batches.restore(result.batchId))).toBe('not_voided');
    expect(await t.cuadra.batches.get(result.batchId)).toMatchObject({ activeCount: 2, voidedCount: 1, restorableCount: 0 });
    expect((await t.cuadra.batches.list(ws, { source: 'capture' })).find((b) => b.id === result.batchId)?.restorableCount).toBe(0);
    expect(await codeOf(t.cuadra.batches.get('no-existe'))).toBe('not_found');
  });

  it('duplicate devuelve borrador con fecha de hoy y no consume seq', async () => {
    const cat = await seedField(t, ws, { key: 'categoria', type: 'list', options: ['Compras', 'Vieja'] });
    const note = await seedField(t, ws, { key: 'nota_vieja', type: 'text' });
    const { value } = await t.cuadra.transactions.create({
      accountId: cash, kind: 'expense', amountMinor: 8_000, date: '2026-05-02', description: 'Compra de hielo', notes: 'Proveedor A',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Compras']! }, [note.id]: { type: 'text', value: 'x' } },
    });
    await t.driver.run('UPDATE fields SET deactivated_at = ? WHERE id = ?', [t.clock.now().toISOString(), note.id]);
    const nextBefore = await nextSeqOf(t.driver, cash);
    const draft = await t.cuadra.transactions.duplicate(value.id);
    expect(draft).toEqual({
      accountId: cash, kind: 'expense', amountMinor: 8_000, date: '2026-06-15', description: 'Compra de hielo', notes: 'Proveedor A',
      values: { [cat.id]: { type: 'list', optionId: cat.options['Compras'] } },
    });
    expect(await nextSeqOf(t.driver, cash)).toBe(nextBefore);
    expect(await countRows(t.driver, 'transactions')).toBe(1);
    expect((await t.cuadra.transactions.duplicate(value.id, { date: '2026-06-01' })).date).toBe('2026-06-01');

    const bank = await seedAccount(t, ws, { name: 'Banco' });
    const tr = await t.cuadra.transactions.createTransfer({
      fromAccountId: cash, toAccountId: bank, amountMinor: 100, date: '2026-06-01', description: 'Depósito',
    });
    expect(await t.cuadra.transactions.duplicate(tr.value.in.id)).toEqual({
      fromAccountId: cash, toAccountId: bank, amountMinor: 100, date: '2026-06-15', description: 'Depósito', notes: '', values: {},
    });
  });
});
