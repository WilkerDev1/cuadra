// Fechas de calendario (ARCHITECTURE.md 2.1, 3.4): `IsoDate` 'YYYY-MM-DD' sin hora ni zona; las marcas
// del sistema son ISO-8601 UTC. Toda la aritmética es de calendario local (date-fns), semana de lunes.
import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subYears,
} from 'date-fns';
import type { Clock } from './ports';
import type { IsoDate, PeriodPreset, Timestamp } from './types';

export type { IsoDate, PeriodPreset, Timestamp } from './types';
export type PeriodUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

const WEEK = { weekStartsOn: 1 } as const; // lunes (es-DO)
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha 'YYYY-MM-DD' que existe en el calendario? */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

/** Fecha local de un Date ('YYYY-MM-DD'). */
export function toIsoDate(date: Date): IsoDate {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Medianoche local de una IsoDate. Lanza RangeError si no es válida. */
export function fromIsoDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new RangeError(`fecha inválida: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  if (y < 100) date.setFullYear(y);
  return date;
}

/** Marca del sistema ISO-8601 UTC con milisegundos. */
export function toTimestamp(date: Date): Timestamp {
  return date.toISOString();
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return toIsoDate(dfAddDays(fromIsoDate(iso), n));
}

/** Suma meses; si el día no existe se queda en el último del mes (31 ene + 1 → 28 feb). */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  return toIsoDate(dfAddMonths(fromIsoDate(iso), n));
}

/** Días de calendario de `a` a `b` (positivo si b es posterior). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return differenceInCalendarDays(fromIsoDate(b), fromIsoDate(a));
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthKey(iso: IsoDate): string {
  return iso.slice(0, 7);
}

/** Primer y último día de un mes 'YYYY-MM'. */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const from = `${month}-01`;
  return { from, to: toIsoDate(endOfMonth(fromIsoDate(from))) };
}

function startOf(date: Date, unit: PeriodUnit): Date {
  switch (unit) {
    case 'day':
      return date;
    case 'week':
      return startOfWeek(date, WEEK);
    case 'month':
      return startOfMonth(date);
    case 'quarter':
      return startOfQuarter(date);
    case 'year':
      return startOfYear(date);
  }
}

function step(date: Date, unit: PeriodUnit): Date {
  switch (unit) {
    case 'day':
      return dfAddDays(date, 1);
    case 'week':
      return addWeeks(date, 1);
    case 'month':
      return dfAddMonths(date, 1);
    case 'quarter':
      return addQuarters(date, 1);
    case 'year':
      return addYears(date, 1);
  }
}

/**
 * Clave estable y ordenable del periodo que contiene la fecha:
 * día 'YYYY-MM-DD', semana = lunes 'YYYY-MM-DD', mes 'YYYY-MM', trimestre 'YYYY-Qn', año 'YYYY'.
 */
export function periodKey(iso: IsoDate, unit: PeriodUnit): string {
  switch (unit) {
    case 'day':
      return iso;
    case 'week':
      return toIsoDate(startOfWeek(fromIsoDate(iso), WEEK));
    case 'month':
      return iso.slice(0, 7);
    case 'quarter':
      return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
    case 'year':
      return iso.slice(0, 4);
  }
}

/** Todas las claves de periodo entre dos fechas (inclusive), para rellenar huecos con cero. */
export function enumeratePeriodKeys(from: IsoDate, to: IsoDate, unit: PeriodUnit): string[] {
  if (from > to) return [];
  const keys: string[] = [];
  const end = fromIsoDate(to);
  for (let d = startOf(fromIsoDate(from), unit); d <= end; d = step(d, unit)) {
    keys.push(periodKey(toIsoDate(d), unit));
  }
  return keys;
}

/** Rango [from, to] (inclusive) de un preset relativo a `today`. 'all' → sin límites. */
export function presetRange(preset: PeriodPreset, today: IsoDate): { from: IsoDate | null; to: IsoDate | null } {
  const t = fromIsoDate(today);
  const range = (a: Date, b: Date) => ({ from: toIsoDate(a), to: toIsoDate(b) });
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'this_week':
      return range(startOfWeek(t, WEEK), endOfWeek(t, WEEK));
    case 'this_month':
      return range(startOfMonth(t), endOfMonth(t));
    case 'last_month': {
      const p = subMonths(startOfMonth(t), 1);
      return range(p, endOfMonth(p));
    }
    case 'this_quarter':
      return range(startOfQuarter(t), endOfQuarter(t));
    case 'last_quarter': {
      const p = subQuarters(startOfQuarter(t), 1);
      return range(p, endOfQuarter(p));
    }
    case 'this_year':
      return range(startOfYear(t), endOfYear(t));
    case 'last_year': {
      const p = subYears(startOfYear(t), 1);
      return range(p, endOfYear(p));
    }
    case 'last_30_days':
      return range(subDays(t, 29), t);
    case 'last_12_months':
      return range(subMonths(startOfMonth(t), 11), endOfMonth(t));
    case 'all':
      return { from: null, to: null };
  }
}

// ── Etiquetas en español (informes y resúmenes; la UI tiene además i18n/format) ─────────

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

/** "26 nov 2026". */
export function dayLabel(iso: IsoDate): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1] ?? m} ${y}`;
}

/** "noviembre 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** Etiqueta legible de un rango: mes, trimestre, año, día o "a – b". */
export function periodLabel(from: IsoDate | null, to: IsoDate | null): string {
  if (from === null && to === null) return 'Todo el historial';
  if (from === null) return `Hasta ${dayLabel(to as IsoDate)}`;
  if (to === null) return `Desde ${dayLabel(from)}`;
  if (from === to) return dayLabel(from);
  const f = fromIsoDate(from);
  if (toIsoDate(startOfMonth(f)) === from && toIsoDate(endOfMonth(f)) === to) return monthLabel(from.slice(0, 7));
  if (toIsoDate(startOfQuarter(f)) === from && toIsoDate(endOfQuarter(f)) === to) {
    return `T${Math.floor(f.getMonth() / 3) + 1} ${f.getFullYear()}`;
  }
  if (toIsoDate(startOfYear(f)) === from && toIsoDate(endOfYear(f)) === to) {
    return String(f.getFullYear());
  }
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

// ── Relojes ──────────────────────────────────────────────────────────────────────────

/** Reloj del sistema: `today()` es la fecha local del usuario, no la UTC. */
export const systemClock: Clock = {
  now: () => new Date(),
  today: () => toIsoDate(new Date()),
};

/** Reloj fijo para pruebas y datos de ejemplo. */
export class FixedClock implements Clock {
  private ms: number;

  constructor(iso: string | Date = '2026-06-15T12:00:00Z') {
    this.ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
    if (Number.isNaN(this.ms)) throw new RangeError(`instante inválido: ${String(iso)}`);
  }

  now(): Date {
    return new Date(this.ms);
  }

  today(): IsoDate {
    return toIsoDate(new Date(this.ms));
  }

  set(iso: string | Date): void {
    const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
    if (Number.isNaN(ms)) throw new RangeError(`instante inválido: ${String(iso)}`);
    this.ms = ms;
  }

  /** Mueve el reloj al mediodía local de esa fecha. */
  setToday(iso: IsoDate): void {
    const d = fromIsoDate(iso);
    d.setHours(12, 0, 0, 0);
    this.ms = d.getTime();
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}
