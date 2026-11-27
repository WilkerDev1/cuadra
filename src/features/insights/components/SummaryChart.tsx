// Gráfica del Resumen: columnas (barras, líneas, Escalera) o barras ordenadas. Cada grupo es un enlace a sus
// movimientos. Columnas: un solo punto de tabulación (tabindex itinerante), flechas para recorrer, Intro abre.
// En táctil, el primer toque fija el grupo (lectura arriba con «Ver movimientos») y el segundo lo abre.
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { Currency } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, cx } from '../../../ui';
import { at, axisLabel, cumulative, domainOf, labelStep, niceCeil, shortPeriodLabel, span, type Domain, type Point } from '../model/series';
import type { ChartKind, Measure, TimeUnit } from '../model/state';

export interface SummaryChartProps {
  points: readonly Point[];
  chart: ChartKind;
  measure: Measure;
  /** Unidad de tiempo si se agrupa por periodo; null en dimensiones. */
  unit: TimeUnit | null;
  compare: boolean;
  currency: Currency;
  title: string;
  hrefFor: (p: Point) => string;
  /** Texto plano del valor (para nombres accesibles). */
  textOf: (v: number) => string;
  /** Texto compacto para el eje («RD$2 M»). */
  axisText: (v: number) => string;
}

type Tone = 'in' | 'out' | 'neutral';

function toneOf(measure: Measure, v: number): Tone {
  if (measure === 'in') return 'in';
  if (measure === 'out') return 'out';
  if (measure === 'net') return v < 0 ? 'out' : 'in';
  return 'neutral';
}

export function ValueText({ value, measure, currency, size = 'm' }: { value: number; measure: Measure; currency: Currency; size?: 'm' | 'row' | 'table' }) {
  const t = useT();
  if (measure === 'count') return <span className="num ins-count">{t('insights.count.value', { n: value })}</span>;
  return <AmountText minor={value} size={size} currency={currency} neutral={measure !== 'net' || value >= 0} />;
}

export function SummaryChart(props: SummaryChartProps) {
  return props.chart === 'ranked' ? <RankedBars {...props} /> : <ColumnPlot {...props} />;
}

// ── Lectura (arriba de la gráfica) ───────────────────────────────────────────────────

function Readout({ point, children, href }: { point: Point | null; children?: ReactNode; href?: string }) {
  const t = useT();
  return (
    <div className="ins-readout" aria-live="polite">
      {point === null ? null : (
        <>
          <span className="ins-readout__label">{point.label}</span>
          {children}
          {href === undefined ? null : (
            <Link className="ins-readout__open" to={href}>
              {t('insights.chart.open')}
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

// ── Columnas ─────────────────────────────────────────────────────────────────────────

function ColumnPlot({ points, chart, measure, unit, compare, currency, title, hrefFor, textOf, axisText }: SummaryChartProps) {
  const t = useT();
  const n = points.length;
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const armed = useRef<number | null>(null);
  const pointer = useRef<string>('mouse');
  const sel = hover ?? focus ?? pinned;
  const ladder = chart === 'ladder';
  const line = chart === 'line';

  const geo = useMemo(() => {
    if (ladder) {
      const m = niceCeil(Math.max(1, ...points.map((p) => Math.max(p.group.inMinor, p.group.outMinor))));
      const cum = cumulative(points.map((p) => p.group.netMinor));
      return { d: { lo: -m, hi: m } as Domain, cum, dc: domainOf(cum) };
    }
    const vals = points.map((p) => p.value);
    const prev = compare ? points.map((p) => p.prev ?? 0) : [];
    return { d: domainOf([...vals, ...prev]), cum: [] as number[], dc: null };
  }, [points, ladder, compare]);
  const { d, cum, dc } = geo;

  const step1 = labelStep(n, 12);
  const step2 = labelStep(n, 6);
  const xLabel = (p: Point, i: number) => (unit === null ? p.label : shortPeriodLabel(p.key, unit, i === 0));
  const y = (v: number, dom: Domain) => at(dom, v, true);
  const path = (vals: readonly number[], dom: Domain) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i + 0.5} ${y(v, dom).toFixed(2)}`).join('');

  const move = (to: number) => {
    const i = Math.max(0, Math.min(n - 1, to));
    refs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const cur = focus ?? 0;
    const map: Record<string, number> = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: n - 1 };
    const next = map[e.key];
    if (next === undefined) return;
    e.preventDefault();
    move(next);
  };

  const sp = sel === null ? null : (points[sel] ?? null);
  const tabStop = focus ?? pinned ?? n - 1;
  const fmtAxis = (v: number) => axisLabel(v, (abs) => (measure === 'count' ? new Intl.NumberFormat(getLocale()).format(abs) : axisText(abs)));

  return (
    <figure className="ins-chart">
      <figcaption className="visually-hidden">
        {title}. {t('insights.chart.keys')}
      </figcaption>
      <Readout point={sp} {...(sp === null ? {} : { href: hrefFor(sp) })}>
        {sp === null ? null : ladder ? (
          <>
            <AmountText minor={sp.group.inMinor} kind="income" size="m" currency={currency} />
            <AmountText minor={sp.group.outMinor} kind="expense" size="m" currency={currency} />
            <span className="ins-readout__aside">
              {t('insights.chart.cumulative')} <AmountText minor={cum[sel ?? 0] ?? 0} size="m" currency={currency} />
            </span>
          </>
        ) : (
          <>
            <ValueText value={sp.value} measure={measure} currency={currency} />
            {sp.prev === null ? null : (
              <span className="ins-readout__aside">
                {t('insights.chart.previous')} <ValueText value={sp.prev} measure={measure} currency={currency} />
              </span>
            )}
          </>
        )}
      </Readout>
      <div className={cx('ins-plot', ladder && dc !== null && 'ins-plot--dual')}>
        <div className="ins-plot__y" aria-hidden="true">
          <span>{fmtAxis(d.hi)}</span>
          {d.lo < 0 ? <span>{fmtAxis(d.lo)}</span> : <span>{fmtAxis(0)}</span>}
        </div>
        <div className="ins-plot__area">
          <svg className="ins-plot__svg" viewBox={`0 0 ${Math.max(1, n)} 100`} preserveAspectRatio="none" aria-hidden="true">
            <line x1={0} x2={n} y1={y(0, d)} y2={y(0, d)} className="ins-plot__zero" />
            <line x1={0} x2={n} y1={0} y2={0} className="ins-plot__grid" />
            {line && compare ? <path d={path(points.map((p) => p.prev ?? 0), d)} className="ins-plot__prevline" /> : null}
            {line ? <path d={path(points.map((p) => p.value), d)} className="ins-plot__line" /> : null}
            {ladder && dc !== null ? (
              <path
                d={`${cum.map((v, i) => (i === 0 ? `M0 ${y(v, dc).toFixed(2)}` : `H${i}V${y(v, dc).toFixed(2)}`)).join('')}H${n}`}
                className="ins-plot__step"
              />
            ) : null}
          </svg>
          <ol
            className={cx('ins-cols', sel !== null && 'has-sel')}
            style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}
            onKeyDown={onKey}
            onMouseLeave={() => setHover(null)}
          >
            {points.map((p, i) => {
              const tone = toneOf(measure, p.value);
              const bar = span(d, 0, p.value, true);
              const label = ladder
                ? t('insights.chart.pointLadder', { label: p.label, in: textOf(p.group.inMinor), out: textOf(p.group.outMinor) })
                : p.prev === null
                ? t('insights.chart.point', { label: p.label, value: textOf(p.value) })
                : t('insights.chart.pointPrev', { label: p.label, value: textOf(p.value), prev: textOf(p.prev) });
              return (
                <li key={p.id} className="ins-cols__item">
                  <Link
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    to={hrefFor(p)}
                    tabIndex={i === tabStop ? 0 : -1}
                    aria-label={label}
                    className={cx('ins-col', sel === i && 'is-sel')}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setFocus(i)}
                    onBlur={() => setFocus(null)}
                    onPointerDown={(e) => {
                      pointer.current = e.pointerType;
                    }}
                    onClick={(e) => {
                      if (pointer.current !== 'touch') return;
                      if (armed.current !== i) {
                        e.preventDefault();
                        armed.current = i;
                        setPinned(i);
                      }
                    }}
                  >
                    {ladder ? (
                      <>
                        {p.group.inMinor > 0 ? (
                          <span className="ins-bar ins-bar--in" style={{ insetBlockStart: `${span(d, 0, p.group.inMinor, true).start}%`, blockSize: `${span(d, 0, p.group.inMinor, true).size}%` }} />
                        ) : null}
                        {p.group.outMinor > 0 ? (
                          <span className="ins-bar ins-bar--out" style={{ insetBlockStart: `${span(d, -p.group.outMinor, 0, true).start}%`, blockSize: `${span(d, -p.group.outMinor, 0, true).size}%` }} />
                        ) : null}
                      </>
                    ) : line ? (
                      <span className={cx('ins-dot', n > 40 && 'ins-dot--quiet')} style={{ insetBlockStart: `${y(p.value, d)}%` }} />
                    ) : p.value !== 0 ? (
                      <span className={cx('ins-bar', `ins-bar--${tone}`)} style={{ insetBlockStart: `${bar.start}%`, blockSize: `${bar.size}%` }} />
                    ) : null}
                    {compare && !ladder && !line && p.prev !== null ? <span className="ins-prev" style={{ insetBlockStart: `${y(p.prev, d)}%` }} /> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
        {ladder && dc !== null ? (
          <div className="ins-plot__y ins-plot__y2" aria-hidden="true">
            <span>{axisLabel(dc.hi, axisText)}</span>
            <span>{axisLabel(dc.lo, axisText)}</span>
          </div>
        ) : null}
        <ol className="ins-plot__x" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <li key={p.id} className={cx(i % step1 === 0 && 'is-l1', i % step2 === 0 && 'is-l2')}>
              <span>{xLabel(p, i)}</span>
            </li>
          ))}
        </ol>
      </div>
      {compare && !ladder ? (
        <p className="ins-legend" aria-hidden="true">
          <span className={cx('ins-legend__mark', line ? 'ins-legend__mark--line' : 'ins-legend__mark--tick')} />
          {t('insights.chart.previous')}
        </p>
      ) : ladder ? (
        <p className="ins-legend" aria-hidden="true">
          <span className="ins-legend__mark ins-legend__mark--step" />
          {t('insights.chart.cumulativeAxis')}
        </p>
      ) : null}
    </figure>
  );
}

// ── Barras ordenadas ─────────────────────────────────────────────────────────────────

function RankedBars({ points, measure, compare, currency, title, hrefFor, textOf }: SummaryChartProps) {
  const t = useT();
  const shown = useMemo(
    () => [...points].filter((p) => p.value !== 0 || (p.prev ?? 0) !== 0).sort((a, b) => b.value - a.value),
    [points],
  );
  const hidden = points.length - shown.length;
  const d = domainOf([...shown.map((p) => p.value), ...(compare ? shown.map((p) => p.prev ?? 0) : [])]);
  const allPositive = shown.every((p) => p.value >= 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const pct = (v: number) =>
    new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(total === 0 ? 0 : v / total);
  return (
    <figure className="ins-chart">
      <figcaption className="visually-hidden">{title}</figcaption>
      <ol className="ins-rank">
        {shown.map((p) => {
          const bar = span(d, 0, p.value, false);
          const label = p.prev === null
            ? t('insights.chart.point', { label: p.label, value: textOf(p.value) })
            : t('insights.chart.pointPrev', { label: p.label, value: textOf(p.value), prev: textOf(p.prev) });
          return (
            <li key={p.id}>
              <Link to={hrefFor(p)} className="ins-rank__row" aria-label={label}>
                <span className={cx('ins-rank__label', p.group.inactive && 'is-inactive')}>{p.label}</span>
                <span className="ins-rank__track" aria-hidden="true">
                  {d.lo < 0 ? <span className="ins-rank__zero" style={{ insetInlineStart: `${at(d, 0, false)}%` }} /> : null}
                  {p.value !== 0 ? (
                    <span className={cx('ins-hbar', `ins-bar--${toneOf(measure, p.value)}`)} style={{ insetInlineStart: `${bar.start}%`, inlineSize: `${bar.size}%` }} />
                  ) : null}
                  {compare && p.prev !== null ? <span className="ins-hprev" style={{ insetInlineStart: `${at(d, p.prev, false)}%` }} /> : null}
                </span>
                <span className="ins-rank__value" aria-hidden="true">
                  <ValueText value={p.value} measure={measure} currency={currency} size="row" />
                  {allPositive && measure !== 'net' ? <span className="ins-rank__share num">{pct(p.value)}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {compare ? (
        <p className="ins-legend" aria-hidden="true">
          <span className="ins-legend__mark ins-legend__mark--vtick" />
          {t('insights.chart.previous')}
        </p>
      ) : null}
      {hidden > 0 ? <p className="ins-chart__note">{t('insights.chart.hidden', { n: hidden })}</p> : null}
    </figure>
  );
}
