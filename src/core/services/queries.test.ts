import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { isDomainError } from '../errors';
import type { FieldType, Id, SummaryGroup, Totals, TransactionRow, TxFilter } from '../types';
import { ledgerFixture, type LedgerFixture } from './ledger.fixture';
import { groupFilter, previousRange } from './queries';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function failure(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  return undefined;
}

/**
 * Libro base (hoy = 2026-06-15):
 *   Caja:   inicial 1,000.00 (01-01) · venta café 2,500.50 (03-05) · compra azúcar −300.00 (03-10)
 *           · transferencia a Banco −500.00 (04-15) · venta Café molido 800.00 (05-20)
 *           · café oficina −50.00 ANULADO (06-01)
 *   Banco:  inicial 5,000.00 (01-01) · pago luz −1,200.00 (04-02) · +500.00 (04-15) · intereses 100.00 (05-31)
 *           · comisión −200.00 (06-10)
 */
async function seedBase() {
  h = await createTestCuadra();
  const fx = ledgerFixture(h.driver, h.ids);
  const ws = await fx.workspace();
  const caja = await fx.account(ws, 'Caja');
  const banco = await fx.account(ws, 'Banco', { type: 'bank' });
  const cat = await fx.field(ws, {
    key: 'categoria',
    label: 'Categoría',
    type: 'list',
    role: 'category',
    options: ['Ventas', 'Compras', 'Servicios'],
  });
  const contacto = await fx.field(ws, { key: 'contacto', label: 'Contacto', type: 'list', role: 'contact', options: ['Juan', 'María'] });
  const conciliado = await fx.field(ws, { key: 'conciliado', label: 'Conciliado', type: 'bool' });
  const ref = await fx.field(ws, { key: 'referencia', label: 'Referencia', type: 'text' });
  const unidades = await fx.field(ws, { key: 'unidades', label: 'Unidades', type: 'number' });
  const vence = await fx.field(ws, { key: 'vence', label: 'Vence', type: 'date' });

  const ids = {
    cajaOpening: await fx.opening(caja, 100000, '2026-01-01'),
    bancoOpening: await fx.opening(banco, 500000, '2026-01-01'),
    ventaCafe: await fx.income(caja, 250050, '2026-03-05', 'Venta café', {
      values: { [cat.id]: { option: cat.opt['Ventas']! }, [contacto.id]: { option: contacto.opt['Juan']! }, [unidades.id]: { number: 12 } },
    }),
    azucar: await fx.expense(caja, 30000, '2026-03-10', 'Compra de azúcar', {
      values: { [cat.id]: { option: cat.opt['Compras']! }, [conciliado.id]: { bool: true }, [contacto.id]: { option: contacto.opt['María']! } },
    }),
    luz: await fx.expense(banco, 120000, '2026-04-02', 'Pago luz', {
      values: { [cat.id]: { option: cat.opt['Servicios']! }, [ref.id]: { text: 'F-001' }, [vence.id]: { date: '2026-04-30' } },
    }),
    deposito: await fx.transfer(caja, banco, 50000, '2026-04-15', 'Depósito'),
    molido: await fx.income(caja, 80000, '2026-05-20', 'Venta Café molido', {
      notes: 'cliente frecuente',
      values: { [cat.id]: { option: cat.opt['Ventas']! }, [contacto.id]: { option: contacto.opt['Juan']! }, [unidades.id]: { number: 4 } },
    }),
    intereses: await fx.income(banco, 10000, '2026-05-31', 'Intereses'),
    oficina: await fx.expense(caja, 5000, '2026-06-01', 'Café para la oficina', {
      voided: 'Duplicado',
      values: { [cat.id]: { option: cat.opt['Compras']! } },
    }),
    comision: await fx.expense(banco, 20000, '2026-06-10', 'Comisión', {
      values: { [cat.id]: { option: cat.opt['Servicios']! }, [ref.id]: { text: 'F-001' } },
    }),
  };
  return { h, fx, ws, caja, banco, cat, contacto, conciliado, ref, unidades, vence, ids, q: h.cuadra.queries };
}

const descriptions = (rows: TransactionRow[]) => rows.map((r) => r.description);
const sumGroups = (groups: SummaryGroup[]) => ({
  inMinor: groups.reduce((s, g) => s + g.inMinor, 0),
  outMinor: groups.reduce((s, g) => s + g.outMinor, 0),
  count: groups.reduce((s, g) => s + g.count, 0),
});

describe('queries: listados y filtros', () => {
  it('filtros combinados (cuenta + periodo + tipo + campo + texto + monto) son AND', async () => {
    const { q, ws, caja, cat } = await seedBase();
    const full: TxFilter = {
      accountIds: [caja],
      period: { from: '2026-03-01', to: '2026-05-31' },
      kinds: ['income'],
      fields: [{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Ventas']!] }],
      text: 'cafe',
      amount: { min: 100000 },
    };
    const all = await q.listTransactions(ws, { filter: full });
    expect(descriptions(all.items)).toEqual(['Venta café']);
    expect(all.totals.inMinor).toBe(250050);

    // Quitar cualquier criterio amplía el resultado: cada uno restringe por su cuenta (AND, no OR).
    const without = async (key: keyof TxFilter) => {
      const f = { ...full };
      delete f[key];
      return descriptions((await q.listTransactions(ws, { filter: f })).items).sort();
    };
    expect(await without('amount')).toEqual(['Venta Café molido', 'Venta café']);
    expect(await without('kinds')).toEqual(['Venta café']);
    expect(await without('text')).toEqual(['Venta café']);
    expect(await without('accountIds')).toEqual(['Venta café']);
    expect(await without('period')).toEqual(['Venta café']);
    // Un criterio que ningún movimiento cumple a la vez que los demás deja la lista vacía.
    const none = await q.listTransactions(ws, { filter: { ...full, kinds: ['expense'] } });
    expect(none.items).toEqual([]);
    expect(none.totals.count).toBe(0);
  });

  it('los totales se recalculan sobre lo filtrado', async () => {
    const { q, ws, caja, cat } = await seedBase();
    const everything = await q.totals(ws, {});
    expect(everything).toEqual<Totals>({
      inMinor: 250050 + 80000 + 10000,
      outMinor: 30000 + 120000 + 20000,
      netMinor: 340050 - 170000,
      transfersInMinor: 50000,
      transfersOutMinor: 50000,
      openingsMinor: 600000,
      count: 10,
      voidedCount: 1,
    });
    const cajaOnly = await q.listTransactions(ws, { filter: { accountIds: [caja] } });
    expect(cajaOnly.totals).toEqual<Totals>({
      inMinor: 330050,
      outMinor: 30000,
      netMinor: 300050,
      transfersInMinor: 0,
      transfersOutMinor: 50000,
      openingsMinor: 100000,
      count: 5,
      voidedCount: 1,
    });
    // Totales del conjunto completo aunque la página sea corta.
    const page = await q.listTransactions(ws, { filter: { kinds: ['expense'] }, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.totals.outMinor).toBe(170000);
    expect(page.totals.count).toBe(3);
    // Filtro por campo: solo cuenta lo que lo cumple.
    const servicios = await q.totals(ws, { fields: [{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Servicios']!] }] });
    expect(servicios.outMinor).toBe(140000);
    expect(servicios.inMinor).toBe(0);
    // Anulados: se ven si se piden, pero nunca suman.
    const voided = await q.listTransactions(ws, { filter: { status: 'voided' } });
    expect(descriptions(voided.items)).toEqual(['Café para la oficina']);
    expect(voided.items[0]?.status).toBe('voided');
    expect(voided.totals.outMinor).toBe(0);
    expect(voided.totals.count).toBe(1);
  });

  it('las páginas siguientes (con cursor) reutilizan los totales de la primera si nada cambió', async () => {
    const { q, ws, caja, fx, h: th } = await seedBase();
    const aggregates: string[] = [];
    const get = th.driver.get.bind(th.driver);
    th.driver.get = (async (sql: string, params?: never) => {
      if (sql.includes('ws_exists')) aggregates.push(sql);
      return get(sql, params);
    }) as typeof th.driver.get;

    const first = await q.listTransactions(ws, { filter: { status: 'all' }, limit: 3 });
    expect(aggregates).toHaveLength(1);
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor !== null) {
      const page = await q.listTransactions(ws, { filter: { status: 'all' }, limit: 3, cursor });
      expect(page.totals).toEqual(first.totals);
      cursor = page.nextCursor;
      pages++;
    }
    expect(pages).toBeGreaterThan(2);
    expect(aggregates).toHaveLength(1);

    // Un cambio en la base entre páginas invalida lo guardado: la página siguiente trae totales al día.
    const again = await q.listTransactions(ws, { filter: { status: 'all' }, limit: 3 });
    expect(aggregates).toHaveLength(2);
    await fx.income(caja, 7000, '2026-06-12', 'Venta tarde');
    const next = await q.listTransactions(ws, { filter: { status: 'all' }, limit: 3, cursor: again.nextCursor! });
    expect(aggregates).toHaveLength(3);
    expect(next.totals.inMinor).toBe(again.totals.inMinor + 7000);
    // Otro filtro con cursor no hereda los totales del anterior.
    const exp = await q.listTransactions(ws, { filter: { kinds: ['expense'] }, limit: 1 });
    const inc = await q.listTransactions(ws, { filter: { kinds: ['income'] }, limit: 1, cursor: exp.nextCursor! });
    expect(aggregates).toHaveLength(5);
    expect(inc.totals.outMinor).toBe(0);
    expect(inc.totals.inMinor).toBe(next.totals.inMinor);
  });

  it('búsqueda de texto ignora mayúsculas y tildes ("cafe" encuentra "Café")', async () => {
    const { q, ws } = await seedBase();
    const found = await q.listTransactions(ws, { filter: { text: 'cafe' }, sort: { by: 'date', dir: 'asc' } });
    expect(descriptions(found.items)).toEqual(['Venta café', 'Venta Café molido']);
    expect(descriptions((await q.listTransactions(ws, { filter: { text: 'CAFÉ' } })).items).sort()).toEqual([
      'Venta Café molido',
      'Venta café',
    ]);
    // Busca también en las notas y exige todas las palabras.
    expect(descriptions((await q.listTransactions(ws, { filter: { text: 'FRECUENTE café' } })).items)).toEqual([
      'Venta Café molido',
    ]);
    // Con anulados incluidos aparece el tercero.
    const withVoided = await q.listTransactions(ws, { filter: { text: 'cafe', status: 'all' } });
    expect(withVoided.items).toHaveLength(3);
    // Comodines de LIKE no se cuelan.
    expect((await q.listTransactions(ws, { filter: { text: '%' } })).items).toEqual([]);
  });

  it('saldo corrido en el listado de una cuenta coincide con el saldo real aunque haya filtros', async () => {
    const { q, ws, caja, banco } = await seedBase();
    const bal = await q.balances(ws);
    // Sin filtros: el más reciente activo lleva el saldo de la cuenta.
    const all = await q.listTransactions(ws, { filter: { accountIds: [caja] } });
    expect(all.items[0]?.description).toBe('Venta Café molido');
    expect(all.items[0]?.runningMinor).toBe(bal.byAccount[caja]);
    // El anulado no mueve el saldo corrido.
    const withVoided = await q.listTransactions(ws, { filter: { accountIds: [caja], status: 'all' } });
    expect(withVoided.items[0]?.description).toBe('Café para la oficina');
    expect(withVoided.items[0]?.runningMinor).toBe(bal.byAccount[caja]);
    // Con filtros de texto y periodo el saldo de cada fila sigue siendo el real de la cuenta en ese punto.
    const filtered = await q.listTransactions(ws, {
      filter: { accountIds: [caja], text: 'venta', period: { from: '2026-03-01', to: '2026-03-31' } },
    });
    expect(filtered.items.map((r) => [r.description, r.runningMinor])).toEqual([['Venta café', 100000 + 250050]]);
    const asOf = await q.balances(ws, { asOf: '2026-03-05' });
    expect(filtered.items[0]?.runningMinor).toBe(asOf.byAccount[caja]);
    for (const row of (await q.listTransactions(ws, { filter: { accountIds: [banco] }, sort: { by: 'amount', dir: 'asc' } })).items) {
      const at = await q.balances(ws, { asOf: row.date });
      // Banco no tiene dos movimientos el mismo día: el saldo a esa fecha es el corrido.
      expect(row.runningMinor).toBe(at.byAccount[banco]);
    }
    // Con varias cuentas no hay saldo corrido.
    const multi = await q.listTransactions(ws, { filter: { accountIds: [caja, banco] } });
    expect(multi.items.every((r) => r.runningMinor === null)).toBe(true);
  });

  it('cada fila trae sus valores de campo y la contrapartida de las transferencias', async () => {
    const { q, ws, caja, banco, cat, ids } = await seedBase();
    const rows = (await q.listTransactions(ws, { filter: { kinds: ['transfer', 'income'] }, sort: { by: 'date', dir: 'asc' } })).items;
    const out = rows.find((r) => r.id === ids.deposito.out);
    const inn = rows.find((r) => r.id === ids.deposito.in);
    expect(out?.counterpart).toEqual({ accountId: banco, transactionId: ids.deposito.in, seq: 3 });
    expect(inn?.counterpart).toEqual({ accountId: caja, transactionId: ids.deposito.out, seq: 4 });
    const venta = rows.find((r) => r.id === ids.ventaCafe);
    expect(venta?.values[cat.id]).toEqual({ type: 'list', optionId: cat.opt['Ventas'] });
    expect(Object.values(venta?.values ?? {})).toContainEqual({ type: 'number', value: 12 });
    expect(venta?.counterpart).toBeNull();
  });

  it('paginación por cursor recorre todo sin repetir en cualquier orden', async () => {
    h = await createTestCuadra();
    const fx = ledgerFixture(h.driver, h.ids);
    const ws = await fx.workspace();
    const a = await fx.account(ws, 'Caja');
    const b = await fx.account(ws, 'Banco');
    for (let i = 0; i < 23; i++) {
      await fx.income(i % 3 === 0 ? b : a, 1000 + (i % 5) * 100, `2026-05-${String(1 + (i % 4)).padStart(2, '0')}`, `M${i}`);
    }
    for (const sort of [
      { by: 'date', dir: 'desc' },
      { by: 'date', dir: 'asc' },
      { by: 'amount', dir: 'asc' },
      { by: 'amount', dir: 'desc' },
      { by: 'recorded_at', dir: 'desc' },
      { by: 'seq', dir: 'asc' },
    ] as const) {
      for (const filter of [{}, { accountIds: [a] }]) {
        const full = (await h.cuadra.queries.listTransactions(ws, { filter, sort, limit: 500 })).items.map((r) => r.id);
        const seen: Id[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await h.cuadra.queries.listTransactions(ws, { filter, sort, limit: 5, ...(cursor ? { cursor } : {}) });
          seen.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor ?? undefined;
          pages++;
        } while (cursor !== undefined);
        expect(seen, `${sort.by} ${sort.dir}`).toEqual(full);
        expect(pages).toBe(Math.ceil(full.length / 5));
      }
    }
    const listed = (await h.cuadra.queries.listTransactions(ws, { filter: {}, sort: { by: 'amount', dir: 'asc' } })).items;
    const amounts = listed.map((r) => r.amountMinor);
    expect(amounts).toEqual([...amounts].sort((x, y) => x - y));
    // Un cursor de otro orden o manipulado se rechaza.
    const first = await h.cuadra.queries.listTransactions(ws, { filter: {}, limit: 5 });
    const e = await failure(() =>
      h!.cuadra.queries.listTransactions(ws, { filter: {}, sort: { by: 'amount', dir: 'asc' }, cursor: first.nextCursor! }),
    );
    expect(isDomainError(e, 'invalid_recipe')).toBe(true);
    expect(isDomainError(await failure(() => h!.cuadra.queries.listTransactions(ws, { filter: {}, cursor: '!!' })), 'invalid_recipe')).toBe(true);
  });

  it('listByDay agrupa por día con el subtotal del día completo aunque la página lo corte', async () => {
    const { q, ws, caja, fx } = await seedBase();
    await fx.income(caja, 1000, '2026-06-12', 'Venta A');
    await fx.income(caja, 2000, '2026-06-12', 'Venta B');
    await fx.expense(caja, 500, '2026-06-12', 'Gasto C');
    const ahorro = await fx.account(ws, 'Ahorro');
    await fx.transfer(caja, ahorro, 700, '2026-06-12', 'Ahorro');
    const p1 = await q.listByDay(ws, { filter: {}, limit: 2 });
    expect(p1.items).toHaveLength(1);
    expect(p1.items[0]).toMatchObject({ date: '2026-06-12', inMinor: 3000, outMinor: 500 });
    expect(p1.items[0]?.items).toHaveLength(2);
    const p2 = await q.listByDay(ws, { filter: {}, limit: 4, cursor: p1.nextCursor! });
    expect(p2.items[0]).toMatchObject({ date: '2026-06-12', inMinor: 3000, outMinor: 500 });
    expect(p2.items[0]?.items).toHaveLength(3);
    // Recorriendo todas las páginas salen todos los activos una vez, de más reciente a más antiguo.
    const all: TransactionRow[] = [];
    let cursor: string | undefined;
    do {
      const page = await q.listByDay(ws, { filter: {}, limit: 3, ...(cursor ? { cursor } : {}) });
      for (const d of page.items) all.push(...d.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(all).toHaveLength(15);
    expect(all.map((r) => r.date)).toEqual([...all.map((r) => r.date)].sort().reverse());
    expect((await q.listByDay(ws, { filter: { text: 'nada que encuentre' } })).items).toEqual([]);
  });

  it('valida el filtro, las fechas y el espacio', async () => {
    const { q, ws } = await seedBase();
    expect(isDomainError(await failure(() => q.listTransactions(ws, { filter: { period: { from: '2026-02-30' } } })), 'invalid_recipe')).toBe(true);
    expect(isDomainError(await failure(() => q.totals(ws, { amount: { min: 1.5 } })), 'invalid_recipe')).toBe(true);
    expect(isDomainError(await failure(() => q.balances(ws, { asOf: '2026-13-01' })), 'invalid_date')).toBe(true);
    expect(isDomainError(await failure(() => q.home(ws, { month: '2026-13' })), 'invalid_date')).toBe(true);
    const ghost = '01900000-0000-7000-8000-0000000000ff';
    for (const call of [
      () => q.listTransactions(ghost, { filter: {} }),
      () => q.listByDay(ghost, { filter: {} }),
      () => q.totals(ghost, {}),
      () => q.balances(ghost),
      () => q.balanceSeries(ghost, { period: { preset: 'this_year' }, unit: 'month' }),
      () => q.summarize(ghost, { filter: {}, groupBy: { by: 'kind' } }),
      () => q.home(ghost),
      () => q.dashboard(ghost),
    ]) {
      expect(isDomainError(await failure(call), 'not_found')).toBe(true);
    }
  });
});

describe('queries: saldos', () => {
  it('saldos por cuenta y del espacio, a una fecha, sin anulados', async () => {
    const { q, ws, caja, banco, fx } = await seedBase();
    const archived = await fx.account(ws, 'Vieja', { archived: true });
    await fx.opening(archived, 1500, '2026-02-01');
    const now = await q.balances(ws);
    expect(now.byAccount).toEqual({ [caja]: 350050, [banco]: 500000 - 120000 + 50000 + 10000 - 20000, [archived]: 1500 });
    expect(now.totalMinor).toBe(350050 + 420000 + 1500);
    const march = await q.balances(ws, { asOf: '2026-03-31' });
    expect(march.byAccount).toEqual({ [caja]: 320050, [banco]: 500000, [archived]: 1500 });
    const before = await q.balances(ws, { asOf: '2025-12-31' });
    expect(before.totalMinor).toBe(0);
  });

  it('balanceSeries da el saldo al cierre de cada mes o día, con huecos rellenados', async () => {
    const { q, ws, caja } = await seedBase();
    const monthly = await q.balanceSeries(ws, { period: { from: '2026-01-01', to: '2026-06-30' }, unit: 'month' });
    expect(monthly).toEqual([
      { key: '2026-01', balanceMinor: 600000 },
      { key: '2026-02', balanceMinor: 600000 },
      { key: '2026-03', balanceMinor: 820050 },
      { key: '2026-04', balanceMinor: 700050 },
      { key: '2026-05', balanceMinor: 790050 },
      { key: '2026-06', balanceMinor: 770050 },
    ]);
    const daily = await q.balanceSeries(ws, { accountIds: [caja], period: { from: '2026-03-04', to: '2026-03-06' }, unit: 'day' });
    expect(daily).toEqual([
      { key: '2026-03-04', balanceMinor: 100000 },
      { key: '2026-03-05', balanceMinor: 350050 },
      { key: '2026-03-06', balanceMinor: 350050 },
    ]);
    // Sin límite inicial arranca en el primer movimiento y termina hoy.
    const open = await q.balanceSeries(ws, { period: { preset: 'all' }, unit: 'month' });
    expect(open[0]?.key).toBe('2026-01');
    expect(open.at(-1)).toEqual({ key: '2026-06', balanceMinor: (await q.balances(ws)).totalMinor });
  });
});

describe('queries: resúmenes', () => {
  it('resumen por mes rellena con cero los meses sin datos del rango', async () => {
    const { q, ws } = await seedBase();
    const r = await q.summarize(ws, {
      filter: { period: { from: '2026-01-01', to: '2026-07-31' } },
      groupBy: { by: 'period', unit: 'month' },
    });
    expect(r.groups.map((g) => g.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(r.groups.map((g) => [g.inMinor, g.outMinor, g.count])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [250050, 30000, 2],
      [0, 120000, 1],
      [90000, 0, 2],
      [0, 20000, 1],
      [0, 0, 0],
    ]);
    expect(r.groups[1]?.label).toBe('febrero 2026');
    expect(r.period).toEqual({ from: '2026-01-01', to: '2026-07-31', label: '1 ene 2026 – 31 jul 2026' });
    // Otras unidades también rellenan.
    const quarters = await q.summarize(ws, { filter: { period: { preset: 'this_year' } }, groupBy: { by: 'period', unit: 'quarter' } });
    expect(quarters.groups.map((g) => [g.key, g.label])).toEqual([
      ['2026-Q1', 'T1 2026'],
      ['2026-Q2', 'T2 2026'],
      ['2026-Q3', 'T3 2026'],
      ['2026-Q4', 'T4 2026'],
    ]);
    const weeks = await q.summarize(ws, {
      filter: { period: { from: '2026-03-01', to: '2026-03-15' } },
      groupBy: { by: 'period', unit: 'week' },
    });
    expect(weeks.groups.map((g) => [g.key, g.inMinor, g.outMinor])).toEqual([
      ['2026-02-23', 0, 0],
      ['2026-03-02', 250050, 0],
      ['2026-03-09', 0, 30000],
    ]);
    const days = await q.summarize(ws, { filter: { period: { from: '2026-03-04', to: '2026-03-06' } }, groupBy: { by: 'period', unit: 'day' } });
    expect(days.groups.map((g) => g.key)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06']);
    // Sin periodo: del primer al último mes con datos.
    const years = await q.summarize(ws, { filter: {}, groupBy: { by: 'period', unit: 'year' } });
    expect(years.groups.map((g) => g.key)).toEqual(['2026']);
  });

  it('resumen por campo incluye "Sin valor" y la suma de grupos = totales', async () => {
    const { q, ws, cat, conciliado, ref, unidades, vence } = await seedBase();
    const r = await q.summarize(ws, { filter: {}, groupBy: { by: 'field', fieldId: cat.id } });
    expect(r.groups.map((g) => [g.label, g.inMinor, g.outMinor, g.count])).toEqual([
      ['Ventas', 330050, 0, 2],
      ['Compras', 0, 30000, 1],
      ['Servicios', 0, 140000, 2],
      ['Sin valor', 10000, 0, 1],
    ]);
    expect(r.groups.at(-1)?.key).toBeNull();
    const sum = sumGroups(r.groups);
    expect(sum.inMinor).toBe(r.totals.inMinor);
    expect(sum.outMinor).toBe(r.totals.outMinor);
    // Cualquier tipo de campo.
    const bool = await q.summarize(ws, { filter: {}, groupBy: { by: 'field', fieldId: conciliado.id } });
    expect(bool.groups.map((g) => [g.key, g.label, g.count])).toEqual([
      ['true', 'Sí', 1],
      ['false', 'No', 5],
    ]);
    const text = await q.summarize(ws, { filter: {}, groupBy: { by: 'field', fieldId: ref.id } });
    expect(text.groups.map((g) => [g.key, g.outMinor])).toEqual([
      ['F-001', 140000],
      [null, 30000],
    ]);
    const num = await q.summarize(ws, { filter: {}, groupBy: { by: 'field', fieldId: unidades.id } });
    expect(num.groups.map((g) => [g.key, g.label, g.inMinor])).toEqual([
      ['4', '4', 80000],
      ['12', '12', 250050],
      [null, 'Sin valor', 10000],
    ]);
    const date = await q.summarize(ws, { filter: {}, groupBy: { by: 'field', fieldId: vence.id } });
    expect(date.groups.map((g) => [g.key, g.label])).toEqual([
      ['2026-04', 'abril 2026'],
      [null, 'Sin valor'],
    ]);
    for (const res of [bool, text, num, date]) {
      expect(sumGroups(res.groups).inMinor).toBe(res.totals.inMinor);
      expect(sumGroups(res.groups).outMinor).toBe(res.totals.outMinor);
    }
  });

  it('resumen excluye transferencias y saldos iniciales de entradas/salidas', async () => {
    const { q, ws, caja, banco } = await seedBase();
    const r = await q.summarize(ws, { filter: {}, groupBy: { by: 'account' } });
    expect(r.groups.map((g) => [g.key, g.inMinor, g.outMinor, g.count])).toEqual([
      [caja, 330050, 30000, 3],
      [banco, 10000, 140000, 3],
    ]);
    expect(r.totals.inMinor).toBe(340050);
    expect(r.totals.outMinor).toBe(170000);
    expect(r.totals.transfersInMinor).toBe(50000);
    expect(r.totals.transfersOutMinor).toBe(50000);
    expect(r.totals.openingsMinor).toBe(600000);
    // Los grupos solo cuentan entradas y salidas: totals.count incluye además transferencias y saldos iniciales.
    expect(sumGroups(r.groups).count).toBe(r.totals.count - 4);
    const kinds = await q.summarize(ws, { filter: {}, groupBy: { by: 'kind' } });
    expect(kinds.groups.map((g) => [g.key, g.label, g.inMinor, g.outMinor])).toEqual([
      ['income', 'Entrada', 340050, 0],
      ['expense', 'Salida', 0, 170000],
    ]);
    // Aunque el filtro pida transferencias, no entran en entradas/salidas.
    const onlyTransfers = await q.summarize(ws, { filter: { kinds: ['transfer'] }, groupBy: { by: 'account' } });
    expect(onlyTransfers.groups.every((g) => g.inMinor === 0 && g.outMinor === 0)).toBe(true);
    expect(onlyTransfers.totals.transfersInMinor).toBe(50000);
  });

  it('resumen con split por segunda dimensión y descripción del filtro', async () => {
    const { q, ws, caja, banco, cat } = await seedBase();
    const r = await q.summarize(ws, {
      filter: { period: { from: '2026-01-01', to: '2026-06-30' }, accountIds: [caja, banco] },
      groupBy: { by: 'field', fieldId: cat.id },
      split: { by: 'period', unit: 'quarter' },
    });
    const ventas = r.groups.find((g) => g.label === 'Ventas');
    expect(ventas?.split?.map((s) => [s.key, s.inMinor])).toEqual([
      ['2026-Q1', 250050],
      ['2026-Q2', 80000],
    ]);
    for (const g of r.groups) {
      expect(sumGroups(g.split ?? []).inMinor).toBe(g.inMinor);
      expect(sumGroups(g.split ?? []).outMinor).toBe(g.outMinor);
    }
    expect(r.filtered).toBe(true);
    expect(r.filterDescription).toEqual(['Periodo: 1 ene 2026 – 30 jun 2026', 'Cuenta: Caja, Banco']);
    expect(r.warnings).toEqual([]);
  });

  it('groupFilter abre exactamente los movimientos de cada grupo', async () => {
    const { q, ws, cat, conciliado, ref, unidades, vence, h: th } = await seedBase();
    const base: TxFilter = { period: { from: '2026-02-15', to: '2026-06-30' } };
    const groupings = [
      { by: 'period', unit: 'month' },
      { by: 'period', unit: 'week' },
      { by: 'account' },
      { by: 'kind' },
      { by: 'field', fieldId: cat.id },
      { by: 'field', fieldId: conciliado.id },
      { by: 'field', fieldId: ref.id },
      { by: 'field', fieldId: unidades.id },
      { by: 'field', fieldId: vence.id },
    ] as const;
    const types = new Map<Id, FieldType>([
      [cat.id, 'list'],
      [conciliado.id, 'bool'],
      [ref.id, 'text'],
      [unidades.id, 'number'],
      [vence.id, 'date'],
    ]);
    for (const groupBy of groupings) {
      const r = await q.summarize(ws, { filter: base, groupBy });
      for (const g of r.groups) {
        const fieldType = groupBy.by === 'field' ? types.get(groupBy.fieldId) : undefined;
        for (const opts of [{ clock: th.clock }, { clock: th.clock, ...(fieldType ? { fieldType } : {}) }]) {
          const t = await q.totals(ws, groupFilter(base, groupBy, g.key, opts));
          expect([t.inMinor, t.outMinor, t.count], `${JSON.stringify(groupBy)} ${g.key}`).toEqual([g.inMinor, g.outMinor, g.count]);
        }
      }
    }
  });

  it('previousRange: meses completos retroceden por meses; si no, por días', () => {
    expect(previousRange('2026-06-01', '2026-06-30')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(previousRange('2026-04-01', '2026-06-30')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(previousRange('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange('2026-06-08', '2026-06-14')).toEqual({ from: '2026-06-01', to: '2026-06-07' });
    expect(previousRange('2026-05-17', '2026-06-15')).toEqual({ from: '2026-04-17', to: '2026-05-16' });
    expect(previousRange(null, '2026-06-15')).toBeNull();
  });
});

describe('queries: vistas guardadas', () => {
  it('vista guardada que usa un campo desactivado funciona y avisa field_inactive', async () => {
    const { q, ws, fx, conciliado, cat, h: th } = await seedBase();
    const views = th.cuadra.views;
    const filterView = await views.save({
      workspaceId: ws,
      name: 'Conciliados',
      recipe: { v: 1, kind: 'filter', filter: { fields: [{ fieldId: conciliado.id, op: 'is', value: true }] } },
    });
    const summaryView = await views.save({
      workspaceId: ws,
      name: 'Por conciliado',
      recipe: { v: 1, kind: 'summary', filter: {}, groupBy: { by: 'field', fieldId: conciliado.id }, measure: 'out', chart: 'bars' },
    });
    expect(filterView.warnings).toEqual([]);
    await fx.deactivateField(conciliado.id);

    const loaded = await views.get(filterView.value.id);
    expect(loaded.warnings).toEqual([{ code: 'field_inactive', fieldId: conciliado.id }]);
    expect(loaded.kind).toBe('filter');
    const list = await q.listTransactions(ws, { filter: loaded.recipe.kind === 'filter' ? loaded.recipe.filter : {} });
    expect(descriptions(list.items)).toEqual(['Compra de azúcar']);

    const summary = await views.get(summaryView.value.id);
    expect(summary.warnings).toEqual([{ code: 'field_inactive', fieldId: conciliado.id }]);
    if (summary.recipe.kind !== 'summary') throw new Error('kind');
    const r = await q.summarize(ws, { filter: summary.recipe.filter, groupBy: summary.recipe.groupBy });
    expect(r.warnings).toEqual([{ code: 'field_inactive', fieldId: conciliado.id }]);
    expect(r.groups.map((g) => g.label)).toEqual(['Sí', 'No']);
    // El listado de vistas también avisa.
    const listed = await views.list(ws, 'summary');
    expect(listed.map((v) => v.warnings)).toEqual([[{ code: 'field_inactive', fieldId: conciliado.id }]]);
    // Una opción fusionada en la receta sigue a su destino.
    await fx.deactivateOption(cat.opt['Compras']!, cat.opt['Servicios']!);
    const merged = await views.save({
      workspaceId: ws,
      name: 'Compras',
      recipe: { v: 1, kind: 'filter', filter: { fields: [{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Compras']!] }] } },
    });
    expect(merged.value.recipe.filter.fields).toEqual([{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Servicios']] }]);
    expect(merged.warnings).toContainEqual({ code: 'option_inactive', fieldId: cat.id, optionId: cat.opt['Compras'] });
  });
});

describe('queries: inicio y panel', () => {
  it('home junta saldo, mes, mes anterior, 12 meses, cuentas en negativo y respaldo', async () => {
    const { q, ws, fx, banco } = await seedBase();
    const tarjeta = await fx.account(ws, 'Tarjeta', { type: 'card' });
    await fx.opening(tarjeta, 75000, '2026-05-01', 'out');
    const d = await q.home(ws);
    expect(d.isEmpty).toBe(false);
    expect(d.totalBalanceMinor).toBe(770050 - 75000);
    expect(d.month).toMatchObject({ inMinor: 0, outMinor: 20000, count: 1, voidedCount: 1 });
    expect(d.previousMonth).toMatchObject({ inMinor: 90000, outMinor: 0, openingsMinor: -75000 });
    expect(d.monthly.map((m) => m.key)).toEqual([
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ]);
    expect(d.monthly.at(-3)).toEqual({ key: '2026-04', inMinor: 0, outMinor: 120000 });
    expect(d.negativeAccounts.map((a) => [a.name, a.balanceMinor, a.isNegative])).toEqual([['Tarjeta', -75000, true]]);
    expect(d.negativeAccounts[0]?.openingTransactionId).not.toBeNull();
    expect(d.backup).toEqual({ lastVerifiedAt: null, reminderDays: 30, overdue: true });

    await fx.setting('backup.lastVerifiedAt', '2026-06-01T10:00:00.000Z');
    await fx.setting('backup.reminderDays', 30);
    expect((await q.home(ws)).backup).toEqual({ lastVerifiedAt: '2026-06-01T10:00:00.000Z', reminderDays: 30, overdue: false });
    await fx.setting('backup.lastVerifiedAt', '2026-04-01T10:00:00.000Z');
    expect((await q.home(ws)).backup.overdue).toBe(true);
    const may = await q.home(ws, { month: '2026-05' });
    expect(may.month.inMinor).toBe(90000);
    expect(may.previousMonth.outMinor).toBe(120000);
    void banco;

    const empty = await fx.workspace({ name: 'Vacío' });
    const e = await q.home(empty);
    expect(e).toMatchObject({ isEmpty: true, totalBalanceMinor: 0, negativeAccounts: [] });
    expect(e.backup.overdue).toBe(false);
  });

  it('dashboard devuelve flujo, series, reparto con periodo anterior, top, atención y recientes', async () => {
    const { q, ws, fx, caja, banco, cat, contacto } = await seedBase();
    const tarjeta = await fx.account(ws, 'Tarjeta', { type: 'card' });
    await fx.expense(tarjeta, 9000, '2026-06-03', 'Gasolina', { values: { [cat.id]: { option: cat.opt['Servicios']! } } });
    const lote = await fx.batch(ws, { accountId: caja, control: 5000, accepted: true });
    await fx.income(caja, 2000, '2026-06-05', 'Venta lote 1', { batchId: lote });
    await fx.income(caja, 2500, '2026-06-05', 'Venta lote 2', { batchId: lote });
    const cuadrado = await fx.batch(ws, { accountId: caja, control: 1000 });
    await fx.income(caja, 1000, '2026-06-06', 'Venta cuadrada', { batchId: cuadrado });
    await fx.setting('backup.lastVerifiedAt', '2026-05-01T10:00:00.000Z');

    const d = await q.dashboard(ws, { period: { preset: 'this_month' }, months: 6, seriesUnit: 'month' });
    const bal = await q.balances(ws);
    expect(d.isEmpty).toBe(false);
    expect(d.currency).toEqual({ code: 'DOP', minorDigits: 2, symbol: 'RD$' });
    expect(d.balance.totalMinor).toBe(bal.totalMinor);
    expect(d.period).toMatchObject({ from: '2026-06-01', to: '2026-06-30', label: 'junio 2026' });
    expect(d.period.totals).toMatchObject({ inMinor: 5500, outMinor: 29000, count: 5 });
    expect(d.previousPeriod).toMatchObject({ from: '2026-05-01', to: '2026-05-31', label: 'mayo 2026' });
    expect(d.previousPeriod?.totals).toMatchObject({ inMinor: 90000, outMinor: 0 });
    expect(d.balance.periodChangeMinor).toBe(5500 - 29000);

    expect(d.flow.map((f) => f.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    expect(d.flow.map((f) => [f.inMinor, f.outMinor])).toEqual([
      [0, 0],
      [0, 0],
      [250050, 30000],
      [0, 120000],
      [90000, 0],
      [5500, 29000],
    ]);
    expect(d.series.keys).toEqual(d.flow.map((f) => f.key));
    expect(d.series.totalMinor.at(-1)).toBe(bal.totalMinor);
    expect(d.series.byAccount[caja]?.at(-1)).toBe(bal.byAccount[caja]);
    expect(d.series.byAccount[banco]?.[2]).toBe(500000);
    const sumAt = (i: number) => Object.values(d.series.byAccount).reduce((s, xs) => s + (xs[i] ?? 0), 0);
    expect(d.series.totalMinor.map((_, i) => sumAt(i))).toEqual(d.series.totalMinor);

    expect(d.accounts.map((a) => a.name)).toEqual(['Caja', 'Banco', 'Tarjeta']);
    expect(d.breakdown.field).toEqual({ id: cat.id, label: 'Categoría' });
    expect(d.breakdown.groups.map((g) => [g.label, g.current.outMinor, g.previous?.inMinor])).toEqual([
      ['Servicios', 29000, 0],
      ['Ventas', 0, 80000],
      ['Sin valor', 0, 10000],
    ]);
    const cur = d.breakdown.groups.reduce((s, g) => s + g.current.inMinor, 0);
    expect(cur).toBe(d.period.totals.inMinor);

    const contacts = d.top.find((t) => t.role === 'contact');
    expect(contacts?.field.id).toBe(contacto.id);
    expect(contacts?.byIn).toEqual([]);
    const cats = d.top.find((t) => t.role === 'category');
    expect(cats?.byOut.map((x) => [x.label, x.minor, x.count])).toEqual([['Servicios', 29000, 2]]);

    expect(d.attention.negativeAccounts.map((a) => a.name)).toEqual(['Tarjeta']);
    expect(d.attention.unbalancedBatches.map((b) => [b.batch.id, b.sumMinor, b.differenceMinor])).toEqual([[lote, 4500, -500]]);
    expect(d.attention.unbalancedBatches[0]?.batch.activeCount).toBe(2);
    expect(d.attention.backup).toEqual({
      lastVerifiedAt: '2026-05-01T10:00:00.000Z',
      daysSince: 45,
      reminderDays: 30,
      overdue: true,
    });
    expect(d.recent.map((r) => r.description)).toEqual([
      'Comisión',
      'Venta cuadrada',
      'Venta lote 2',
      'Venta lote 1',
      'Gasolina',
      'Intereses',
      'Venta Café molido',
      'Depósito',
    ]);
    expect(d.warnings).toEqual([]);

    // Reparto por contacto y por semanas; periodo de un año.
    const y = await q.dashboard(ws, {
      period: { preset: 'this_year' },
      breakdown: { by: 'field', fieldId: contacto.id },
      seriesUnit: 'week',
      measure: 'in',
    });
    expect(y.previousPeriod).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(y.breakdown.groups[0]).toMatchObject({ label: 'Juan', current: { inMinor: 330050 } });
    expect(y.series.keys[0]).toBe('2025-06-30');
    expect(y.series.totalMinor.at(-1)).toBe(bal.totalMinor);
    // Todo el historial: sin periodo anterior.
    const all = await q.dashboard(ws, { period: { preset: 'all' }, recentLimit: 0 });
    expect(all.previousPeriod).toBeNull();
    expect(all.period.totals.inMinor).toBe(340050 + 5500);
    expect(all.recent).toEqual([]);
    expect(all.breakdown.groups.every((g) => g.previous === null)).toBe(true);
  });

  it('dashboard: serie diaria del periodo (entradas, salidas y saldo al cierre) y posibles duplicados', async () => {
    const { q, ws, fx, caja, banco } = await seedBase();
    const d = await q.dashboard(ws, { period: { preset: 'this_month' } });
    // Junio de 2026 hasta hoy (15): un punto por día, sin futuro.
    expect(d.daily.map((x) => x.date)).toEqual(Array.from({ length: 15 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`));
    expect(d.daily.reduce((s, x) => s + x.inMinor, 0)).toBe(d.period.totals.inMinor);
    expect(d.daily.reduce((s, x) => s + x.outMinor, 0)).toBe(d.period.totals.outMinor);
    for (const x of d.daily) expect(x.netMinor).toBe(x.inMinor - x.outMinor);
    expect(d.daily.at(-1)?.balanceMinor).toBe(d.balance.totalMinor);
    const before = await q.balances(ws, { asOf: '2026-05-31' });
    expect(d.daily[0]!.balanceMinor - (d.daily[0]!.inMinor - d.daily[0]!.outMinor)).toBe(before.totalMinor);
    // Un periodo cerrado del pasado: todos sus días.
    const may = await q.dashboard(ws, { period: { from: '2026-05-01', to: '2026-05-31' } });
    expect(may.daily).toHaveLength(31);
    expect(may.daily.at(-1)?.balanceMinor).toBe(before.totalMinor);

    expect(d.attention.possibleDuplicates).toEqual({ count: 0, days: 90, items: [] });
    const a = await fx.expense(banco, 4321, '2026-06-10', 'Compra de mercancía');
    const b = await fx.expense(banco, 4321, '2026-06-12', 'Compra de mercancia');
    await fx.expense(banco, 4321, '2026-06-01', 'Otra cosa distinta'); // misma cifra, otra descripción
    await fx.expense(caja, 4321, '2026-06-11', 'Compra de mercancía'); // otra cuenta
    await fx.income(banco, 777, '2026-06-13', 'Venta');
    await fx.income(banco, 777, '2026-06-13', 'Venta', { voided: 'Repetido' }); // la copia ya anulada no cuenta
    const dup = (await q.dashboard(ws)).attention.possibleDuplicates;
    expect(dup.count).toBe(1);
    expect(dup.items).toEqual([{ transactionId: b, duplicateOfId: a }]);
  });

  it('dashboard de un espacio vacío no falla', async () => {
    h = await createTestCuadra();
    const fx: LedgerFixture = ledgerFixture(h.driver, h.ids);
    const ws = await fx.workspace();
    const d = await h.cuadra.queries.dashboard(ws);
    expect(d.isEmpty).toBe(true);
    expect(d.balance.totalMinor).toBe(0);
    expect(d.breakdown.groupBy).toEqual({ by: 'account' });
    expect(d.top).toEqual([]);
    expect(d.series.keys).toHaveLength(d.series.totalMinor.length);
    expect(d.attention.backup.overdue).toBe(false);
    expect(d.daily).toEqual([]);
    expect(d.attention.possibleDuplicates.count).toBe(0);
  });
});
