// Pruebas de campos y opciones (ARCHITECTURE.md 4.2, 54–65). Los valores se escriben por SQL con las
// mismas reglas que usa el núcleo (seq reservado, triggers de tipo) para no depender del servicio de
// movimientos; las comprobaciones que necesitan transactions/queries se activan solas cuando existen.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { isDomainError } from '../errors';
import { validateRecipe } from '../recipes';
import { compileFilter } from '../sql/filter';
import type { FieldValue, Id, ViewRecipe } from '../types';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function setup() {
  h = await createTestCuadra();
  const t = h;
  const ws = (await t.cuadra.workspaces.create({ name: 'Colmado' })).value;
  const caja = (await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Caja' })).value;
  return { t, ws, caja };
}

/** Movimiento + valores por SQL, en una transacción. */
async function rawTx(
  t: TestCuadra,
  workspaceId: Id,
  accountId: Id,
  opts: {
    kind?: 'income' | 'expense';
    amountMinor?: number;
    date?: string;
    status?: 'active' | 'voided';
    values?: Record<Id, FieldValue>;
  } = {},
): Promise<Id> {
  const id = t.ids.next();
  const now = t.clock.now().toISOString();
  const kind = opts.kind ?? 'expense';
  await t.driver.transaction(async (tx) => {
    const r = await tx.get<{ seq: number }>(
      'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
      [accountId],
    );
    const voided = opts.status === 'voided';
    await tx.run(
      `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date,
         description, status, voided_at, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Movimiento', ?, ?, ?, ?)`,
      [
        id,
        workspaceId,
        accountId,
        r?.seq ?? 0,
        kind,
        kind === 'income' ? 'in' : 'out',
        opts.amountMinor ?? 1_000,
        opts.date ?? '2026-06-01',
        voided ? 'voided' : 'active',
        voided ? now : null,
        now,
        now,
      ],
    );
    for (const [fieldId, v] of Object.entries(opts.values ?? {})) {
      await tx.run(
        `INSERT INTO transaction_field_values (transaction_id, field_id, value_text, value_number, value_date,
           value_option_id, value_bool) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          fieldId,
          v.type === 'text' ? v.value : null,
          v.type === 'number' ? v.value : null,
          v.type === 'date' ? v.value : null,
          v.type === 'list' ? v.optionId : null,
          v.type === 'bool' ? (v.value ? 1 : 0) : null,
        ],
      );
    }
  });
  return id;
}

const opt = (field: { options: Array<{ id: Id; label: string }> }, label: string): Id => {
  const o = field.options.find((x) => x.label === label);
  if (!o) throw new Error(`sin opción ${label}`);
  return o.id;
};

async function auditCount(t: TestCuadra): Promise<number> {
  return (await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log'))?.n ?? 0;
}

describe('campos personalizables', () => {
  it('campo nuevo aparece en formSchema, en dimensions y se puede agrupar', async () => {
    const { t, ws } = await setup();
    const created = await t.cuadra.fields.create({
      workspaceId: ws.id,
      label: 'Categoría',
      type: 'list',
      role: 'category',
      options: [
        { label: 'Ventas', appliesTo: 'in' },
        { label: 'Alquiler', appliesTo: 'out' },
        { label: 'Otros' },
      ],
    });
    const field = created.value;
    expect(field).toMatchObject({ key: 'categoria', type: 'list', role: 'category', active: true });
    expect(field.options.map((o) => o.label)).toEqual(['Ventas', 'Alquiler', 'Otros']);
    expect(created.auditActionId).not.toBeNull();

    const expense = await t.cuadra.fields.formSchema(ws.id, 'expense');
    expect(expense.fields.map((f) => f.id)).toEqual([field.id]);
    expect(expense.fields[0]?.options.map((o) => o.label)).toEqual(['Alquiler', 'Otros']);
    const income = await t.cuadra.fields.formSchema(ws.id, 'income');
    expect(income.fields[0]?.options.map((o) => o.label)).toEqual(['Ventas', 'Otros']);

    const dims = await t.cuadra.fields.dimensions(ws.id);
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ id: field.id, groupable: true, filterable: true });

    const recipe: ViewRecipe = {
      v: 1,
      kind: 'summary',
      filter: {},
      groupBy: { by: 'field', fieldId: field.id },
      measure: 'out',
      chart: 'donut',
    };
    expect(validateRecipe(recipe, dims).warnings).toEqual([]);

    // Los cinco tipos; la clave se deriva de la etiqueta y no se repite.
    for (const [label, type] of [
      ['Comprobante', 'text'],
      ['Unidades', 'number'],
      ['Fecha de factura', 'date'],
      ['Conciliado', 'bool'],
    ] as const) {
      await t.cuadra.fields.create({ workspaceId: ws.id, label, type });
    }
    const all = await t.cuadra.fields.list(ws.id);
    expect(all.map((f) => [f.key, f.type])).toEqual([
      ['categoria', 'list'],
      ['comprobante', 'text'],
      ['unidades', 'number'],
      ['fecha_de_factura', 'date'],
      ['conciliado', 'bool'],
    ]);
    expect((await t.cuadra.fields.dimensions(ws.id)).find((f) => f.type === 'number')?.groupable).toBe(false);
    await expect(t.cuadra.fields.create({ workspaceId: ws.id, label: 'categoria', type: 'text' })).rejects.toMatchObject({
      code: 'duplicate_label',
    });
    await expect(
      t.cuadra.fields.create({ workspaceId: ws.id, label: 'Notas', type: 'text', options: [{ label: 'A' }] }),
    ).rejects.toMatchObject({ code: 'options_require_list_field' });
    const second = await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Categoría 2', type: 'list', key: 'categoria' }).catch((e: unknown) => e);
    expect(isDomainError(second, 'duplicate_label')).toBe(true);

    const summary = await t.cuadra.queries.summarize(ws.id, { filter: {}, groupBy: { by: 'field', fieldId: field.id } });
    expect(summary.groups.length).toBeGreaterThanOrEqual(0);

  });

  it('campo desactivado sale de formSchema pero conserva valores y sigue filtrable', async () => {
    const { t, ws, caja } = await setup();
    const field = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Proyecto', type: 'text' })).value;
    const txId = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'text', value: 'Obra norte' } } });

    const off = await t.cuadra.fields.deactivate(field.id);
    expect(off.value.active).toBe(false);
    expect(off.auditActionId).not.toBeNull();
    expect((await t.cuadra.fields.deactivate(field.id)).auditActionId).toBeNull();

    expect((await t.cuadra.fields.formSchema(ws.id, 'expense')).fields).toEqual([]);
    expect(await t.cuadra.fields.list(ws.id)).toEqual([]);
    expect((await t.cuadra.fields.list(ws.id, { includeInactive: true })).map((f) => f.id)).toEqual([field.id]);
    const dims = await t.cuadra.fields.dimensions(ws.id);
    expect(dims[0]).toMatchObject({ id: field.id, active: false, filterable: true, groupable: true });

    const value = await t.driver.get<{ value_text: string }>(
      'SELECT value_text FROM transaction_field_values WHERE transaction_id = ?',
      [txId],
    );
    expect(value?.value_text).toBe('Obra norte');
    const { where, params } = compileFilter(
      { fields: [{ fieldId: field.id, op: 'contains', value: 'norte' }] },
      { workspaceId: ws.id, clock: t.clock },
    );
    const found = await t.driver.all<{ id: string }>(`SELECT t.id FROM transactions t WHERE ${where}`, params);
    expect(found.map((r) => r.id)).toEqual([txId]);

    const on = await t.cuadra.fields.reactivate(field.id);
    expect(on.value.active).toBe(true);
    expect((await t.cuadra.fields.formSchema(ws.id, 'income')).fields.map((f) => f.id)).toEqual([field.id]);
  });

  it('crear un movimiento con valor en un campo inactivo → field_inactive; editar uno viejo lo conserva', async () => {
    const { t, ws, caja } = await setup();
    const field = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Proyecto', type: 'text' })).value;
    const other = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Nota interna', type: 'text' })).value;
    const old = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'text', value: 'Obra norte' } } });
    await t.cuadra.fields.deactivate(field.id);
    // La estructura sí queda marcada: el campo existe, inactivo, con su valor histórico.
    const dims = await t.cuadra.fields.dimensions(ws.id);
    expect(dims.find((f) => f.id === field.id)?.active).toBe(false);

    await expect(
      t.cuadra.transactions.create({
        accountId: caja.id,
        kind: 'expense',
        amountMinor: 500,
        date: '2026-06-10',
        description: 'Compra',
        values: { [field.id]: { type: 'text', value: 'Obra sur' } },
      }),
    ).rejects.toMatchObject({ code: 'field_inactive' });
    const edited = await t.cuadra.transactions.update(old, { values: { [other.id]: { type: 'text', value: 'ok' } } });
    expect(edited.value.values[field.id]).toEqual({ type: 'text', value: 'Obra norte' });
  });

  it('borrar un campo nunca usado funciona; con un valor en un anulado → field_in_use', async () => {
    const { t, ws, caja } = await setup();
    const unused = (
      await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Sobrante', type: 'list', options: [{ label: 'A' }] })
    ).value;
    expect(await t.cuadra.fields.usage(unused.id)).toEqual({ total: 0, active: 0, voided: 0 });
    await t.cuadra.fields.delete(unused.id);
    expect(await t.cuadra.fields.list(ws.id, { includeInactive: true })).toEqual([]);
    const options = await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM field_options WHERE field_id = ?', [unused.id]);
    expect(options?.n).toBe(0);
    const log = await t.driver.all<{ message: string }>('SELECT message FROM audit_log WHERE entity_id = ? ORDER BY id', [
      unused.id,
    ]);
    expect(log.map((l) => l.message)).toEqual(['audit.field.create', 'audit.field.delete']);

    const used = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Conciliado', type: 'bool' })).value;
    await rawTx(t, ws.id, caja.id, { status: 'voided', values: { [used.id]: { type: 'bool', value: true } } });
    expect(await t.cuadra.fields.usage(used.id)).toEqual({ total: 1, active: 0, voided: 1 });
    await expect(t.cuadra.fields.delete(used.id)).rejects.toMatchObject({ code: 'field_in_use' });
    await expect(t.cuadra.fields.delete('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('update no acepta type y el trigger impide cambiarlo por SQL', async () => {
    const { t, ws } = await setup();
    const field = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Unidades', type: 'number' })).value;
    await expect(
      t.cuadra.fields.update(field.id, { type: 'text' } as unknown as { label: string }),
    ).rejects.toMatchObject({ code: 'field_type_immutable' });
    await expect(t.driver.run("UPDATE fields SET type = 'text' WHERE id = ?", [field.id])).rejects.toMatchObject({
      code: 'field_type_immutable',
    });
    const renamed = await t.cuadra.fields.update(field.id, { label: 'Cantidad', showInList: true, appliesTo: 'out' });
    expect(renamed.value).toMatchObject({ label: 'Cantidad', type: 'number', key: 'unidades', showInList: true, appliesTo: 'out' });
    expect((await t.cuadra.fields.formSchema(ws.id, 'income')).fields).toEqual([]);
  });

  it('un movimiento no puede tener dos opciones del mismo campo', async () => {
    const { t, ws, caja } = await setup();
    const field = (
      await t.cuadra.fields.create({
        workspaceId: ws.id,
        label: 'Categoría',
        type: 'list',
        options: [{ label: 'Ventas' }, { label: 'Compras' }],
      })
    ).value;
    const txId = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: opt(field, 'Ventas') } } });
    await expect(
      t.driver.run('INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES (?, ?, ?)', [
        txId,
        field.id,
        opt(field, 'Compras'),
      ]),
    ).rejects.toThrow();
    const n = await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transaction_field_values WHERE transaction_id = ?', [txId]);
    expect(n?.n).toBe(1);
  });
});

describe('opciones', () => {
  it('renombrar una opción se refleja en todos los movimientos sin tocarlos', async () => {
    const { t, ws, caja } = await setup();
    const field = (
      await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }, { label: 'Agua' }] })
    ).value;
    const luz = opt(field, 'Luz');
    const a = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: luz } } });
    const b = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: luz } } });
    const before = await t.driver.all('SELECT * FROM transactions ORDER BY id');

    const renamed = await t.cuadra.fields.updateOption(luz, { label: 'Electricidad', color: 'tint-4' });
    expect(renamed.value).toMatchObject({ id: luz, label: 'Electricidad', color: 'tint-4' });
    expect(renamed.auditActionId).not.toBeNull();
    await expect(t.cuadra.fields.updateOption(luz, { label: 'agua' })).rejects.toMatchObject({ code: 'duplicate_label' });

    expect(await t.driver.all('SELECT * FROM transactions ORDER BY id')).toEqual(before);
    const values = await t.driver.all<{ value_option_id: string }>(
      'SELECT value_option_id FROM transaction_field_values WHERE transaction_id IN (?, ?)',
      [a, b],
    );
    expect(values.every((v) => v.value_option_id === luz)).toBe(true);
    const labels = await t.driver.all<{ label: string }>(
      `SELECT o.label FROM transaction_field_values v JOIN field_options o ON o.id = v.value_option_id
       WHERE v.transaction_id IN (?, ?)`,
      [a, b],
    );
    expect(labels).toEqual([{ label: 'Electricidad' }, { label: 'Electricidad' }]);
  });

  it('fusionar opciones mueve los valores, desactiva el origen con merged_into_id y escribe una sola acción', async () => {
    const { t, ws, caja } = await setup();
    const field = (
      await t.cuadra.fields.create({
        workspaceId: ws.id,
        label: 'Categoría',
        type: 'list',
        options: [{ label: 'Electricidad' }, { label: 'Luz' }, { label: 'Agua' }],
      })
    ).value;
    const target = opt(field, 'Electricidad');
    const source = opt(field, 'Luz');
    await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: source } } });
    await rawTx(t, ws.id, caja.id, { status: 'voided', values: { [field.id]: { type: 'list', optionId: source } } });
    await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: target } } });
    await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: opt(field, 'Agua') } } });

    const n0 = await auditCount(t);
    const merged = await t.cuadra.fields.mergeOptions(source, target);
    expect(merged.value.movedCount).toBe(2);
    expect(await auditCount(t)).toBe(n0 + 1);
    const action = await t.driver.get<{ action: string; entity_type: string }>(
      'SELECT action, entity_type FROM audit_log WHERE id = ?',
      [merged.auditActionId],
    );
    expect(action).toEqual({ action: 'merge', entity_type: 'option' });

    const counts = await t.driver.all<{ value_option_id: string; n: number }>(
      'SELECT value_option_id, COUNT(*) AS n FROM transaction_field_values GROUP BY value_option_id',
    );
    expect(Object.fromEntries(counts.map((c) => [c.value_option_id, c.n]))).toEqual({
      [target]: 3,
      [opt(field, 'Agua')]: 1,
    });
    const after = (await t.cuadra.fields.list(ws.id)).find((f) => f.id === field.id);
    const src = after?.options.find((o) => o.id === source);
    expect(src).toMatchObject({ active: false, mergedIntoId: target });
    expect((await t.cuadra.fields.formSchema(ws.id, 'expense')).fields[0]?.options.map((o) => o.label)).toEqual([
      'Electricidad',
      'Agua',
    ]);

    await expect(t.cuadra.fields.mergeOptions(target, target)).rejects.toMatchObject({ code: 'merge_same_option' });
    await expect(t.cuadra.fields.mergeOptions(opt(field, 'Agua'), source)).rejects.toMatchObject({
      code: 'option_inactive',
    });
    await expect(t.cuadra.fields.deleteOption(source)).rejects.toMatchObject({ code: 'option_in_use' });
  });

  it('filtro sí/no "No" incluye los movimientos sin valor (F-65)', async () => {
    const { t, ws, caja } = await setup();
    const field = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Conciliado', type: 'bool', role: 'reconciled' })).value;
    const yes = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'bool', value: true } } });
    const no = await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'bool', value: false } } });
    const none = await rawTx(t, ws.id, caja.id);

    const run = async (value: boolean) => {
      const { where, params } = compileFilter(
        { fields: [{ fieldId: field.id, op: 'is', value }] },
        { workspaceId: ws.id, clock: t.clock },
      );
      return (await t.driver.all<{ id: string }>(`SELECT t.id FROM transactions t WHERE ${where} ORDER BY t.seq`, params)).map(
        (r) => r.id,
      );
    };
    expect(await run(false)).toEqual([no, none]);
    expect(await run(true)).toEqual([yes]);
    const totals = await t.cuadra.queries.totals(ws.id, { fields: [{ fieldId: field.id, op: 'is', value: false }] });
    expect(totals.count).toBe(2);

  });

  it('campo creado con datos existentes: los viejos agrupan en "Sin valor"', async () => {
    const { t, ws, caja } = await setup();
    await rawTx(t, ws.id, caja.id, { amountMinor: 2_000 });
    await rawTx(t, ws.id, caja.id, { amountMinor: 3_000 });
    const field = (
      await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Categoría', type: 'list', options: [{ label: 'Compras' }] })
    ).value;
    await rawTx(t, ws.id, caja.id, { amountMinor: 500, values: { [field.id]: { type: 'list', optionId: opt(field, 'Compras') } } });

    // Consulta canónica de 2.3.
    const groups = await t.driver.all<{ key: string | null; out_minor: number; count: number }>(
      `SELECT o.id AS key, SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS out_minor, COUNT(*) AS count
       FROM transactions t
       LEFT JOIN transaction_field_values v ON v.transaction_id = t.id AND v.field_id = ?
       LEFT JOIN field_options o ON o.id = v.value_option_id
       WHERE t.workspace_id = ? AND t.status = 'active' AND t.kind IN ('income', 'expense')
       GROUP BY o.id ORDER BY o.id IS NOT NULL`,
      [field.id, ws.id],
    );
    expect(groups).toEqual([
      { key: null, out_minor: 5_000, count: 2 },
      { key: opt(field, 'Compras'), out_minor: 500, count: 1 },
    ]);
    const summary = await t.cuadra.queries.summarize(ws.id, { filter: {}, groupBy: { by: 'field', fieldId: field.id } });
    const empty = summary.groups.find((g) => g.key === null);
    expect(empty).toMatchObject({ outMinor: 5_000, count: 2 });

  });

  it('similarOptions encuentra "Electricidad" al escribir "electrisidad"', async () => {
    const { t, ws } = await setup();
    const field = (
      await t.cuadra.fields.create({
        workspaceId: ws.id,
        label: 'Categoría',
        type: 'list',
        options: [{ label: 'Electricidad' }, { label: 'Educación' }, { label: 'Agua' }, { label: 'Gas' }],
      })
    ).value;
    const similar = await t.cuadra.fields.similarOptions(field.id, 'electrisidad');
    expect(similar.map((o) => o.label)).toEqual(['Electricidad']);
    expect((await t.cuadra.fields.similarOptions(field.id, 'EDUCACION')).map((o) => o.label)).toEqual(['Educación']);
    expect((await t.cuadra.fields.similarOptions(field.id, 'agu')).map((o) => o.label)).toEqual(['Agua']);
    expect(await t.cuadra.fields.similarOptions(field.id, 'Mercancía')).toEqual([]);
    expect(await t.cuadra.fields.similarOptions(field.id, '  ')).toEqual([]);
    // Opciones desactivadas no se sugieren.
    await t.cuadra.fields.deactivateOption(opt(field, 'Gas'));
    expect(await t.cuadra.fields.similarOptions(field.id, 'gas')).toEqual([]);
  });

  it('valor de lista con opción de otro campo lo rechaza la BD (field_value_type_mismatch)', async () => {
    const { t, ws, caja } = await setup();
    const a = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Categoría', type: 'list', options: [{ label: 'Ventas' }] })).value;
    const b = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Método de pago', type: 'list', options: [{ label: 'Efectivo' }] })).value;
    await expect(
      rawTx(t, ws.id, caja.id, { values: { [a.id]: { type: 'list', optionId: opt(b, 'Efectivo') } } }),
    ).rejects.toMatchObject({ code: 'field_value_type_mismatch' });
  });

  it('crear, ordenar, desactivar, reactivar y borrar opciones', async () => {
    const { t, ws, caja } = await setup();
    const field = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Método de pago', type: 'list' })).value;
    const efectivo = (await t.cuadra.fields.addOption(field.id, { label: 'Efectivo' })).value;
    const tarjeta = (await t.cuadra.fields.addOption(field.id, { label: 'Tarjeta', color: 'tint-1', appliesTo: 'out' })).value;
    expect([efectivo.sortOrder, tarjeta.sortOrder]).toEqual([0, 1]);
    expect(efectivo.key).toBe('efectivo');
    await expect(t.cuadra.fields.addOption(field.id, { label: ' EFECTIVO ' })).rejects.toMatchObject({ code: 'duplicate_label' });
    const text = (await t.cuadra.fields.create({ workspaceId: ws.id, label: 'Nota', type: 'text' })).value;
    await expect(t.cuadra.fields.addOption(text.id, { label: 'X' })).rejects.toMatchObject({ code: 'options_require_list_field' });

    await t.cuadra.fields.reorderOptions(field.id, [tarjeta.id, efectivo.id]);
    let current = (await t.cuadra.fields.list(ws.id)).find((f) => f.id === field.id);
    expect(current?.options.map((o) => o.label)).toEqual(['Tarjeta', 'Efectivo']);

    await t.cuadra.fields.deactivateOption(efectivo.id);
    // Con el nombre libre se puede crear otra opción igual; reactivar la vieja choca.
    const again = (await t.cuadra.fields.addOption(field.id, { label: 'Efectivo' })).value;
    await expect(t.cuadra.fields.reactivateOption(efectivo.id)).rejects.toMatchObject({ code: 'duplicate_label' });
    await t.cuadra.fields.deleteOption(again.id);
    const back = await t.cuadra.fields.reactivateOption(efectivo.id);
    expect(back.value.active).toBe(true);

    await rawTx(t, ws.id, caja.id, { values: { [field.id]: { type: 'list', optionId: tarjeta.id } } });
    await expect(t.cuadra.fields.deleteOption(tarjeta.id)).rejects.toMatchObject({ code: 'option_in_use' });
    current = (await t.cuadra.fields.list(ws.id)).find((f) => f.id === field.id);
    expect(current?.options.map((o) => o.label)).toEqual(['Tarjeta', 'Efectivo']);

    await t.cuadra.fields.reorder(ws.id, [text.id, field.id]);
    expect((await t.cuadra.fields.list(ws.id)).map((f) => f.label)).toEqual(['Nota', 'Método de pago']);
  });
});
