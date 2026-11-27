// Money (ARCHITECTURE.md 3.3): montos como enteros en unidad menor. Jamás flotantes: el parseo separa
// parte entera y fracción como texto y compone con BigInt; el formato pasa a Intl un decimal en texto.
import { err, ok, type Result } from './result';
import type { Currency, Direction, Minor } from './types';

export const MAX_MINOR = Number.MAX_SAFE_INTEGER;
const MAX_BIG = BigInt(MAX_MINOR);

export type MoneyParseError = 'empty' | 'not_a_number' | 'too_many_decimals' | 'negative_not_allowed' | 'too_large';

export interface MoneyParseOptions {
  locale: string; // 'es-DO' → decimal '.', grupo ','; 'es-ES' → decimal ',', grupo '.'
  currency: Currency;
  allowNegative?: boolean; // solo saldo inicial de tarjeta/deuda
}

export interface MoneyFormatOptions {
  locale: string;
  currency: Currency;
  display?: 'symbol' | 'code' | 'none';
  /** 'always' muestra "+" en positivos (el cero va sin signo). */
  sign?: 'auto' | 'always' | 'never';
  compact?: boolean; // "RD$12.5 mil" para tarjetas
}

// ── Separadores del locale ───────────────────────────────────────────────────────────

interface Separators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<string, Separators>();

/** Separadores del locale según Intl. Los espacios de grupo (fr-FR) se normalizan a ' '. */
function separatorsFor(locale: string): Separators {
  let hit = separatorCache.get(locale);
  if (hit === undefined) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
    const group = normalizeSpaces(parts.find((p) => p.type === 'group')?.value ?? ',');
    const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    hit = { group, decimal };
    separatorCache.set(locale, hit);
  }
  return hit;
}

const SPACES = /[\s    ]/g;
function normalizeSpaces(s: string): string {
  return s.replace(SPACES, ' ');
}

const symbolCache = new Map<string, string[]>();

/** Símbolos que Intl usa para esta moneda en este locale ("RD$", "US$", "$", "€"). */
function intlSymbols(locale: string, code: string): string[] {
  const key = `${locale}|${code}`;
  let hit = symbolCache.get(key);
  if (hit === undefined) {
    hit = [];
    for (const currencyDisplay of ['symbol', 'narrowSymbol', 'name'] as const) {
      try {
        const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay }).formatToParts(1);
        const symbol = parts.find((p) => p.type === 'currency')?.value;
        if (symbol !== undefined && symbol !== '' && !hit.includes(symbol)) hit.push(symbol);
      } catch {
        // Código de moneda que Intl no conoce: solo quitamos el código y el símbolo configurado.
      }
    }
    symbolCache.set(key, hit);
  }
  return hit;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Composición exacta con BigInt ────────────────────────────────────────────────────

/** "1234" + "5" con 2 dígitos → 123450n. La fracción ya viene validada (≤ minorDigits tras quitar ceros). */
function compose(intDigits: string, fracDigits: string, minorDigits: number): bigint {
  const frac = fracDigits.padEnd(minorDigits, '0');
  const digits = `${intDigits === '' ? '0' : intDigits}${frac}`;
  return BigInt(digits);
}

/** Quita ceros finales sobrantes ("500" con 2 dígitos → "5" no; "500" → "50"). */
function trimFraction(frac: string, minorDigits: number): string | null {
  let f = frac;
  while (f.length > minorDigits && f.endsWith('0')) f = f.slice(0, -1);
  return f.length > minorDigits ? null : f;
}

function toSafe(value: bigint, negative: boolean): Result<Minor, MoneyParseError> {
  if (value > MAX_BIG) return err('too_large');
  const n = Number(value);
  return ok(negative && n !== 0 ? -n : n);
}

// ── Parseo de texto del usuario ──────────────────────────────────────────────────────

interface Unsigned {
  /** Magnitud en unidad menor. */
  value: bigint;
  negative: boolean;
}

/** Quita moneda y espacios, detecta el signo y valida la forma. No aplica allowNegative ni MAX. */
function parseUnsigned(input: string, opts: MoneyParseOptions): Result<Unsigned, MoneyParseError> {
  const { group, decimal } = separatorsFor(opts.locale);
  const digits = opts.currency.minorDigits;
  let s = normalizeSpaces(input);

  // Moneda: símbolo configurado, símbolos de Intl, código ISO y cualquier signo de moneda suelto.
  const tokens = [opts.currency.symbol, ...intlSymbols(opts.locale, opts.currency.code), opts.currency.code]
    .filter((t): t is string => t !== undefined && t !== '')
    .sort((a, b) => b.length - a.length);
  for (const token of tokens) s = s.replace(new RegExp(escapeRegExp(token), 'gi'), ' ');
  s = s.replace(/\p{Sc}/gu, ' ');

  // Los espacios solo se toleran como separador de grupo (fr-FR) o alrededor; se quitan.
  s = s.replace(/ /g, group === ' ' ? ' ' : '').trim();
  if (group === ' ') s = s.replace(/ +/g, ' ');
  if (s === '') return err('empty');

  // Signo: "-5", "−5", "5-", "(5)", "+5".
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const lead = /^[-−+]/.exec(s);
  if (lead) {
    if (lead[0] !== '+') negative = true;
    s = s.slice(1).trim();
  } else if (/[-−]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s === '') return err('empty');

  // Solo quedan dígitos y separadores del locale.
  const allowed = new RegExp(`^[0-9${escapeRegExp(group)}${escapeRegExp(decimal)}]+$`);
  if (!allowed.test(s)) return err('not_a_number');

  const decimalCount = s.split(decimal).length - 1;
  const groupCount = s.split(group).length - 1;
  let intPart: string;
  let fracPart = '';

  if (decimalCount > 1) return err('not_a_number');
  if (decimalCount === 1) {
    const [i = '', f = ''] = s.split(decimal);
    if (f.includes(group)) return err('not_a_number');
    intPart = i;
    fracPart = f;
  } else if (groupCount === 1 && /^[0-9]{1,2}$/.test(s.slice(s.indexOf(group) + group.length))) {
    // Regla de ambigüedad: solo un separador de GRUPO seguido de 1–2 dígitos finales → es decimal.
    const at = s.indexOf(group);
    intPart = s.slice(0, at);
    fracPart = s.slice(at + group.length);
  } else {
    intPart = s;
  }

  if (intPart.includes(group)) {
    const groups = intPart.split(group);
    const [first = '', ...rest] = groups;
    if (!/^[0-9]{1,3}$/.test(first) || rest.some((g) => !/^[0-9]{3}$/.test(g))) return err('not_a_number');
    intPart = groups.join('');
  }
  if (intPart === '' && fracPart === '') return err('not_a_number');
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) return err('not_a_number');

  const frac = trimFraction(fracPart, digits);
  if (frac === null) return err('too_many_decimals');
  return ok({ value: compose(intPart.replace(/^0+(?=\d)/, ''), frac, digits), negative });
}

function finish(value: bigint, negative: boolean, opts: MoneyParseOptions): Result<Minor, MoneyParseError> {
  if (value > MAX_BIG) return err('too_large');
  if (negative && value !== 0n && opts.allowNegative !== true) return err('negative_not_allowed');
  return toSafe(value, negative);
}

function parse(input: string, opts: MoneyParseOptions): Result<Minor, MoneyParseError> {
  const r = parseUnsigned(input, opts);
  if (!r.ok) return r;
  return finish(r.value.value, r.value.negative, opts);
}

function parseExpression(input: string, opts: MoneyParseOptions): Result<Minor, MoneyParseError> {
  const s = normalizeSpaces(input).trim();
  if (s === '') return err('empty');
  // Términos separados por + o − (ASCII o tipográfico). Sin precedencias ni paréntesis.
  const tokens = s
    .split(/([+\-−])/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  let total = 0n;
  let sign: 1n | -1n = 1n;
  let state: 'start' | 'term' | 'operator' = 'start';
  for (const token of tokens) {
    if (token === '+' || token === '-' || token === '−') {
      if (state === 'operator') return err('not_a_number'); // "150++5"
      sign = token === '+' ? 1n : -1n;
      state = 'operator';
      continue;
    }
    if (state === 'term') return err('not_a_number');
    const term = parseUnsigned(token, opts);
    if (!term.ok) return term;
    if (term.value.negative) return err('not_a_number'); // "(5)" dentro de una expresión
    total += sign * term.value.value;
    if (total > MAX_BIG || total < -MAX_BIG) return err('too_large');
    sign = 1n;
    state = 'term';
  }
  if (!tokens.some((t) => t !== '+' && t !== '-' && t !== '−')) return err('empty');
  // Un operador final ("150+") se ignora: es lo que se ve mientras se teclea.
  const negative = total < 0n;
  return finish(negative ? -total : total, negative, opts);
}

// ── Decimal canónico ─────────────────────────────────────────────────────────────────

function assertSafe(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} no es un entero seguro: ${n}`);
}

function toDecimalString(minor: Minor, minorDigits: number): string {
  assertSafe(minor, 'minor');
  const negative = minor < 0;
  const abs = String(negative ? -minor : minor);
  if (minorDigits === 0) return `${negative ? '-' : ''}${abs}`;
  const padded = abs.padStart(minorDigits + 1, '0');
  const int = padded.slice(0, padded.length - minorDigits);
  const frac = padded.slice(padded.length - minorDigits);
  return `${negative ? '-' : ''}${int}.${frac}`;
}

function fromDecimalString(s: string, minorDigits: number): Result<Minor, MoneyParseError> {
  const t = s.trim();
  if (t === '') return err('empty');
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(t);
  if (!m) return err('not_a_number');
  const frac = trimFraction(m[3] ?? '', minorDigits);
  if (frac === null) return err('too_many_decimals');
  const value = compose((m[2] ?? '0').replace(/^0+(?=\d)/, ''), frac, minorDigits);
  return toSafe(value, m[1] === '-');
}

// ── Formato ──────────────────────────────────────────────────────────────────────────

const formatCache = new Map<string, Intl.NumberFormat>();

function formatter(opts: MoneyFormatOptions): Intl.NumberFormat {
  const display = opts.display ?? 'symbol';
  const sign = opts.sign ?? 'auto';
  const compact = opts.compact === true;
  const digits = opts.currency.minorDigits;
  const key = [opts.locale, opts.currency.code, digits, display, sign, compact].join('|');
  let hit = formatCache.get(key);
  if (hit === undefined) {
    const signDisplay = sign === 'always' ? 'exceptZero' : sign;
    const fraction: Intl.NumberFormatOptions = compact
      ? { notation: 'compact', compactDisplay: 'short', minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits };
    const base: Intl.NumberFormatOptions =
      display === 'none'
        ? { style: 'decimal' }
        : { style: 'currency', currency: opts.currency.code, currencyDisplay: display === 'code' ? 'code' : 'symbol' };
    hit = new Intl.NumberFormat(opts.locale, { ...base, ...fraction, signDisplay });
    formatCache.set(key, hit);
  }
  return hit;
}

function format(minor: Minor, opts: MoneyFormatOptions): string {
  const decimal = toDecimalString(minor, opts.currency.minorDigits) as `${number}`;
  const nf = formatter(opts);
  const symbol = opts.currency.symbol;
  if ((opts.display ?? 'symbol') === 'symbol' && symbol !== undefined && symbol !== '') {
    return nf
      .formatToParts(decimal)
      .map((p) => (p.type === 'currency' ? symbol : p.value))
      .join('');
  }
  return nf.format(decimal);
}

// ── Aritmética ───────────────────────────────────────────────────────────────────────

function add(a: Minor, b: Minor): Minor {
  assertSafe(a, 'a');
  assertSafe(b, 'b');
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new RangeError(`suma fuera de rango: ${a} + ${b}`);
  return r;
}

function sub(a: Minor, b: Minor): Minor {
  assertSafe(b, 'b');
  return add(a, -b);
}

function sum(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total = add(total, v);
  return total;
}

function signed(amount: Minor, direction: Direction): Minor {
  assertSafe(amount, 'amount');
  return direction === 'in' ? amount : amount === 0 ? 0 : -amount;
}

/** Peso → entero exacto escalado: 0.25 → (25n, 2). Usa la representación decimal del número. */
function ratioToScaled(r: number): { n: bigint; scale: number } {
  if (!Number.isFinite(r) || r < 0) throw new RangeError(`peso inválido: ${r}`);
  let text = String(r);
  if (/e/i.test(text)) text = r.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  const [int = '0', frac = ''] = text.split('.');
  return { n: BigInt(`${int}${frac}`), scale: frac.length };
}

function allocate(total: Minor, ratios: readonly number[]): Minor[] {
  assertSafe(total, 'total');
  if (ratios.length === 0) throw new RangeError('allocate necesita al menos un peso');
  const scaled = ratios.map(ratioToScaled);
  const maxScale = Math.max(...scaled.map((s) => s.scale));
  const weights = scaled.map((s) => s.n * 10n ** BigInt(maxScale - s.scale));
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) throw new RangeError('allocate necesita algún peso mayor que cero');

  const negative = total < 0;
  const abs = BigInt(negative ? -total : total);
  const shares = weights.map((w) => (abs * w) / weightSum);
  let remainder = abs - shares.reduce((a, b) => a + b, 0n);
  // El resto va a los primeros con peso > 0 (patrón dinero.js).
  for (let i = 0; remainder > 0n; i = (i + 1) % shares.length) {
    if ((weights[i] ?? 0n) > 0n) {
      shares[i] = (shares[i] ?? 0n) + 1n;
      remainder -= 1n;
    }
  }
  return shares.map((s) => (negative && s !== 0n ? -Number(s) : Number(s)));
}

function isValidAmount(n: unknown): n is Minor {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_MINOR;
}

export const Money = {
  parse,
  parseExpression,
  format,
  toDecimalString,
  fromDecimalString,
  add,
  sub,
  sum,
  signed,
  allocate,
  isValidAmount,
} as const;
