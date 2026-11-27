// Evolución del saldo total sobre el bosque: área y línea, el periodo elegido como franja, cursor y teclado.
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Currency, IsoDate, Minor } from '../../../core';
import { useMoneyFormat } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { AmountText, amountParts } from '../../../ui';
import { areaGeometry, monthTicks, nearestIndex, niceDomain, seriesKeyMonth, seriesPointEnd, stepIndex } from '../logic/chart';
import { ChartTip } from './ChartTip';
import { shortMonth, useWidth } from './shared';

export interface BalanceChartProps {
  keys: readonly string[];
  values: readonly Minor[];
  unit: 'day' | 'week' | 'month';
  currency: Currency;
  range: { from: IsoDate | null; to: IsoDate | null };
  height?: number;
}

export function BalanceChart({ keys, values, unit, currency, range, height = 184 }: BalanceChartProps) {
  const t = useT();
  const fmt = useMoneyFormat();
  const [wrapRef, width] = useWidth<HTMLDivElement>(560);
  const [sel, setSel] = useState<number | null>(null);
  const dom = useMemo(() => niceDomain(values, 4), [values]);
  const geo = useMemo(() => areaGeometry(values, width, height, 6, 0, dom), [values, width, height, dom]);
  const n = values.length;
  const windowChange = (values[n - 1] ?? 0) - (values[0] ?? 0);
  const shown = sel ?? n - 1;
  const firstEnd = keys[0] === undefined ? null : seriesPointEnd(keys[0], unit);
  const axis = (v: number) => (v < 0 ? `\u2212${fmt(-v, { compact: true })}` : fmt(v, { compact: true }));
  const widest = dom.values.reduce((w, v) => (axis(v).length > w.length ? axis(v) : w), '');
  const point = geo.points[shown];
  const key = keys[shown];
  const label = (k: string) =>
    unit === 'week' ? t('home.balance.week', { date: formatDate(k).replace(/ \d{4}$/, '') }) : unit === 'day' ? formatDate(k) : shortMonth(k, true);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSel(nearestIndex(e.clientX - rect.left, rect.width, n));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = stepIndex(e.key, sel, n);
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };

  // Franja del periodo: claves de serie dentro del rango (las semanas empiezan en lunes: se toma su inicio).
  const idxIn = keys.map((k) => (range.from === null || k >= range.from.slice(0, k.length)) && (range.to === null || k <= range.to));
  const b0 = idxIn.indexOf(true);
  const b1 = idxIn.lastIndexOf(true);
  const step = n > 1 ? width / (n - 1) : width;
  const ticks = monthTicks(keys.map(seriesKeyMonth), 6);
  const announce =
    sel === null || key === undefined ? '' : `${label(key)}: ${amountParts(values[shown] ?? 0, { locale: getLocale(), currency }).text}`;

  return (
    <figure className="home-bal">
      <figcaption className="visually-hidden">{t('home.balance.series')}</figcaption>
      <div className="home-bal__readout" aria-hidden="true">
        <AmountText minor={Math.abs(windowChange)} kind={windowChange < 0 ? 'expense' : 'income'} size="m" onForest currency={currency} />
        <span className="home-bal__when">{t('home.balance.since', { date: firstEnd === null ? '' : formatDate(firstEnd) })}</span>
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
          className="home-bal__svg"
          tabIndex={0}
          role="img"
          aria-label={`${t('home.balance.series')}. ${t('home.balance.seriesHint')}`}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setSel(null);
          }}
          onKeyDown={onKey}
          onBlur={() => setSel(null)}
        >
          {b0 >= 0 ? (
            <rect x={Math.max(0, b0 * step - step / 2)} y={0} width={Math.min(width, (b1 - b0 + 1) * step)} height={height} className="home-bal__band" />
          ) : null}
          {dom.values.map((v) => (
            <line key={v} x1={0} x2={width} y1={geo.yOf(v)} y2={geo.yOf(v)} className={v === 0 ? 'home-bal__zero' : 'home-bal__grid'} />
          ))}
          <path d={geo.area} className="home-bal__area" />
          <path d={geo.line} className="home-bal__line" pathLength={1} />
          {sel === null || point === undefined ? null : <line x1={point.x} x2={point.x} y1={0} y2={height} className="home-bal__cursor" />}
          {point === undefined ? null : <circle cx={Math.min(width - 4, Math.max(4, point.x))} cy={point.y} r={4} className="home-bal__dot" />}
        </svg>
        {sel === null || point === undefined || key === undefined ? null : (
          <ChartTip x={point.x} width={width} gap={10} className="home-tip--forest">
            <p className="home-tip__title">{label(key)}</p>
            <AmountText minor={values[shown] ?? 0} size="row" currency={currency} />
          </ChartTip>
        )}
        <div className="home-bal__axisx" aria-hidden="true">
          {ticks.map((i) => {
            const m = seriesKeyMonth(keys[i] ?? '');
            return m === null ? null : (
              <span key={i} style={{ insetInlineStart: `${(i / Math.max(1, n - 1)) * 100}%` }}>
                {shortMonth(m, m.endsWith('-01'))}
              </span>
            );
          })}
        </div>
        </div>
      </div>
    </figure>
  );
}
