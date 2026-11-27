// Plan de datos de ejemplo (ARCHITECTURE.md 6): una descripción pura, sin ids, de todo lo que el servicio
// demo escribe. Las referencias van por CLAVE de plantilla (cuenta, campo, opción) y por `ref` propia para
// los movimientos que la "historia" posterior edita, anula o restaura. Mismo perfil + semilla + ancla →
// mismo plan, byte a byte (hashPlan).
import { addDays, compareIsoDate, fromIsoDate, toIsoDate } from '../dates';
import type { AccountType, AppliesTo, FieldRole, FieldType, IsoDate, Minor } from '../types';
import { fnv1a } from './prng';

export type DemoProfileId = 'colmado' | 'despacho' | 'personal';
export type DemoTemplateId = 'negocio' | 'despacho' | 'personal';

/** Valor por clave de campo: lista → clave de opción; texto → texto; fecha → IsoDate; número; sí/no. */
export type DemoValue = string | number | boolean;
export type DemoValues = Record<string /* field key */, DemoValue>;

export interface DemoOpening {
  amountMinor: Minor;
  direction: 'in' | 'out';
  date: IsoDate;
}

export interface DemoRow {
  amountMinor: Minor;
  description: string;
  notes?: string;
  values: DemoValues;
}

export type DemoItem =
  | {
      t: 'tx';
      ref?: string;
      account: string;
      kind: 'income' | 'expense';
      amountMinor: Minor;
      date: IsoDate;
      description: string;
      notes?: string;
      values: DemoValues;
    }
  | {
      t: 'transfer';
      ref?: string;
      from: string;
      to: string;
      amountMinor: Minor;
      date: IsoDate;
      description: string;
      notes?: string;
      values?: DemoValues;
    }
  | {
      /** Un lote de captura (tabla de captura) en una cuenta: filas del mismo tipo y día. */
      t: 'capture';
      ref?: string;
      account: string;
      kind: 'income' | 'expense';
      date: IsoDate;
      label: string;
      controlTotalMinor: Minor;
      /** El total de control no cuadra y se aceptó (con esta nota en el lote). */
      mismatchNote?: string;
      rows: DemoRow[];
    }
  | {
      /**
       * Un lote importado: el servicio arma con estas filas una hoja tipo Excel (preámbulo del banco,
       * cabeceras, Débito/Crédito y una columna por campo) y la pasa por importCsv.fromRows → preview →
       * commit, así que queda como un lote de importación real. `date` = la fecha en que se importó.
       */
      t: 'import';
      ref?: string;
      account: string;
      date: IsoDate;
      label: string;
      fileName: string;
      /** Líneas de encabezado del archivo antes de las cabeceras (nombre del banco, cuenta, periodo). */
      preamble: string[];
      rows: Array<DemoRow & { kind: 'income' | 'expense'; date: IsoDate }>;
    };

/** Lo que pasa DESPUÉS de anotar: ediciones, anulaciones, fusiones… Cada paso es una acción de historial real. */
export type DemoStep =
  | {
      t: 'edit';
      at: IsoDate;
      ref: string;
      patch: { amountMinor?: Minor; description?: string; notes?: string; date?: IsoDate; values?: Record<string, DemoValue | null> };
    }
  | { t: 'void'; at: IsoDate; ref: string; reason: string }
  | { t: 'restore'; at: IsoDate; ref: string }
  | { t: 'void_batch'; at: IsoDate; ref: string; reason: string }
  | { t: 'rename_option'; at: IsoDate; field: string; option: string; label: string }
  | { t: 'merge_options'; at: IsoDate; field: string; source: string; target: string }
  | { t: 'deactivate_field'; at: IsoDate; field: string }
  | { t: 'archive_account'; at: IsoDate; account: string };

export interface DemoExtraAccount {
  key: string;
  name: string;
  type: AccountType;
  icon?: string;
  opening?: DemoOpening;
}

export interface DemoExtraField {
  key: string;
  label: string;
  type: FieldType;
  appliesTo?: AppliesTo;
  role?: FieldRole;
  options?: Array<{ key: string; label: string }>;
}

/**
 * Vista guardada que la demo añade a las de la plantilla. La receta va con CLAVES (como en las plantillas:
 * 'categoria', 'categoria.ventas', 'banco'); el servicio las traduce con resolveTemplateRecipe.
 */
export interface DemoView {
  name: string;
  pinned?: boolean;
  recipe: Record<string, unknown> & { kind: 'filter' | 'summary' | 'report' };
}

export interface DemoPlan {
  profile: DemoProfileId;
  templateId: DemoTemplateId;
  workspace: { name: string; ownerName?: string };
  /** Primer día con datos y día ancla (hoy). */
  start: IsoDate;
  anchor: IsoDate;
  /** Saldos iniciales de las cuentas de la plantilla, por clave. */
  openings: Record<string, DemoOpening>;
  extraAccounts: DemoExtraAccount[];
  extraFields: DemoExtraField[];
  /** Opciones nuevas de campos de lista de la plantilla (contactos, comercios…). */
  extraOptions: Record<string /* field key */, Array<{ key: string; label: string }>>;
  /** Ordenados por fecha (orden estable). */
  items: DemoItem[];
  /** Ordenados por `at`. */
  steps: DemoStep[];
  /** Vistas guardadas extra (filtros, resúmenes e informes), además de las de la plantilla. */
  views: DemoView[];
  /** Días desde el último respaldo verificado que se registra si no había ninguno (vencido a propósito). */
  backupVerifiedDaysAgo: number;
}

export interface PlanOptions {
  seed: number;
  anchor: IsoDate;
  months: number;
}

export const DEMO_SEED = 20261126;
export const DEMO_MONTHS = 14;

/** Fecha en que acaba un elemento (los import se ordenan por su fecha de importación). */
const itemDate = (it: DemoItem): IsoDate => it.date;

/**
 * Día en que el elemento queda ANOTADO en la base (su created_at): los movimientos sueltos se anotan por
 * bloques semanales (lunes a domingo) el domingo, o el día ancla si la semana no ha terminado; los lotes de
 * captura, el mismo día; los importados, el día de la importación. La historia de un movimiento (ediciones,
 * anulaciones) siempre cae DESPUÉS de este día.
 */
export function recordedOn(it: DemoItem, anchor: IsoDate): IsoDate {
  if (it.t === 'capture' || it.t === 'import') return it.date;
  const sunday = addDays(it.date, (7 - weekday(it.date)) % 7);
  return compareIsoDate(sunday, anchor) > 0 ? anchor : sunday;
}

export function sortPlan(plan: DemoPlan): DemoPlan {
  const items = plan.items.map((it, i) => ({ it, i }));
  items.sort((a, b) => compareIsoDate(itemDate(a.it), itemDate(b.it)) || a.i - b.i);
  const steps = plan.steps.map((s, i) => ({ s, i }));
  steps.sort((a, b) => compareIsoDate(a.s.at, b.s.at) || a.i - b.i);
  return { ...plan, items: items.map((x) => x.it), steps: steps.map((x) => x.s) };
}

/** Huella determinista del plan (prueba 104). */
export function hashPlan(plan: DemoPlan): string {
  const text = JSON.stringify(plan);
  // Dos FNV-1a con prefijos distintos: 64 bits de huella, suficiente para detectar cualquier cambio.
  return `${fnv1a(text)}${fnv1a(`cuadra:${text}`)}`;
}

/** Número de movimientos (filas de `transactions`) que crea el plan, contando saldos iniciales y los dos lados. */
export function countPlanTransactions(plan: DemoPlan): number {
  let n = Object.keys(plan.openings).length + plan.extraAccounts.filter((a) => a.opening).length;
  for (const it of plan.items) {
    if (it.t === 'tx') n += 1;
    else if (it.t === 'transfer') n += 2;
    else n += it.rows.length;
  }
  return n;
}

// ── Calendario ───────────────────────────────────────────────────────────────────────

/** 0 = domingo … 6 = sábado. */
export const weekday = (iso: IsoDate): number => fromIsoDate(iso).getDay();
export const dayOfMonth = (iso: IsoDate): number => Number(iso.slice(8, 10));
export const monthOf = (iso: IsoDate): number => Number(iso.slice(5, 7));

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIsoDate(new Date(year, month - 1, day));
}

export const goodFriday = (year: number): IsoDate => addDays(easterSunday(year), -2);

/** Días de `from` a `to`, ambos incluidos. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; compareIsoDate(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Último día del mes de `iso`. */
export function lastDayOfMonth(iso: IsoDate): IsoDate {
  const d = fromIsoDate(iso);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Día `day` del mes de `iso`, recortado al último día del mes. */
export function dayIn(iso: IsoDate, day: number): IsoDate {
  const last = lastDayOfMonth(iso);
  const n = Math.min(day, dayOfMonth(last));
  return `${iso.slice(0, 8)}${String(n).padStart(2, '0')}`;
}

/** Primeros días de cada mes desde el de `from` hasta el de `to`. */
export function monthStarts(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let d = `${from.slice(0, 8)}01`;
  const end = `${to.slice(0, 8)}01`;
  while (compareIsoDate(d, end) <= 0) {
    out.push(d);
    const next = fromIsoDate(d);
    d = toIsoDate(new Date(next.getFullYear(), next.getMonth() + 1, 1));
  }
  return out;
}

/** Primer día de datos: el día 1 del mes que queda `months − 1` meses antes del ancla (≈ 14 meses). */
export function planStart(anchor: IsoDate, months: number): IsoDate {
  const d = fromIsoDate(anchor);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() - (months - 1), 1));
}

/** Factor de estacionalidad en porcentaje entero: diciembre +35 %, agosto (inicio de clases) +15 %, enero −20 % (la cuesta de enero). */
export function seasonPercent(iso: IsoDate): number {
  const m = monthOf(iso);
  if (m === 12) return 135;
  if (m === 8) return 115;
  if (m === 1) return 80;
  return 100;
}

/** Días de quincena (cobro de salarios): el 15, el 16, el 30, el 31 y el 1 se vende un 15 % más. */
export function paydayPercent(iso: IsoDate): number {
  const d = dayOfMonth(iso);
  return d === 15 || d === 16 || d === 30 || d === 31 || d === 1 ? 115 : 100;
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

/** "julio 2026" (nombres de archivo y preámbulos de los estados de cuenta). */
export const monthName = (iso: IsoDate): string => `${MONTH_NAMES[monthOf(iso) - 1] as string} ${iso.slice(0, 4)}`;

/** NCF de comprobante fiscal ficticio con prefijo de serie (B01 crédito fiscal, B02 consumo, B14…). */
export function ncf(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(8, '0')}`;
}

export const inRange = (d: IsoDate, from: IsoDate, to: IsoDate): boolean =>
  compareIsoDate(d, from) >= 0 && compareIsoDate(d, to) <= 0;
