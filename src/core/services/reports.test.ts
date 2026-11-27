import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { addDays } from '../dates';
import { isDomainError } from '../errors';
import { reportToSheets, sheetToRows, type Sheet } from '../export/tabular';
import type { Direction, Id, IsoDate, StatementLine, TxFilter, TxKind } from '../types';
import { ledgerFixture, prng } from './ledger.fixture';
import { statementBalances, type ReportRecipe } from './reports';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

const identity = (s: StatementLine) =>
  s.periodOpeningMinor + s.openingsInPeriodMinor + s.inMinor - s.outMinor + s.transfersInMinor - s.transfersOutMinor;

async function seed() {
  h = await createTestCuadra();
  const fx = ledgerFixture(h.driver, h.ids);
  const ws = await fx.workspace({ name: 'Estudio Brisa', ownerName: 'Brisa, SRL' });
  const caja = await fx.account(ws, 'Caja');
  const banco = await fx.account(ws, 'Banco', { type: 'bank' });
  const tarjeta = await fx.account(ws, 'Tarjeta', { type: 'card' });
  const cat = await fx.field(ws, { key: 'categoria', label: 'Categoría', type: 'list', role: 'category', options: ['Honorarios', 'Oficina'] });
  const conc = await fx.field(ws, { key: 'conciliado', label: 'Conciliado', type: 'bool' });
  await fx.opening(caja, 50000, '2026-01-01');
  await fx.opening(banco, 300000, '2026-01-01');
  await fx.income(banco, 200000, '2026-04-10', 'Honorarios abril', { values: { [cat.id]: { option: cat.opt['Honorarios']! } } });
  await fx.expense(caja, 15000, '2026-04-12', 'Papel', { values: { [cat.id]: { option: cat.opt['Oficina']! }, [conc.id]: { bool: true } } });
  await fx.transfer(banco, caja, 40000, '2026-04-20', 'Retiro');
  // Saldo inicial de la tarjeta fechado DENTRO del periodo: va en su propia línea.
  await fx.opening(tarjeta, 25000, '2026-04-05', 'out');
  await fx.expense(tarjeta, 8000, '2026-04-25', 'Software', { values: { [cat.id]: { option: cat.opt['Oficina']! } } });
  const voidedId = await fx.expense(caja, 999, '2026-04-26', 'Error de captura', { voided: 'Duplicado' });
  await fx.income(banco, 100000, '2026-05-02', 'Honorarios mayo', { values: { [cat.id]: { option: cat.opt['Honorarios']! } } });
  return { h, fx, ws, caja, banco, tarjeta, cat, conc, voidedId, reports: h.cuadra.reports };
}

describe('reports: estado y secciones', () => {
  it('identidad del estado: inicial + iniciales del periodo + entradas − salidas + transf. = final, por cuenta y total', async () => {
    const { reports, ws, caja, banco, tarjeta } = await seed();
    const doc = await reports.build(ws, reports.preset('summary', { from: '2026-04-01', to: '2026-04-30' }));
    expect(doc.statement).toEqual<StatementLine>({
      periodOpeningMinor: 350000,
      openingsInPeriodMinor: -25000,
      inMinor: 200000,
      outMinor: 23000,
      transfersInMinor: 40000,
      transfersOutMinor: 40000,
      closingMinor: 502000,
    });
    expect(statementBalances(doc.statement)).toBe(true);
    const lines = Object.fromEntries(doc.byAccount.map((l) => [l.account.id, l]));
    expect(lines[caja]).toMatchObject({ periodOpeningMinor: 50000, outMinor: 15000, transfersInMinor: 40000, closingMinor: 75000 });
    expect(lines[banco]).toMatchObject({ periodOpeningMinor: 300000, inMinor: 200000, transfersOutMinor: 40000, closingMinor: 460000 });
    expect(lines[tarjeta]).toMatchObject({ periodOpeningMinor: 0, openingsInPeriodMinor: -25000, outMinor: 8000, closingMinor: -33000 });
    for (const line of doc.byAccount) expect(identity(line)).toBe(line.closingMinor);
    // El saldo final de cada cuenta es su saldo real a la fecha de cierre.
    const atClose = await h!.cuadra.queries.balances(ws, { asOf: '2026-04-30' });
    for (const line of doc.byAccount) expect(line.closingMinor).toBe(atClose.byAccount[line.account.id]);
    expect(doc.statement.closingMinor).toBe(atClose.totalMinor);
    // Transferencias en su línea, con origen y destino.
    expect(doc.transfers).toEqual([{ date: '2026-04-20', fromAccountId: banco, toAccountId: caja, amountMinor: 40000, description: 'Retiro' }]);
    // Reparto por la categoría (por defecto, el campo con rol categoría).
    expect(doc.byField.map((b) => [b.field.label, b.groups.map((g) => [g.label, g.inMinor, g.outMinor])])).toEqual([
      ['Categoría', [['Honorarios', 200000, 0], ['Oficina', 0, 23000]]],
    ]);
    expect(doc.movements).toBeNull();
    expect(doc.voided).toBeNull();
    expect(doc.audit).toBeNull();
    expect(doc.meta).toMatchObject({
      workspaceName: 'Estudio Brisa',
      ownerName: 'Brisa, SRL',
      form: 'summary',
      period: { from: '2026-04-01', to: '2026-04-30', label: 'abril 2026' },
      generatedAt: '2026-06-15T12:00:00.000Z',
      filtered: false,
      includeVoided: false,
    });
  });

  it('la identidad se cumple con libros, periodos y filtros aleatorios (casos deterministas)', async () => {
    h = await createTestCuadra();
    const fx = ledgerFixture(h.driver, h.ids);
    const ws = await fx.workspace();
    const accounts = [await fx.account(ws, 'A'), await fx.account(ws, 'B'), await fx.account(ws, 'C', { type: 'card' })];
    const cat = await fx.field(ws, { key: 'categoria', label: 'Categoría', type: 'list', role: 'category', options: ['X', 'Y', 'Z'] });
    const optionIds = Object.values(cat.opt);
    const rnd = prng(20261127);
    const int = (n: number) => Math.floor(rnd() * n);
    const day = (): IsoDate => addDays('2025-01-01', int(560));

    // Oráculo independiente: lo que se escribe, en JS.
    type Rec = { account: Id; kind: TxKind; direction: Direction; amount: number; date: IsoDate; active: boolean; option: Id | null };
    const recs: Rec[] = [];
    for (const [i, account] of accounts.entries()) {
      const direction: Direction = i === 2 ? 'out' : 'in';
      const amount = 1000 + int(900000);
      const date = day();
      const active = rnd() > 0.15;
      const id = await fx.opening(account, amount, date, direction);
      if (!active) await fx.voidTx(id);
      recs.push({ account, kind: 'opening', direction, amount, date, active, option: null });
    }
    for (let n = 0; n < 260; n++) {
      const account = accounts[int(3)]!;
      const date = day();
      const amount = int(5) === 0 ? 0 : 1 + int(2_000_000);
      const active = rnd() > 0.1;
      const r = rnd();
      if (r < 0.2) {
        const to = accounts.filter((a) => a !== account)[int(2)]!;
        const pair = await fx.transfer(account, to, amount, date, `T${n}`);
        if (!active) {
          await fx.voidTx(pair.out);
          await fx.voidTx(pair.in);
        }
        recs.push({ account, kind: 'transfer', direction: 'out', amount, date, active, option: null });
        recs.push({ account: to, kind: 'transfer', direction: 'in', amount, date, active, option: null });
      } else {
        const kind: TxKind = r < 0.55 ? 'income' : 'expense';
        const option = int(4) === 0 ? null : optionIds[int(3)]!;
        const id = await fx.tx(
          account,
          { kind, amount, date, description: `M${n}` },
          option ? { values: { [cat.id]: { option } } } : {},
        );
        if (!active) await fx.voidTx(id);
        recs.push({ account, kind, direction: kind === 'income' ? 'in' : 'out', amount, date, active, option });
      }
    }

    const signed = (x: Rec) => (x.direction === 'in' ? x.amount : -x.amount);
    for (let c = 0; c < 40; c++) {
      const a = day();
      const b = day();
      const from = int(6) === 0 ? null : a < b ? a : b;
      const to = int(6) === 0 ? null : a < b ? b : a;
      const filter: TxFilter = {};
      if (from !== null || to !== null) filter.period = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
      if (int(2) === 0) filter.accountIds = accounts.filter(() => rnd() < 0.6);
      if (int(3) === 0) filter.kinds = (['income', 'expense', 'transfer', 'opening'] as const).filter(() => rnd() < 0.6);
      const option = int(4) === 0 ? optionIds[int(3)]! : null;
      if (option) filter.fields = [{ fieldId: cat.id, op: 'any_of', optionIds: [option] }];

      const recipe: ReportRecipe = { ...h.cuadra.reports.preset('detailed', { preset: 'all' }), filter };
      const doc = await h.cuadra.reports.build(ws, recipe);
      const label = JSON.stringify(filter);

      // Identidad por línea y total; total = suma de líneas.
      expect(identity(doc.statement), label).toBe(doc.statement.closingMinor);
      for (const line of doc.byAccount) expect(identity(line), label).toBe(line.closingMinor);
      const keys = Object.keys(doc.statement) as Array<keyof StatementLine>;
      for (const k of keys) {
        expect(doc.byAccount.reduce((s, l) => s + l[k], 0), `${label} ${k}`).toBe(doc.statement[k]);
      }

      // Frente al oráculo.
      const match = (x: Rec) =>
        x.active &&
        (!filter.accountIds?.length || filter.accountIds.includes(x.account)) &&
        (!filter.kinds?.length || filter.kinds.includes(x.kind)) &&
        (option === null || x.option === option) &&
        (to === null || x.date <= to);
      const inPeriod = (x: Rec) => from === null || x.date >= from;
      const sel = recs.filter(match);
      const sum = (xs: Rec[], f: (x: Rec) => number) => xs.reduce((s, x) => s + f(x), 0);
      const expected: StatementLine = {
        periodOpeningMinor: sum(sel.filter((x) => !inPeriod(x)), signed),
        openingsInPeriodMinor: sum(sel.filter((x) => inPeriod(x) && x.kind === 'opening'), signed),
        inMinor: sum(sel.filter((x) => inPeriod(x) && x.kind === 'income'), (x) => x.amount),
        outMinor: sum(sel.filter((x) => inPeriod(x) && x.kind === 'expense'), (x) => x.amount),
        transfersInMinor: sum(sel.filter((x) => inPeriod(x) && x.kind === 'transfer' && x.direction === 'in'), (x) => x.amount),
        transfersOutMinor: sum(sel.filter((x) => inPeriod(x) && x.kind === 'transfer' && x.direction === 'out'), (x) => x.amount),
        closingMinor: sum(sel, signed),
      };
      expect(doc.statement, label).toEqual(expected);

      // Sin filtros más que el periodo, el cierre es el saldo real a esa fecha (I-1, I-2).
      if (!filter.accountIds && !filter.kinds && option === null) {
        const bal = await h.cuadra.queries.balances(ws, to ? { asOf: to } : {});
        expect(doc.statement.closingMinor, label).toBe(bal.totalMinor);
        // I-4: en el espacio, transferencias entrantes = salientes.
        expect(doc.statement.transfersInMinor).toBe(doc.statement.transfersOutMinor);
      }
      // Movimientos del detallado = filas del periodo que cumplen el filtro, en orden cronológico.
      const movements = doc.movements ?? [];
      expect(movements.length, label).toBe(sel.filter(inPeriod).length);
      expect(movements.map((m) => m.date)).toEqual([...movements.map((m) => m.date)].sort());
      // Grupos por categoría suman las entradas y salidas del estado.
      const groups = doc.byField[0]?.groups ?? [];
      expect(groups.reduce((s, g) => s + g.inMinor, 0), label).toBe(doc.statement.inMinor);
      expect(groups.reduce((s, g) => s + g.outMinor, 0), label).toBe(doc.statement.outMinor);
    }
  });

  it('informe detallado lista anulados aparte solo si includeVoided', async () => {
    const { reports, ws, caja, voidedId } = await seed();
    const base = reports.preset('detailed', { from: '2026-04-01', to: '2026-04-30' });
    const plain = await reports.build(ws, base);
    expect(plain.voided).toBeNull();
    expect(plain.movements?.map((m) => m.description)).toEqual(['Saldo inicial', 'Honorarios abril', 'Papel', 'Retiro', 'Retiro', 'Software']);
    expect(plain.movements?.some((m) => m.status === 'voided')).toBe(false);

    const withVoided = await reports.build(ws, { ...base, includeVoided: true });
    expect(withVoided.meta.includeVoided).toBe(true);
    expect(withVoided.voided?.map((m) => [m.id, m.status, m.voidReason])).toEqual([[voidedId, 'voided', 'Duplicado']]);
    // El anulado no cambia el estado.
    expect(withVoided.statement).toEqual(plain.statement);
    expect(withVoided.movements).toEqual(plain.movements);

    // De una sola cuenta: saldo corrido real en el detallado.
    const one = await reports.build(ws, { ...base, filter: { ...base.filter, accountIds: [caja] } });
    expect(one.movements?.map((m) => [m.description, m.runningMinor])).toEqual([
      ['Papel', 35000],
      ['Retiro', 75000],
    ]);
    expect(one.movements?.at(-1)?.runningMinor).toBe(one.statement.closingMinor);
  });

  it('informe con filtros marca filtered y describe los filtros', async () => {
    const { reports, ws, caja, cat } = await seed();
    const base = reports.preset('summary', { preset: 'this_year' });
    const doc = await reports.build(ws, {
      ...base,
      filter: { ...base.filter, accountIds: [caja], fields: [{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Oficina']!] }] },
    });
    expect(doc.meta.filtered).toBe(true);
    expect(doc.meta.filterDescription).toEqual(['Periodo: Este año', 'Cuenta: Caja', 'Categoría: Oficina']);
    expect(doc.byAccount.map((l) => l.account.name)).toEqual(['Caja']);
    expect(doc.statement).toMatchObject({ outMinor: 15000, inMinor: 0, closingMinor: -15000 });
    expect(statementBalances(doc.statement)).toBe(true);
    const unfiltered = await reports.build(ws, base);
    expect(unfiltered.meta.filtered).toBe(false);
    expect(unfiltered.meta.filterDescription).toEqual(['Periodo: Este año']);
  });

  it('secciones de historial y firma; avisos de campos desactivados; recetas inválidas', async () => {
    const { reports, ws, fx, conc, h: th } = await seed();
    // Una acción de historial dentro del periodo (vía vistas guardadas, que escriben historial).
    await th.cuadra.views.save({ workspaceId: ws, name: 'Mi vista', recipe: { v: 1, kind: 'filter', filter: {} } });
    await fx.deactivateField(conc.id);
    const doc = await reports.build(ws, {
      ...reports.preset('summary', { preset: 'this_month' }),
      form: 'custom',
      sections: ['header', 'statement', 'by_field', 'audit', 'signature'],
      groupByFieldIds: [conc.id],
    });
    expect(doc.signature).toBe(true);
    expect(doc.audit?.map((a) => [a.action, a.entityType, a.message])).toEqual([['create', 'view', 'audit.view.create']]);
    expect(doc.meta.warnings).toEqual([{ code: 'field_inactive', fieldId: conc.id }]);
    expect(doc.byField[0]?.groups.map((g) => [g.label, g.count])).toEqual([['Sí', 0], ['No', 0]]);
    expect(doc.transfers).toEqual([]);

    const bad = await reports.build(ws, { v: 1, kind: 'filter', filter: {} } as unknown as ReportRecipe).catch((e: unknown) => e);
    expect(isDomainError(bad, 'invalid_recipe')).toBe(true);
    expect(() => reports.preset('summary', { from: '2026-02-31' })).toThrow('invalid_recipe');
    const ghost = await reports.build('nope', reports.preset('summary', { preset: 'all' })).catch((e: unknown) => e);
    expect(isDomainError(ghost, 'not_found')).toBe(true);
  });

  it('preset arma las recetas resumida y detallada', () => {
    return (async () => {
      const { reports } = await seed();
      expect(reports.preset('summary', { preset: 'last_month' })).toEqual({
        v: 1,
        kind: 'report',
        form: 'summary',
        filter: { period: { preset: 'last_month' } },
        sections: ['header', 'statement', 'by_account', 'by_field', 'transfers'],
        groupByFieldIds: [],
        columns: [],
        includeVoided: false,
        signature: false,
      });
      expect(reports.preset('detailed', { preset: 'all' }).sections).toContain('movements');
    })();
  });
});

describe('reports: exportación tabular', () => {
  it('reportToSheets produce columnas de dinero en unidad menor y tipos correctos', async () => {
    const { reports, ws, cat } = await seed();
    const doc = await reports.build(ws, {
      ...reports.preset('detailed', { from: '2026-04-01', to: '2026-04-30' }),
      includeVoided: true,
      sections: ['header', 'statement', 'by_account', 'by_field', 'transfers', 'movements', 'audit'],
    });
    const sheets = reportToSheets(doc);
    const byName = Object.fromEntries(sheets.map((s) => [s.name, s])) as Record<string, Sheet>;
    expect(sheets.map((s) => s.name)).toEqual(['Resumen', 'Por cuenta', 'Categoría', 'Transferencias', 'Movimientos', 'Anulados', 'Historial']);

    // Cada fila tiene tantas celdas como columnas; cada celda cumple el tipo de su columna.
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        expect(row).toHaveLength(sheet.columns.length);
        row.forEach((cell, i) => {
          const type = sheet.columns[i]!.type;
          if (cell === null) return;
          if (type === 'money' || type === 'integer') expect(Number.isSafeInteger(cell), `${sheet.name} ${i}`).toBe(true);
          if (type === 'number') expect(typeof cell).toBe('number');
          if (type === 'date') expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          if (type === 'text') expect(typeof cell).toBe('string');
        });
      }
    }
    const summary = byName['Resumen']!;
    expect(summary.currency).toEqual({ code: 'DOP', minorDigits: 2, symbol: 'RD$' });
    expect(summary.rows.at(-1)).toEqual(['Saldo final', 502000]);
    expect(summary.rows).toContainEqual(['Saldos iniciales en el periodo', -25000]);

    const accounts = byName['Por cuenta']!;
    expect(accounts.columns.map((c) => c.type)).toEqual(['text', 'money', 'money', 'money', 'money', 'money', 'money', 'money']);
    expect(accounts.rows.at(-1)).toEqual(['Total', 350000, -25000, 200000, 23000, 40000, 40000, 502000]);

    const movements = byName['Movimientos']!;
    const col = (key: string) => movements.columns.findIndex((c) => c.key === key);
    expect(movements.columns.find((c) => c.key === 'in')?.type).toBe('money');
    expect(movements.columns.find((c) => c.key === 'seq')?.type).toBe('integer');
    expect(movements.columns.find((c) => c.key === 'date')?.type).toBe('date');
    expect(movements.columns.find((c) => c.key === cat.id)).toEqual({ key: cat.id, header: 'Categoría', type: 'text' });
    const honorarios = movements.rows.find((r) => r[col('description')] === 'Honorarios abril')!;
    expect(honorarios[col('in')]).toBe(200000);
    expect(honorarios[col('out')]).toBeNull();
    expect(honorarios[col(cat.id)]).toBe('Honorarios');
    expect(honorarios[col('kind')]).toBe('Entrada');
    const retiro = movements.rows.filter((r) => r[col('description')] === 'Retiro');
    expect(retiro.map((r) => r[col('counterpart')]).sort()).toEqual(['Banco', 'Caja']);

    // Para CSV el dinero sale como texto decimal canónico.
    const csv = sheetToRows(accounts);
    expect(csv[0]).toEqual(accounts.columns.map((c) => c.header));
    expect(csv.at(-1)).toEqual(['Total', '3500.00', '-250.00', '2000.00', '230.00', '400.00', '400.00', '5020.00']);

    // Traducción: t manda; si devuelve la clave, español por defecto.
    const t = (key: string) => (key === 'export.sheet.summary' ? 'Summary' : key);
    expect(reportToSheets(doc, t).map((s) => s.name)[0]).toBe('Summary');
  });
});
