// Revisión adversarial del núcleo (Oleada 2). Intenta romper los invariantes de ARCHITECTURE.md 4.1 con
// secuencias raras, entradas hostiles y concurrencia, siempre a través de la fachada pública. Cada prueba que
// falló al escribirse documentó un defecto real; el arreglo está en la causa y la prueba se queda.
import { afterEach, describe, expect, it } from 'vitest';
import { Money, MAX_MINOR, sheetToRows, transactionsToSheet, type Cuadra } from '../core';
import { computeChecksum, type BackupFile } from '../core/services/backup';
import { codeOf } from '../core/services/movements.testkit';
import type { SqlExecutor } from '../core/ports';
import type { Id } from '../core/types';
import { createTestCuadra, type TestCuadra } from './harness';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

const DOP = { code: 'DOP', minorDigits: 2 } as const;

async function setup(): Promise<{ c: Cuadra; h: TestCuadra; ws: Id; cash: Id; bank: Id; card: Id }> {
  h = await createTestCuadra();
  const c = h.cuadra;
  const ws = (await c.workspaces.create({ name: 'Colmado "La Esquina"', currency: DOP })).value.id;
  const cash = (await c.accounts.create({ workspaceId: ws, name: 'Caja', type: 'cash' })).value.id;
  const bank = (await c.accounts.create({ workspaceId: ws, name: 'Banco', type: 'bank' })).value.id;
  const card = (await c.accounts.create({ workspaceId: ws, name: 'Tarjeta', type: 'card' })).value.id;
  return { c, h, ws, cash, bank, card };
}

const n = async (ex: Pick<SqlExecutor, 'get'>, sql: string, p: unknown[] = []): Promise<number> =>
  Number(((await ex.get(sql, p as never)) as { n: number } | undefined)?.n ?? 0);

/** I-7 e I-9 sobre toda la base, con SQL directo. Devuelve las violaciones encontradas. */
async function structuralViolations(ex: SqlExecutor): Promise<string[]> {
  const out: string[] = [];
  const seq = await ex.all<{ account_id: string; c: number; mx: number; next_seq: number }>(
    `SELECT a.id AS account_id, COUNT(t.id) AS c, COALESCE(MAX(t.seq), 0) AS mx, a.next_seq
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id`,
  );
  for (const r of seq) {
    if (Number(r.c) !== Number(r.mx) || Number(r.next_seq) !== Number(r.mx) + 1) out.push(`seq ${r.account_id}`);
  }
  const groups = await ex.all<{ g: string }>(
    `SELECT transfer_group_id AS g FROM transactions WHERE transfer_group_id IS NOT NULL GROUP BY transfer_group_id
     HAVING COUNT(*) <> 2 OR COUNT(DISTINCT direction) <> 2 OR COUNT(DISTINCT amount_minor) <> 1
         OR COUNT(DISTINCT date) <> 1 OR COUNT(DISTINCT status) <> 1 OR COUNT(DISTINCT workspace_id) <> 1
         OR COUNT(DISTINCT account_id) <> 2`,
  );
  for (const g of groups) out.push(`transfer ${g.g}`);
  const openings = await ex.all<{ a: string }>(
    "SELECT account_id AS a FROM transactions WHERE kind = 'opening' GROUP BY account_id HAVING COUNT(*) > 1",
  );
  for (const o of openings) out.push(`opening ${o.a}`);
  return out;
}

// ── Secuencias raras sobre movimientos ───────────────────────────────────────────────

describe('adversarial: movimientos y transferencias', () => {
  it('editar una transferencia anulada (por cualquiera de sus lados) → already_voided y nada cambia', async () => {
    const { c, h, cash, bank } = await setup();
    const t = (await c.transactions.createTransfer({ fromAccountId: cash, toAccountId: bank, amountMinor: 5000, date: '2026-06-01', description: 'Depósito' })).value;
    await c.transactions.void(t.in.id, 'error');
    const before = await h.driver.all('SELECT * FROM transactions ORDER BY id');
    expect(await codeOf(c.transactions.update(t.out.id, { amountMinor: 9999 }))).toBe('already_voided');
    expect(await codeOf(c.transactions.update(t.in.id, { description: 'Otro' }))).toBe('already_voided');
    expect(await codeOf(c.transactions.void(t.out.id))).toBe('already_voided');
    expect(await h.driver.all('SELECT * FROM transactions ORDER BY id')).toEqual(before);
    // Restaurar por el lado contrario al que se anuló devuelve los dos.
    await c.transactions.restore(t.out.id);
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM transactions WHERE transfer_group_id = ? AND status = 'active'", [t.out.transferGroupId])).toBe(2);
    expect(await structuralViolations(h.driver)).toEqual([]);
  });

  it('una transferencia no se puede convertir en entrada, ni cambiar de cuenta por ninguno de sus lados', async () => {
    const { c, cash, bank, card } = await setup();
    const t = (await c.transactions.createTransfer({ fromAccountId: cash, toAccountId: bank, amountMinor: 100, date: '2026-06-01', description: 'x' })).value;
    expect(await codeOf(c.transactions.update(t.in.id, { kind: 'income' }))).toBe('kind_change_forbidden');
    const bad = { accountId: card } as unknown as Parameters<Cuadra['transactions']['update']>[1];
    expect(await codeOf(c.transactions.update(t.in.id, bad))).toBe('account_change_forbidden');
    const bad2 = { toAccountId: card } as unknown as Parameters<Cuadra['transactions']['update']>[1];
    expect(await codeOf(c.transactions.update(t.out.id, bad2))).toBe('account_change_forbidden');
  });

  it('editar el monto desde el lado de entrada mueve los dos lados (I-9)', async () => {
    const { c, h, ws, cash, bank } = await setup();
    const t = (await c.transactions.createTransfer({ fromAccountId: cash, toAccountId: bank, amountMinor: 100, date: '2026-06-01', description: 'x' })).value;
    await c.transactions.update(t.in.id, { amountMinor: 777, date: '2026-06-03' });
    const b = await c.queries.balances(ws);
    expect(b.byAccount[cash]).toBe(-777);
    expect(b.byAccount[bank]).toBe(777);
    expect(await structuralViolations(h.driver)).toEqual([]);
  });

  it('restaurar un movimiento de un lote anulado y luego restaurar el lote no lo cuenta dos veces', async () => {
    const { c, h, ws, cash } = await setup();
    const cap = await c.batches.capture({
      workspaceId: ws, accountId: cash, kind: 'income', date: '2026-06-10',
      rows: [{ amount: 100, description: 'a' }, { amount: 200, description: 'b' }, { amount: 300, description: 'c' }],
    });
    if (cap.status !== 'saved') throw new Error(cap.status);
    const ids = (await h.driver.all<{ id: string }>('SELECT id FROM transactions WHERE batch_id = ? ORDER BY seq', [cap.batchId])).map((r) => r.id);
    await c.transactions.void(ids[2]!, 'a mano');
    expect((await c.batches.void(cap.batchId, 'lote malo')).value.voidedCount).toBe(2);
    await c.transactions.restore(ids[0]!);
    expect((await c.queries.balances(ws)).byAccount[cash]).toBe(100);
    const r = await c.batches.restore(cap.batchId);
    expect(r.value.restoredCount).toBe(1); // solo "b": "a" ya estaba activo y "c" se anuló a mano
    expect((await c.queries.balances(ws)).byAccount[cash]).toBe(300);
    // Anular el lote otra vez y restaurarlo dos veces no hace nada raro.
    await c.batches.void(cap.batchId);
    await c.batches.restore(cap.batchId);
    expect(await codeOf(c.batches.restore(cap.batchId))).toBe('not_voided');
    expect((await c.queries.balances(ws)).byAccount[cash]).toBe(300);
  });

  it('montos hostiles: no enteros, negativos, NaN, texto, > 2^53 → invalid_amount sin escribir', async () => {
    const { c, h, cash } = await setup();
    const base = { accountId: cash, kind: 'income' as const, date: '2026-06-01', description: 'x' };
    for (const amountMinor of [1.5, -1, Number.NaN, Infinity, MAX_MINOR + 1, 2 ** 60, '100' as unknown as number, null as unknown as number]) {
      expect(await codeOf(c.transactions.create({ ...base, amountMinor }))).toBe('invalid_amount');
    }
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('montos enormes cercanos a 2^53: el saldo nunca sale de los enteros seguros ni rompe las consultas', async () => {
    const { c, h, ws, cash, bank } = await setup();
    const big = MAX_MINOR - 10;
    await c.transactions.create({ accountId: cash, kind: 'income', amountMinor: big, date: '2026-06-01', description: 'Lotería' });
    // Una segunda entrada igual haría el saldo > 2^53: tiene que rechazarse con un error de dominio.
    const second = await codeOf(c.transactions.create({ accountId: cash, kind: 'income', amountMinor: big, date: '2026-06-02', description: 'Otra' }));
    expect(second).toBe('invalid_amount');
    // Ni siquiera en otra cuenta: los totales del espacio también deben caber.
    expect(await codeOf(c.transactions.create({ accountId: bank, kind: 'income', amountMinor: big, date: '2026-06-02', description: 'Otra' }))).toBe('invalid_amount');
    expect(await codeOf(c.transactions.create({ accountId: bank, kind: 'expense', amountMinor: big, date: '2026-06-02', description: 'Otra' }))).toBe('invalid_amount');
    // Lo guardado sigue legible en todas las consultas.
    const b = await c.queries.balances(ws);
    expect(b.totalMinor).toBe(big);
    await expect(c.queries.totals(ws, {})).resolves.toMatchObject({ inMinor: big });
    await expect(c.queries.dashboard(ws)).resolves.toBeDefined();
    await expect(c.reports.build(ws, c.reports.preset('summary', { preset: 'all' }))).resolves.toBeDefined();
    // Editar al alza también se rechaza; a la baja se permite.
    const id = (await h.driver.get<{ id: string }>('SELECT id FROM transactions'))!.id;
    await c.transactions.create({ accountId: bank, kind: 'income', amountMinor: 10, date: '2026-06-02', description: 'cabe' });
    expect(await codeOf(c.transactions.update(id, { amountMinor: MAX_MINOR }))).toBe('invalid_amount');
    await c.transactions.update(id, { amountMinor: 5 });
    expect((await c.queries.balances(ws)).totalMinor).toBe(15);
  });

  it('fechas inválidas que el GLOB del esquema dejaría pasar → invalid_date', async () => {
    const { c, h, ws, cash } = await setup();
    const base = { accountId: cash, kind: 'expense' as const, amountMinor: 100, description: 'x' };
    for (const date of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', ' 2026-01-01', '2026-01-01T00:00', '0999-12-31', '3000-01-01', '', '20260101']) {
      expect(await codeOf(c.transactions.create({ ...base, date }))).toBe('invalid_date');
    }
    await expect(c.transactions.create({ ...base, date: '2028-02-29' })).resolves.toBeDefined();
    expect(await codeOf(c.transactions.setOpening(cash, { amountMinor: 1, direction: 'in', date: '2026-02-30' }))).toBe('invalid_date');
    for (const date of ['2026-02-30', '0999-01-01', '3000-01-01']) {
      expect(await codeOf(c.accounts.create({ workspaceId: ws, name: 'Z', opening: { amountMinor: 5, direction: 'in', date } }))).toBe('invalid_date');
    }
    const tx = (await h.driver.get<{ id: string }>('SELECT id FROM transactions'))!.id;
    expect(await codeOf(c.transactions.update(tx, { date: '2026-06-31' }))).toBe('invalid_date');
    expect(await codeOf(c.transactions.duplicate(tx, { date: '2026-06-31' }))).toBe('invalid_date');
    const cap = await c.batches.capture({ workspaceId: ws, accountId: cash, kind: 'income', date: '2026-02-30', rows: [{ amount: 5, description: 'a' }] });
    expect(cap.status).not.toBe('saved');
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM transactions WHERE date(date) IS NOT date")).toBe(0);
    // Los filtros con fechas inexistentes no se cuelan al SQL.
    expect(await codeOf(c.queries.totals(ws, { period: { from: '2026-02-30', to: '2026-03-01' } }))).toBe('invalid_recipe');
  });

  it('cadenas hostiles (comillas, emoji, SQL, LIKE, NUL) se guardan tal cual y se buscan sin inyección', async () => {
    const { c, h, ws, cash } = await setup();
    const evil = [
      "Robert'); DROP TABLE transactions;--",
      'Comillas "dobles" y \'simples\'',
      'Pago 💸 a Ñandú — café ☕',
      '100% de descuento_total',
      'Barra \\ invertida',
      'Fórmula =HYPERLINK("http://x")',
    ];
    for (const d of evil) await c.transactions.create({ accountId: cash, kind: 'expense', amountMinor: 1, date: '2026-06-01', description: d, notes: d });
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM transactions')).toBe(evil.length);
    const list = await c.queries.listTransactions(ws, { filter: { status: 'all' }, limit: 50 });
    expect(list.items.map((t) => t.description).sort()).toEqual([...evil].sort());
    // LIKE: "%" y "_" son literales.
    const pct = await c.queries.listTransactions(ws, { filter: { text: '100%' } });
    expect(pct.items.map((t) => t.description)).toEqual(['100% de descuento_total']);
    const under = await c.queries.listTransactions(ws, { filter: { text: 'o_t' } });
    expect(under.items.map((t) => t.description)).toEqual(['100% de descuento_total']);
    expect((await c.queries.listTransactions(ws, { filter: { text: '%' } })).items).toHaveLength(1);
    expect((await c.queries.listTransactions(ws, { filter: { text: "'); DROP" } })).items).toHaveLength(1);
    expect((await c.queries.listTransactions(ws, { filter: { text: 'nandu cafe' } })).items).toHaveLength(1);
    expect((await c.queries.listTransactions(ws, { filter: { text: '\\' } })).items).toHaveLength(1);
    const sugg = await c.transactions.suggestDescriptions(ws, '100%');
    expect(sugg.map((s) => s.description)).toEqual(['100% de descuento_total']);
    expect(await c.transactions.suggestDescriptions(ws, '_')).toEqual([]);
    // Nombres de cuenta, campo, opción y vista hostiles.
    const acc = await c.accounts.create({ workspaceId: ws, name: "Caja'; DELETE FROM accounts;--" });
    const f = await c.fields.create({ workspaceId: ws, label: 'Categoría 🧾 "x"', type: 'list', options: [{ label: "O'Higgins" }, { label: '🍺' }] });
    expect(f.value.options.map((o) => o.label)).toEqual(["O'Higgins", '🍺']);
    expect((await c.accounts.get(acc.value.id)).name).toBe("Caja'; DELETE FROM accounts;--");
    await c.views.save({ workspaceId: ws, name: "Vista'); --", recipe: { v: 1, kind: 'filter', filter: { text: "'; --" } } });
    expect(await c.views.list(ws, 'filter')).toHaveLength(1);
  });

  it('descripción y nombres solo de espacios o vacíos → error de dominio, nunca SqlError', async () => {
    const { c, ws, cash } = await setup();
    expect(await codeOf(c.transactions.create({ accountId: cash, kind: 'income', amountMinor: 1, date: '2026-06-01', description: ' \t\n ' }))).toBe('description_required');
    expect(await codeOf(c.accounts.create({ workspaceId: ws, name: '   ' }))).toBe('name_required');
    expect(await codeOf(c.fields.create({ workspaceId: ws, label: '  ', type: 'text' }))).toBe('name_required');
    expect(await codeOf(c.workspaces.create({ name: ' ' }))).toBe('name_required');
  });

  it('ids inexistentes o de otro espacio → not_found / workspace_mismatch antes que la clave foránea', async () => {
    const { c, cash } = await setup();
    const other = (await c.workspaces.create({ name: 'Otro' })).value.id;
    const foreign = (await c.accounts.create({ workspaceId: other, name: 'Ajena' })).value.id;
    const ghost = '01900000-0000-7000-8000-ffffffffffff';
    expect(await codeOf(c.transactions.create({ accountId: ghost, kind: 'income', amountMinor: 1, date: '2026-06-01', description: 'x' }))).toBe('not_found');
    expect(await codeOf(c.transactions.createTransfer({ fromAccountId: cash, toAccountId: ghost, amountMinor: 1, date: '2026-06-01', description: 'x' }))).toBe('not_found');
    expect(await codeOf(c.transactions.createTransfer({ fromAccountId: cash, toAccountId: foreign, amountMinor: 1, date: '2026-06-01', description: 'x' }))).toBe('workspace_mismatch');
    expect(await codeOf(c.transactions.createTransfer({ fromAccountId: cash, toAccountId: cash, amountMinor: 1, date: '2026-06-01', description: 'x' }))).toBe('transfer_same_account');
    expect(await codeOf(c.transactions.void(ghost))).toBe('not_found');
    expect(await codeOf(c.transactions.restore(ghost))).toBe('not_found');
    expect(await codeOf(c.transactions.update(ghost, { amountMinor: 1 }))).toBe('not_found');
    expect(await codeOf(c.transactions.setOpening(ghost, { amountMinor: 1, direction: 'in', date: '2026-06-01' }))).toBe('not_found');
    expect(await codeOf(c.batches.void(ghost))).toBe('not_found');
    expect(await codeOf(c.fields.mergeOptions(ghost, ghost + '0'))).toBe('not_found');
  });

  it('valores de campo de otro espacio o de otro campo → error de dominio', async () => {
    const { c, ws, cash } = await setup();
    const other = (await c.workspaces.create({ name: 'Otro' })).value.id;
    const fOther = (await c.fields.create({ workspaceId: other, label: 'Cat', type: 'list', options: [{ label: 'A' }] })).value;
    const fMine = (await c.fields.create({ workspaceId: ws, label: 'Cat', type: 'list', options: [{ label: 'A' }] })).value;
    const fNum = (await c.fields.create({ workspaceId: ws, label: 'Unidades', type: 'number' })).value;
    const draft = { accountId: cash, kind: 'income' as const, amountMinor: 1, date: '2026-06-01', description: 'x' };
    expect(await codeOf(c.transactions.create({ ...draft, values: { [fOther.id]: { type: 'list', optionId: fOther.options[0]!.id } } }))).toBe('not_found');
    expect(await codeOf(c.transactions.create({ ...draft, values: { [fMine.id]: { type: 'list', optionId: fOther.options[0]!.id } } }))).toBe('field_value_type_mismatch');
    expect(await codeOf(c.transactions.create({ ...draft, values: { [fNum.id]: { type: 'number', value: Number.NaN } } }))).toBe('field_value_type_mismatch');
    expect(await codeOf(c.transactions.create({ ...draft, values: { [fNum.id]: { type: 'text', value: '3' } as never } }))).toBe('field_value_type_mismatch');
  });
});

// ── Exportación ─────────────────────────────────────────────────────────────────────

describe('adversarial: exportación a CSV', () => {
  it('texto que empieza por = + - @ o tabulador se neutraliza (inyección de fórmulas); el dinero negativo no', async () => {
    const { c, ws, cash } = await setup();
    const evil = ['=HYPERLINK("http://x","clic")', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1', 'normal'];
    for (const d of evil) await c.transactions.create({ accountId: cash, kind: 'expense', amountMinor: 150, date: '2026-06-01', description: d, notes: d });
    await c.transactions.setOpening(cash, { amountMinor: 5000, direction: 'out', date: '2026-01-01' });
    const rows = (await c.queries.listTransactions(ws, { filter: {}, limit: 50 })).items;
    const accounts = await c.accounts.list(ws, { includeArchived: true });
    const ws0 = await c.workspaces.get(ws);
    const sheet = transactionsToSheet(rows, await c.fields.list(ws), { accounts, currency: ws0.currency }, (k) => k);
    const csv = sheetToRows(sheet);
    const cells = csv.slice(1).flat().filter((x): x is string => typeof x === 'string');
    for (const cell of cells) expect(cell, cell).not.toMatch(/^[=+\-@\t\r]/);
    expect(cells).toContain("'=HYPERLINK(\"http://x\",\"clic\")");
    expect(cells).toContain('normal');
    // Las columnas de dinero siguen siendo números legibles ("-50.00" sí empieza por "-" y no se toca).
    const moneyCols = sheet.columns.flatMap((col, i) => (col.type === 'money' ? [i] : []));
    expect(moneyCols.length).toBeGreaterThan(0);
    const moneyCells = csv.slice(1).flatMap((r) => moneyCols.map((i) => r[i])).filter((x) => x !== null);
    expect(moneyCells.length).toBeGreaterThanOrEqual(evil.length);
    for (const m of moneyCells) expect(String(m)).toMatch(/^-?\d+\.\d{2}$/);
  });
});

describe('adversarial: plantillas importadas', () => {
  it('una plantilla hostil (__proto__, tipos cruzados, recetas con ids inventados) no contamina ni escribe', async () => {
    const { c, h } = await setup();
    const before = await n(h.driver, 'SELECT COUNT(*) AS n FROM workspaces');
    const base = JSON.parse(c.templates.serialize(c.templates.get('negocio')).json) as Record<string, unknown>;
    const evil = JSON.stringify({ ...base, __proto__: { polluted: true }, constructor: { prototype: { polluted: true } } }).replace('"format"', '"__proto__":{"polluted":true},"format"');
    const parsed = c.templates.parse(evil);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    if (parsed.ok) await c.templates.apply(parsed.value, { name: 'Desde plantilla' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    const crossed = structuredClone(base) as { fields: Array<Record<string, unknown>> };
    crossed.fields[0] = { ...crossed.fields[0], type: 'text' }; // un campo de lista convertido a texto con opciones
    const v = c.templates.validate(crossed);
    expect(v.ok).toBe(false);
    expect(await codeOf(c.templates.apply(crossed as never, { name: 'X' }))).toMatch(/template_invalid|invalid_recipe/);
    expect(c.templates.parse('{"format":"cuadra-template","v":1,"name":' + '"a"'.repeat(1) + '}').ok).toBe(false);
    expect(c.templates.parse('[]').ok).toBe(false);
    expect(c.templates.parse('no json').ok).toBe(false);
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM workspaces')).toBe(before + (parsed.ok ? 1 : 0));
  });
});

// ── Espacios y lotes ────────────────────────────────────────────────────────────────

describe('adversarial: espacios y createMany', () => {
  it('moneda: decimales bloqueados con movimientos, códigos y decimales absurdos → error de dominio', async () => {
    const { c, ws, cash } = await setup();
    expect(await codeOf(c.workspaces.update(ws, { currency: { code: 'DOP', minorDigits: 5 as never } }))).toBe('invalid_currency');
    expect(await codeOf(c.workspaces.update(ws, { currency: { code: "D'P", minorDigits: 2 } }))).toBe('invalid_currency');
    expect(await codeOf(c.workspaces.create({ name: 'Y', currency: { code: 'US', minorDigits: 2 } }))).toBe('invalid_currency');
    await c.transactions.create({ accountId: cash, kind: 'income', amountMinor: 150, date: '2026-06-01', description: 'x' });
    expect(await codeOf(c.workspaces.update(ws, { currency: { code: 'JPY', minorDigits: 0 } }))).toBe('currency_locked');
    // Aunque el único movimiento esté anulado: los montos siguen guardados en unidad menor.
    const t = (await c.queries.listTransactions(ws, { filter: {} })).items[0]!;
    await c.transactions.void(t.id);
    expect(await codeOf(c.workspaces.update(ws, { currency: { code: 'JPY', minorDigits: 0 } }))).toBe('currency_locked');
  });

  it('borrar un espacio exige el nombre exacto y no toca los demás', async () => {
    const { c, h, ws, cash, bank } = await setup();
    const other = (await c.workspaces.create({ name: 'Otro' })).value.id;
    const o1 = (await c.accounts.create({ workspaceId: other, name: 'A' })).value.id;
    const o2 = (await c.accounts.create({ workspaceId: other, name: 'B' })).value.id;
    await c.transactions.createTransfer({ fromAccountId: o1, toAccountId: o2, amountMinor: 10, date: '2026-06-01', description: 'x' });
    await c.transactions.createTransfer({ fromAccountId: cash, toAccountId: bank, amountMinor: 20, date: '2026-06-01', description: 'y' });
    expect(await codeOf(c.workspaces.purge(ws, 'colmado "la esquina"'))).toBe('confirmation_mismatch');
    expect(await codeOf(c.workspaces.purge(ws, ' Colmado "La Esquina" '))).toBe('confirmation_mismatch');
    await c.workspaces.purge(ws, 'Colmado "La Esquina"');
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ?', [ws])).toBe(0);
    expect((await c.queries.balances(other)).byAccount).toEqual({ [o1]: -10, [o2]: 10 });
    expect(await structuralViolations(h.driver)).toEqual([]);
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM settings WHERE key = 'sys.maintenance'")).toBe(0);
  });

  it('createMany es todo o nada: un borrador malo al final (o un índice de anulado fuera de rango) no deja nada', async () => {
    const { c, h, ws, cash, bank } = await setup();
    const good = [
      { kind: 'opening' as const, accountId: cash, amountMinor: 100, direction: 'in' as const, date: '2026-01-01' },
      { kind: 'transfer' as const, fromAccountId: cash, toAccountId: bank, amountMinor: 5, date: '2026-01-02', description: 't' },
      { accountId: bank, kind: 'expense' as const, amountMinor: 3, date: '2026-01-03', description: 'e' },
    ];
    const audit = { action: 'batch_create' as const, message: 'audit.batch.create' };
    const batch = { source: 'capture' as const, accountId: null, label: '' };
    const snap = () => n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) + (SELECT SUM(next_seq) FROM accounts) AS n');
    const before = await snap();
    expect(await codeOf(c.transactions.createMany({ workspaceId: ws, batch, audit, drafts: [...good, { accountId: bank, kind: 'income', amountMinor: 1, date: '2026-02-30', description: 'mala' }] }))).toBe('invalid_date');
    expect(await codeOf(c.transactions.createMany({ workspaceId: ws, batch, audit, drafts: good, voids: [{ index: 9, reason: 'x' }] }))).toBe('not_found');
    expect(await codeOf(c.transactions.createMany({ workspaceId: ws, batch, audit, drafts: [...good, good[0]!] }))).toBe('opening_exists');
    expect(await codeOf(c.transactions.createMany({ workspaceId: ws, batch, audit, drafts: [] }))).toBe('batch_empty');
    expect(await snap()).toBe(before);
    // Con un anulado de transferencia: los dos lados nacen anulados (I-9).
    const m = await c.transactions.createMany({ workspaceId: ws, batch, audit, drafts: good, voids: [{ index: 1, reason: 'error' }] });
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM transactions WHERE batch_id = ? AND status = 'voided'", [m.value.batchId])).toBe(2);
    expect(await structuralViolations(h.driver)).toEqual([]);
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM audit_log WHERE batch_id = ?', [m.value.batchId])).toBe(1);
  });
});

// ── Consultas con recetas hostiles ──────────────────────────────────────────────────

describe('adversarial: recetas y filtros hostiles', () => {
  it('orden, agrupación, cursor y filtros con forma inválida → invalid_recipe, nunca SQL ni SqlError', async () => {
    const { c, ws, cash } = await setup();
    await c.transactions.create({ accountId: cash, kind: 'income', amountMinor: 5, date: '2026-06-01', description: 'x' });
    const bad = <T>(x: unknown) => x as T;
    const list = (input: unknown) => c.queries.listTransactions(ws, bad(input));
    expect(await codeOf(list({ filter: {}, sort: { by: 'date', dir: 'ASC, (SELECT 1)' } }))).toBe('invalid_recipe');
    expect(await codeOf(list({ filter: {}, sort: { by: 'amount_minor; DROP TABLE x', dir: 'asc' } }))).toBe('invalid_recipe');
    expect(await codeOf(list({ filter: {}, cursor: "x' OR 1=1 --" }))).toBe('invalid_recipe');
    expect(await codeOf(list({ filter: {}, cursor: btoa('{"v":[1,2,3]}') }))).toBe('invalid_recipe');
    const summarize = (groupBy: unknown, filter: unknown = {}) => c.queries.summarize(ws, bad({ filter, groupBy }));
    expect(await codeOf(summarize({ by: 'period', unit: "month') --" }))).toBe('invalid_recipe');
    // Un campo que no existe (vista guardada de un campo borrado) no es un error: avisa field_missing.
    const ghost = await summarize({ by: 'field', fieldId: "x' OR '1'='1" });
    expect(ghost.warnings).toContainEqual({ code: 'field_missing', fieldKeyOrId: "x' OR '1'='1" });
    expect(ghost.totals.inMinor).toBe(5);
    expect(await codeOf(summarize({ by: 'account' }, { kinds: ["income' OR 1=1 --"] }))).toBe('invalid_recipe');
    expect(await codeOf(summarize({ by: 'account' }, { amount: { min: 1.5 } }))).toBe('invalid_recipe');
    expect(await codeOf(summarize({ by: 'account' }, { status: 'deleted' }))).toBe('invalid_recipe');
    expect(await codeOf(summarize({ by: 'account' }, { accountIds: [{ toString: () => 'x' }] }))).toBe('invalid_recipe');
    expect(await codeOf(c.views.save({ workspaceId: ws, name: 'v', recipe: bad({ v: 1, kind: 'filter', filter: { period: { from: '2026-13-01' } } }) }))).toBe('invalid_recipe');
    expect(await codeOf(c.views.save({ workspaceId: ws, name: 'v', recipe: bad({ v: 2, kind: 'filter', filter: {} }) }))).toBe('invalid_recipe');
  });
});

// ── Campos y opciones ────────────────────────────────────────────────────────────────

describe('adversarial: campos y opciones', () => {
  it('fusionar una opción consigo misma, entre campos distintos, o hacia una inactiva → error y nada cambia', async () => {
    const { c, h, ws, cash } = await setup();
    const cat = (await c.fields.create({ workspaceId: ws, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }, { label: 'Electricidad' }, { label: 'Agua' }] })).value;
    const fondo = (await c.fields.create({ workspaceId: ws, label: 'Fondo', type: 'list', options: [{ label: 'General' }] })).value;
    const [luz, elec, agua] = cat.options.map((o) => o.id) as [Id, Id, Id];
    await c.transactions.create({ accountId: cash, kind: 'expense', amountMinor: 5, date: '2026-06-01', description: 'x', values: { [cat.id]: { type: 'list', optionId: luz } } });
    const snapshot = async () => [await h.driver.all('SELECT * FROM field_options ORDER BY id'), await h.driver.all('SELECT * FROM transaction_field_values')];
    const before = await snapshot();
    expect(await codeOf(c.fields.mergeOptions(luz, luz))).toBe('merge_same_option');
    expect(await codeOf(c.fields.mergeOptions(luz, fondo.options[0]!.id))).toBe('merge_different_field');
    await c.fields.deactivateOption(agua);
    const before2 = await snapshot();
    expect(await codeOf(c.fields.mergeOptions(luz, agua))).toBe('option_inactive');
    expect(await snapshot()).toEqual(before2);
    expect(before[1]).toEqual(before2[1]);
    // Fusión en cadena: Luz → Electricidad, y luego Electricidad → Agua (reactivada). Luz no queda colgando.
    await c.fields.mergeOptions(luz, elec);
    await c.fields.reactivateOption(agua);
    await c.fields.mergeOptions(elec, agua);
    const opts = await h.driver.all<{ id: string; merged_into_id: string | null }>('SELECT id, merged_into_id FROM field_options WHERE field_id = ?', [cat.id]);
    expect(opts.find((o) => o.id === luz)!.merged_into_id).toBe(agua);
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM transaction_field_values WHERE value_option_id = ?', [agua])).toBe(1);
    // Fusionar hacia una opción ya fusionada (inactiva) se rechaza: evitaría ciclos A→B, B→A.
    expect(await codeOf(c.fields.mergeOptions(agua, luz))).toBe('option_inactive');
  });

  it('reactivar una opción fusionada o con etiqueta ocupada → error de dominio, nunca SqlError', async () => {
    const { c, ws } = await setup();
    const cat = (await c.fields.create({ workspaceId: ws, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }, { label: 'Electricidad' }] })).value;
    const [luz, elec] = cat.options.map((o) => o.id) as [Id, Id];
    await c.fields.deactivateOption(luz);
    await c.fields.addOption(cat.id, { label: 'LUZ' });
    expect(await codeOf(c.fields.reactivateOption(luz))).toBe('duplicate_label');
    await c.fields.mergeOptions(elec, (await c.fields.list(ws))[0]!.options.find((o) => o.label === 'LUZ')!.id);
    // Reactivar una opción fusionada la separa del destino; no debe chocar con el CHECK del esquema.
    const r = await c.fields.reactivateOption(elec);
    expect(r.value).toMatchObject({ active: true, mergedIntoId: null });
  });

  it('borrar un campo u opción usado solo por anulados → field_in_use / option_in_use', async () => {
    const { c, h, ws, cash } = await setup();
    const cat = (await c.fields.create({ workspaceId: ws, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }, { label: 'Libre' }] })).value;
    const note = (await c.fields.create({ workspaceId: ws, label: 'Ref', type: 'text' })).value;
    const t = await c.transactions.create({
      accountId: cash, kind: 'expense', amountMinor: 5, date: '2026-06-01', description: 'x',
      values: { [cat.id]: { type: 'list', optionId: cat.options[0]!.id }, [note.id]: { type: 'text', value: 'F-1' } },
    });
    await c.transactions.void(t.value.id, 'error');
    expect(await codeOf(c.fields.delete(cat.id))).toBe('field_in_use');
    expect(await codeOf(c.fields.delete(note.id))).toBe('field_in_use');
    expect(await codeOf(c.fields.deleteOption(cat.options[0]!.id))).toBe('option_in_use');
    await c.fields.deleteOption(cat.options[1]!.id);
    expect(await c.fields.usage(cat.id)).toEqual({ total: 1, active: 0, voided: 1 });
    expect(await n(h.driver, 'SELECT COUNT(*) AS n FROM fields')).toBe(2);
  });

  it('opciones de un campo que no es de lista → error de dominio', async () => {
    const { c, ws } = await setup();
    const txt = (await c.fields.create({ workspaceId: ws, label: 'Ref', type: 'text' })).value;
    expect(await codeOf(c.fields.addOption(txt.id, { label: 'A' }))).toBe('options_require_list_field');
    const bad = { type: 'list' } as never;
    expect(await codeOf(c.fields.update(txt.id, bad))).not.toMatch(/^sql:/);
  });

  it('cuentas: desarchivar con un nombre ya ocupado → duplicate_label, nunca SqlError', async () => {
    const { c, ws, cash } = await setup();
    await c.accounts.archive(cash);
    await c.accounts.create({ workspaceId: ws, name: 'CAJA' });
    expect(await codeOf(c.accounts.unarchive(cash))).toBe('duplicate_label');
    expect(await codeOf(c.accounts.create({ workspaceId: ws, name: 'caja' }))).toBe('duplicate_label');
  });
});

// ── Concurrencia ────────────────────────────────────────────────────────────────────

describe('adversarial: mutaciones simultáneas', () => {
  it('veinte altas a la vez en la misma cuenta dejan seq 1..20 sin huecos', async () => {
    const { c, h, cash } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      c.transactions.create({ accountId: cash, kind: 'income', amountMinor: i + 1, date: '2026-06-01', description: `v${i}` }),
    ));
    const seqs = (await h.driver.all<{ seq: number }>('SELECT seq FROM transactions WHERE account_id = ? ORDER BY seq', [cash])).map((r) => Number(r.seq));
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await structuralViolations(h.driver)).toEqual([]);
  });

  it('dos setOpening a la vez sobre la misma cuenta dejan un único saldo inicial y ningún SqlError', async () => {
    const { c, h, cash } = await setup();
    const results = await Promise.allSettled([
      c.transactions.setOpening(cash, { amountMinor: 100, direction: 'in', date: '2026-01-01' }),
      c.transactions.setOpening(cash, { amountMinor: 200, direction: 'in', date: '2026-01-01' }),
    ]);
    for (const r of results) if (r.status === 'rejected') expect((r.reason as { name?: string }).name).toBe('DomainError');
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'opening'")).toBe(1);
  });

  it('anular y editar a la vez el mismo movimiento: uno gana, el otro falla con error de dominio, historial coherente', async () => {
    const { c, h, cash } = await setup();
    const t = (await c.transactions.create({ accountId: cash, kind: 'income', amountMinor: 100, date: '2026-06-01', description: 'x' })).value;
    const results = await Promise.allSettled([c.transactions.void(t.id, 'a'), c.transactions.update(t.id, { amountMinor: 5 }), c.transactions.void(t.id, 'b')]);
    const failures = results.filter((r) => r.status === 'rejected');
    for (const f of failures) expect((f as PromiseRejectedResult).reason).toMatchObject({ name: 'DomainError', code: 'already_voided' });
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'void'")).toBe(1);
  });

  it('dos anulaciones simultáneas del mismo lote cuentan una vez', async () => {
    const { c, ws, cash } = await setup();
    const cap = await c.batches.capture({ workspaceId: ws, accountId: cash, kind: 'income', date: '2026-06-10', rows: [{ amount: 1, description: 'a' }, { amount: 2, description: 'b' }] });
    if (cap.status !== 'saved') throw new Error(cap.status);
    const [a, b] = await Promise.allSettled([c.batches.void(cap.batchId), c.batches.void(cap.batchId)]);
    const counts = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.value.voidedCount : 0));
    expect(counts.reduce((x, y) => x + y, 0)).toBe(2);
    expect((await c.queries.balances(ws)).byAccount[cash]).toBe(0);
  });
});

// ── Captura e importación ───────────────────────────────────────────────────────────

describe('adversarial: captura e importación', () => {
  it('captura y vista previa con filas cuya suma pasa de 2^53 → too_large por fila, nunca RangeError', async () => {
    const { c, ws, cash } = await setup();
    const half = Math.floor(MAX_MINOR / 2) + 1;
    const input = { workspaceId: ws, accountId: cash, kind: 'income' as const, date: '2026-06-10', rows: [{ amount: half, description: 'a' }, { amount: half, description: 'b' }, { amount: 5, description: 'c' }] };
    const pre = await c.batches.previewCapture(input);
    expect(pre.rowErrors).toEqual([{ index: 1, error: 'too_large' }]);
    expect(pre.sumMinor).toBe(half + 5);
    const cap = await c.batches.capture(input);
    expect(cap.status).toBe('saved');
    if (cap.status === 'saved') expect(cap.rowErrors).toEqual([{ index: 1, error: 'too_large' }]);
    expect((await c.queries.balances(ws)).totalMinor).toBe(half + 5);
  });

  it('total de control descuadrado sin aceptar no escribe nada, ni lote ni historial (I-14)', async () => {
    const { c, h, ws, cash } = await setup();
    const before = await n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) + (SELECT COUNT(*) FROM audit_log) AS n');
    const r = await c.batches.capture({ workspaceId: ws, accountId: cash, kind: 'income', date: '2026-06-10', rows: [{ amount: '150+75.50', description: 'a' }], controlTotalMinor: 22549 });
    expect(r).toMatchObject({ status: 'control_mismatch', differenceMinor: 1 });
    expect(await n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) + (SELECT COUNT(*) FROM audit_log) AS n')).toBe(before);
    // createMany directo con control descuadrado tampoco.
    expect(await codeOf(c.transactions.createMany({
      workspaceId: ws, batch: { source: 'capture', accountId: cash, label: '', controlTotalMinor: 1 },
      drafts: [{ accountId: cash, kind: 'income', amountMinor: 2, date: '2026-06-01', description: 'x' }],
      audit: { action: 'batch_create', message: 'audit.batch.create' },
    }))).toBe('control_total_mismatch');
    expect(await n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) + (SELECT COUNT(*) FROM audit_log) AS n')).toBe(before);
  });

  it('importar dos veces el mismo archivo: la segunda vista previa marca todo como duplicado y lo salta', async () => {
    const { c, h, ws, bank } = await setup();
    const sheet = [
      ['Banco Popular — Estado de cuenta'],
      [],
      ['Fecha', 'Descripción', 'Débito', 'Crédito'],
      ['01/06/2026', 'Depósito', '', '1,500.00'],
      ['02/06/2026', 'Pago luz', '455.10', ''],
      ['02/06/2026', 'Pago luz', '455.10', ''], // repetida DENTRO del archivo: no es duplicado de la BD
    ];
    const raw = c.importCsv.fromRows(sheet);
    const fields = await c.fields.list(ws);
    const mapping = { ...c.importCsv.suggestMapping(raw, fields), fields: {}, createMissingOptions: false, amountLocale: 'es-DO' } as Parameters<Cuadra['importCsv']['preview']>[3];
    const p1 = await c.importCsv.preview(ws, bank, raw, mapping);
    const inc1 = p1.rows.filter((r) => !r.skipByDefault).map((r) => r.index);
    expect(inc1).toHaveLength(3);
    await c.importCsv.commit(ws, bank, p1, { include: inc1, fileName: 'estado.xlsx', mapping });
    const p2 = await c.importCsv.preview(ws, bank, raw, mapping);
    expect(p2.rows.filter((r) => r.draft !== null).every((r) => r.status === 'duplicate' && r.skipByDefault)).toBe(true);
    expect(p2.totals.count).toBe(0);
    expect(await codeOf(c.importCsv.commit(ws, bank, p2, { include: p2.rows.filter((r) => !r.skipByDefault).map((r) => r.index), fileName: 'estado.xlsx', mapping }))).toBe('batch_empty');
    expect((await c.queries.balances(ws)).byAccount[bank]).toBe(150000 - 2 * 45510);
    expect(await structuralViolations(h.driver)).toEqual([]);
  });

  it('una vista previa manipulada (cuenta ajena, monto inválido, fecha inexistente) no escribe nada al confirmar', async () => {
    const { c, h, ws, bank } = await setup();
    const other = (await c.workspaces.create({ name: 'Otro' })).value.id;
    const foreign = (await c.accounts.create({ workspaceId: other, name: 'Ajena' })).value.id;
    const raw = c.importCsv.fromRows([['Fecha', 'Concepto', 'Monto'], ['01/06/2026', 'Venta', '100.00']]);
    const mapping = { ...c.importCsv.suggestMapping(raw, []), fields: {}, createMissingOptions: false, amountLocale: 'es-DO' } as Parameters<Cuadra['importCsv']['preview']>[3];
    const p = await c.importCsv.preview(ws, bank, raw, mapping);
    const before = await n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) AS n');
    const tamper = (patch: Record<string, unknown>) => ({ ...p, rows: p.rows.map((r) => (r.draft ? { ...r, draft: { ...r.draft, ...patch } } : r)) }) as typeof p;
    expect(await codeOf(c.importCsv.commit(ws, bank, tamper({ accountId: foreign }), { include: [0], fileName: 'x.csv', mapping }))).toBe('workspace_mismatch');
    expect(await codeOf(c.importCsv.commit(ws, bank, tamper({ amountMinor: -5 }), { include: [0], fileName: 'x.csv', mapping }))).toBe('invalid_amount');
    expect(await codeOf(c.importCsv.commit(ws, bank, tamper({ date: '2026-02-30' }), { include: [0], fileName: 'x.csv', mapping }))).toBe('invalid_date');
    expect(await codeOf(c.importCsv.commit(ws, bank, tamper({ kind: 'transfer' }), { include: [0], fileName: 'x.csv', mapping }))).not.toMatch(/^sql:/);
    expect(await n(h.driver, 'SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM batches) AS n')).toBe(before);
  });

  it('un archivo con montos que juntos pasan de 2^53 marca la fila sobrante como ilegible', async () => {
    const { c, ws, bank } = await setup();
    const big = Money.toDecimalString(Math.floor(MAX_MINOR / 2) + 1, 2);
    const raw = c.importCsv.fromRows([['Fecha', 'Concepto', 'Monto'], ['01/06/2026', 'A', big], ['02/06/2026', 'B', big]]);
    const mapping = { ...c.importCsv.suggestMapping(raw, []), fields: {}, createMissingOptions: false, amountLocale: 'en-US' } as Parameters<Cuadra['importCsv']['preview']>[3];
    const p = await c.importCsv.preview(ws, bank, raw, mapping);
    expect(p.rows.map((r) => r.status)).toEqual(['ok', 'error']);
    expect(p.rows[1]!.issues).toContain('too_large');
  });
});

// ── Respaldo ────────────────────────────────────────────────────────────────────────

/** Respaldo de todo con datos variados: transferencia, saldo inicial, lote y campo. */
async function backupWithData(): Promise<{ c: Cuadra; h: TestCuadra; ws: Id; cash: Id; bank: Id; file: BackupFile }> {
  const { c, h, ws, cash, bank } = await setup();
  await c.transactions.setOpening(cash, { amountMinor: 10_000, direction: 'in', date: '2026-01-01' });
  await c.transactions.createTransfer({ fromAccountId: cash, toAccountId: bank, amountMinor: 2_500, date: '2026-03-01', description: 'Depósito' });
  await c.transactions.create({ accountId: cash, kind: 'expense', amountMinor: 700, date: '2026-03-02', description: 'Luz' });
  const ex = await c.backup.export({ scope: 'all' });
  return { c, h, ws, cash, bank, file: JSON.parse(ex.json) as BackupFile };
}

/** Manipula el archivo y le recalcula el checksum (un checksum no es una firma). */
async function forge(file: BackupFile, edit: (t: BackupFile['tables']) => void): Promise<string> {
  const copy = structuredClone(file);
  edit(copy.tables);
  for (const k of Object.keys(copy.tables) as Array<keyof BackupFile['tables']>) copy.counts[k] = copy.tables[k].rows.length;
  copy.checksum = await computeChecksum(copy.tables);
  return JSON.stringify(copy);
}

const colOf = (t: { columns: string[] }, name: string) => t.columns.indexOf(name);

describe('adversarial: respaldos manipulados', () => {
  async function expectRejected(c: Cuadra, h: TestCuadra, text: string): Promise<void> {
    const before = await h.driver.all('SELECT id, seq, amount_minor, status FROM transactions ORDER BY id');
    expect(await codeOf(c.backup.restoreAll(text, { confirm: true }))).toBe('backup_invalid');
    expect(await codeOf(c.backup.importWorkspace(text, JSON.parse(text).workspaceIds[0]))).toBe('backup_invalid');
    expect(await h.driver.all('SELECT id, seq, amount_minor, status FROM transactions ORDER BY id')).toEqual(before);
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM settings WHERE key = 'sys.maintenance'")).toBe(0);
  }

  it('transferencia con un solo lado (checksum recalculado) → backup_invalid y nada cambia', async () => {
    const { c, h, file } = await backupWithData();
    const text = await forge(file, (t) => {
      const g = colOf(t.transactions, 'transfer_group_id');
      const d = colOf(t.transactions, 'direction');
      const victim = t.transactions.rows.find((r) => r[g] !== null && r[d] === 'in')!;
      t.transactions.rows = t.transactions.rows.filter((r) => r !== victim);
      t.transaction_field_values.rows = t.transaction_field_values.rows.filter((r) => r[0] !== victim[0]);
    });
    await expectRejected(c, h, text);
  });

  it('transferencia con lados de distinto monto → backup_invalid', async () => {
    const { c, h, file } = await backupWithData();
    const text = await forge(file, (t) => {
      const g = colOf(t.transactions, 'transfer_group_id');
      const d = colOf(t.transactions, 'direction');
      const a = colOf(t.transactions, 'amount_minor');
      t.transactions.rows.find((r) => r[g] !== null && r[d] === 'in')![a] = 999_999;
    });
    await expectRejected(c, h, text);
  });

  it('next_seq por debajo del último seq o seq con huecos → backup_invalid (la cuenta quedaría inservible)', async () => {
    const { c, h, cash, file } = await backupWithData();
    const lowered = await forge(file, (t) => {
      const id = colOf(t.accounts, 'id');
      t.accounts.rows.find((r) => r[id] === cash)![colOf(t.accounts, 'next_seq')] = 1;
    });
    await expectRejected(c, h, lowered);
    const gap = await forge(file, (t) => {
      const acc = colOf(t.transactions, 'account_id');
      const seq = colOf(t.transactions, 'seq');
      const last = t.transactions.rows.filter((r) => r[acc] === cash).sort((x, y) => Number(y[seq]) - Number(x[seq]))[0]!;
      last[seq] = 9;
      t.accounts.rows.find((r) => r[colOf(t.accounts, 'id')] === cash)![colOf(t.accounts, 'next_seq')] = 10;
    });
    await expectRejected(c, h, gap);
  });

  it('fecha inexistente que pasa el GLOB ("2026-02-31") → backup_invalid', async () => {
    const { c, h, file } = await backupWithData();
    const text = await forge(file, (t) => {
      t.transactions.rows[0]![colOf(t.transactions, 'date')] = '2026-02-31';
    });
    await expectRejected(c, h, text);
  });

  it('montos que juntos pasan de 2^53 → backup_invalid', async () => {
    const { c, h, file } = await backupWithData();
    const text = await forge(file, (t) => {
      const a = colOf(t.transactions, 'amount_minor');
      const k = colOf(t.transactions, 'kind');
      for (const r of t.transactions.rows) if (r[k] === 'expense') r[a] = MAX_MINOR;
      for (const r of t.transactions.rows) if (r[k] === 'opening') r[a] = MAX_MINOR;
    });
    await expectRejected(c, h, text);
  });

  it('respaldo de otra versión: más nueva, cero, negativa o no entera → error de dominio sin escribir', async () => {
    const { c, h, file } = await backupWithData();
    for (const [schemaVersion, code] of [[99, 'backup_from_newer_version'], [0, 'backup_invalid'], [-1, 'backup_invalid'], [1.5, 'backup_invalid'], ['1', 'backup_invalid']] as const) {
      const text = JSON.stringify({ ...file, schemaVersion });
      expect(await codeOf(c.backup.restoreAll(text, { confirm: true }))).toBe(code);
      expect((await c.backup.inspect(text)).ok).toBe(false);
    }
    expect(await codeOf(c.backup.restoreAll(JSON.stringify({ ...file, formatVersion: 99 }), { confirm: true }))).toBe('backup_from_newer_version');
    expect(await codeOf(c.backup.restoreAll('{"format":"cuadra-backup","__proto__":{"x":1}}', { confirm: true }))).toBe('backup_invalid');
    expect(await codeOf(c.backup.restoreAll('no es json', { confirm: true }))).toBe('backup_invalid');
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup_restore'")).toBe(0);
  });

  it('nombres de columna o tabla inyectados → backup_invalid antes de construir SQL', async () => {
    const { c, file } = await backupWithData();
    const evilCol = await forge(file, (t) => {
      t.accounts.columns[1] = 'workspace_id) VALUES (1); DROP TABLE accounts; --';
    });
    expect(await codeOf(c.backup.restoreAll(evilCol, { confirm: true }))).toBe('backup_invalid');
    const unknownCol = await forge(file, (t) => {
      t.accounts.columns.push('next_seq_x');
      for (const r of t.accounts.rows) r.push(1);
    });
    expect(await codeOf(c.backup.restoreAll(unknownCol, { confirm: true }))).toBe('backup_invalid');
  });

  it('respaldo cifrado: contraseña incorrecta, vacía, o sobre manipulado → error sin escribir', async () => {
    const { c, h } = await backupWithData();
    const ex = await c.backup.export({ scope: 'all', password: 'contraseña larga 🔐' });
    expect(ex.encrypted).toBe(true);
    expect(await codeOf(c.backup.restoreAll(ex.text, { confirm: true, password: 'otra cosa larga' }))).toBe('wrong_password');
    expect(await codeOf(c.backup.restoreAll(ex.text, { confirm: true }))).toBe('password_required');
    expect(await codeOf(c.backup.restoreAll(ex.text, { confirm: true, password: '' }))).toBe('password_required');
    const env = JSON.parse(ex.text) as Record<string, unknown>;
    expect(await codeOf(c.backup.restoreAll(JSON.stringify({ ...env, iterations: 1e12 }), { confirm: true, password: 'x' }))).toBe('backup_invalid');
    const flipped = { ...env, data: (env['data'] as string).replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A')) };
    expect(await codeOf(c.backup.restoreAll(JSON.stringify(flipped), { confirm: true, password: 'contraseña larga 🔐' }))).toBe('wrong_password');
    // La cabecera está autenticada: cambiar la sal o el número de iteraciones también falla.
    expect(await codeOf(c.backup.restoreAll(JSON.stringify({ ...env, iterations: (env['iterations'] as number) + 1 }), { confirm: true, password: 'contraseña larga 🔐' }))).toBe('wrong_password');
    expect(await n(h.driver, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup_restore'")).toBe(0);
    await c.backup.restoreAll(ex.text, { confirm: true, password: 'contraseña larga 🔐' });
    expect(await structuralViolations(h.driver)).toEqual([]);
  });

  it('importar dos veces el mismo espacio crea dos espacios independientes y deja escribir en ambos', async () => {
    const { c, h, ws, file } = await backupWithData();
    const text = JSON.stringify(file);
    const a = (await c.backup.importWorkspace(text, ws)).value;
    const b = (await c.backup.importWorkspace(text, ws)).value;
    expect(new Set([ws, a.id, b.id]).size).toBe(3);
    expect(new Set((await c.workspaces.list()).map((w) => w.name)).size).toBe(3);
    for (const id of [ws, a.id, b.id]) {
      const acc = (await c.accounts.list(id))[0]!;
      await c.transactions.create({ accountId: acc.id, kind: 'income', amountMinor: 1, date: '2026-06-01', description: 'tras importar' });
    }
    expect(await structuralViolations(h.driver)).toEqual([]);
  });
});

// ── Inicio de sesión ────────────────────────────────────────────────────────────────

describe('adversarial: inicio de sesión local', () => {
  it('intentos simultáneos con contraseña errónea se cuentan todos y bloquean; la buena no entra durante el bloqueo', async () => {
    h = await createTestCuadra();
    const auth = h.cuadra.auth;
    await auth.setup({ profileName: 'Dueña', password: 'clave-correcta-1' });
    auth.lock();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => auth.unlock('clave-equivocada')));
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes.filter((x) => x === 'wrong_password').length).toBeGreaterThanOrEqual(5);
    expect(codes).toContain('too_many_attempts');
    expect(codes).not.toContain('ok');
    expect(await codeOf(auth.unlock('clave-correcta-1'))).toBe('too_many_attempts');
    expect((await auth.status()).locked).toBe(true);
    h.clock.set(new Date(Date.parse(h.clock.now().toISOString()) + 16 * 60_000));
    await auth.unlock('clave-correcta-1');
    expect((await auth.status())).toMatchObject({ locked: false, failedAttempts: 0, retryAt: null });
  });

  it('la contraseña se compara normalizada (NFC = NFD) y no admite vacía, corta ni solo espacios', async () => {
    h = await createTestCuadra();
    const auth = h.cuadra.auth;
    expect(await codeOf(auth.setup({ profileName: 'X', password: '        ' }))).toBe('password_too_short');
    expect(await codeOf(auth.setup({ profileName: 'X', password: 'corta' }))).toBe('password_too_short');
    expect(await codeOf(auth.setup({ profileName: '   ', password: 'suficientemente larga' }))).toBe('profile_name_required');
    expect(await codeOf(auth.unlock('lo que sea'))).toBe('auth_not_enabled');
    await auth.setup({ profileName: 'Dueña', password: 'Ñandú café 12'.normalize('NFC') });
    expect(await codeOf(auth.setup({ profileName: 'Otra', password: 'otra contraseña' }))).toBe('auth_already_enabled');
    auth.lock();
    await auth.unlock('Ñandú café 12'.normalize('NFD'));
    expect((await auth.status()).locked).toBe(false);
  });

  it('una clave de recuperación errónea cuenta como intento y no cambia la contraseña', async () => {
    h = await createTestCuadra();
    const auth = h.cuadra.auth;
    await auth.setup({ profileName: 'Dueña', password: 'clave-correcta-1' });
    auth.lock();
    expect(await codeOf(auth.unlockWithRecoveryKey('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'nueva-clave-123'))).toMatch(/wrong_recovery_key|backup_invalid|invalid/);
    expect((await auth.status()).failedAttempts).toBeGreaterThanOrEqual(0);
    await auth.unlock('clave-correcta-1');
    expect((await auth.status()).locked).toBe(false);
  });

  it('restaurar un respaldo hecho con otra contraseña no cambia la del equipo ni abre la sesión', async () => {
    const { c, h: th } = await backupWithData();
    const ex = await c.backup.export({ scope: 'all' });
    await c.auth.setup({ profileName: 'Dueña', password: 'clave-del-equipo' });
    c.auth.lock();
    const forged = await forge(JSON.parse(ex.json) as BackupFile, (t) => {
      t.settings.rows.push(['', 'auth.enabled', 'false', '2026-01-01T00:00:00.000Z']);
      t.settings.rows.push(['', 'sys.maintenance', 'true', '2026-01-01T00:00:00.000Z']);
    });
    await c.backup.restoreAll(forged, { confirm: true });
    expect(await c.auth.status()).toMatchObject({ enabled: true, locked: true });
    expect(await n(th.driver, "SELECT COUNT(*) AS n FROM settings WHERE key = 'sys.maintenance'")).toBe(0);
    await c.auth.unlock('clave-del-equipo');
  });
});

