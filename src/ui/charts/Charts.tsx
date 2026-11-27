import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import type { Currency, IsoDate, Minor } from '../../core/types';
import { useT } from '../../i18n';
import { formatDate, getLocale } from '../../i18n/format';
import { cx } from '../lib';
import { AmountText, DEFAULT_CURRENCY } from '../domain/AmountText';
import { amountParts } from '../domain/amountLogic';
import { ladderSeries, linePath, niceCeil, sparkPoints, stepPath, type DayFlow } from './chartMath';

/** Ancho real del contenedor para dibujar en píxeles (trazos nítidos, sin deformar). */
function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
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

/** Trama diagonal a 45° (1.5px cada 4px) para las salidas. */
function OutPattern({ id }: { id: string }) {
  return (
    <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="4" className="ui-chart__out-bg" />
      <rect width="1.5" height="4" className="ui-chart__out-hatch" />
    </pattern>
  );
}

interface TableFallbackProps {
  caption: string;
  head: readonly string[];
  rows: ReadonlyArray<{ key: string; cells: readonly ReactNode[] }>;
}

/** «Ver como tabla»: alternativa obligatoria de toda gráfica. */
function TableFallback({ caption, head, rows }: TableFallbackProps) {
  const t = useT();
  return (
    <details className="ui-chart__table">
      <summary>{t('ui.table.asTable')}</summary>
      <table className="ui-table ui-table--summary ui-table--dense">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i > 0 ? 'is-end' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={i} className={i > 0 ? 'is-end num' : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ── Barras horizontales ─────────────────────────────────────────────────────────────────

export interface BarDatum {
  id: string;
  label: string;
  minor: Minor;
  /** `out` lleva trama diagonal; `in` relleno sólido. */
  kind: 'in' | 'out';
}

export interface BarsProps {
  /** Título accesible: «Salidas por categoría». */
  title: string;
  data: readonly BarDatum[];
  currency?: Currency;
  /** Ordenar de mayor a menor (por defecto sí). */
  sort?: boolean;
  /** Mostrar el % del total a la derecha. */
  showShare?: boolean;
}

/** Barras horizontales por categoría o dimensión: etiqueta a la izquierda, monto y % a la derecha. */
export function Bars({ title, data, currency = DEFAULT_CURRENCY, sort = true, showShare = true }: BarsProps) {
  const t = useT();
  const pid = `p${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const rows = sort ? [...data].sort((a, b) => b.minor - a.minor) : data;
  const max = Math.max(1, ...rows.map((d) => d.minor));
  const total = rows.reduce((s, d) => s + d.minor, 0) || 1;
  const pct = (m: Minor) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(m / total);
  return (
    <figure className="ui-chart ui-bars">
      <figcaption className="visually-hidden">{title}</figcaption>
      <svg width="0" height="0" aria-hidden="true" className="ui-chart__defs">
        <defs>
          <OutPattern id={pid} />
        </defs>
      </svg>
      <ul role="list" className="ui-bars__list" aria-hidden="true">
        {rows.map((d) => {
          const w = (d.minor / max) * 100;
          return (
            <li key={d.id} className="ui-bars__row">
              <span className="ui-bars__label truncate">{d.label}</span>
              <svg className="ui-bars__track" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path
                  d={`M0 0H${Math.max(0, w - 1)}Q${w} 0 ${w} 1V9Q${w} 10 ${Math.max(0, w - 1)} 10H0Z`}
                  className={cx('ui-bars__bar', `ui-bars__bar--${d.kind}`)}
                  fill={d.kind === 'out' ? `url(#${pid})` : undefined}
                />
              </svg>
              <span className="ui-bars__value">
                <AmountText minor={d.minor} size="row" currency={currency} neutral />
                {showShare ? <span className="ui-bars__share num">{pct(d.minor)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <TableFallback
        caption={title}
        head={[t('ui.chart.label'), t('ui.chart.amount'), ...(showShare ? [t('ui.chart.share')] : [])]}
        rows={rows.map((d) => ({
          key: d.id,
          cells: [d.label, <AmountText key="a" minor={d.minor} size="table" currency={currency} neutral />, ...(showShare ? [pct(d.minor)] : [])],
        }))}
      />
    </figure>
  );
}

// ── Escalera (§11.4) ────────────────────────────────────────────────────────────────────

export interface LadderProps {
  /** Título accesible: «Flujo de noviembre». */
  title: string;
  /** Un registro por día, en orden. */
  days: readonly DayFlow[];
  /** Saldo antes del primer día. */
  openingMinor: Minor;
  currency?: Currency;
  /** Alto en px del área de dibujo (160 en Inicio). */
  height?: number;
  /** Etiqueta corta del día («Mar 24»); por defecto la fecha corta. */
  formatDay?: (iso: IsoDate) => string;
}

/** Barras diarias espejadas (entradas arriba, salidas abajo con trama) y saldo escalonado; táctil y con teclado. */
export function Ladder({ title, days, openingMinor, currency = DEFAULT_CURRENCY, height = 160, formatDay }: LadderProps) {
  const t = useT();
  const pid = `p${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [wrapRef, width] = useWidth<HTMLDivElement>(600);
  const series = useMemo(() => ladderSeries(days, openingMinor), [days, openingMinor]);
  const [sel, setSel] = useState<number | null>(null);
  const fmtDay = formatDay ?? ((iso: IsoDate) => formatDate(iso).replace(/ \d{4}$/, ''));
  const n = Math.max(1, series.length);
  const padTop = 8;
  const mid = height / 2;
  const half = mid - padTop;
  const flowMax = niceCeil(Math.max(1, ...series.map((d) => Math.max(d.inMinor, d.outMinor))));
  const balances = [openingMinor, ...series.map((d) => d.balance)];
  const bMin = Math.min(...balances);
  const bMax = Math.max(...balances);
  const bSpan = bMax - bMin || 1;
  const slot = width / n;
  const barW = Math.max(2, Math.min(18, slot * 0.6));
  const yBal = (v: Minor) => padTop + (1 - (v - bMin) / bSpan) * (height - padTop * 2);
  const stepPts = series.map((d, i) => ({ x: i * slot, y: yBal(d.balance) }));
  const money = (m: Minor, kind?: 'income' | 'expense') => amountParts(m, { locale: getLocale(), currency, kind }).text;

  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    setSel(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    setSel((s) => {
      const cur = s ?? (d > 0 ? -1 : series.length);
      return Math.max(0, Math.min(series.length - 1, Number.isFinite(d) ? cur + d : d > 0 ? series.length - 1 : 0));
    });
  };
  const day = sel === null ? undefined : series[sel];
  const readout =
    day === undefined
      ? ''
      : t('ui.chart.selected', {
          day: fmtDay(day.date),
          in: money(day.inMinor, 'income'),
          out: money(day.outMinor, 'expense'),
          balance: money(day.balance),
        });

  return (
    <figure className="ui-chart ui-ladder">
      <figcaption className="visually-hidden">{title}</figcaption>
      <div className="ui-ladder__readout" aria-hidden="true">
        {day === undefined ? (
          <span className="ui-ladder__hint">{' '}</span>
        ) : (
          <>
            <span className="ui-ladder__day">{fmtDay(day.date)}</span>
            <AmountText minor={day.inMinor} kind="income" size="m" currency={currency} />
            <AmountText minor={day.outMinor} kind="expense" size="m" currency={currency} />
            <span className="ui-ladder__bal">
              <span>{t('ui.chart.balance')}</span> <AmountText minor={day.balance} size="m" currency={currency} />
            </span>
          </>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {readout}
      </p>
      <div ref={wrapRef} className="ui-ladder__plot">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          tabIndex={0}
          role="img"
          aria-label={`${title}. ${t('ui.chart.ladderLabel')}`}
          className="ui-ladder__svg"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pickAt(e);
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse' || e.buttons > 0) pickAt(e);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setSel(null);
          }}
          onKeyDown={onKey}
          onBlur={() => setSel(null)}
        >
          <defs>
            <OutPattern id={pid} />
          </defs>
          {sel === null ? null : <line x1={sel * slot + slot / 2} x2={sel * slot + slot / 2} y1={0} y2={height} className="ui-ladder__cursor" />}
          {series.map((d, i) => {
            const x = i * slot + (slot - barW) / 2;
            const hIn = (d.inMinor / flowMax) * half;
            const hOut = (d.outMinor / flowMax) * half;
            const active = sel === i;
            return (
              <g key={d.date} className={cx('ui-ladder__day-g', active && 'is-active', sel !== null && !active && 'is-dim')}>
                {hIn > 0 ? <rect x={x} y={mid - hIn} width={barW} height={hIn} rx={1} className="ui-ladder__in" /> : null}
                {hOut > 0 ? <rect x={x} y={mid} width={barW} height={hOut} rx={1} className="ui-ladder__out" fill={active ? undefined : `url(#${pid})`} /> : null}
              </g>
            );
          })}
          <line x1={0} x2={width} y1={mid} y2={mid} className="ui-ladder__axis" />
          <path d={stepPath(stepPts, width)} className="ui-ladder__balance" />
        </svg>
      </div>
      <TableFallback
        caption={title}
        head={[t('ui.chart.day'), t('ui.chart.in'), t('ui.chart.out'), t('ui.chart.balance')]}
        rows={series.map((d) => ({
          key: d.date,
          cells: [
            fmtDay(d.date),
            <AmountText key="i" minor={d.inMinor} size="table" notation="columns" kind="income" currency={currency} />,
            <AmountText key="o" minor={d.outMinor} size="table" notation="columns" kind="expense" currency={currency} />,
            <AmountText key="b" minor={d.balance} size="table" notation="parens" currency={currency} />,
          ],
        }))}
      />
    </figure>
  );
}

// ── Línea ───────────────────────────────────────────────────────────────────────────────

export interface LinePoint {
  /** Etiqueta del eje: «nov». */
  label: string;
  minor: Minor;
}

export interface LineProps {
  title: string;
  points: readonly LinePoint[];
  currency?: Currency;
  height?: number;
  /** Escalonada (saldos) o recta (tendencias). */
  step?: boolean;
}

/** Serie temporal con tres guías como máximo y el último valor rotulado. */
export function Line({ title, points, currency = DEFAULT_CURRENCY, height = 140, step = false }: LineProps) {
  const t = useT();
  const [wrapRef, width] = useWidth<HTMLDivElement>(480);
  const padY = 10;
  const values = points.map((p) => p.minor);
  const max = niceCeil(Math.max(1, ...values));
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const pts = points.map((p, i) => ({ x: i * stepX, y: padY + (1 - (p.minor - min) / span) * (height - padY * 2) }));
  const last = pts.at(-1);
  const guides = [0, 0.5, 1].map((f) => padY + f * (height - padY * 2));
  return (
    <figure className="ui-chart ui-line">
      <figcaption className="visually-hidden">{title}</figcaption>
      <div ref={wrapRef} className="ui-line__plot" aria-hidden="true">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {guides.map((y) => (
            <line key={y} x1={0} x2={width} y1={y} y2={y} className="ui-line__grid" />
          ))}
          <path d={step ? stepPath(pts, width) : linePath(pts)} className="ui-line__path" />
          {last === undefined ? null : <circle cx={Math.min(width - 3, last.x)} cy={last.y} r={3} className="ui-line__dot" />}
        </svg>
        <div className="ui-line__axis">
          {points.map((p, i) => (
            <span key={`${p.label}${i}`}>{p.label}</span>
          ))}
        </div>
      </div>
      <TableFallback
        caption={title}
        head={[t('ui.chart.label'), t('ui.chart.value')]}
        rows={points.map((p, i) => ({ key: `${p.label}${i}`, cells: [p.label, <AmountText key="a" minor={p.minor} size="table" notation="parens" currency={currency} />] }))}
      />
    </figure>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────────────────

export interface SparklineProps {
  /** Saldos diarios (30 días). */
  values: readonly Minor[];
  /** Resumen accesible: «Saldo de los últimos 30 días, sube». */
  label: string;
  width?: number;
  height?: number;
  /** Sobre el bosque. */
  onForest?: boolean;
}

/** Línea mínima de 64×20 con el último punto marcado. */
export function Sparkline({ values, label, width = 64, height = 20, onForest = false }: SparklineProps) {
  const pts = sparkPoints(values, width - 3, height, 3);
  const last = pts.at(-1);
  return (
    <svg className={cx('ui-spark', onForest && 'ui-spark--forest')} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={linePath(pts)} className="ui-spark__path" />
      {last === undefined ? null : <circle cx={last.x} cy={last.y} r={2} className="ui-spark__dot" />}
    </svg>
  );
}
