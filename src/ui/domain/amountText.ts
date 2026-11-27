// Montos escritos como texto (campo de escritorio, celdas de la tabla, total de control y pegado al teclado propio). Cada número suelto lo lee
// `Money.parse` del núcleo, el mismo que usan el saldo inicial y la importación: «1.500.000», «10.999» o
// «1.234,56» en es-DO son un error y no un monto recortado en silencio, y «1,5» vale lo mismo en toda la app.
// Los operadores `+ − ×` se evalúan después con `evaluateExpression` del teclado (precedencia y redondeo).
import { Money } from '../../core/money';
import type { Currency, Minor } from '../../core/types';
import { evaluateExpression, localeSeparators } from './amountLogic';

export type AmountTextResult =
  | { status: 'empty'; expr: '' }
  | { status: 'ok'; expr: string; minor: Minor; hasOps: boolean }
  | { status: 'invalid'; expr: string; reason: 'invalid' | 'negative' | 'too_large' };

/** Decimales que admite un factor de `×` (no es dinero: `× 0.18`, `× 1.0825`). */
export const MAX_FACTOR_DIGITS = 6;

const OPERATOR: Record<string, '+' | '-' | '*'> = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', x: '*', X: '*' };
const SPLIT = /([+\-−–*×xX])/;

/**
 * Texto → expresión canónica y resultado en unidad menor. Un signo o paréntesis al principio (`-350`, `(350.00)`,
 * como salen de Excel) se ignoran: el tipo del movimiento ya dice si entra o sale. Un operador al final (`150+`) se
 * ignora porque es lo que se ve mientras se teclea.
 */
export function parseAmountText(text: string, locale: string, minorDigits: number): AmountTextResult {
  const trimmed = text.trim().replace(/^\((.*)\)$/, '$1').trim().replace(/^[-−–+]\s*/, '');
  if (trimmed === '') return { status: 'empty', expr: '' };
  // Moneda delante de cualquier término (`RD$`, `US$`, `$`); otra letra o signo («dos mil», «1,500 pesos») es error.
  const src = trimmed.replace(/[A-Za-z]{0,3}\$/g, '');
  if (/[^0-9.,\s+\-−–*×xX]/.test(src)) return { status: 'invalid', expr: '', reason: 'invalid' };

  const parts = src.split(SPLIT).map((p) => p.trim());
  while (parts.length > 1 && (parts.at(-1) ?? '') === '' && OPERATOR[parts.at(-2) ?? ''] !== undefined) parts.splice(-2, 2);
  const currency: Currency = { code: 'XXX', minorDigits: minorDigits as Currency['minorDigits'] };
  let expr = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    if (i % 2 === 1) {
      expr += OPERATOR[part] ?? '';
      continue;
    }
    if (part === '') return { status: 'invalid', expr: '', reason: 'invalid' };
    if (parts[i - 1] !== undefined && OPERATOR[parts[i - 1]!] === '*') {
      const factor = parseFactor(part, locale);
      if (factor === null) return { status: 'invalid', expr: '', reason: 'invalid' };
      expr += factor;
      continue;
    }
    const r = Money.parse(part, { locale, currency });
    if (!r.ok) return { status: 'invalid', expr: '', reason: r.error === 'too_large' ? 'too_large' : 'invalid' };
    expr += canonical(r.value, minorDigits);
  }
  const r = evaluateExpression(expr, minorDigits);
  if (!r.ok) return { status: 'invalid', expr, reason: r.reason };
  return { status: 'ok', expr, minor: r.minor, hasOps: /\d[+\-*]\d/.test(expr) };
}

/**
 * Factor de `×` con las mismas reglas de separadores que `Money.parse` (un solo decimal, grupos de tres, y un
 * separador de grupo seguido de 1–2 cifras finales se lee como decimal), pero sin cortar decimales: `0.333` es
 * `0.333`. Devuelve el número en forma canónica (`.` decimal) o `null` si no se entiende.
 */
export function parseFactor(token: string, locale: string): string | null {
  const { decimal, group } = localeSeparators(locale);
  const s = token.replace(/\s+/g, '');
  if (s === '' || !new RegExp(`^[0-9${escape(group)}${escape(decimal)}]+$`).test(s)) return null;
  const decimals = s.split(decimal).length - 1;
  const groups = s.split(group).length - 1;
  let int = s;
  let frac = '';
  if (decimals > 1) return null;
  if (decimals === 1) {
    [int = '', frac = ''] = s.split(decimal);
    if (frac.includes(group)) return null;
  } else if (groups === 1 && /^[0-9]{1,2}$/.test(s.slice(s.indexOf(group) + group.length))) {
    [int = '', frac = ''] = s.split(group);
  }
  if (int.includes(group)) {
    const [first = '', ...rest] = int.split(group);
    if (!/^[0-9]{1,3}$/.test(first) || rest.some((g) => !/^[0-9]{3}$/.test(g))) return null;
    int = [first, ...rest].join('');
  }
  frac = frac.replace(/0+$/, '');
  if ((int === '' && frac === '') || frac.length > MAX_FACTOR_DIGITS) return null;
  const head = int.replace(/^0+(?=\d)/, '') || '0';
  return frac === '' ? head : `${head}.${frac}`;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unidad menor → número canónico del teclado, con `0` para cero (los términos de una expresión pueden valer 0). */
function canonical(minor: Minor, minorDigits: number): string {
  return minor === 0 ? '0' : exprFromMinor(minor, minorDigits);
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

/**
 * Texto pegado en el teclado propio → expresión canónica. Usa la misma regla que `Money.parse` (y que los montos
 * escritos de la captura): «RD$ 1,250.50» → `1250.5`, «1,5» → `1.5`. Si no se entiende («1.500.000», «10.999» en
 * es-DO) devuelve el texto saneado SIN recortar, para que el teclado lo marque como operación no válida en vez de
 * guardar otra cifra en silencio.
 */
export function pastedAmountExpr(text: string, locale: string, minorDigits: number): string {
  const r = parseAmountText(text, locale, minorDigits);
  if (r.status === 'ok') return r.expr;
  if (r.status === 'empty') return '';
  const { decimal, group } = localeSeparators(locale);
  let s = text.replace(/[−–—]/g, '-').replace(/[×xX]/g, '*').replace(/\s+/g, '');
  s = s.split(group).join('');
  if (decimal !== '.') s = s.split(decimal).join('.');
  return s.replace(/[^0-9.+\-*]/g, '').replace(/^[+*-]+/, '');
}
