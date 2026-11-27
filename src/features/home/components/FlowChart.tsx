// Entradas y salidas del periodo, por día (mes), semana (trimestre) o mes (año y 12 meses): barras espejadas
// (entradas arriba, salidas abajo con trama). En semanas y meses el neto va como punto unido por una línea fina; por
// día sería ruido y queda en la ficha. Los cubos que aún no llegan quedan vacíos, salvo los movimientos con fecha
// posterior a hoy, que se dibujan como barras programadas (contorno discontinuo): así las barras suman lo mismo que
// los totales del periodo. Las semanas recortadas al borde del trimestre llevan una barra más estrecha. Cursor y
// teclado fijan un cubo; clic o Intro abre sus movimientos.
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import type { Currency } from '../../../core';
import { useMoneyFormat } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { AmountText, amountParts, cx } from '../../../ui';
import { getLocale } from '../../../i18n/format';
import { bucketDays, dayTicks, isWeekend, monthStarts, type Bucket, type BucketRange, type PeriodChart } from '../logic/buckets';
import { flowGeometry, slotIndex, stepIndex } from '../logic/chart';
import { ChartTip, TipRow } from './ChartTip';
import { AxisLabels, axisLabel, bucketTitle, useSettled, useWidth } from './shared';

const HEIGHT = 248;
const PAD = 10;

/** ¿Se puede fijar el cubo? Lo ya ocurrido (o en curso) y lo futuro que tiene movimientos programados. */
const reachable = (b: Bucket) => !b.future || b.pending;

export interface FlowChartProps {
  chart: PeriodChart;
  /** «noviembre 2026». */
  periodLabel: string;
  currency: Currency;
  hrefFor: (bucket: BucketRange) => string;
  onOpen: (bucket: BucketRange) => void;
}

export function FlowChart({ chart, periodLabel, currency, hrefFor, onOpen }: FlowChartProps) {
  const t = useT();
  const fmt = useMoneyFormat();
  const settled = useSettled();
  const pid = `hf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const [sel, setSel] = useState<number | null>(null);
  const { buckets, grain } = chart;
  const n = buckets.length;
  const geo = useMemo(
    () =>
      flowGeometry(
        buckets.map((b) => (grain === 'week' ? { ...b, weight: bucketDays(b) / 7 } : b)),
        width,
        HEIGHT,
        PAD,
        5,
        grain === 'month' ? 0.46 : 0.58,
      ),
    [buckets, width, grain],
  );
  const firstFuture = buckets.findIndex((b) => b.future);
  const lastActive = buckets.reduce((last, b, i) => (reachable(b) ? i : last), -1);
  const shown = sel === null ? null : Math.min(sel, lastActive);
  const bucket = shown === null ? undefined : buckets[shown];
  const money = (m: number, kind?: 'income' | 'expense') => amountParts(m, { locale: getLocale(), currency, kind }).text;
  const announce =
    bucket === undefined
      ? ''
      : t('home.flow.readout', {
          month: bucketTitle(bucket, grain),
          in: money(bucket.inMinor, 'income'),
          out: money(bucket.outMinor, 'expense'),
          net: money(bucket.netMinor),
        }) + (bucket.future ? ` (${t('home.chart.scheduled')})` : '');

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (lastActive < 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = slotIndex(e.clientX - rect.left, rect.width, n);
    const b = buckets[i];
    // Un día o una semana futura sin nada programado no tiene qué mostrar.
    setSel(b !== undefined && !reachable(b) ? null : Math.min(lastActive, i));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && bucket !== undefined) {
      e.preventDefault();
      onOpen(bucket);
      return;
    }
    const next = stepIndex(e.key, sel, lastActive + 1);
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };

  const total = buckets.reduce((a, b) => ({ in: a.in + b.inMinor, out: a.out + b.outMinor }), { in: 0, out: 0 });
  const active = shown === null ? undefined : geo.bars[shown];
  const axisText = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), { compact: true })}`);
  const widest = geo.ticks.reduce((w, tk) => (axisText(tk.value).length > w.length ? axisText(tk.value) : w), '');
  const showNet = grain !== 'day';
  const drawn = geo.bars.slice(0, lastActive + 1);
  const netBars = drawn.filter((_, i) => reachable(buckets[i]!));
  const netPath = netBars.map((b, i) => `${i === 0 ? 'M' : 'L'}${b.cx} ${b.yNet}`).join('');
  // Separadores discretos: inicio de cada mes en las semanas, cambio de año en los meses.
  const seps =
    grain === 'week' ? monthStarts(buckets).filter((i) => i > 0) : grain === 'month' ? buckets.flatMap((b, i) => (i > 0 && b.key.endsWith('-01') ? [i] : [])) : [];
  const labeled = grain === 'day' ? dayTicks(buckets, chart.today) : grain === 'week' ? monthStarts(buckets) : buckets.map((_, i) => i);
  const futureX = firstFuture < 0 ? null : firstFuture * geo.slot;
  const stagger = `${Math.min(28, Math.round(360 / Math.max(1, n)))}ms`;
  const metaOf = (b: Bucket) => {
    const parts = [t('home.flow.count', { n: b.count })];
    if (grain === 'week' && bucketDays(b) < 7) parts.push(t('home.flow.partialWeek', { n: bucketDays(b) }));
    if (b.future) parts.push(t('home.chart.scheduled'));
    else if (b.current) parts.push(t(b.pending ? 'home.chart.withScheduled' : 'home.chart.partial').toLowerCase());
    return parts.join(' · ');
  };

  return (
    <figure className="home-flow">
      <figcaption className="home-flow__head">
        <h2 className="home-h2">
          {t('home.flow.title')} <span className="home-h2__period">· {periodLabel}</span>
        </h2>
        <div className="home-flow__readout" aria-hidden="true">
          <span className="home-flow__fig">
            <AmountText minor={total.in} kind="income" size="m" currency={currency} />
          </span>
          <span className="home-flow__fig">
            <AmountText minor={total.out} kind="expense" size="m" currency={currency} />
          </span>
          <span className="home-flow__fig home-flow__net">
            <span className="home-flow__netlabel">{t('home.kpi.net')}</span>
            <AmountText minor={total.in - total.out} size="m" currency={currency} />
          </span>
        </div>
      </figcaption>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      <div className="home-flow__plot">
        <div className="home-flow__scale" aria-hidden="true" style={{ blockSize: HEIGHT }}>
          <span className="home-flow__scale-ghost">{widest}</span>
          {geo.ticks.map((tk) => (
            <span key={tk.value} className="home-flow__tick" style={{ insetBlockStart: tk.y }}>
              {axisText(tk.value)}
            </span>
          ))}
        </div>
        <div ref={wrapRef} className="home-flow__canvas">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className={cx('home-flow__svg', lastActive < 0 && 'is-idle', settled && 'is-settled')}
            tabIndex={0}
            role="img"
            aria-label={t('home.flow.aria', { period: periodLabel, unit: t(`home.chart.${grain}`) })}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setSel(null);
            }}
            onClick={() => {
              if (bucket !== undefined) onOpen(bucket);
            }}
            onKeyDown={onKey}
            onBlur={() => setSel(null)}
          >
            <defs>
              <pattern id={pid} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" className="home-hatch__bg" />
                <rect width="1.5" height="4" className="home-hatch__line" />
              </pattern>
            </defs>
            {grain === 'day'
              ? buckets.map((b, i) =>
                  isWeekend(b.from) ? <rect key={b.key} x={i * geo.slot} y={0} width={geo.slot} height={HEIGHT} className="home-flow__weekend" /> : null,
                )
              : null}
            {geo.ticks
              .filter((tk) => tk.value !== 0)
              .map((tk) => (
                <line key={tk.value} x1={0} x2={width} y1={tk.y} y2={tk.y} className="home-flow__guide" />
              ))}
            {seps.map((i) => (
              <line key={i} x1={i * geo.slot} x2={i * geo.slot} y1={0} y2={HEIGHT} className="home-flow__sep" />
            ))}
            {active === undefined || shown === null ? null : <rect x={shown * geo.slot} y={0} width={geo.slot} height={HEIGHT} className="home-flow__hover" />}
            <g className="home-flow__bars" style={{ '--stagger': stagger } as CSSProperties}>
              {drawn.map((b, i) => {
                const on = i === shown;
                const r = Math.min(3, b.w / 4);
                return (
                  <g
                    key={b.key}
                    className={cx('home-flow__m', buckets[i]!.future && 'is-scheduled', on && 'is-active', shown !== null && !on && 'is-dim')}
                    style={{ '--i': i } as CSSProperties}
                  >
                    {b.hIn > 0 ? (
                      <path
                        className="home-flow__in"
                        d={`M${b.x} ${geo.mid}V${b.yIn + r}Q${b.x} ${b.yIn} ${b.x + r} ${b.yIn}H${b.x + b.w - r}Q${b.x + b.w} ${b.yIn} ${b.x + b.w} ${b.yIn + r}V${geo.mid}Z`}
                      />
                    ) : null}
                    {b.hOut > 0 ? (
                      <path
                        className="home-flow__out"
                        fill={`url(#${pid})`}
                        d={`M${b.x} ${geo.mid}V${geo.mid + b.hOut - r}Q${b.x} ${geo.mid + b.hOut} ${b.x + r} ${geo.mid + b.hOut}H${b.x + b.w - r}Q${b.x + b.w} ${geo.mid + b.hOut} ${b.x + b.w} ${geo.mid + b.hOut - r}V${geo.mid}Z`}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
            <line x1={0} x2={futureX ?? width} y1={geo.mid} y2={geo.mid} className="home-flow__axis" />
            {futureX === null ? null : <line x1={futureX} x2={width} y1={geo.mid} y2={geo.mid} className="home-flow__axis home-flow__axis--future" />}
            {showNet && netBars.length > 0 ? (
              <g className="home-flow__net-g">
                <path d={netPath} className="home-flow__netline" />
                {netBars.map((b) => (
                  <rect
                    key={b.key}
                    x={b.cx - 3.5}
                    y={b.yNet - 3.5}
                    width={7}
                    height={7}
                    className={cx('home-flow__netdot', b === active && 'is-active')}
                  />
                ))}
              </g>
            ) : null}
          </svg>
          {chart.quiet ? <p className="home-flow__empty">{t('home.flow.empty', { period: periodLabel })}</p> : null}
          {active === undefined || bucket === undefined ? null : (
            <ChartTip x={active.cx} width={width} gap={active.w / 2 + 10}>
              <p className="home-tip__title">{bucketTitle(bucket, grain)}</p>
              <TipRow label={t('home.kpi.in')}>
                <AmountText minor={bucket.inMinor} kind="income" size="row" currency={currency} />
              </TipRow>
              <TipRow label={t('home.kpi.out')}>
                <AmountText minor={bucket.outMinor} kind="expense" size="row" currency={currency} />
              </TipRow>
              <TipRow label={t('home.kpi.net')} strong>
                <AmountText minor={bucket.netMinor} size="row" currency={currency} />
              </TipRow>
              <p className="home-tip__meta">{metaOf(bucket)}</p>
            </ChartTip>
          )}
          <AxisLabels
            className="home-flow__axisx"
            width={width}
            items={labeled.flatMap((i) => {
              const b = buckets[i];
              if (b === undefined) return [];
              const isToday = grain === 'day' && chart.today === b.from;
              return [
                {
                  key: b.key,
                  x: i * geo.slot + geo.slot / 2,
                  text: isToday ? t('home.chart.today') : axisLabel(buckets, i, grain),
                  className: cx(i === shown && 'is-active', isToday && 'is-today') || undefined,
                },
              ];
            })}
          />
        </div>
      </div>
      <details className="home-table">
        <summary>{t('ui.table.asTable')}</summary>
        <table className="ui-table ui-table--summary ui-table--dense">
          <caption className="visually-hidden">{`${t('home.flow.title')} · ${periodLabel}`}</caption>
          <thead>
            <tr>
              <th scope="col">{t(`home.flow.${grain}`)}</th>
              <th scope="col" className="is-end">{t('home.kpi.in')}</th>
              <th scope="col" className="is-end">{t('home.kpi.out')}</th>
              <th scope="col" className="is-end">{t('home.kpi.net')}</th>
              <th scope="col" className="is-end">{t('home.flow.close')}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.slice(0, lastActive + 1).flatMap((b) =>
              reachable(b)
                ? [
                    <tr key={b.key}>
                      <td>
                        <Link to={hrefFor(b)} aria-label={t('home.flow.open', { month: bucketTitle(b, grain) })}>
                          {bucketTitle(b, grain)}
                        </Link>
                        {b.future ? <span className="home-table__note"> · {t('home.chart.scheduled')}</span> : null}
                        {grain === 'week' && bucketDays(b) < 7 ? <span className="home-table__note"> · {t('home.flow.partialWeek', { n: bucketDays(b) })}</span> : null}
                      </td>
                      <td className="is-end num">
                        <AmountText minor={b.inMinor} size="table" notation="columns" kind="income" currency={currency} />
                      </td>
                      <td className="is-end num">
                        <AmountText minor={b.outMinor} size="table" notation="columns" kind="expense" currency={currency} />
                      </td>
                      <td className="is-end num">
                        <AmountText minor={b.netMinor} size="table" notation="parens" currency={currency} />
                      </td>
                      <td className="is-end num">
                        <AmountText minor={b.closeMinor ?? b.endMinor} size="table" notation="parens" neutral currency={currency} />
                      </td>
                    </tr>,
                  ]
                : [],
            )}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
