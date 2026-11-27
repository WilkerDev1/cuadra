// Lógica pura de cifras para la UI: expresión del teclado propio, partes de un monto formateado
// (DESIGN.md §5) y saneado de pegado. Nunca usa flotantes: todo pasa por strings y BigInt.
import type { Currency, Minor, TxKind } from '../../core/types';

export const MINUS = '−';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

// ── Separadores del locale ──────────────────────────────────────────────────────────────

const sepCache = new Map<string, { decimal: string; group: string }>();
/** Separador decimal y de grupo del locale (`es-DO` → `.` y `,`). */
export function localeSeparators(locale: string): { decimal: string; group: string } {
  let hit = sepCache.get(locale);
  if (hit === undefined) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: 'always' } as Intl.NumberFormatOptions).formatToParts(
      12345.6,
    );
    hit = {
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
    };
    sepCache.set(locale, hit);
  }
  return hit;
}

// ── Expresión del teclado ───────────────────────────────────────────────────────────────
// Forma canónica interna: dígitos, `.` como decimal y operadores ASCII `+ - *`.

export type KeypadKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '00' | '.' | '+' | '-' | '*' | 'backspace' | 'clear';

const OPS = new Set(['+', '-', '*']);

/** Número que se está escribiendo al final de la expresión. */
function lastNumber(expr: string): string {
  const m = /[0-9.]*$/.exec(expr);
  return m === null ? '' : m[0];
}

/** Aplica una tecla a la expresión respetando los decimales de la moneda. */
export function appendKey(expr: string, key: KeypadKey, minorDigits: number): string {
  if (key === 'clear') return '';
  if (key === 'backspace') return expr.slice(0, -1);
  const last = expr.at(-1);
  if (OPS.has(key)) {
    if (expr === '') return '';
    if (last !== undefined && OPS.has(last)) return expr.slice(0, -1) + key;
    if (last === '.') return expr.slice(0, -1) + key;
    return expr + key;
  }
  const num = lastNumber(expr);
  const head = expr.slice(0, expr.length - num.length);
  if (key === '.') {
    if (minorDigits === 0 || num.includes('.')) return expr;
    return head + (num === '' ? '0.' : `${num}.`);
  }
  // dígitos y doble cero
  let next = num;
  for (const d of key) {
    const dot = next.indexOf('.');
    if (dot >= 0 && next.length - dot - 1 >= minorDigits) break;
    if (next === '0') next = d;
    else next += d;
  }
  if (next === '0' && key === '00') next = '0';
  // límite de dígitos enteros: 15 (cabe en un entero seguro con 2 decimales)
  const intPart = next.split('.')[0] ?? '';
  if (intPart.length > 15) return expr;
  return head + next;
}

export type EvalResult = { ok: true; minor: Minor } | { ok: false; reason: 'invalid' | 'negative' | 'too_large' };

const NUM = /^(\d+)(?:\.(\d*))?$/;

function toScaled(token: string, digits: number): bigint | null {
  const m = NUM.exec(token);
  if (m === null) return null;
  const frac = m[2] ?? '';
  if (frac.length > digits) return null;
  return BigInt((m[1] ?? '0') + frac.padEnd(digits, '0'));
}

function scalar(token: string): { n: bigint; scale: bigint } | null {
  const m = NUM.exec(token);
  if (m === null) return null;
  const frac = m[2] ?? '';
  return { n: BigInt((m[1] ?? '0') + frac), scale: 10n ** BigInt(frac.length) };
}

/** Evalúa `1500+350*2` en unidad menor con precedencia normal (× antes que + y −). */
export function evaluateExpression(expr: string, minorDigits: number): EvalResult {
  let src = expr;
  while (src !== '' && OPS.has(src.at(-1) ?? '')) src = src.slice(0, -1);
  if (src === '') return { ok: true, minor: 0 };
  const tokens = src.split(/([+\-*])/);
  // tokens: num, op, num, op, num...
  let total = 0n;
  let termSign = 1n;
  let term: { value: bigint; mulN: bigint; mulScale: bigint } | null = null;
  const flush = () => {
    if (term === null) return;
    // redondeo mitad hacia arriba de value × mulN / mulScale
    const num = term.value * term.mulN;
    const q = (num * 2n + term.mulScale) / (term.mulScale * 2n);
    total += termSign * q;
  };
  let pendingOp: string | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? '';
    if (i % 2 === 1) {
      pendingOp = tok;
      continue;
    }
    if (tok === '') return { ok: false, reason: 'invalid' };
    if (pendingOp === '*') {
      const s = scalar(tok);
      if (s === null || term === null) return { ok: false, reason: 'invalid' };
      const current: { value: bigint; mulN: bigint; mulScale: bigint } = term;
      term = { value: current.value, mulN: current.mulN * s.n, mulScale: current.mulScale * s.scale };
      continue;
    }
    flush();
    if (pendingOp === '-') termSign = -1n;
    else termSign = 1n;
    const v = toScaled(tok, minorDigits);
    if (v === null) return { ok: false, reason: 'invalid' };
    term = { value: v, mulN: 1n, mulScale: 1n };
  }
  flush();
  if (total < 0n) return { ok: false, reason: 'negative' };
  if (total > MAX) return { ok: false, reason: 'too_large' };
  return { ok: true, minor: Number(total) };
}

const GLYPH: Record<string, string> = { '+': '+', '-': MINUS, '*': '×' };

/** Expresión legible: `1500+350` → `1,500 + 350` con los separadores del locale. */
export function formatExpression(expr: string, locale: string): string {
  const { decimal, group } = localeSeparators(locale);
  const useGroup = new Intl.NumberFormat(locale).format(1000).includes(group);
  return expr
    .split(/([+\-*])/)
    .map((tok) => {
      const op = GLYPH[tok];
      if (op !== undefined) return ` ${op} `;
      const [int = '', frac] = tok.split('.');
      const grouped = useGroup ? int.replace(/\B(?=(\d{3})+(?!\d))/g, group) : int;
      return frac === undefined ? grouped : `${grouped}${decimal}${frac}`;
    })
    .join('');
}

/** Texto pegado o tecleado → expresión canónica (`RD$ 1,250.50` → `1250.50`). */
export function sanitizePastedAmount(text: string, locale: string, minorDigits: number): string {
  const { decimal, group } = localeSeparators(locale);
  let s = text
    .replace(/[−–—]/g, '-')
    .replace(/[×xX]/g, '*')
    .replace(/\s+/g, '');
  s = s.split(group).join('');
  if (decimal !== '.') s = s.split(decimal).join('.');
  s = s.replace(/[^0-9.+\-*]/g, '');
  // recorta decimales sobrantes y puntos repetidos en cada número
  return s
    .split(/([+\-*])/)
    .map((tok) => {
      if (OPS.has(tok)) return tok;
      const [int = '', ...rest] = tok.split('.');
      if (rest.length === 0 || minorDigits === 0) return int;
      return `${int}.${rest.join('').slice(0, minorDigits)}`;
    })
    .join('')
    .replace(/^[+*]+/, '');
}

// ── Partes de un monto ──────────────────────────────────────────────────────────────────

export type AmountNotation = 'sign' | 'parens' | 'plain';

export interface AmountPartsOptions {
  locale: string;
  currency: Currency;
  /** Tipo de movimiento: el monto llega positivo y el signo sale del tipo. Sin tipo = saldo con signo. */
  kind?: TxKind | undefined;
  notation?: AmountNotation | undefined;
  /** Mostrar el símbolo de moneda (por defecto sí). */
  symbol?: boolean | undefined;
}

export interface AmountParts {
  /** `+`, `−` o vacío. */
  sign: string;
  symbol: string;
  integer: string;
  decimal: string;
  fraction: string;
  parens: boolean;
  negative: boolean;
  /** Caracteres de la cifra sin el símbolo (para la cifra elástica, §5.5). */
  chars: number;
  /** Texto plano completo, tal como se ve. */
  text: string;
}

function decimalString(abs: bigint, digits: number): string {
  if (digits === 0) return abs.toString();
  const s = abs.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function currencyFormatter(locale: string, currency: Currency): Intl.NumberFormat {
  const key = `${locale}|${currency.code}|${currency.minorDigits}`;
  let f = fmtCache.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: currency.minorDigits,
      maximumFractionDigits: currency.minorDigits,
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** Descompone un monto en partes según las reglas de cifras de DESIGN.md §5. */
export function amountParts(minor: Minor, opts: AmountPartsOptions): AmountParts {
  if (!Number.isSafeInteger(minor)) throw new RangeError('amountParts espera un entero en unidad menor');
  const notation = opts.notation ?? 'sign';
  const showSymbol = opts.symbol ?? true;
  const negativeValue = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const formatter = currencyFormatter(opts.locale, opts.currency);
  const raw = (formatter as unknown as { formatToParts(v: string): Intl.NumberFormatPart[] }).formatToParts(
    decimalString(abs, opts.currency.minorDigits),
  );
  let symbol = '';
  let integer = '';
  let decimal = '';
  let fraction = '';
  for (const p of raw) {
    if (p.type === 'currency') symbol = opts.currency.symbol ?? p.value;
    else if (p.type === 'integer' || p.type === 'group') integer += p.value;
    else if (p.type === 'decimal') decimal = p.value;
    else if (p.type === 'fraction') fraction = p.value;
  }
  if (!showSymbol) symbol = '';

  let sign = '';
  let parens = false;
  let negative = negativeValue;
  if (notation !== 'plain') {
    if (opts.kind === 'income') sign = '+';
    else if (opts.kind === 'expense') {
      sign = MINUS;
      negative = true;
    } else if (opts.kind === undefined && negativeValue) {
      if (notation === 'parens') parens = true;
      else sign = MINUS;
    }
  }
  if (notation === 'plain') negative = negativeValue;
  const body = `${integer}${decimal}${fraction}`;
  const text = parens ? `(${symbol}${body})` : `${sign}${symbol}${body}`;
  return { sign, symbol, integer, decimal, fraction, parens, negative, chars: body.length + sign.length, text };
}
