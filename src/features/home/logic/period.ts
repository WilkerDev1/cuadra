// Periodo del panel: tipo (mes, trimestre, año, 12 meses) y desplazamiento hacia atrás desde hoy.
// Puro: recibe `today` y devuelve rangos; nunca lee el reloj.
import { addMonths, monthKey, monthRange, type DashboardOptions, type DateRange, type IsoDate, type PeriodPreset } from '../../../core';

export type PeriodKind = 'month' | 'quarter' | 'year' | '12m';
export const PERIOD_KINDS: readonly PeriodKind[] = ['month', 'quarter', 'year', '12m'];

export interface PeriodSel {
  kind: PeriodKind;
  /** 0 = el periodo actual; −1 el anterior… Nunca positivo (no hay datos del futuro). */
  offset: number;
}

const firstOfMonth = (iso: IsoDate): IsoDate => `${monthKey(iso)}-01`;
const endOfMonth = (iso: IsoDate): IsoDate => monthRange(monthKey(iso)).to;

/** Rango cerrado [from, to] del periodo elegido. */
export function periodRange(sel: PeriodSel, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const off = Math.min(0, Math.trunc(sel.offset));
  const m0 = firstOfMonth(today);
  switch (sel.kind) {
    case 'month': {
      const from = addMonths(m0, off);
      return { from, to: endOfMonth(from) };
    }
    case 'quarter': {
      const month = Number(today.slice(5, 7));
      const qStart = addMonths(m0, -((month - 1) % 3));
      const from = addMonths(qStart, off * 3);
      return { from, to: endOfMonth(addMonths(from, 2)) };
    }
    case 'year': {
      const y = Number(today.slice(0, 4)) + off;
      const yy = String(y).padStart(4, '0');
      return { from: `${yy}-01-01`, to: `${yy}-12-31` };
    }
    case '12m': {
      const last = addMonths(m0, off * 12);
      return { from: addMonths(last, -11), to: endOfMonth(last) };
    }
  }
}

const PRESET: Record<PeriodKind, PeriodPreset> = {
  month: 'this_month',
  quarter: 'this_quarter',
  year: 'this_year',
  '12m': 'last_12_months',
};

/** El preset equivalente cuando el periodo es el actual (para `?periodo=`), si no `null`. */
export function presetFor(sel: PeriodSel): PeriodPreset | null {
  return sel.offset === 0 ? PRESET[sel.kind] : null;
}

/** DateRange del filtro: preset si es el actual (enlaces legibles), rango explícito si no. */
export function periodFilter(sel: PeriodSel, today: IsoDate): DateRange {
  const preset = presetFor(sel);
  return preset === null ? periodRange(sel, today) : { preset };
}

/** Opciones de `queries.dashboard` para el escritorio. */
export function desktopOptions(sel: PeriodSel, today: IsoDate, extra: Pick<DashboardOptions, 'breakdown' | 'measure'> = {}): DashboardOptions {
  return {
    period: periodFilter(sel, today),
    months: 12,
    seriesUnit: 'week',
    topLimit: 5,
    recentLimit: 9,
    ...extra,
  };
}

/** Opciones del inicio móvil: mes en curso y saldo diario para las líneas de 30 días. */
export function mobileOptions(): DashboardOptions {
  return { period: { preset: 'this_month' }, months: 2, seriesUnit: 'day', topLimit: 1, recentLimit: 14 };
}

/** ¿El mes `key` (`YYYY-MM`) cae dentro del rango? */
export function monthInRange(key: string, range: { from: IsoDate | null; to: IsoDate | null }): boolean {
  const { from, to } = monthRange(key);
  return (range.from === null || to >= range.from) && (range.to === null || from <= range.to);
}

/** Lee `?p=month:-1` (estado del panel en la URL); valores raros → mes actual. */
export function parsePeriodParam(raw: string | null): PeriodSel {
  if (raw === null) return { kind: 'month', offset: 0 };
  const [kind, off] = raw.split(':');
  const k = PERIOD_KINDS.find((x) => x === kind) ?? 'month';
  const n = Number(off ?? '0');
  return { kind: k, offset: Number.isInteger(n) && n <= 0 && n >= -120 ? n : 0 };
}

export function formatPeriodParam(sel: PeriodSel): string {
  return sel.offset === 0 ? sel.kind : `${sel.kind}:${sel.offset}`;
}

/** «octubre 2026» → «octubre» si es del mismo año que `current` (comparaciones más cortas). */
export function shortPeriodLabel(label: string, current: string): string {
  const year = /(\d{4})$/.exec(label)?.[1];
  const curYear = /(\d{4})$/.exec(current)?.[1];
  return year !== undefined && year === curYear && /\D/.test(label.slice(0, -4).trim()) ? label.slice(0, -4).trim() : label;
}
