import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../core';
import { areaGeometry, changeRatio, dayNet, flowGeometry, groupByDay, monthTicks, nearestIndex, niceDomain, niceStep, seriesKeyMonth, seriesPointEnd, slotIndex, stepIndex, tail, tipSide } from './chart';
import { findPossibleDuplicates, similarDescriptions } from './duplicates';
import { normalizeFilter, readLedgerSearch } from '../../../app/data/txFilterUrl';
import { movementsHref } from './links';
import { desktopOptions, formatPeriodParam, monthInRange, parsePeriodParam, periodFilter, periodRange, presetFor, shortPeriodLabel } from './period';

const TODAY = '2026-11-27';

describe('periodo', () => {
  it('mes actual y anteriores', () => {
    expect(periodRange({ kind: 'month', offset: 0 }, TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange({ kind: 'month', offset: -1 }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange({ kind: 'month', offset: -9 }, TODAY)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange({ kind: 'month', offset: -11 }, TODAY)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('trimestre, año y 12 meses', () => {
    expect(periodRange({ kind: 'quarter', offset: 0 }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange({ kind: 'quarter', offset: -1 }, TODAY)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodRange({ kind: 'quarter', offset: -4 }, '2026-01-15')).toEqual({ from: '2025-01-01', to: '2025-03-31' });
    expect(periodRange({ kind: 'year', offset: -1 }, TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodRange({ kind: '12m', offset: 0 }, TODAY)).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(periodRange({ kind: '12m', offset: -1 }, TODAY)).toEqual({ from: '2024-12-01', to: '2025-11-30' });
  });
  it('nunca mira al futuro', () => {
    expect(periodRange({ kind: 'month', offset: 3 }, TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('preset solo para el periodo actual', () => {
    expect(presetFor({ kind: 'quarter', offset: 0 })).toBe('this_quarter');
    expect(presetFor({ kind: 'month', offset: -1 })).toBeNull();
    expect(periodFilter({ kind: '12m', offset: 0 }, TODAY)).toEqual({ preset: 'last_12_months' });
    expect(periodFilter({ kind: 'month', offset: -1 }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(desktopOptions({ kind: 'month', offset: 0 }, TODAY, { measure: 'in' })).toMatchObject({ months: 12, seriesUnit: 'week', measure: 'in' });
  });
  it('lee y escribe el parámetro de la URL', () => {
    expect(parsePeriodParam(null)).toEqual({ kind: 'month', offset: 0 });
    expect(parsePeriodParam('year:-2')).toEqual({ kind: 'year', offset: -2 });
    expect(parsePeriodParam('raro:5')).toEqual({ kind: 'month', offset: 0 });
    expect(parsePeriodParam('quarter:1.5')).toEqual({ kind: 'quarter', offset: 0 });
    expect(formatPeriodParam({ kind: '12m', offset: 0 })).toBe('12m');
    expect(formatPeriodParam({ kind: 'month', offset: -3 })).toBe('month:-3');
  });
  it('etiqueta corta del periodo anterior', () => {
    expect(shortPeriodLabel('octubre 2026', 'noviembre 2026')).toBe('octubre');
    expect(shortPeriodLabel('diciembre 2025', 'enero 2026')).toBe('diciembre 2025');
    expect(shortPeriodLabel('T3 2026', 'T4 2026')).toBe('T3');
    expect(shortPeriodLabel('2025', '2026')).toBe('2025');
    expect(shortPeriodLabel('1 nov 2025 – 30 nov 2025', 'x')).toBe('1 nov 2025 – 30 nov 2025');
  });
  it('mes dentro de un rango', () => {
    expect(monthInRange('2026-11', { from: '2026-10-01', to: '2026-12-31' })).toBe(true);
    expect(monthInRange('2026-09', { from: '2026-10-01', to: '2026-12-31' })).toBe(false);
    expect(monthInRange('2026-09', { from: null, to: null })).toBe(true);
  });
});

describe('enlaces a Movimientos', () => {
  const read = (href: string) => readLedgerSearch(new URLSearchParams(href.split('?')[1] ?? ''), { period: { preset: 'this_month' } });
  it('filtro simple: periodo legible y cuenta, sin f', () => {
    expect(movementsHref('ws', { period: { preset: 'last_month' }, accountIds: ['a1'] })).toBe('/e/ws/movimientos?periodo=last_month&cuenta=a1');
    expect(movementsHref('ws', {})).toBe('/e/ws/movimientos');
  });
  it('filtro compuesto: Movimientos lee exactamente el mismo filtro', () => {
    const filter = { period: { from: '2026-10-01', to: '2026-10-31' }, kinds: ['expense' as const], text: 'Categoría ñ' };
    const href = movementsHref('ws', filter);
    expect(new URLSearchParams(href.split('?')[1]).get('periodo')).toBe('2026-10-01..2026-10-31');
    expect(read(href).filter).toEqual(normalizeFilter(filter));
  });
});

const tx = (p: Partial<Transaction> & { id: string }): Transaction =>
  ({
    workspaceId: 'w',
    accountId: 'caja',
    seq: 1,
    kind: 'expense',
    direction: 'out',
    amountMinor: 50000,
    date: '2026-11-20',
    description: 'Compra de hielo',
    notes: '',
    status: 'active',
    voidReason: null,
    voidedAt: null,
    batchId: null,
    transferGroupId: null,
    counterpart: null,
    recordedAt: '',
    updatedAt: '',
    values: {},
    ...p,
  }) as Transaction;

describe('posibles duplicados', () => {
  it('descripción parecida', () => {
    expect(similarDescriptions('Compra de hielo', 'compra de  HIELO')).toBe(true);
    expect(similarDescriptions('Compra de hielo', 'Compra de hiela')).toBe(true);
    expect(similarDescriptions('Luz', 'Agua')).toBe(false);
    expect(similarDescriptions('', '')).toBe(false);
  });
  it('mismo monto, cuenta y tipo a ± 3 días', () => {
    const rows = [
      tx({ id: 'a', seq: 3, date: '2026-11-22' }),
      tx({ id: 'b', seq: 2, date: '2026-11-20' }),
      tx({ id: 'c', seq: 1, date: '2026-11-10' }), // fuera de la ventana
      tx({ id: 'd', seq: 4, date: '2026-11-22', accountId: 'banco' }), // otra cuenta
      tx({ id: 'e', seq: 5, date: '2026-11-21', amountMinor: 50001 }), // otro monto
      tx({ id: 'f', seq: 6, date: '2026-11-21', status: 'voided' }), // anulado
    ];
    const pairs = findPossibleDuplicates(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.latest.id).toBe('a');
    expect(pairs[0]?.earlier.id).toBe('b');
    expect(pairs[0]).toMatchObject({ from: '2026-11-20', to: '2026-11-22', amountMinor: 50000 });
  });
  it('cada movimiento entra en un solo par y las transferencias no cuentan', () => {
    const rows = [
      tx({ id: 'a', seq: 3, date: '2026-11-22' }),
      tx({ id: 'b', seq: 2, date: '2026-11-22' }),
      tx({ id: 'c', seq: 1, date: '2026-11-21' }),
      tx({ id: 't1', seq: 9, kind: 'transfer', date: '2026-11-22' }),
      tx({ id: 't2', seq: 8, kind: 'transfer', date: '2026-11-22' }),
    ];
    const pairs = findPossibleDuplicates(rows);
    expect(pairs.map((p) => [p.latest.id, p.earlier.id])).toEqual([['a', 'b']]);
  });
});

describe('geometría', () => {
  it('cambio relativo', () => {
    expect(changeRatio(112, 100)).toBeCloseTo(0.12);
    expect(changeRatio(-50, -100)).toBeCloseTo(0.5);
    expect(changeRatio(10, 0)).toBeNull();
  });
  it('barras espejadas con escala común', () => {
    const g = flowGeometry(
      [
        { key: '2026-10', inMinor: 1000, outMinor: 500, netMinor: 500 },
        { key: '2026-11', inMinor: 0, outMinor: 1000, netMinor: -1000 },
      ],
      200,
      100,
      0,
    );
    expect([g.top, g.bottom]).toEqual([1000, 1000]);
    expect(g.slot).toBe(100);
    expect(g.mid).toBe(50);
    expect(g.bars[0]).toMatchObject({ hIn: 50, yIn: 0, hOut: 25, yNet: 25, cx: 50 });
    expect(g.bars[1]).toMatchObject({ hIn: 0, hOut: 50, yNet: 100 });
    expect(g.ticks.map((t) => t.value)).toEqual([-1000, -500, 0, 500, 1000]);
  });
  it('el eje reparte la altura entre entradas y salidas con la misma escala', () => {
    const g = flowGeometry(
      [
        { key: '2026-10', inMinor: 145_000_000, outMinor: 80_000_000, netMinor: 65_000_000 },
        { key: '2026-11', inMinor: 88_000_000, outMinor: 84_000_000, netMinor: 4_000_000 },
      ],
      200,
      250,
      0,
    );
    // Paso de RD$500,000: arriba 1.5 M, abajo 1 M → el eje queda a 3/5 de la altura.
    expect([g.top, g.bottom]).toEqual([150_000_000, 100_000_000]);
    expect(g.mid).toBe(150);
    expect(g.ticks).toHaveLength(6);
    // Un peso mide lo mismo hacia arriba que hacia abajo.
    expect(g.bars[0]!.hIn / 145_000_000).toBeCloseTo(g.bars[1]!.hOut / 84_000_000, 6);
    // Sin entradas el eje no se pega al borde: queda al menos un paso arriba.
    const out = flowGeometry([{ key: '2026-11', inMinor: 0, outMinor: 700, netMinor: -700 }], 100, 100, 0);
    expect(out.top).toBeGreaterThan(0);
  });
  it('dominio y divisiones bonitas del saldo', () => {
    expect(niceStep(2_800_000, 4)).toBe(1_000_000);
    expect(niceDomain([99_744_000, 377_232_000])).toMatchObject({ lo: 0, hi: 400_000_000, step: 100_000_000 });
    expect(niceDomain([11_770_000, 43_050_000]).values).toEqual([10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000]);
    expect(niceDomain([-500, 1500]).values).toEqual([-500, 0, 500, 1000, 1500]);
    expect(niceDomain([700, 700]).lo).toBeLessThan(700);
    const a = areaGeometry([0, 50], 100, 100, 0, 0, { lo: 0, hi: 100 });
    expect(a.points[1]).toEqual({ x: 100, y: 50 });
    expect(a.yOf(100)).toBe(0);
  });
  it('fin del punto de la serie y lado de la ficha', () => {
    expect(seriesPointEnd('2025-12-01', 'week')).toBe('2025-12-07');
    expect(seriesPointEnd('2026-02', 'month')).toBe('2026-02-28');
    expect(seriesPointEnd('2026-11-27', 'day')).toBe('2026-11-27');
    expect(tipSide(10, 100)).toBe('right');
    expect(tipSide(90, 100)).toBe('left');
  });
  it('área de saldo, con cero dentro', () => {
    const a = areaGeometry([-100, 100], 100, 100, 0, 0);
    expect(a.points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(a.zeroY).toBe(50);
    expect(a.area.endsWith('L100 100L0 100Z')).toBe(true);
    expect(areaGeometry([], 10, 10).line).toBe('');
    expect(areaGeometry([5, 5], 10, 10, 0, 0).points[0]?.y).toBe(5);
  });
  it('punteros y teclado', () => {
    expect(nearestIndex(49, 100, 3)).toBe(1);
    expect(slotIndex(99.9, 100, 4)).toBe(3);
    expect(slotIndex(-5, 100, 4)).toBe(0);
    expect(stepIndex('ArrowRight', null, 5)).toBe(0);
    expect(stepIndex('ArrowLeft', null, 5)).toBe(4);
    expect(stepIndex('ArrowRight', 4, 5)).toBe(4);
    expect(stepIndex('End', 1, 5)).toBe(4);
    expect(stepIndex('a', 1, 5)).toBeNull();
    expect(stepIndex('Home', null, 0)).toBeNull();
  });
  it('rótulos de mes', () => {
    expect(seriesKeyMonth('2026-11-03')).toBe('2026-11');
    expect(seriesKeyMonth('2026-11')).toBe('2026-11');
    expect(seriesKeyMonth('2026-Q4')).toBeNull();
    const months = ['2026-01', '2026-01', '2026-02', '2026-03', '2026-03', '2026-04'];
    expect(monthTicks(months)).toEqual([0, 2, 3, 5]);
    expect(monthTicks(months, 2)).toEqual([0, 3]);
    expect(tail([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });
  it('agrupa por día y calcula el neto', () => {
    const rows = [
      { date: '2026-11-27', kind: 'income', amountMinor: 500 },
      { date: '2026-11-27', kind: 'expense', amountMinor: 200 },
      { date: '2026-11-26', kind: 'transfer', amountMinor: 900 },
    ];
    const days = groupByDay(rows);
    expect(days.map((d) => [d.date, d.items.length])).toEqual([
      ['2026-11-27', 2],
      ['2026-11-26', 1],
    ]);
    expect(dayNet(days[0]?.items ?? [])).toBe(300);
    expect(dayNet(days[1]?.items ?? [])).toBe(0);
  });
});
