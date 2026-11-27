// Evolución del saldo total dentro del periodo, sobre el bosque: arranca en el saldo de apertura (borde izquierdo)
// y sigue con el cierre de cada día, semana o mes, al centro de su cubo y bajo su rótulo. Lo que aún no llega queda
// vacío, salvo los movimientos programados, que siguen la línea con un tramo de puntos. Una línea punteada tenue
// repite el periodo anterior equivalente, alineado por posición. Cursor y teclado recorren los cierres.
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Currency, Minor } from '../../../core';
import { useMoneyFormat } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, amountParts, cx } from '../../../ui';
import { dayTicks, monthStarts, type PeriodChart } from '../logic/buckets';
import { areaGeometry, centeredX, nearestOf, niceDomain, stepIndex } from '../logic/chart';
import { ChartTip, TipRow } from './ChartTip';
import { AxisLabels, axisLabel, bucketTitle, shortDay, useSettled, useWidth } from './shared';

export interface BalanceChartProps {
  chart: PeriodChart;
  /** «noviembre 2026». */
  periodLabel: string;
  /** Nombre corto del periodo anterior («octubre»), si hay línea de comparación. */
  prevLabel: string | null;
  currency: Currency;
  height?: number;
}

export function BalanceChart({ chart, periodLabel, prevLabel, currency, height = 184 }: BalanceChartProps) {
  const t = useT();
  const fmt = useMoneyFormat();
  const settled = useSettled();
  const [wrapRef, width] = useWidth<HTMLDivElement>(560);
  const [sel, setSel] = useState<number | null>(null);
  const { buckets, grain, lastIndex } = chart;
  const n = buckets.length;
  const slots = n + 1;
  const xOf = useMemo(() => centeredX(n, width), [n, width]);
  const values = useMemo(() => chart.line.slice(0, lastIndex + 1).map((v) => v ?? 0), [chart.line, lastIndex]);
  const prev = chart.prev;
  const prevValues = useMemo(() => prev?.values ?? [], [prev]);
  const prevStart = prev?.start ?? 0;
  const prevDrawn = useMemo(() => prevValues.slice(prevStart), [prevValues, prevStart]);
  const proj = chart.projection;
  const projValues = useMemo(() => proj?.values ?? [], [proj]);
  const projStart = proj?.start ?? lastIndex;
  // Hasta dónde llega el cursor: el último cierre, o el final del tramo programado.
  const reach = proj === null ? lastIndex : projStart + projValues.length - 1;
  const dom = useMemo(() => niceDomain([...values, ...prevDrawn, ...projValues], 4), [values, prevDrawn, projValues]);
  const geo = useMemo(() => areaGeometry(values, width, height, 6, 0, dom, slots, xOf), [values, width, height, dom, slots, xOf]);
  // Las otras dos líneas empiezan más a la derecha: misma escala y mismas posiciones, desplazadas.
  const prevGeo = useMemo(
    () => areaGeometry(prevDrawn, width, height, 6, 0, dom, slots, (j) => xOf(j + prevStart)),
    [prevDrawn, width, height, dom, slots, xOf, prevStart],
  );
  const projGeo = useMemo(
    () => areaGeometry(projValues, width, height, 6, 0, dom, slots, (j) => xOf(j + projStart)),
    [projValues, width, height, dom, slots, xOf, projStart],
  );
  const valueAt = (i: number): Minor => (i <= lastIndex ? (values[i] ?? 0) : (projValues[i - projStart] ?? 0));
  const shown = Math.min(sel ?? lastIndex, reach);
  const scheduled = shown > lastIndex;
  const point = { x: xOf(shown), y: geo.yOf(valueAt(shown)) };
  const opening = values[0] ?? 0;
  const axis = (v: number) => (v < 0 ? `−${fmt(-v, { compact: true })}` : fmt(v, { compact: true }));
  const widest = dom.values.reduce((w, v) => (axis(v).length > w.length ? axis(v) : w), '');
  const money = (m: Minor) => amountParts(m, { locale: getLocale(), currency }).text;
  const startDate = shortDay(chart.from);

  /** Título de la posición `i`: 0 es la apertura; `i` el cierre del cubo `i − 1`. */
  const titleAt = (i: number) => (i === 0 ? t('home.balance.opening', { date: startDate }) : bucketTitle(buckets[i - 1]!, grain));
  const prevTitleAt = (i: number) => {
    if (prev === null) return '';
    const r = prev.ranges[Math.max(0, i - 1)];
    if (r === undefined) return '';
    return i === 0 ? t('home.balance.opening', { date: shortDay(r.from) }) : bucketTitle(r, grain);
  };

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSel(nearestOf(e.clientX - rect.left, reach + 1, xOf));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = stepIndex(e.key, sel, reach + 1);
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };

  // Rótulos del eje al centro de su cubo: días (el 1, los lunes y hoy), inicio de cada mes en las semanas, o meses.
  const ticks = grain === 'day' ? dayTicks(buckets, chart.today) : grain === 'week' ? monthStarts(buckets) : buckets.map((_, i) => i);
  const sparse = grain === 'month' && width / Math.max(1, n) < 34;
  const todayX = chart.today === null ? null : xOf(lastIndex);
  const announce =
    sel === null ? '' : `${titleAt(shown)}: ${money(valueAt(shown))}${scheduled ? ` (${t('home.balance.scheduled').toLowerCase()})` : ''}`;
  const summary = t(chart.today === null ? 'home.balance.summaryClosed' : 'home.balance.summaryOpen', {
    period: periodLabel,
    unit: t(`home.chart.${grain}`),
    start: money(opening),
    end: money(values[lastIndex] ?? 0),
  });
  const prevAt = shown >= prevStart ? prevValues[shown] : undefined;
  const aria = [
    summary,
    prev === null || prevLabel === null ? '' : t('home.balance.prevAria', { period: prevLabel }),
    proj === null ? '' : t('home.balance.projAria', { amount: money(projValues.at(-1) ?? 0) }),
    t('home.balance.seriesHint'),
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <figure className="home-bal">
      <figcaption className="visually-hidden">{`${t('home.balance.series')}. ${summary}`}</figcaption>
      <div className="home-bal__readout" aria-hidden="true">
        <AmountText minor={opening} size="m" onForest currency={currency} />
        <span className="home-bal__when">{t('home.balance.startedAt', { date: startDate })}</span>
        {proj === null ? null : (
          <span className="home-bal__key">
            <svg width="18" height="6" viewBox="0 0 18 6" className="home-bal__keyproj">
              <line x1="1" x2="17" y1="3" y2="3" />
            </svg>
            {t('home.balance.scheduled')}
          </span>
        )}
        {prev === null || prevLabel === null ? null : (
          <span className="home-bal__key">
            <svg width="18" height="6" viewBox="0 0 18 6" className="home-bal__keyline">
              <line x1="0" x2="18" y1="3" y2="3" />
            </svg>
            {prevLabel}
          </span>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      <div className="home-bal__plot">
        <div className="home-bal__scale" aria-hidden="true" style={{ blockSize: height }}>
          <span className="home-bal__scale-ghost">{widest}</span>
          {dom.values.map((v) => (
            <span key={v} className="home-bal__tick" style={{ insetBlockStart: geo.yOf(v) }}>
              {axis(v)}
            </span>
          ))}
        </div>
        <div ref={wrapRef} className="home-bal__canvas">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={cx('home-bal__svg', settled && 'is-settled')}
            tabIndex={0}
            role="img"
            aria-label={aria}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setSel(null);
            }}
            onKeyDown={onKey}
            onBlur={() => setSel(null)}
          >
            {dom.values.map((v) => (
              <line key={v} x1={0} x2={width} y1={geo.yOf(v)} y2={geo.yOf(v)} className={v === 0 ? 'home-bal__zero' : 'home-bal__grid'} />
            ))}
            {todayX === null ? null : <line x1={todayX} x2={todayX} y1={0} y2={height} className="home-bal__today" />}
            <g className="home-bal__series">
              {prevGeo.line === '' ? null : <path d={prevGeo.line} className="home-bal__prev" />}
              <path d={geo.area} className="home-bal__area" />
              <path d={geo.line} className="home-bal__line" pathLength={1} />
              {projGeo.line === '' ? null : <path d={projGeo.line} className="home-bal__proj" />}
            </g>
            {sel === null ? null : <line x1={point.x} x2={point.x} y1={0} y2={height} className="home-bal__cursor" />}
            {sel === null || prevAt === undefined ? null : <circle cx={point.x} cy={prevGeo.yOf(prevAt)} r={2.5} className="home-bal__prevdot" />}
            <circle cx={Math.min(width - 4, Math.max(4, point.x))} cy={point.y} r={4} className={cx('home-bal__dot', scheduled && 'is-scheduled')} />
          </svg>
          {sel === null ? null : (
            <ChartTip x={point.x} width={width} gap={10} className="home-tip--forest">
              <p className="home-tip__title">{titleAt(shown)}</p>
              <AmountText minor={valueAt(shown)} size="row" currency={currency} />
              {shown === 0 ? null : (
                <TipRow label={t('home.balance.since', { date: startDate })}>
                  <AmountText
                    minor={Math.abs(valueAt(shown) - opening)}
                    kind={valueAt(shown) - opening < 0 ? 'expense' : 'income'}
                    size="row"
                    currency={currency}
                  />
                </TipRow>
              )}
              {prevAt === undefined ? null : (
                <TipRow label={prevTitleAt(shown)}>
                  <AmountText minor={prevAt} size="row" currency={currency} />
                </TipRow>
              )}
              {scheduled ? (
                <p className="home-tip__meta">{t('home.balance.scheduledTip')}</p>
              ) : shown > 0 && buckets[shown - 1]?.current === true ? (
                <p className="home-tip__meta">{t('home.chart.partial')}</p>
              ) : null}
            </ChartTip>
          )}
          <AxisLabels
            className="home-bal__axisx"
            width={width}
            items={ticks
              .filter((i, j) => !sparse || j % 2 === 0 || i === n - 1)
              .flatMap((i) => {
                const b = buckets[i];
                if (b === undefined) return [];
                const isToday = grain === 'day' && chart.today === b.from;
                return [{ key: b.key, x: xOf(i + 1), text: isToday ? t('home.chart.today') : axisLabel(buckets, i, grain), className: isToday ? 'is-today' : undefined }];
              })}
          />
        </div>
      </div>
    </figure>
  );
}
