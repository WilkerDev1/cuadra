// Geometría y aritmética de las gráficas del panel. Los montos entran en unidad menor (enteros); lo que sale son
// coordenadas de pantalla y proporciones para mostrar, nunca dinero.
import type { IsoDate, Minor } from '../../../core';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tope «bonito» ≥ v: 1, 2, 2.5 o 5 por potencia de 10. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v) return m * base;
  return 10 * base;
}

/** Cambio relativo de `prev` a `cur` (0.12 = +12 %); `null` si no hay base con la que comparar. */
export function changeRatio(cur: Minor, prev: Minor): number | null {
  if (prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export interface FlowMonth {
  key: string;
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  /** Fracción del cubo que cubre el periodo (semana parcial: 4/7); la barra se estrecha en proporción. */
  weight?: number;
}

/** Paso «bonito» (1, 2, 2.5 o 5 por potencia de 10) para que `span` quepa en `maxSteps` divisiones como mucho. */
export function niceStep(span: number, maxSteps = 4): number {
  if (span <= 0 || maxSteps <= 0) return 1;
  // Los valores son unidad menor: un paso fraccionario (0.2, 2.5) no es un monto y Money no lo formatea.
  const step = niceCeil(span / maxSteps);
  if (Number.isInteger(step)) return step;
  return step < 1 ? 1 : 5; // solo queda 2.5 (base 1): el siguiente paso bonito entero
}

/** Divisiones de un eje: de `lo` a `hi` cada `step` (enteros, en la unidad de los valores). */
export interface Tick {
  value: number;
  y: number;
}

export interface FlowGeometry {
  slot: number;
  barW: number;
  /** y del eje (cero): queda donde reparte la altura entre lo que entra y lo que sale. */
  mid: number;
  /** Tope de entradas y fondo de salidas (unidad menor, positivos); misma escala arriba y abajo. */
  top: number;
  bottom: number;
  ticks: Tick[];
  bars: Array<{ key: string; x: number; w: number; cx: number; yIn: number; hIn: number; yOut: number; hOut: number; yNet: number }>;
}

/**
 * Barras espejadas por cubo (día, semana o mes): entradas hacia arriba y salidas hacia abajo desde el eje, con el neto como punto
 * sobre la misma escala. El eje no va al centro: arriba cabe la mayor entrada y abajo la mayor salida, redondeadas
 * a un paso bonito, así las barras usan toda la altura sin dejar de ser comparables. `pad` reserva los bordes.
 */
export function flowGeometry(months: readonly FlowMonth[], width: number, height: number, pad = 6, maxSteps = 5, barRatio = 0.46): FlowGeometry {
  const n = Math.max(1, months.length);
  const slot = width / n;
  const barW = Math.max(Math.min(4, slot * 0.8), Math.min(40, slot * barRatio));
  const maxIn = Math.max(0, ...months.map((m) => m.inMinor));
  const maxOut = Math.max(0, ...months.map((m) => m.outMinor));
  const step = niceStep(Math.max(1, maxIn + maxOut), maxSteps);
  const top = Math.max(step, Math.ceil(maxIn / step) * step);
  const bottom = Math.max(step, Math.ceil(maxOut / step) * step);
  const scale = (height - pad * 2) / (top + bottom);
  const mid = r2(pad + top * scale);
  const y = (v: number) => v * scale;
  const ticks: Tick[] = [];
  if (maxIn === 0 && maxOut === 0) ticks.push({ value: 0, y: mid });
  else for (let v = -bottom; v <= top; v += step) ticks.push({ value: v, y: r2(mid - y(v)) });
  return {
    slot,
    barW,
    mid,
    top,
    bottom,
    ticks,
    bars: months.map((m, i) => {
      const w = Math.max(Math.min(barW, 3), barW * Math.min(1, Math.max(0, m.weight ?? 1)));
      const x = i * slot + (slot - w) / 2;
      const hIn = y(m.inMinor);
      const hOut = y(m.outMinor);
      const net = Math.max(-bottom, Math.min(top, m.netMinor));
      return { key: m.key, x: r2(x), w: r2(w), cx: r2(i * slot + slot / 2), yIn: r2(mid - hIn), hIn: r2(hIn), yOut: mid, hOut: r2(hOut), yNet: r2(mid - y(net)) };
    }),
  };
}

/** Dominio redondeado de una serie de saldos y sus divisiones (como mucho `maxSteps`). */
export function niceDomain(values: readonly number[], maxSteps = 4): { lo: number; hi: number; step: number; values: number[] } {
  if (values.length === 0) return { lo: 0, hi: 1, step: 1, values: [0, 1] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = niceStep(Math.max(1, max - min), maxSteps);
  // Serie plana: una sola división en su valor y la línea al medio.
  if (min === max) return { lo: min - step, hi: max + step, step, values: [min] };
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (lo === hi) {
    lo -= step;
    hi += step;
  }
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return { lo, hi, step, values: out };
}

/** Último día que cubre un punto de la serie de saldo: la clave es el inicio de la semana, el día o el mes. */
export function seriesPointEnd(key: string, unit: 'day' | 'week' | 'month'): IsoDate {
  if (unit === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number);
    const last = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
    return `${key}-${String(last).padStart(2, '0')}`;
  }
  if (unit === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }
  return key;
}

/** Lado en que se abre la ficha de una gráfica: a la derecha del cursor en la mitad izquierda y al revés. */
export function tipSide(x: number, width: number): 'right' | 'left' {
  return x <= width / 2 ? 'right' : 'left';
}

export interface AreaGeometry {
  line: string;
  area: string;
  points: Array<{ x: number; y: number }>;
  min: number;
  max: number;
  /** y del cero si cae dentro del dibujo; si no `null`. */
  zeroY: number | null;
  /** y de un valor cualquiera en la misma escala (divisiones del eje). */
  yOf: (v: number) => number;
  /** x de la posición `i` (de `slots`). */
  xOf: (i: number) => number;
}

/**
 * Posiciones de la línea de saldo por cubos: la 0 (apertura) en el borde izquierdo y la `p` (cierre del cubo
 * `p − 1`) al centro de su cubo, justo bajo su rótulo del eje. `n` es el número de cubos.
 */
export function centeredX(n: number, width: number): (p: number) => number {
  const slot = width / Math.max(1, n);
  return (p) => (p <= 0 ? 0 : r2((p - 0.5) * slot));
}

/** Posición más cercana a `x` entre las `count` primeras de `xOf` (no tienen por qué estar repartidas por igual). */
export function nearestOf(x: number, count: number, xOf: (p: number) => number): number {
  let best = 0;
  for (let p = 1; p < count; p++) if (Math.abs(xOf(p) - x) < Math.abs(xOf(best) - x)) best = p;
  return best;
}

/**
 * Línea y área de una serie de saldos en una caja w×h, con margen vertical. `slots` (≥ valores) reparte el ancho
 * entre más posiciones que valores: la línea se detiene donde acaban los datos y el resto queda vacío. `xAt`
 * sustituye el reparto uniforme (p. ej. `centeredX`). El área se cierra en el cero si cae dentro del dibujo
 * (si no, en el borde más cercano), así un saldo negativo o plano en cero no se pinta como saldo positivo.
 */
export function areaGeometry(
  values: readonly Minor[],
  width: number,
  height: number,
  padTop = 8,
  padBottom = 4,
  domain?: { lo: number; hi: number },
  slots = values.length,
  xAt?: (i: number) => number,
): AreaGeometry {
  const n = Math.max(slots, values.length);
  const step = n > 1 ? width / (n - 1) : 0;
  const xOf = xAt ?? ((i: number) => r2(i * step));
  if (values.length === 0) return { line: '', area: '', points: [], min: 0, max: 0, zeroY: null, yOf: () => height, xOf };
  let min = domain?.lo ?? Math.min(...values);
  let max = domain?.hi ?? Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const inner = height - padTop - padBottom;
  const yOf = (v: number) => r2(padTop + (1 - (v - min) / span) * inner);
  const points = values.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('');
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  const base = Math.min(height, Math.max(0, yOf(0)));
  const area = `${line}L${last.x} ${base}L${points[0]?.x ?? 0} ${base}Z`;
  const zeroY = min < 0 && max > 0 ? yOf(0) : null;
  return { line, area, points, min, max, zeroY, yOf, xOf };
}

/** Índice del punto más cercano a `x` en una serie de `n` puntos repartidos en `width`. */
export function nearestIndex(x: number, width: number, n: number): number {
  if (n <= 1) return 0;
  const step = width / (n - 1);
  return Math.max(0, Math.min(n - 1, Math.round(x / step)));
}

/** Índice de la ranura (barras) bajo `x`. */
export function slotIndex(x: number, width: number, n: number): number {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor((x / width) * n)));
}

/** Paso de teclado sobre un índice: ←/→, Inicio, Fin. `null` si la tecla no es de navegación. */
export function stepIndex(key: string, current: number | null, n: number): number | null {
  if (n === 0) return null;
  const cur = current ?? (key === 'ArrowLeft' ? n : -1);
  switch (key) {
    case 'ArrowRight':
      return Math.min(n - 1, cur + 1);
    case 'ArrowLeft':
      return Math.max(0, cur - 1);
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
    default:
      return null;
  }
}

/** Mes `YYYY-MM` de una clave de serie (`2026-11-03` día, `2026-W45` semana, `2026-11` mes) para rotular ejes. */
export function seriesKeyMonth(key: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(key)) return key;
  return null;
}

/** Posiciones de rótulos del eje: el primer índice de cada mes (máximo `maxTicks`, repartidos). */
export function monthTicks(months: ReadonlyArray<string | null>, maxTicks = 6): number[] {
  const firsts: number[] = [];
  let prev: string | null = null;
  months.forEach((m, i) => {
    if (m !== null && m !== prev) firsts.push(i);
    if (m !== null) prev = m;
  });
  if (firsts.length <= maxTicks) return firsts;
  const every = Math.ceil(firsts.length / maxTicks);
  return firsts.filter((_, i) => i % every === 0);
}

/** Últimos `n` valores de una serie (sparkline de 30 días). */
export function tail<T>(values: readonly T[], n: number): T[] {
  return values.slice(Math.max(0, values.length - n));
}

/** Agrupa filas por fecha conservando el orden de llegada (ya vienen de más reciente a más antigua). */
export function groupByDay<T extends { date: IsoDate }>(rows: readonly T[]): Array<{ date: IsoDate; items: T[] }> {
  const out: Array<{ date: IsoDate; items: T[] }> = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last !== undefined && last.date === r.date) last.items.push(r);
    else out.push({ date: r.date, items: [r] });
  }
  return out;
}

/** Suma de entradas y salidas de un día (lista móvil). */
export function dayNet(items: ReadonlyArray<{ kind: string; amountMinor: Minor }>): Minor {
  return items.reduce((s, r) => (r.kind === 'income' ? s + r.amountMinor : r.kind === 'expense' ? s - r.amountMinor : s), 0);
}
