import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  enumeratePeriodKeys,
  FixedClock,
  isIsoDate,
  periodKey,
  periodLabel,
  presetRange,
  systemClock,
  toIsoDate,
} from './dates';
import { resolvePeriod } from './recipes';

const at = (today: string) => new FixedClock(`${today}T12:00:00Z`);

describe('resolvePeriod', () => {
  it('resolvePeriod last_month con hoy 2026-01-15 → 2025-12-01..2025-12-31', () => {
    const r = resolvePeriod({ preset: 'last_month' }, at('2026-01-15'));
    expect(r.from).toBe('2025-12-01');
    expect(r.to).toBe('2025-12-31');
    expect(r.label).toBe('diciembre 2025');
  });

  it('resolvePeriod this_week empieza en lunes (es-DO)', () => {
    // 2026-06-15 es lunes; 2026-06-17 miércoles; 2026-06-21 domingo.
    for (const today of ['2026-06-15', '2026-06-17', '2026-06-21']) {
      const r = resolvePeriod({ preset: 'this_week' }, at(today));
      expect(r.from).toBe('2026-06-15');
      expect(r.to).toBe('2026-06-21');
    }
    expect(resolvePeriod({ preset: 'this_week' }, at('2026-06-22')).from).toBe('2026-06-22');
  });

  it('resuelve el resto de presets, rangos libres y sin periodo', () => {
    const clock = at('2026-06-15');
    const r = (preset: Parameters<typeof presetRange>[0]) => presetRange(preset, clock.today());
    expect(r('today')).toEqual({ from: '2026-06-15', to: '2026-06-15' });
    expect(r('this_month')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(r('this_quarter')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(r('last_quarter')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(r('this_year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(r('last_year')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(r('last_30_days')).toEqual({ from: '2026-05-17', to: '2026-06-15' });
    expect(r('last_12_months')).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    expect(r('all')).toEqual({ from: null, to: null });
    expect(presetRange('last_quarter', '2026-02-10')).toEqual({ from: '2025-10-01', to: '2025-12-31' });

    expect(resolvePeriod(undefined, clock)).toEqual({ from: null, to: null, label: 'Todo el historial' });
    expect(resolvePeriod({ from: '2026-06-01', to: '2026-06-15' }, clock).label).toBe('1 jun 2026 – 15 jun 2026');
    expect(resolvePeriod({ from: '2026-06-01' }, clock)).toEqual({ from: '2026-06-01', to: null, label: 'Desde 1 jun 2026' });
    expect(resolvePeriod({ preset: 'this_quarter' }, clock).label).toBe('T2 2026');
    expect(resolvePeriod({ preset: 'this_year' }, clock).label).toBe('2026');
    expect(resolvePeriod({ preset: 'today' }, clock).label).toBe('15 jun 2026');
  });
});

describe('dates', () => {
  it('isIsoDate valida calendario real', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-6-1')).toBe(false);
    expect(isIsoDate(20260601)).toBe(false);
  });

  it('aritmética de días y meses en calendario local', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(diffDays('2026-06-15', '2026-09-13')).toBe(90);
    expect(diffDays('2026-06-15', '2026-06-12')).toBe(-3);
  });

  it('claves de periodo y relleno de huecos', () => {
    expect(periodKey('2026-06-17', 'day')).toBe('2026-06-17');
    expect(periodKey('2026-06-17', 'week')).toBe('2026-06-15');
    expect(periodKey('2026-06-17', 'month')).toBe('2026-06');
    expect(periodKey('2026-06-17', 'quarter')).toBe('2026-Q2');
    expect(periodKey('2026-06-17', 'year')).toBe('2026');
    expect(enumeratePeriodKeys('2025-11-20', '2026-02-03', 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(enumeratePeriodKeys('2026-06-14', '2026-06-16', 'day')).toEqual(['2026-06-14', '2026-06-15', '2026-06-16']);
    expect(enumeratePeriodKeys('2026-06-14', '2026-06-23', 'week')).toEqual(['2026-06-08', '2026-06-15', '2026-06-22']);
    expect(enumeratePeriodKeys('2025-12-01', '2026-04-01', 'quarter')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(enumeratePeriodKeys('2026-06-02', '2026-06-01', 'day')).toEqual([]);
  });

  it('periodLabel nombra meses, trimestres, años y rangos', () => {
    expect(periodLabel('2026-11-01', '2026-11-30')).toBe('noviembre 2026');
    expect(periodLabel('2026-10-01', '2026-12-31')).toBe('T4 2026');
    expect(periodLabel('2026-01-01', '2026-12-31')).toBe('2026');
    expect(periodLabel(null, '2026-11-26')).toBe('Hasta 26 nov 2026');
    expect(periodLabel(null, null)).toBe('Todo el historial');
  });

  it('FixedClock da hoy en fecha local y se puede mover', () => {
    const clock = new FixedClock('2026-06-15T12:00:00Z');
    expect(clock.today()).toBe('2026-06-15');
    expect(clock.now().toISOString()).toBe('2026-06-15T12:00:00.000Z');
    clock.advance(24 * 3600 * 1000);
    expect(clock.today()).toBe('2026-06-16');
    clock.set('2026-01-01T03:00:00Z'); // 23:00 del 31 dic en Santo Domingo (UTC−4)
    expect(clock.today()).toBe('2025-12-31');
    clock.setToday('2026-03-10');
    expect(clock.today()).toBe('2026-03-10');
    expect(toIsoDate(clock.now())).toBe('2026-03-10');
    // now() devuelve copias: mutarlas no mueve el reloj.
    clock.now().setFullYear(1999);
    expect(clock.today()).toBe('2026-03-10');
  });

  it('systemClock usa la fecha local del sistema', () => {
    expect(systemClock.today()).toBe(toIsoDate(new Date()));
    expect(isIsoDate(systemClock.today())).toBe(true);
  });
});
