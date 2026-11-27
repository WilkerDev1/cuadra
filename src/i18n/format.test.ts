import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDayHeader,
  formatMoney,
  formatPeriod,
  formatRelativeDay,
  minorToDecimalString,
} from './format';

describe('formatMoney', () => {
  it('formatea DOP con símbolo RD$ y separadores es-DO', () => {
    expect(formatMoney(8_420_000)).toBe('RD$84,200.00');
    expect(formatMoney(5)).toBe('RD$0.05');
  });
  it('usa el signo menos tipográfico y + opcional', () => {
    expect(formatMoney(-6_135_000)).toBe('−RD$61,350.00');
    expect(formatMoney(1500, { sign: 'always' })).toBe('+RD$15.00');
    expect(formatMoney(0, { sign: 'always' })).toBe('RD$0.00');
  });
  it('no pierde precisión en enteros grandes', () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe('RD$90,071,992,547,409.91');
  });
  it('respeta moneda y decimales del espacio', () => {
    expect(formatMoney(12_345, { currency: 'USD', locale: 'en-US' })).toBe('$123.45');
    expect(formatMoney(1234, { decimals: 0, currency: 'JPY', locale: 'ja-JP' })).toContain('1,234');
  });
  it('rechaza no enteros', () => {
    expect(() => formatMoney(1.5)).toThrow(RangeError);
  });
  it('minorToDecimalString es exacto', () => {
    expect(minorToDecimalString(-105, 2)).toBe('-1.05');
    expect(minorToDecimalString(7, 3)).toBe('0.007');
    expect(minorToDecimalString(12, 0)).toBe('12');
  });
});

describe('fechas', () => {
  it('formatDate', () => {
    expect(formatDate('2026-11-26')).toBe('26 nov 2026');
  });
  it('formatDayHeader', () => {
    expect(formatDayHeader('2026-11-26', '2026-11-26')).toBe('Hoy');
    expect(formatDayHeader('2026-11-25', '2026-11-26')).toBe('Ayer');
    expect(formatDayHeader('2026-11-26', '2026-12-01')).toBe('jueves 26');
  });
  it('formatRelativeDay', () => {
    expect(formatRelativeDay('2026-11-23', '2026-11-26')).toBe('hace 3 días');
    expect(formatRelativeDay('2026-11-26', '2026-11-26')).toBe('hoy');
  });
  it('formatPeriod', () => {
    expect(formatPeriod('2026-11-05', 'month')).toBe('noviembre 2026');
    expect(formatPeriod('2026-11-05', 'quarter')).toBe('T4 2026');
    expect(formatPeriod('2026-11-05', 'year')).toBe('2026');
  });
  it('rechaza fechas inválidas', () => {
    expect(() => formatDate('26/11/2026')).toThrow(RangeError);
  });
});
