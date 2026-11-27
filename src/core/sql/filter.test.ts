import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { buildSearchText } from '../text';
import type { TxFilter, TxKind } from '../types';
import { compileFilter } from './filter';

// Datos mínimos escritos con SQL directo sobre el esquema real (001_init.sql) para probar el SQL compilado.
let h: TestCuadra;
const NOW = '2026-06-15T12:00:00.000Z';
const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const CAJA = 'acc-caja';
const BANCO = 'acc-banco';
const AJENA = 'acc-ajena';
const F = { cat: 'f-cat', conc: 'f-conc', ref: 'f-ref', qty: 'f-qty', due: 'f-due' };
const O = { ventas: 'o-ventas', compras: 'o-compras', luz: 'o-luz' };

interface Seed {
  id: string;
  account: string;
  kind: TxKind;
  amount: number;
  date: string;
  description: string;
  notes?: string;
  status?: 'active' | 'voided';
  batch?: string;
  group?: string;
  values?: Partial<Record<keyof typeof F, string | number | boolean>>;
}

const TXS: Seed[] = [
  { id: 't1', account: CAJA, kind: 'opening', amount: 1500000, date: '2026-01-01', description: 'Saldo inicial' },
  { id: 't2', account: CAJA, kind: 'income', amount: 320000, date: '2026-06-01', description: 'Ventas del día', values: { cat: O.ventas, conc: true } },
  { id: 't3', account: CAJA, kind: 'expense', amount: 45000, date: '2026-06-03', description: 'Café y azúcar', notes: 'Colmado 100% local', values: { cat: O.compras, ref: 'B0100000123', qty: 3 } },
  { id: 't4', account: BANCO, kind: 'expense', amount: 980000, date: '2026-06-05', description: 'Pago electricidad', values: { cat: O.luz, conc: false, due: '2026-06-10' } },
  { id: 't5', account: BANCO, kind: 'income', amount: 120000, date: '2026-05-20', description: 'Cobro factura', batch: 'b1', values: { cat: O.ventas, qty: 10 } },
  { id: 't6', account: CAJA, kind: 'expense', amount: 5000, date: '2026-06-10', description: 'Cafe molido', status: 'voided' },
  { id: 't7', account: CAJA, kind: 'transfer', amount: 200000, date: '2026-06-12', description: 'Depósito', group: 'g1' },
  { id: 't8', account: BANCO, kind: 'transfer', amount: 200000, date: '2026-06-12', description: 'Depósito', group: 'g1' },
  { id: 't9', account: AJENA, kind: 'income', amount: 777, date: '2026-06-02', description: 'Café de otro espacio' },
];

async function seed(): Promise<void> {
  const d = h.driver;
  for (const [id, name] of [[WS, 'Colmado'], [OTHER_WS, 'Otro']] as const) {
    await d.run('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, name, NOW, NOW]);
  }
  for (const [id, ws, name] of [[CAJA, WS, 'Caja'], [BANCO, WS, 'Banco'], [AJENA, OTHER_WS, 'Caja']] as const) {
    await d.run('INSERT INTO accounts (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, ws, name, NOW, NOW]);
  }
  await d.run("INSERT INTO batches (id, workspace_id, account_id, source, created_at) VALUES ('b1', ?, ?, 'capture', ?)", [WS, BANCO, NOW]);
  const fields: Array<[string, string, string]> = [
    [F.cat, 'categoria', 'list'],
    [F.conc, 'conciliado', 'bool'],
    [F.ref, 'referencia', 'text'],
    [F.qty, 'unidades', 'number'],
    [F.due, 'vence', 'date'],
  ];
  for (const [id, key, type] of fields) {
    await d.run('INSERT INTO fields (id, workspace_id, key, label, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, WS, key, key, type, NOW, NOW]);
  }
  for (const [id, label] of [[O.ventas, 'Ventas'], [O.compras, 'Compras'], [O.luz, 'Electricidad']] as const) {
    await d.run('INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, F.cat, label, NOW, NOW]);
  }
  for (const t of TXS) {
    const ws = t.account === AJENA ? OTHER_WS : WS;
    const r = await d.get<{ seq: number }>('UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq', [t.account]);
    const direction = t.kind === 'income' || (t.kind === 'transfer' && t.account === BANCO) || t.kind === 'opening' ? 'in' : 'out';
    const voided = t.status === 'voided';
    await d.run(
      `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date, description, notes,
         search_text, status, voided_at, batch_id, transfer_group_id, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, ws, t.account, r?.seq ?? 0, t.kind, direction, t.amount, t.date, t.description, t.notes ?? '',
        buildSearchText(t.description, t.notes ?? ''), voided ? 'voided' : 'active', voided ? NOW : null,
        t.batch ?? null, t.group ?? null, NOW, NOW],
    );
    for (const [key, value] of Object.entries(t.values ?? {})) {
      const fieldId = F[key as keyof typeof F];
      const col = key === 'cat' ? 'value_option_id' : key === 'conc' ? 'value_bool' : key === 'qty' ? 'value_number' : key === 'due' ? 'value_date' : 'value_text';
      const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      await d.run(`INSERT INTO transaction_field_values (transaction_id, field_id, ${col}) VALUES (?, ?, ?)`, [t.id, fieldId, v]);
    }
  }
}

beforeAll(async () => {
  h = await createTestCuadra();
  await seed();
});
afterAll(async () => {
  await h.driver.close();
});

async function ids(filter: TxFilter): Promise<string[]> {
  const { where, params } = compileFilter(filter, { workspaceId: WS, clock: h.clock });
  const rows = await h.driver.all<{ id: string }>(`SELECT t.id FROM transactions t WHERE ${where} ORDER BY t.id`, params);
  return rows.map((r) => r.id);
}

describe('compileFilter', () => {
  it('sin criterios: solo el espacio y los activos', async () => {
    expect(await ids({})).toEqual(['t1', 't2', 't3', 't4', 't5', 't7', 't8']);
  });

  it('estado voided y all', async () => {
    expect(await ids({ status: 'voided' })).toEqual(['t6']);
    expect(await ids({ status: 'all' })).toHaveLength(8);
  });

  it('periodo por preset (relativo al reloj) y por rango', async () => {
    expect(await ids({ period: { preset: 'this_month' } })).toEqual(['t2', 't3', 't4', 't7', 't8']);
    expect(await ids({ period: { preset: 'last_month' } })).toEqual(['t5']);
    expect(await ids({ period: { from: '2026-06-03', to: '2026-06-05' } })).toEqual(['t3', 't4']);
    expect(await ids({ period: { to: '2026-01-31' } })).toEqual(['t1']);
  });

  it('cuentas, tipos, monto y lote', async () => {
    expect(await ids({ accountIds: [BANCO] })).toEqual(['t4', 't5', 't8']);
    expect(await ids({ kinds: ['expense', 'opening'] })).toEqual(['t1', 't3', 't4']);
    expect(await ids({ amount: { min: 100000, max: 500000 } })).toEqual(['t2', 't5', 't7', 't8']);
    expect(await ids({ batchId: 'b1' })).toEqual(['t5']);
    expect(await ids({ accountIds: [], kinds: [] })).toHaveLength(7);
  });

  it('texto ignora mayúsculas y tildes y exige todas las palabras', async () => {
    expect(await ids({ text: 'CAFE' })).toEqual(['t3']);
    expect(await ids({ text: 'café', status: 'all' })).toEqual(['t3', 't6']);
    expect(await ids({ text: 'cafe azucar' })).toEqual(['t3']);
    expect(await ids({ text: '100%' })).toEqual(['t3']);
    expect(await ids({ text: '_' })).toEqual([]);
  });

  it('campos: lista, vacío/no vacío, sí/no (sin valor = No), texto, número y fecha', async () => {
    expect(await ids({ fields: [{ fieldId: F.cat, op: 'any_of', optionIds: [O.ventas, O.luz] }] })).toEqual(['t2', 't4', 't5']);
    expect(await ids({ fields: [{ fieldId: F.cat, op: 'empty' }] })).toEqual(['t1', 't7', 't8']);
    expect(await ids({ fields: [{ fieldId: F.cat, op: 'not_empty' }] })).toEqual(['t2', 't3', 't4', 't5']);
    expect(await ids({ fields: [{ fieldId: F.conc, op: 'is', value: true }] })).toEqual(['t2']);
    expect(await ids({ fields: [{ fieldId: F.conc, op: 'is', value: false }] })).toEqual(['t1', 't3', 't4', 't5', 't7', 't8']);
    expect(await ids({ fields: [{ fieldId: F.ref, op: 'contains', value: 'b0100' }] })).toEqual(['t3']);
    expect(await ids({ fields: [{ fieldId: F.qty, op: 'between', min: 5 }] })).toEqual(['t5']);
    expect(await ids({ fields: [{ fieldId: F.qty, op: 'between' }] })).toEqual(['t3', 't5']);
    expect(await ids({ fields: [{ fieldId: F.due, op: 'date_between', from: '2026-06-01', to: '2026-06-30' }] })).toEqual(['t4']);
    expect(await ids({ fields: [{ fieldId: F.cat, op: 'any_of', optionIds: [] }] })).toHaveLength(7);
    expect(await ids({ fields: [{ fieldId: F.ref, op: 'contains', value: '  ' }] })).toHaveLength(7);
  });

  it('filtros combinados son AND', async () => {
    expect(
      await ids({
        accountIds: [CAJA],
        period: { preset: 'this_month' },
        kinds: ['expense'],
        fields: [{ fieldId: F.cat, op: 'any_of', optionIds: [O.compras] }],
        text: 'cafe',
        amount: { min: 1000 },
      }),
    ).toEqual(['t3']);
    expect(await ids({ accountIds: [CAJA], kinds: ['income'], text: 'cafe' })).toEqual([]);
  });

  it('nunca cruza espacios', async () => {
    const { where, params } = compileFilter({ text: 'café' }, { workspaceId: OTHER_WS, clock: h.clock });
    const rows = await h.driver.all(`SELECT t.id FROM transactions t WHERE ${where}`, params);
    expect(rows).toEqual([{ id: 't9' }]);
  });

  it('usa parámetros con nombre, alias y prefijo configurables, y valida el alias', () => {
    const c = compileFilter({ accountIds: [CAJA], text: "x' OR 1=1 --" }, { workspaceId: WS, clock: h.clock, alias: 'tx', paramPrefix: 'q' });
    expect(c.where).toBe("tx.workspace_id = :q0 AND tx.status = :q1 AND tx.account_id IN (:q2) AND tx.search_text LIKE :q3 ESCAPE '\\' AND tx.search_text LIKE :q4 ESCAPE '\\' AND tx.search_text LIKE :q5 ESCAPE '\\' AND tx.search_text LIKE :q6 ESCAPE '\\'");
    expect(c.params).toEqual({ q0: WS, q1: 'active', q2: CAJA, q3: "%x'%", q4: '%or%', q5: '%1=1%', q6: '%--%' });
    expect(() => compileFilter({}, { workspaceId: WS, clock: h.clock, alias: 't; DROP TABLE x' })).toThrow(RangeError);
  });
});
