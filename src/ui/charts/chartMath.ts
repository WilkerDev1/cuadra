// Geometría pura de las gráficas SVG hechas a mano. Los montos entran en unidad menor (enteros);
// las coordenadas son flotantes de pantalla, nunca dinero.
import type { IsoDate, Minor } from '../../core/types';

export interface Point {
  x: number;
  y: number;
}

/** Tope «bonito» ≥ v: 1, 2, 2.5 o 5 por potencia de 10. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v) return m * base;
  return 10 * base;
}

export interface DayFlow {
  date: IsoDate;
  inMinor: Minor;
  outMinor: Minor;
}
export interface LadderDay extends DayFlow {
  net: Minor;
  /** Saldo al cierre del día. */
  balance: Minor;
}

/** Serie de la Escalera: flujo diario y saldo acumulado al cierre. */
export function ladderSeries(days: readonly DayFlow[], openingMinor: Minor): LadderDay[] {
  let balance = openingMinor;
  return days.map((d) => {
    const net = d.inMinor - d.outMinor;
    balance += net;
    return { ...d, net, balance };
  });
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Línea escalonada step-after hasta `endX`. */
export function stepPath(points: readonly Point[], endX: number): string {
  if (points.length === 0) return '';
  let d = '';
  points.forEach((p, i) => {
    if (i === 0) d += `M${r(p.x)} ${r(p.y)}`;
    else d += `H${r(p.x)}V${r(p.y)}`;
  });
  return `${d}H${r(endX)}`;
}

export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join('');
}

/** Valores → puntos en una caja de w×h con margen vertical `pad`. */
export function sparkPoints(values: readonly number[], w: number, h: number, pad = 2): Point[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => ({ x: r(i * step), y: r(h - pad - ((v - min) / span) * (h - pad * 2)) }));
}
