// Formato regional con Intl cacheado por locale. Locale por defecto es-DO; moneda por defecto DOP.
import type { IsoDate, Minor } from '../core/types';

export type { IsoDate, Minor };

export const DEFAULT_LOCALE = 'es-DO';
export const DEFAULT_CURRENCY = 'DOP';
const MINUS = '−';

let activeLocale = DEFAULT_LOCALE;
export function setLocale(locale: string): void {
  activeLocale = locale;
}
export function getLocale(): string {
  return activeLocale;
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  key: string,
  make: () => T,
): T {
  let hit = cache.get(key) as T | undefined;
  if (hit === undefined) {
    hit = make();
    cache.set(key, hit);
  }
  return hit;
}

export interface MoneyFormatOptions {
  locale?: string;
  currency?: string;
  /** Decimales de la unidad menor (2 para DOP). */
  decimals?: number;
  /** 'auto': solo el signo menos; 'always': también `+` en positivos. */
  sign?: 'auto' | 'always';
  compact?: boolean;
  /** Sin símbolo de moneda (para tablas con la moneda en la cabecera). */
  hideSymbol?: boolean;
}

/** Texto decimal exacto (sin pasar por flotantes) de un entero en unidad menor. */
export function minorToDecimalString(minor: Minor, decimals: number): string {
  const negative = minor < 0;
  const digits = BigInt(Math.abs(minor)).toString().padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${int}${decimals > 0 ? `.${frac}` : ''}`;
}

export function formatMoney(minor: Minor, options: MoneyFormatOptions = {}): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError('formatMoney espera un entero en unidad menor');
  const { locale = activeLocale, currency = DEFAULT_CURRENCY, decimals = 2, sign = 'auto', compact = false } = options;
  const hideSymbol = options.hideSymbol === true;
  const formatter = cached(`n|${locale}|${currency}|${decimals}|${compact}|${hideSymbol}`, () =>
    new Intl.NumberFormat(locale, {
      ...(hideSymbol ? { style: 'decimal' as const } : { style: 'currency' as const, currency }),
      minimumFractionDigits: compact ? 0 : decimals,
      maximumFractionDigits: compact ? 1 : decimals,
      ...(compact ? { notation: 'compact' as const } : {}),
    }),
  );
  const absolute = minorToDecimalString(Math.abs(minor), decimals);
  // Intl admite cadenas decimales exactas (ES2023); los tipos de lib aún no lo reflejan.
  const body = (formatter as { format(value: string): string }).format(absolute);
  if (minor < 0) return `${MINUS}${body}`;
  if (minor > 0 && sign === 'always') return `+${body}`;
  return body;
}

function parseIso(iso: IsoDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) throw new RangeError(`Fecha ISO inválida: ${iso}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Fecha de calendario como instante UTC al mediodía: inmune a la zona horaria al formatear con UTC. */
function utcNoon(iso: IsoDate): Date {
  const { year, month, day } = parseIso(iso);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateFormatter(locale: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(`d|${locale}|${key}`, () => new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }));
}

function cleanMonth(text: string): string {
  return text.replace(/\./g, '');
}

/** `26 nov 2026` */
export function formatDate(iso: IsoDate, locale: string = activeLocale): string {
  return cleanMonth(
    dateFormatter(locale, 'date', { day: 'numeric', month: 'short', year: 'numeric' }).format(utcNoon(iso)),
  ).replace(/ de /g, ' ');
}

export function dayDiff(a: IsoDate, b: IsoDate): number {
  return Math.round((utcNoon(a).getTime() - utcNoon(b).getTime()) / 86_400_000);
}

/** `Hoy`, `Ayer` o `jueves 26`. */
export function formatDayHeader(iso: IsoDate, today: IsoDate, locale: string = activeLocale): string {
  const diff = dayDiff(iso, today);
  if (diff === 0) return 'Hoy';
  if (diff === -1) return 'Ayer';
  return dateFormatter(locale, 'day', { weekday: 'long', day: 'numeric' }).format(utcNoon(iso)).replace(',', '');
}

/** `hoy`, `ayer`, `hace 3 días`, `en 2 días`. */
export function formatRelativeDay(iso: IsoDate, today: IsoDate, locale: string = activeLocale): string {
  const formatter = cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  return formatter.format(dayDiff(iso, today), 'day');
}

export type PeriodKind = 'month' | 'quarter' | 'year';

/** `noviembre 2026`, `T4 2026`, `2026`. `iso` es cualquier día del periodo. */
export function formatPeriod(iso: IsoDate, kind: PeriodKind, locale: string = activeLocale): string {
  const { year, month } = parseIso(iso);
  if (kind === 'year') return String(year);
  if (kind === 'quarter') return `T${Math.ceil(month / 3)} ${year}`;
  return dateFormatter(locale, 'month', { month: 'long', year: 'numeric' }).format(utcNoon(iso)).replace(' de ', ' ');
}
