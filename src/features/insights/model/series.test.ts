import { describe, expect, it } from 'vitest';
import { FixedClock, type Currency, type Field, type SummaryGroup, type SummaryResult } from '../../../core';
import {
  buildPoints,
  change,
  cumulative,
  axisLabel,
  domainOf,
  groupTxFilter,
  labelStep,
  measureOf,
  movementsHref,
  shortPeriodLabel,
  span,
  sumGroups,
  tableRows,
} from './series';
import { normalizeFilter, readLedgerSearch } from '../../../app/data/txFilterUrl';
import { csvFileName, sheetToCsv, summarySheet } from './csv';

const g = (key: string | null, label: string, inMinor: number, outMinor: number, count: number, split?: SummaryGroup[]): SummaryGroup => ({
  key,
  label,
  color: null,
  inactive: false,
  inMinor,
  outMinor,
  netMinor: inMinor - outMinor,
  count,
  ...(split === undefined ? {} : { split }),
});

const FIELD_ID = '0190a1b2-0000-7000-8000-000000000001';
const OPT = '0190a1b2-0000-7000-8000-0000000000aa';
const fields = [{ id: FIELD_ID, type: 'list' } as Field];

describe('medidas y puntos', () => {
  const groups = [g('2026-01', 'enero 2026', 1000, 400, 3), g('2026-02', 'febrero 2026', 0, 900, 2)];
  it('measureOf', () => {
    expect(groups.map((x) => measureOf(x, 'net'))).toEqual([600, -900]);
    expect(groups.map((x) => measureOf(x, 'count'))).toEqual([3, 2]);
  });

  it('el anterior se alinea por posición desde el final en el tiempo y por clave en dimensiones', () => {
    const prev = [g('2025-11', 'n', 0, 1, 1), g('2025-12', 'd', 0, 50, 1), g('2026-01', 'e', 0, 70, 1)];
    expect(buildPoints(groups, 'out', prev, true).map((p) => p.prev)).toEqual([50, 70]);
    expect(buildPoints(groups, 'out', prev, false).map((p) => p.prev)).toEqual([70, 0]);
    expect(buildPoints(groups, 'out', null, true).map((p) => p.prev)).toEqual([null, null]);
  });

  it('suma de grupos y variación entera', () => {
    expect(sumGroups(groups)).toEqual({ inMinor: 1000, outMinor: 1300, netMinor: -300, count: 5 });
    expect(change(150, 100)).toEqual({ diff: 50, ratio: 0.5 });
    expect(change(-50, -100).ratio).toBe(0.5);
    expect(change(10, 0).ratio).toBeNull();
  });
});

describe('escalas', () => {
  it('el dominio contiene el cero y redondea bonito', () => {
    expect(domainOf([120, 480])).toEqual({ lo: 0, hi: 500 });
    expect(domainOf([-30, 70])).toEqual({ lo: -30, hi: 80 });
    expect(domainOf([0, 145_000_000]).hi).toBe(150_000_000);
    expect(axisLabel(-200, (v) => `RD$${v}`)).toBe('\u2212RD$200');
    expect(axisLabel(200, (v) => `RD$${v}`)).toBe('RD$200');
    expect(domainOf([0, 0])).toEqual({ lo: 0, hi: 1 });
  });

  it('span vertical y horizontal', () => {
    const d = { lo: -50, hi: 100 };
    expect(span(d, 0, 100, true)).toEqual({ start: 0, size: (100 / 150) * 100 });
    expect(span(d, -50, 0, false)).toEqual({ start: 0, size: (50 / 150) * 100 });
  });

  it('acumulado y paso de etiquetas', () => {
    expect(cumulative([5, -2, 3])).toEqual([5, 3, 6]);
    expect(labelStep(12, 12)).toBe(1);
    expect(labelStep(365, 12)).toBe(31);
  });

  it('etiquetas cortas de periodo', () => {
    expect(shortPeriodLabel('2026-03', 'month', false)).toBe('mar');
    expect(shortPeriodLabel('2026-03', 'month', true)).toBe('mar 26');
    expect(shortPeriodLabel('2027-01', 'month', false)).toBe('ene 27');
    expect(shortPeriodLabel('2026-Q4', 'quarter', false)).toBe('T4 26');
    expect(shortPeriodLabel('2026-03-24', 'week', false)).toBe('24 mar');
    expect(shortPeriodLabel(null, 'day', false)).toBe('');
  });
});

describe('tabla y enlaces', () => {
  it('subgrupos debajo de su grupo, sin los vacíos', () => {
    const p = buildPoints([g('a', 'A', 10, 0, 1, [g('x', 'X', 10, 0, 1), g('y', 'Y', 0, 0, 0)])], 'in', null, false);
    expect(tableRows(p).map((r) => [r.id, r.depth])).toEqual([
      ['a', 0],
      ['a/x', 1],
    ]);
  });

  it('el filtro de un grupo de mes con subgrupo de campo abre exactamente esos movimientos', () => {
    const clock = new FixedClock('2026-11-27');
    const f = groupTxFilter(
      { period: { preset: 'this_year' }, accountIds: ['a1'] },
      { by: 'period', unit: 'month' },
      '2026-03',
      { fields, clock },
      { split: { by: 'field', fieldId: FIELD_ID }, key: OPT },
    );
    expect(f).toEqual({
      period: { from: '2026-03-01', to: '2026-03-31' },
      accountIds: ['a1'],
      kinds: ['income', 'expense'],
      fields: [{ fieldId: FIELD_ID, op: 'any_of', optionIds: [OPT] }],
    });
    const href = movementsHref('ws1', f);
    expect(href.startsWith('/e/ws1/movimientos?')).toBe(true);
    // Lo que Movimientos lee de ese enlace es exactamente el filtro del grupo.
    const read = readLedgerSearch(new URLSearchParams(href.split('?')[1]), { period: { preset: 'this_month' } });
    expect(read.filter).toEqual(normalizeFilter(f));
  });
});

describe('CSV', () => {
  const result: SummaryResult = {
    groups: [g('a', '=Caja', 12345, 0, 1, [g('2026-01', 'enero 2026', 12345, 0, 1)]), g('b', 'Banco', 0, 500, 2, [g('2026-01', 'enero 2026', 0, 500, 2)])],
    totals: { inMinor: 12345, outMinor: 500, netMinor: 11845, transfersInMinor: 0, transfersOutMinor: 0, openingsMinor: 0, count: 3, voidedCount: 0 },
    period: { from: '2026-01-01', to: '2026-01-31', label: 'enero 2026' },
    filtered: false,
    filterDescription: [],
    warnings: [],
  };
  const currency: Currency = { code: 'DOP', minorDigits: 2, symbol: 'RD$' };

  it('pasa por sheetToRows: decimales canónicos, fórmulas neutralizadas y total', () => {
    const csv = sheetToCsv(summarySheet({ result, currency, groupHeader: 'Cuenta', splitHeader: 'Mes', name: 'Resumen' }));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Cuenta,Mes,Entrada,Salida,Neto,Movimientos');
    expect(lines[1]).toBe("'=Caja,,123.45,0.00,123.45,1");
    expect(lines.at(-1)).toBe('Total,,123.45,5.00,118.45,3');
  });

  it('con comparación añade la columna del anterior en grupos y total', () => {
    const points = buildPoints(result.groups, 'out', [g('a', 'A', 0, 100, 1), g('b', 'B', 0, 300, 1)], false);
    const sheet = summarySheet({ result, currency, groupHeader: 'Cuenta', splitHeader: 'Mes', name: 'R', compare: { header: 'Anterior', points, money: true } });
    const rows = sheetToCsv(sheet).split('\r\n');
    expect(rows[0]?.endsWith(',Anterior')).toBe(true);
    expect(rows[1]?.endsWith(',1.00')).toBe(true);
    expect(rows[2]?.endsWith(',')).toBe(true);
    expect(rows.at(-1)?.endsWith(',4.00')).toBe(true);
  });

  it('nombre de archivo', () => {
    expect(csvFileName('Gastos por categoría', '2026-11-27')).toBe('resumen-gastos-por-categoria-2026-11-27.csv');
    expect(csvFileName('Resumen', '2026-11-27')).toBe('resumen-2026-11-27.csv');
  });
});
