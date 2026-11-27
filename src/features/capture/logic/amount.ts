// Montos escritos como texto (campo de escritorio, celdas de la tabla y pegado): el MISMO parser que el teclado
// propio (`sanitizePastedAmount` + `evaluateExpression`), así que `1,500+350` vale lo mismo en los tres sitios.
import type { Minor } from '../../../core';
import { evaluateExpression, sanitizePastedAmount } from '../../../ui/domain/amountLogic';

export type AmountTextResult =
  | { status: 'empty'; expr: '' }
  | { status: 'ok'; expr: string; minor: Minor; hasOps: boolean }
  | { status: 'invalid'; expr: string; reason: 'invalid' | 'negative' | 'too_large' };

/**
 * Texto → expresión canónica y resultado en unidad menor. Un signo o paréntesis al principio (`-350`, `(350.00)`,
 * como salen de Excel) se ignoran: el tipo del movimiento ya dice si entra o sale.
 */
export function parseAmountText(text: string, locale: string, minorDigits: number): AmountTextResult {
  const trimmed = text.trim().replace(/^\((.*)\)$/, '$1').replace(/^[-−–]\s*/, '');
  if (trimmed === '') return { status: 'empty', expr: '' };
  // El saneado del teclado descarta letras; aquí una palabra («dos mil») es un error, no un monto vacío.
  if (/[^0-9.,\s+\-−–*×xX]/.test(trimmed.replace(/^[A-Za-z]{0,3}\$\s*/, ''))) {
    return { status: 'invalid', expr: '', reason: 'invalid' };
  }
  const expr = sanitizePastedAmount(trimmed, locale, minorDigits);
  if (expr === '') return { status: 'invalid', expr: '', reason: 'invalid' };
  const r = evaluateExpression(expr, minorDigits);
  if (!r.ok) return { status: 'invalid', expr, reason: r.reason };
  return { status: 'ok', expr, minor: r.minor, hasOps: /\d[+\-*]\d/.test(expr) };
}

/** Unidad menor → expresión canónica del teclado (`185050` → `1850.5`), sin dividir: solo cortando el texto. */
export function exprFromMinor(minor: Minor, minorDigits: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) return '';
  if (minorDigits === 0) return String(minor);
  const s = String(minor).padStart(minorDigits + 1, '0');
  const int = s.slice(0, -minorDigits);
  const frac = s.slice(-minorDigits).replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
}
