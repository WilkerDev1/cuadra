// Rendimiento con 20 000 movimientos (node:sqlite en memoria). El objetivo es "pocas decenas de ms" por
// llamada; el umbral de la prueba es holgado para no fallar en máquinas lentas o con la CI cargada, y los
// tiempos reales se imprimen. También comprueba que las consultas calientes usan índices.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { addDays } from '../dates';
import type { SqlValue } from '../ports';
import { insertSql, recordValues } from '../sql/rows';
import { buildSearchText } from '../text';
import type { Id } from '../types';
import { ledgerFixture, prng } from './ledger.fixture';

const N = 20_000;
const BUDGET_MS = 150;

let h: TestCuadra;
let ws: Id;
let accounts: Id[];

beforeAll(async () => {
  h = await createTestCuadra();
  const fx = ledgerFixture(h.driver, h.ids);
  ws = await fx.workspace();
  accounts = [];
  for (const name of ['Caja', 'Banco', 'Ahorro', 'Tarjeta', 'Billetera']) accounts.push(await fx.account(ws, name));
  const cat = await fx.field(ws, { key: 'categoria', label: 'Categoría', type: 'list', role: 'category', options: ['Ventas', 'Compras', 'Servicios', 'Nómina', 'Alquiler', 'Impuestos', 'Otros'] });
  const contact = await fx.field(ws, { key: 'contacto', label: 'Contacto', type: 'list', role: 'contact', options: Array.from({ length: 40 }, (_, i) => `Cliente ${i}`) });
  const cats = Object.values(cat.opt);
  const contacts = Object.values(contact.opt);
  const rnd = prng(7);
  const int = (n: number) => Math.floor(rnd() * n);
  const seq = new Map(accounts.map((a) => [a, 0]));
  const txRows: SqlValue[][] = [];
  const valueRows: SqlValue[][] = [];
  const now = '2026-06-15T12:00:00.000Z';
  const push = (account: Id, kind: string, direction: string, amount: number, date: string, description: string, group: Id | null, voided: boolean) => {
    const id = h.ids.next();
    const s = (seq.get(account) ?? 0) + 1;
    seq.set(account, s);
    txRows.push(
      recordValues('transactions', {
        id,
        workspace_id: ws,
        account_id: account,
        seq: s,
        kind,
        direction,
        amount_minor: amount,
        date,
        description,
        notes: '',
        search_text: buildSearchText(description, ''),
        status: voided ? 'voided' : 'active',
        void_reason: null,
        voided_at: voided ? now : null,
        voided_with_batch: 0,
        batch_id: null,
        transfer_group_id: group,
        recorded_at: now,
        updated_at: now,
      }),
    );
    return id;
  };
  for (const a of accounts) push(a, 'opening', 'in', 1_000_000, '2025-04-01', 'Saldo inicial', null, false);
  while (txRows.length < N) {
    const date = addDays('2025-04-01', int(440));
    const account = accounts[int(5)]!;
    const r = rnd();
    if (r < 0.08) {
      const to = accounts.filter((x) => x !== account)[int(4)]!;
      const g = h.ids.next();
      const amount = 1000 + int(500_000);
      push(account, 'transfer', 'out', amount, date, 'Transferencia', g, false);
      push(to, 'transfer', 'in', amount, date, 'Transferencia', g, false);
      continue;
    }
    const kind = r < 0.5 ? 'income' : 'expense';
    const id = push(account, kind, kind === 'income' ? 'in' : 'out', 100 + int(300_000), date, `${kind === 'income' ? 'Venta' : 'Compra'} ${int(900)} café`, null, rnd() < 0.03);
    valueRows.push(recordValues('transaction_field_values', { transaction_id: id, field_id: cat.id, value_option_id: cats[int(cats.length)]! }));
    if (rnd() < 0.6) valueRows.push(recordValues('transaction_field_values', { transaction_id: id, field_id: contact.id, value_option_id: contacts[int(contacts.length)]! }));
  }
  await h.driver.transaction(async (tx) => {
    await tx.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'sys.maintenance', 'true', ?)", [now]);
    await tx.runMany(insertSql('transactions'), txRows);
    await tx.runMany(insertSql('transaction_field_values'), valueRows);
    for (const [a, s] of seq) await tx.run('UPDATE accounts SET next_seq = ? WHERE id = ?', [s + 1, a]);
    await tx.run("DELETE FROM settings WHERE scope_id = '' AND key = 'sys.maintenance'");
  });
  await h.driver.exec('ANALYZE');
}, 60_000);

afterAll(async () => {
  await h?.driver.close();
});

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  await fn(); // calentar
  const runs: number[] = [];
  let value!: T;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    value = await fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return { ms: runs[2]!, value };
}

describe(`queries con ${N} movimientos`, () => {
  it('listado + totales + panel responden en pocas decenas de ms', async () => {
    const q = h.cuadra.queries;
    const count = await h.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(count?.n).toBe(N);
    const results: Record<string, number> = {};
    const list = await time(() => q.listTransactions(ws, { filter: {} }));
    results['listTransactions (todas, 1ª página + totales)'] = list.ms;
    expect(list.value.items).toHaveLength(50);
    const next = await time(() => q.listTransactions(ws, { filter: {}, cursor: list.value.nextCursor! }));
    results['listTransactions (página siguiente)'] = next.ms;
    const one = await time(() => q.listTransactions(ws, { filter: { accountIds: [accounts[0]!], text: 'cafe', period: { preset: 'last_12_months' } } }));
    results['listTransactions (una cuenta + texto + periodo, saldo corrido)'] = one.ms;
    expect(one.value.items[0]?.runningMinor).not.toBeNull();
    const byAmount = await time(() => q.listTransactions(ws, { filter: { kinds: ['expense'] }, sort: { by: 'amount', dir: 'desc' } }));
    results['listTransactions (salidas por monto)'] = byAmount.ms;
    const byDay = await time(() => q.listByDay(ws, { filter: {} }));
    results['listByDay'] = byDay.ms;
    const dash = await time(() => q.dashboard(ws));
    results['dashboard (mes)'] = dash.ms;
    const dashYear = await time(() => q.dashboard(ws, { period: { preset: 'this_year' }, seriesUnit: 'day' }));
    results['dashboard (año, serie diaria)'] = dashYear.ms;
    const summary = await time(() => q.summarize(ws, { filter: { period: { preset: 'last_12_months' } }, groupBy: { by: 'period', unit: 'month' }, split: { by: 'account' } }));
    results['summarize (mes × cuenta)'] = summary.ms;
    const home = await time(() => q.home(ws));
    results['home'] = home.ms;
    const report = await time(() => h.cuadra.reports.build(ws, h.cuadra.reports.preset('summary', { preset: 'this_year' })));
    results['reports.build resumido (año)'] = report.ms;
    const detailed = await time(() => h.cuadra.reports.build(ws, h.cuadra.reports.preset('detailed', { preset: 'last_month' })));
    results['reports.build detallado (mes pasado)'] = detailed.ms;

    console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ms: Number(v.toFixed(1)) }])));
    for (const [name, ms] of Object.entries(results)) {
      if (name.startsWith('reports.build detallado')) continue; // trae cientos de filas completas; solo se informa
      expect(ms, name).toBeLessThan(BUDGET_MS);
    }
    // Coherencia a escala: suma de saldos del panel = saldo total.
    const bal = await q.balances(ws);
    expect(dash.value.balance.totalMinor).toBe(bal.totalMinor);
    expect(report.value.statement.closingMinor).toBe((await q.balances(ws, { asOf: '2026-12-31' })).totalMinor);
  }, 60_000);

  it('las consultas calientes usan índices (EXPLAIN QUERY PLAN)', async () => {
    const plan = async (sql: string, params: Record<string, SqlValue>) =>
      (await h.driver.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)).map((r) => r.detail).join(' | ');
    // Página del listado de todo el espacio: índice por espacio y fecha (sin recorrer la tabla).
    const page = await plan(
      "SELECT t.id FROM transactions t WHERE t.workspace_id = :ws AND t.status = 'active' ORDER BY t.date DESC, t.recorded_at DESC, t.id DESC LIMIT 51",
      { ws },
    );
    expect(page).toMatch(/USING INDEX tx_ws_(date|status)/);
    // Listado de una cuenta: índice de cuenta y fecha, sin ordenar aparte.
    const account = await plan(
      "SELECT t.id FROM transactions t WHERE t.workspace_id = :ws AND t.status = 'active' AND t.account_id IN (:a) ORDER BY t.date DESC, t.seq DESC LIMIT 51",
      { ws, a: accounts[0]! },
    );
    expect(account).toMatch(/USING INDEX tx_account_date/);
    expect(account).not.toMatch(/TEMP B-TREE/);
    // Valores de campo por movimiento: clave primaria.
    const values = await plan('SELECT * FROM transaction_field_values v WHERE v.transaction_id = :id', { id: 'x' });
    expect(values).toMatch(/USING PRIMARY KEY|USING INDEX sqlite_autoindex_transaction_field_values/);
    // Contrapartida de una transferencia: índice parcial de transferencias.
    const cp = await plan(
      'SELECT o.id FROM transactions o WHERE :g IS NOT NULL AND o.transfer_group_id = :g AND o.id <> :id',
      { g: 'g', id: 'x' },
    );
    expect(cp).toMatch(/USING INDEX tx_transfer_sides/);
  });
});
