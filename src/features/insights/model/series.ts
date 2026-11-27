// Del SummaryResult del núcleo a lo que dibujan la gráfica y la tabla. Puro; montos siempre enteros en unidad
// menor (las proporciones de pantalla y los porcentajes son flotantes, nunca dinero).
import { groupFilter } from '../../../core';
import type { Clock, Field, GroupBy, SummaryGroup, TxFilter } from '../../../core';
import { movementsHref as sharedMovementsHref } from '../../../app/data/txFilterUrl';
import type { Measure } from './state';

type Flows = Pick<SummaryGroup, 'inMinor' | 'outMinor' | 'netMinor' | 'count'>;

export function measureOf(g: Flows, m: Measure): number {
  switch (m) {
    case 'in':
      return g.inMinor;
    case 'out':
      return g.outMinor;
    case 'net':
      return g.netMinor;
    case 'count':
      return g.count;
  }
}

export interface Point {
  /** Clave del grupo (null = «Sin valor»). */
  key: string | null;
  /** Clave estable para React y el foco. */
  id: string;
  label: string;
  value: number;
  /** Valor del periodo anterior (alineado por posición en el tiempo, por clave en dimensiones). */
  prev: number | null;
  group: SummaryGroup;
}

export function buildPoints(groups: readonly SummaryGroup[], measure: Measure, prev: readonly SummaryGroup[] | null, time: boolean): Point[] {
  const byKey = new Map((prev ?? []).map((g) => [g.key, g]));
  // En el tiempo, el periodo anterior se alinea desde el final: el último mes con el último mes.
  const offset = prev === null ? 0 : prev.length - groups.length;
  return groups.map((g, i) => {
    const p = prev === null ? undefined : time ? prev[i + offset] : byKey.get(g.key);
    return {
      key: g.key,
      id: g.key ?? '∅',
      label: g.label,
      value: measureOf(g, measure),
      prev: prev === null ? null : p === undefined ? 0 : measureOf(p, measure),
      group: g,
    };
  });
}

/** Suma de los grupos (I-13: coincide con los totales del filtro). */
export function sumGroups(groups: readonly SummaryGroup[]): Flows {
  let inMinor = 0;
  let outMinor = 0;
  let count = 0;
  for (const g of groups) {
    inMinor += g.inMinor;
    outMinor += g.outMinor;
    count += g.count;
  }
  return { inMinor, outMinor, netMinor: inMinor - outMinor, count };
}

/** Variación: diferencia entera y proporción (null si el anterior es 0). */
export function change(cur: number, prev: number): { diff: number; ratio: number | null } {
  return { diff: cur - prev, ratio: prev === 0 ? null : (cur - prev) / Math.abs(prev) };
}

// ── Escalas ──────────────────────────────────────────────────────────────────────────

/** Tope «bonito» ≥ v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 u 8 por potencia de 10): ajustado para que las barras
 *  usen la altura sin que el rótulo del eje quede raro. */
export function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const c = Math.round(m * base * 1000) / 1000;
    if (c >= v) return c;
  }
  return 10 * base;
}

/** Rótulo de eje con signo menos tipográfico (U+2212), nunca guion. */
export function axisLabel(v: number, format: (abs: number) => string): string {
  return v < 0 ? `\u2212${format(-v)}` : format(v);
}

export interface Domain {
  lo: number;
  hi: number;
}

/** Dominio que siempre contiene el cero; con negativos, el cero queda dentro. */
export function domainOf(values: readonly number[]): Domain {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const hi = niceCeil(max);
  const lo = min < 0 ? -niceCeil(-min) : 0;
  return hi === lo ? { lo: 0, hi: 1 } : { lo, hi };
}

/** Barra de `a` a `b` como porcentajes desde el inicio del eje (arriba en vertical, izquierda en horizontal). */
export function span(d: Domain, a: number, b: number, vertical: boolean): { start: number; size: number } {
  const range = d.hi - d.lo;
  const pos = (v: number) => (vertical ? (d.hi - v) / range : (v - d.lo) / range) * 100;
  const p1 = pos(a);
  const p2 = pos(b);
  return { start: Math.min(p1, p2), size: Math.abs(p2 - p1) };
}

/** Posición del valor en porcentaje (0 = inicio del eje). */
export function at(d: Domain, v: number, vertical: boolean): number {
  return span(d, v, v, vertical).start;
}

/** Saldo acumulado del neto de cada grupo (línea de la Escalera). */
export function cumulative(values: readonly number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

/** Cada cuántos se rotula el eje para que quepan como mucho `max` etiquetas. */
export function labelStep(n: number, max: number): number {
  return n <= max ? 1 : Math.ceil(n / max);
}

// ── Etiquetas cortas de periodo ──────────────────────────────────────────────────────

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Rótulo corto para el eje: mes «nov» (con el año en enero y en el primero: «ene 26»), día y semana «24 mar»,
 * trimestre «T4 26», año «2026». `first` = es la primera etiqueta visible.
 */
export function shortPeriodLabel(key: string | null, unit: 'day' | 'week' | 'month' | 'quarter' | 'year', first: boolean): string {
  if (key === null) return '';
  const yy = key.slice(2, 4);
  switch (unit) {
    case 'year':
      return key;
    case 'quarter':
      return `T${key.slice(6)} ${yy}`;
    case 'month': {
      const m = MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key;
      return first || key.endsWith('-01') ? `${m} ${yy}` : m;
    }
    case 'day':
    case 'week':
      return `${Number(key.slice(8, 10))} ${MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? ''}`;
  }
}

// ── Filas de la tabla ────────────────────────────────────────────────────────────────

export interface TableRow {
  id: string;
  depth: 0 | 1;
  group: SummaryGroup;
  parent: SummaryGroup | null;
  prev: number | null;
}

/** Grupos con sus subgrupos debajo (segunda agrupación). Los subgrupos vacíos no se listan. */
export function tableRows(points: readonly Point[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const p of points) {
    rows.push({ id: p.id, depth: 0, group: p.group, parent: null, prev: p.prev });
    for (const s of p.group.split ?? []) {
      if (s.count === 0) continue;
      rows.push({ id: `${p.id}/${s.key ?? '∅'}`, depth: 1, group: s, parent: p.group, prev: null });
    }
  }
  return rows;
}

/** Tope de filas que la tabla pinta de una vez; más allá, «Mostrar más» (un resumen por día de todo el historial
 *  son más de mil grupos y decenas de miles de nodos). */
export const TABLE_ROW_BUDGET = 240;

export interface TableWindow {
  rows: TableRow[];
  /** Grupos (de primer nivel) que quedan fuera. */
  hiddenGroups: number;
  totalGroups: number;
}

/**
 * Ventana de filas: grupos enteros (con sus subgrupos) hasta `budget` filas; siempre al menos un grupo. En el tiempo
 * (`fromEnd`) se toman los más recientes —el final— y se conserva el orden cronológico; en dimensiones, los primeros.
 */
export function tableWindow(rows: readonly TableRow[], budget: number, fromEnd: boolean): TableWindow {
  const blocks: TableRow[][] = [];
  for (const r of rows) {
    if (r.depth === 0 || blocks.length === 0) blocks.push([r]);
    else blocks[blocks.length - 1]?.push(r);
  }
  const order = fromEnd ? [...blocks].reverse() : blocks;
  const taken: TableRow[][] = [];
  let n = 0;
  for (const b of order) {
    if (taken.length > 0 && n + b.length > budget) break;
    taken.push(b);
    n += b.length;
  }
  if (fromEnd) taken.reverse();
  return { rows: taken.flat(), hiddenGroups: blocks.length - taken.length, totalGroups: blocks.length };
}

// ── Enlace a Movimientos ─────────────────────────────────────────────────────────────

function fieldTypeOf(g: GroupBy, fields: readonly Field[]) {
  if (g.by !== 'field') return {};
  const f = fields.find((x) => x.id === g.fieldId);
  return f === undefined ? {} : { fieldType: f.type };
}

/** Filtro de los movimientos que forman un grupo (y subgrupo, si hay segunda agrupación). */
export function groupTxFilter(
  base: TxFilter,
  groupBy: GroupBy,
  key: string | null,
  ctx: { fields: readonly Field[]; clock?: Clock },
  sub?: { split: GroupBy; key: string | null },
): TxFilter {
  const clockOpt = ctx.clock === undefined ? {} : { clock: ctx.clock };
  const first = groupFilter(base, groupBy, key, { ...clockOpt, ...fieldTypeOf(groupBy, ctx.fields) });
  return sub === undefined ? first : groupFilter(first, sub.split, sub.key, { ...clockOpt, ...fieldTypeOf(sub.split, ctx.fields) });
}

/** Enlace a Movimientos con el filtro del grupo (formato compartido de app/data/txFilterUrl). */
export function movementsHref(workspaceId: string, filter: TxFilter): string {
  return sharedMovementsHref(workspaceId, filter);
}
