// Piezas comunes del inicio: ancho medido, porcentajes y comparaciones en texto llano.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useMoneyFormat } from '../../../app/data/hooks';
import { monthRange, type IsoDate, type Minor } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { cx } from '../../../ui';
import { bucketMonth, type BucketRange, type Grain } from '../logic/buckets';
import { changeRatio } from '../logic/chart';

/**
 * `true` cuando ya pasó la entrada de una gráfica: desde entonces sus series cambian sin animarse (DESIGN §14:
 * las barras crecen solo la primera vez que entran en pantalla, no al cambiar de periodo).
 */
export function useSettled(ms = 900): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return settled;
}

export interface AxisItem {
  key: string;
  /** Centro del rótulo en píxeles del lienzo. */
  x: number;
  text: string;
  className?: string | undefined;
}

/**
 * Rótulos del eje X centrados en su cubo, pero sin salirse del lienzo: el primero y el último se apoyan en el
 * borde si no caben centrados (CSS: `--room-l`/`--room-r` limitan el desplazamiento).
 */
export function AxisLabels({ className, width, items }: { className: string; width: number; items: readonly AxisItem[] }) {
  return (
    <div className={cx('home-axis', className)} aria-hidden="true">
      {items.map((it) => (
        <span
          key={it.key}
          className={it.className}
          style={{ insetInlineStart: `${it.x}px`, '--room-l': `${it.x}px`, '--room-r': `${Math.max(0, width - it.x)}px` } as CSSProperties}
        >
          {it.text}
        </span>
      ))}
    </div>
  );
}

/** Ancho real del contenedor, para dibujar el SVG en píxeles (trazos nítidos). */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setW(Math.max(120, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function formatPct(ratio: number): string {
  return new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: Math.abs(ratio) < 0.1 ? 1 : 0 }).format(Math.abs(ratio));
}

/** «12 % más que octubre 2026» / «Igual que…» / «Nada en…»; si el signo cambia, «En octubre: +RD$…». */
export function useCompare(): (cur: Minor, prev: Minor, prevLabel: string) => string {
  const t = useT();
  const fmt = useMoneyFormat();
  return (cur, prev, prevLabel) => {
    // Signo distinto, o los dos negativos («662 % menos» con una caída seis veces mayor se lee al revés): el monto.
    if (cur !== 0 && prev !== 0 && (cur < 0 !== prev < 0 || cur < 0)) return t('home.compare.flip', { period: prevLabel, amount: fmt(prev, { sign: 'always' }).replace('-', '\u2212') });
    const r = changeRatio(cur, prev);
    if (r === null) return cur === 0 ? t('home.compare.same', { period: prevLabel }) : t('home.compare.none', { period: prevLabel });
    if (Math.abs(r) < 0.005) return t('home.compare.same', { period: prevLabel });
    return t(r > 0 ? 'home.compare.more' : 'home.compare.less', { pct: formatPct(r), period: prevLabel });
  };
}

/** Mes corto para ejes: «nov», y «ene 26» al cambiar de año. */
export function shortMonth(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  const month = new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  return withYear ? `${month} ${String(y).slice(2)}` : month;
}

/** «noviembre 2026». */
export function longMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d).replace(' de ', ' ');
}

const dayFmt = (opts: Intl.DateTimeFormatOptions) => (iso: IsoDate) =>
  new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`))
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/ de /g, ' ');

/** «3 nov». */
export const shortDay = (iso: IsoDate): string => dayFmt({ day: 'numeric', month: 'short' })(iso);
/** «martes 3 nov». */
export const longDay = (iso: IsoDate): string => dayFmt({ weekday: 'long', day: 'numeric', month: 'short' })(iso);

/** Título de un cubo: «martes 3 nov», «3 – 9 nov» / «26 oct – 1 nov», «noviembre 2026». */
export function bucketTitle(b: BucketRange, grain: Grain): string {
  if (grain === 'day') return longDay(b.from);
  if (grain === 'month') return longMonth(b.key);
  if (b.from === b.to) return shortDay(b.from);
  const sameMonth = b.from.slice(0, 7) === b.to.slice(0, 7);
  return `${sameMonth ? String(Number(b.from.slice(8))) : shortDay(b.from)} – ${shortDay(b.to)}`;
}

/** Rótulo del eje para el cubo `i`: «1 nov» y luego el número del día; el mes en semanas y meses («ene 26» al cambiar de año). */
export function axisLabel(buckets: readonly BucketRange[], i: number, grain: Grain): string {
  const b = buckets[i];
  if (b === undefined) return '';
  if (grain === 'day') return i === 0 ? shortDay(b.from) : String(Number(b.from.slice(8)));
  if (grain === 'week') return shortMonth(bucketMonth(b));
  const multiYear = buckets[0]?.key.slice(0, 4) !== buckets.at(-1)?.key.slice(0, 4);
  return shortMonth(b.key, multiYear && (i === 0 || b.key.endsWith('-01')));
}

/** Nombre del periodo para los títulos de las gráficas: el del núcleo, salvo un rango de meses enteros («dic 2025 – nov 2026»). */
export function chartPeriodLabel(label: string, from: IsoDate, to: IsoDate): string {
  if (!label.includes(' – ') || !from.endsWith('-01') || monthRange(to.slice(0, 7)).to !== to) return label;
  return `${shortMonth(from.slice(0, 7))} ${from.slice(0, 4)} – ${shortMonth(to.slice(0, 7))} ${to.slice(0, 4)}`;
}
