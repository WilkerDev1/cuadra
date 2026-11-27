// Entradas y salidas por mes: barras espejadas (entradas arriba, salidas abajo con trama) y el neto como punto
// unido por una línea fina. Cursor y teclado fijan un mes; clic o Intro abre sus movimientos.
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import type { Currency, DashboardData, IsoDate } from '../../../core';
import { useMoneyFormat } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { AmountText, amountParts, cx } from '../../../ui';
import { getLocale } from '../../../i18n/format';
import { flowGeometry, slotIndex, stepIndex } from '../logic/chart';
import { ChartTip, TipRow } from './ChartTip';
import { monthInRange } from '../logic/period';
import { longMonth, shortMonth, useWidth } from './shared';

const HEIGHT = 248;
const PAD = 10;

export interface FlowChartProps {
  flow: DashboardData['flow'];
  range: { from: IsoDate | null; to: IsoDate | null };
  currency: Currency;
  hrefFor: (monthKey: string) => string;
  onOpen: (monthKey: string) => void;
}

export function FlowChart({ flow, range, currency, hrefFor, onOpen }: FlowChartProps) {
  const t = useT();
  const fmt = useMoneyFormat();
  const pid = `hf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const [sel, setSel] = useState<number | null>(null);
  const geo = useMemo(() => flowGeometry(flow, width, HEIGHT, PAD), [flow, width]);
  const inPeriod = flow.map((m) => monthInRange(m.key, range));
  const lastInPeriod = inPeriod.lastIndexOf(true);
  const shown = sel ?? (lastInPeriod >= 0 ? lastInPeriod : flow.length - 1);
  const month = flow[shown];
  const money = (m: number, kind?: 'income' | 'expense') => amountParts(m, { locale: getLocale(), currency, kind }).text;
  const announce =
    sel === null || month === undefined
      ? ''
      : t('home.flow.readout', { month: longMonth(month.key), in: money(month.inMinor, 'income'), out: money(month.outMinor, 'expense'), net: money(month.netMinor) });

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSel(slotIndex(e.clientX - rect.left, rect.width, flow.length));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && month !== undefined) {
      e.preventDefault();
      onOpen(month.key);
      return;
    }
    const next = stepIndex(e.key, sel, flow.length);
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };

  const win = flow.reduce((a, m) => ({ in: a.in + m.inMinor, out: a.out + m.outMinor }), { in: 0, out: 0 });
  const active = sel === null ? undefined : geo.bars[sel];
  const axisLabel = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '\u2212'}${fmt(Math.abs(v), { compact: true })}`);
  const widest = geo.ticks.reduce((w, tk) => (axisLabel(tk.value).length > w.length ? axisLabel(tk.value) : w), '');
  // Línea del neto entre puntos de meses consecutivos.
  const netPath = geo.bars.map((b, i) => `${i === 0 ? 'M' : 'L'}${b.cx} ${b.yNet}`).join('');
  const bandStart = inPeriod.indexOf(true);
  const bandEnd = lastInPeriod;

  return (
    <figure className="home-flow">
      <figcaption className="home-flow__head">
        <h2 className="home-h2">{t('home.flow.title')}</h2>
        {flow.length === 0 ? null : (
          <div className="home-flow__readout" aria-hidden="true">
            <span className="home-flow__month">{t('home.flow.window', { n: flow.length })}</span>
            <span className="home-flow__fig">
              <AmountText minor={win.in} kind="income" size="m" currency={currency} />
            </span>
            <span className="home-flow__fig">
              <AmountText minor={win.out} kind="expense" size="m" currency={currency} />
            </span>
            <span className="home-flow__fig home-flow__net">
              <span className="home-flow__netlabel">{t('home.kpi.net')}</span>
              <AmountText minor={win.in - win.out} size="m" currency={currency} />
            </span>
          </div>
        )}
      </figcaption>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      <div className="home-flow__plot">
        <div className="home-flow__scale" aria-hidden="true" style={{ blockSize: HEIGHT }}>
          <span className="home-flow__scale-ghost">{widest}</span>
          {geo.ticks.map((tk) => (
            <span key={tk.value} className="home-flow__tick" style={{ insetBlockStart: tk.y }}>
              {axisLabel(tk.value)}
            </span>
          ))}
        </div>
        <div ref={wrapRef} className="home-flow__canvas">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="home-flow__svg"
            tabIndex={0}
            role="img"
            aria-label={t('home.flow.aria')}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setSel(null);
            }}
            onClick={() => {
              if (month !== undefined && sel !== null) onOpen(month.key);
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
            {bandStart >= 0 ? (
              <rect x={bandStart * geo.slot} y={0} width={(bandEnd - bandStart + 1) * geo.slot} height={HEIGHT} className="home-flow__band" />
            ) : null}
            {geo.ticks
              .filter((tk) => tk.value !== 0)
              .map((tk) => (
                <line key={tk.value} x1={0} x2={width} y1={tk.y} y2={tk.y} className="home-flow__guide" />
              ))}
            {active === undefined ? null : <rect x={(sel ?? 0) * geo.slot} y={0} width={geo.slot} height={HEIGHT} className="home-flow__hover" />}
            <g className="home-flow__bars">
              {geo.bars.map((b, i) => {
                const on = i === shown && sel !== null;
                const r = Math.min(3, geo.barW / 4);
                return (
                  <g key={b.key} className={cx('home-flow__m', on && 'is-active', sel !== null && !on && 'is-dim')} style={{ '--i': i } as CSSProperties}>
                    {b.hIn > 0 ? (
                      <path
                        className="home-flow__in"
                        d={`M${b.x} ${geo.mid}V${b.yIn + r}Q${b.x} ${b.yIn} ${b.x + r} ${b.yIn}H${b.x + geo.barW - r}Q${b.x + geo.barW} ${b.yIn} ${b.x + geo.barW} ${b.yIn + r}V${geo.mid}Z`}
                      />
                    ) : null}
                    {b.hOut > 0 ? (
                      <path
                        className="home-flow__out"
                        fill={`url(#${pid})`}
                        d={`M${b.x} ${geo.mid}V${geo.mid + b.hOut - r}Q${b.x} ${geo.mid + b.hOut} ${b.x + r} ${geo.mid + b.hOut}H${b.x + geo.barW - r}Q${b.x + geo.barW} ${geo.mid + b.hOut} ${b.x + geo.barW} ${geo.mid + b.hOut - r}V${geo.mid}Z`}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
            <line x1={0} x2={width} y1={geo.mid} y2={geo.mid} className="home-flow__axis" />
            <path d={netPath} className="home-flow__netline" />
            {geo.bars.map((b, i) => (
              <rect
                key={b.key}
                x={b.cx - 3.5}
                y={b.yNet - 3.5}
                width={7}
                height={7}
                className={cx('home-flow__netdot', i === shown && sel !== null && 'is-active')}
              />
            ))}
          </svg>
          {active === undefined || month === undefined ? null : (
            <ChartTip x={active.cx} width={width} gap={geo.barW / 2 + 10}>
              <p className="home-tip__title">{longMonth(month.key)}</p>
              <TipRow label={t('home.kpi.in')}>
                <AmountText minor={month.inMinor} kind="income" size="row" currency={currency} />
              </TipRow>
              <TipRow label={t('home.kpi.out')}>
                <AmountText minor={month.outMinor} kind="expense" size="row" currency={currency} />
              </TipRow>
              <TipRow label={t('home.kpi.net')} strong>
                <AmountText minor={month.netMinor} size="row" currency={currency} />
              </TipRow>
              <p className="home-tip__meta">{t('home.flow.count', { n: month.count })}</p>
            </ChartTip>
          )}
          <div className="home-flow__axisx" aria-hidden="true">
            {flow.map((m, i) => (
              <span key={m.key} className={cx(i === shown && 'is-active', inPeriod[i] === true && 'is-period')}>
                {shortMonth(m.key, m.key.endsWith('-01') || i === 0)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="home-table">
        <summary>{t('ui.table.asTable')}</summary>
        <table className="ui-table ui-table--summary ui-table--dense">
          <caption className="visually-hidden">{t('home.flow.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('home.flow.month')}</th>
              <th scope="col" className="is-end">{t('home.kpi.in')}</th>
              <th scope="col" className="is-end">{t('home.kpi.out')}</th>
              <th scope="col" className="is-end">{t('home.kpi.net')}</th>
            </tr>
          </thead>
          <tbody>
            {flow.map((m) => (
              <tr key={m.key}>
                <td>
                  <Link to={hrefFor(m.key)} aria-label={t('home.flow.open', { month: longMonth(m.key) })}>
                    {longMonth(m.key)}
                  </Link>
                </td>
                <td className="is-end num">
                  <AmountText minor={m.inMinor} size="table" notation="columns" kind="income" currency={currency} />
                </td>
                <td className="is-end num">
                  <AmountText minor={m.outMinor} size="table" notation="columns" kind="expense" currency={currency} />
                </td>
                <td className="is-end num">
                  <AmountText minor={m.netMinor} size="table" notation="parens" currency={currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
