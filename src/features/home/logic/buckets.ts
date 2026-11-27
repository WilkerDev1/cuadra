// Cubos de las gráficas del panel: el periodo elegido se parte en días (mes), semanas (trimestre) o meses (año y
// 12 meses) y los puntos diarios de `queries.dashboard` se suman en ellos. Puro: recibe `today`, nunca lee el reloj.
// Los montos entran y salen en unidad menor (enteros).
import { addDays, diffDays, monthRange, type IsoDate, type Minor, type TxFilter } from '../../../core';

export type Grain = 'day' | 'week' | 'month';

/** Un punto por día del periodo, tal como lo da `DashboardData.daily`. */
export interface DayPoint {
  date: IsoDate;
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  balanceMinor: Minor;
  count: number;
}

export interface BucketRange {
  key: string;
  from: IsoDate;
  to: IsoDate;
}

export interface Bucket extends BucketRange {
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  count: number;
  /** Saldo total al cierre del cubo (o de hoy, si lo contiene); `null` si aún no ha llegado. */
  closeMinor: Minor | null;
  /** Saldo al final del cubo contando lo programado (movimientos con fecha posterior a hoy). */
  endMinor: Minor;
  /** Empieza después de hoy: solo puede tener movimientos programados. */
  future: boolean;
  /** Contiene hoy: sus cifras son parciales. */
  current: boolean;
  /** Tiene movimientos con fecha posterior a hoy (cuentan en sus barras, no en su cierre). */
  pending: boolean;
}

/**
 * Granularidad según la duración del rango: hasta 31 días, por día; hasta 3 meses (92 días), por semana; más,
 * por mes. Se deduce del rango (no del tipo elegido) para que los datos que aún se muestran mientras llega la
 * consulta nueva se dibujen siempre con su propia rejilla.
 */
export function grainFor(from: IsoDate, to: IsoDate): Grain {
  const days = diffDays(from, to) + 1;
  if (days <= 31) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

/** Lunes = 0 … domingo = 6. */
const weekday = (iso: IsoDate): number => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

export function isWeekend(iso: IsoDate): boolean {
  return weekday(iso) >= 5;
}

/** Cubos que cubren [from, to] sin huecos ni solapes: días; semanas de lunes a domingo y meses, recortados al rango. */
export function bucketRanges(from: IsoDate, to: IsoDate, grain: Grain): BucketRange[] {
  const out: BucketRange[] = [];
  let d = from;
  while (d <= to) {
    let end: IsoDate;
    if (grain === 'day') end = d;
    else if (grain === 'week') end = addDays(d, 6 - weekday(d));
    else end = monthRange(d.slice(0, 7)).to;
    if (end > to) end = to;
    out.push({ key: grain === 'month' ? d.slice(0, 7) : d, from: d, to: end });
    d = addDays(end, 1);
  }
  return out;
}

/**
 * Suma los días en sus cubos, todos los del rango (también los posteriores a `today`: un movimiento con fecha
 * futura cuenta en las barras de su cubo, igual que en los totales del periodo). El cierre de cada cubo es el
 * saldo de su último día con dato hasta `today`; un día sin dato arrastra el último saldo conocido (empezando por
 * `openingMinor`). Los cubos que empiezan después de `today` no tienen cierre.
 */
export function buildBuckets(ranges: readonly BucketRange[], days: readonly DayPoint[], today: IsoDate, openingMinor: Minor): Bucket[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  let last: Minor = openingMinor;
  let run: Minor = openingMinor;
  return ranges.map((r) => {
    const future = r.from > today;
    let inMinor = 0;
    let outMinor = 0;
    let count = 0;
    let pending = false;
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      const p = byDate.get(d);
      if (p === undefined) continue;
      inMinor += p.inMinor;
      outMinor += p.outMinor;
      count += p.count;
      if (d <= today) last = p.balanceMinor;
      else if (p.count > 0 || p.balanceMinor !== run) pending = true;
      run = p.balanceMinor;
    }
    return {
      ...r,
      inMinor,
      outMinor,
      netMinor: inMinor - outMinor,
      count,
      closeMinor: future ? null : last,
      endMinor: run,
      future,
      current: !future && r.to >= today,
      pending,
    };
  });
}

/** Días que cubre un cubo (una semana recortada al borde del periodo tiene menos de 7). */
export function bucketDays(r: BucketRange): number {
  return diffDays(r.from, r.to) + 1;
}

/**
 * Mes al que pertenece un cubo (`YYYY-MM`): el de su día central, es decir, el que tiene la mayoría de sus días.
 * Una semana del 31 ago al 6 sept es de septiembre.
 */
export function bucketMonth(r: BucketRange): string {
  return addDays(r.from, Math.floor(diffDays(r.from, r.to) / 2)).slice(0, 7);
}

/** Valores de la línea de saldo: la apertura del periodo y el cierre de cada cubo (`null` en el futuro). */
export function balanceLine(openingMinor: Minor, buckets: readonly Bucket[]): Array<Minor | null> {
  return [openingMinor, ...buckets.map((b) => b.closeMinor)];
}

/**
 * Línea de comparación: el periodo anterior equivalente con la misma rejilla, alineado por posición (día 3 con
 * día 3, semana 2 con semana 2) y recortado a `n` cubos. Vacía si no hay datos del periodo anterior.
 */
export function previousLine(
  prev: { openingMinor: Minor; balances: ReadonlyArray<{ date: IsoDate; balanceMinor: Minor }> } | null,
  range: { from: IsoDate; to: IsoDate },
  grain: Grain,
  n: number,
): { values: Minor[]; ranges: BucketRange[] } {
  if (prev === null || prev.balances.length === 0) return { values: [], ranges: [] };
  const ranges = bucketRanges(range.from, range.to, grain).slice(0, n);
  const days = prev.balances.map((b) => ({ date: b.date, inMinor: 0, outMinor: 0, netMinor: 0, balanceMinor: b.balanceMinor, count: 0 }));
  const closes = buildBuckets(ranges, days, range.to, prev.openingMinor).map((b) => b.closeMinor ?? prev.openingMinor);
  return { values: [prev.openingMinor, ...closes], ranges };
}

/** Separación mínima (en cubos) entre dos rótulos de día del eje. */
const DAY_TICK_GAP = 4;

/**
 * Días rotulados del eje de un mes: hoy (si cae dentro), el primer día y los lunes, descartando los que quedan a
 * menos de `DAY_TICK_GAP` días de uno ya puesto. Devuelve índices ordenados.
 */
export function dayTicks(ranges: readonly BucketRange[], today: IsoDate | null): number[] {
  const todayIdx = today === null ? -1 : ranges.findIndex((r) => r.from === today);
  const candidates = [todayIdx, 0, ...ranges.flatMap((r, i) => (weekday(r.from) === 0 ? [i] : []))].filter((i) => i >= 0);
  const kept: number[] = [];
  for (const i of candidates) {
    if (kept.every((k) => Math.abs(k - i) >= DAY_TICK_GAP)) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

/**
 * Índices de los cubos donde empieza un mes nuevo (el primero siempre): rótulos y separadores de las semanas.
 * Cada semana va con el mes que tiene la mayoría de sus días (`bucketMonth`).
 */
export function monthStarts(ranges: readonly BucketRange[]): number[] {
  const out: number[] = [];
  ranges.forEach((r, i) => {
    if (i === 0 || bucketMonth(r) !== bucketMonth(ranges[i - 1]!)) out.push(i);
  });
  return out;
}

/** Filtro de Movimientos de un cubo: ese rango exacto, solo entradas y salidas (lo que suman las barras). */
export function bucketFilter(range: { from: IsoDate; to: IsoDate }): TxFilter {
  return { period: { from: range.from, to: range.to }, kinds: ['income', 'expense'] };
}

/** Lo que necesitan las dos gráficas del panel para un periodo, con la misma rejilla. */
export interface PeriodChart {
  grain: Grain;
  from: IsoDate;
  to: IsoDate;
  buckets: Bucket[];
  /** Apertura y cierre de cada cubo (`null` en el futuro): `buckets.length + 1` valores. */
  line: Array<Minor | null>;
  /** Índice del último valor de `line` con dato. */
  lastIndex: number;
  /**
   * Periodo anterior con la misma rejilla (apertura + cierres), o `null` si no hay con qué comparar. `start`: primer
   * valor que se dibuja; los ceros del principio son días en que el espacio aún no tenía datos y no se trazan (si
   * no, la línea bajaría a cero y aplastaría la escala). Un saldo real de cero a mitad del periodo sí se traza.
   */
  prev: { values: Minor[]; ranges: BucketRange[]; label: string; start: number } | null;
  /**
   * Tramo punteado de lo programado: desde la posición `start` (= `lastIndex`, hoy) sigue con el saldo al final de
   * cada cubo contando los movimientos con fecha posterior a hoy, hasta el último cubo que los tiene (o el
   * siguiente, si solo los tiene el cubo en curso). `null` si no hay programados en el periodo.
   */
  projection: { start: number; values: Minor[] } | null;
  /** Hoy, si cae dentro del periodo. */
  today: IsoDate | null;
  /** ¿Ningún cubo tiene entradas ni salidas? */
  quiet: boolean;
}

export interface PeriodChartInput {
  today: IsoDate;
  period: { from: IsoDate | null; to: IsoDate | null };
  previousPeriod: { from: IsoDate | null; to: IsoDate | null; label: string } | null;
  daily: readonly DayPoint[];
  dailyOpeningMinor: Minor;
  previousDaily: { openingMinor: Minor; balances: ReadonlyArray<{ date: IsoDate; balanceMinor: Minor }> } | null;
}

/** Cubos, línea de saldo y comparación de un resultado de `queries.dashboard`. */
export function periodChart(d: PeriodChartInput): PeriodChart {
  const from = d.period.from ?? d.daily[0]?.date ?? d.today;
  const lastDay = d.daily.at(-1)?.date ?? d.today;
  const to = d.period.to ?? (lastDay > d.today ? lastDay : d.today);
  const grain = grainFor(from, to);
  const buckets = buildBuckets(bucketRanges(from, to, grain), d.daily, d.today, d.dailyOpeningMinor);
  const line = balanceLine(d.dailyOpeningMinor, buckets);
  let lastIndex = 0;
  line.forEach((v, i) => {
    if (v !== null) lastIndex = i;
  });
  const pp = d.previousPeriod;
  const prevLine =
    pp === null || pp.from === null || pp.to === null ? null : previousLine(d.previousDaily, { from: pp.from, to: pp.to }, grain, buckets.length);
  return {
    grain,
    from,
    to,
    buckets,
    line,
    lastIndex,
    prev: prevPart(prevLine, pp?.label, line.length),
    projection: projectionPart(buckets, line, lastIndex),
    today: d.today >= from && d.today <= to ? d.today : null,
    quiet: buckets.every((b) => b.inMinor === 0 && b.outMinor === 0),
  };
}

/** Fracción mínima de las posiciones que debe cubrir la comparación para dibujarse. */
const PREV_MIN_COVERAGE = 1 / 3;

function prevPart(line: { values: Minor[]; ranges: BucketRange[] } | null, label: string | undefined, slots: number): PeriodChart['prev'] {
  if (line === null || label === undefined) return null;
  const start = line.values.findIndex((v) => v !== 0);
  // Sin un solo dato (o con uno solo al final) no hay línea que comparar; con un tramo corto (el espacio empezó
  // casi al final del periodo anterior) tampoco: la leyenda prometería una comparación de todo el periodo.
  if (start < 0 || start >= line.values.length - 1) return null;
  if (line.values.length - start < slots * PREV_MIN_COVERAGE) return null;
  return { ...line, label, start };
}

function projectionPart(buckets: readonly Bucket[], line: ReadonlyArray<Minor | null>, lastIndex: number): PeriodChart['projection'] {
  let lastPending = -1;
  buckets.forEach((b, i) => {
    if (b.pending) lastPending = i;
  });
  // El cubo en curso es el `lastIndex − 1`: sin sitio a la derecha (es el último) no hay tramo que dibujar.
  if (lastPending < 0 || lastIndex >= buckets.length) return null;
  const end = Math.max(lastPending + 1, lastIndex + 1);
  return { start: lastIndex, values: [line[lastIndex] ?? 0, ...buckets.slice(lastIndex, end).map((b) => b.endMinor)] };
}
