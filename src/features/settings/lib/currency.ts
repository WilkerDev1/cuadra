// Moneda del espacio: valores sugeridos, validación del formulario y la regla de los decimales.
import type { Currency } from '../../../core';

export interface CurrencyPreset {
  code: string;
  symbol: string;
  minorDigits: 0 | 2 | 3;
}

export const CURRENCY_PRESETS: readonly CurrencyPreset[] = [
  { code: 'DOP', symbol: 'RD$', minorDigits: 2 },
  { code: 'USD', symbol: 'US$', minorDigits: 2 },
  { code: 'EUR', symbol: '€', minorDigits: 2 },
  { code: 'MXN', symbol: 'MX$', minorDigits: 2 },
  { code: 'COP', symbol: 'COL$', minorDigits: 0 },
];

export const MINOR_DIGITS: readonly (0 | 2 | 3)[] = [0, 2, 3];

export interface CurrencyDraft {
  code: string;
  symbol: string;
  minorDigits: 0 | 2 | 3;
}

export type CurrencyIssue = 'code' | 'symbol';

/** De un borrador del formulario a `Currency`, o qué campo está mal. El símbolo vacío se omite. */
export function buildCurrency(draft: CurrencyDraft): { ok: true; value: Currency } | { ok: false; issue: CurrencyIssue } {
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, issue: 'code' };
  const symbol = draft.symbol.trim();
  if (symbol.length > 6) return { ok: false, issue: 'symbol' };
  return { ok: true, value: symbol === '' ? { code, minorDigits: draft.minorDigits } : { code, minorDigits: draft.minorDigits, symbol } };
}

export function currencyToDraft(c: Currency): CurrencyDraft {
  return { code: c.code, symbol: c.symbol ?? '', minorDigits: c.minorDigits };
}

export function sameCurrency(a: Currency, b: Currency): boolean {
  return a.code === b.code && a.minorDigits === b.minorDigits && (a.symbol ?? '') === (b.symbol ?? '');
}

/** Con movimientos (también anulados) los decimales no cambian: el núcleo lo rechaza con `currency_locked`. */
export function decimalsLocked(movementCount: number): boolean {
  return movementCount > 0;
}

/** 1 234,5 en unidad menor para la vista previa: 123 456 con 2 decimales = 1,234.56. */
export function sampleMinor(minorDigits: 0 | 2 | 3): number {
  return minorDigits === 0 ? 1235 : minorDigits === 2 ? 123456 : 1234567;
}
