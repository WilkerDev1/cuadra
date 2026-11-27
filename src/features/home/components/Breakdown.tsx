// Reparto por categoría (o cualquier dimensión) como barras ordenadas: la del periodo y, encima, una raya fina con
// el periodo anterior. Cada fila es un enlace a los movimientos que la forman.
import { useId, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { Currency, DashboardData } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, Button, Segmented, Select, amountParts, cx, type SelectOption } from '../../../ui';
import { useCompare } from './shared';

const VISIBLE = 7;

export interface BreakdownProps {
  breakdown: DashboardData['breakdown'];
  currency: Currency;
  prevLabel: string | null;
  dimension: string;
  dimensions: readonly SelectOption[];
  onDimension: (value: string) => void;
  onMeasure: (value: 'in' | 'out') => void;
  hrefFor: (key: string | null) => string;
  /** Etiqueta de un grupo (traduce claves de cuenta o tipo cuando hace falta). */
  labelFor?: (group: DashboardData['breakdown']['groups'][number]) => string;
}

export function Breakdown({ breakdown, currency, prevLabel, dimension, dimensions, onDimension, onMeasure, hrefFor, labelFor }: BreakdownProps) {
  const t = useT();
  const compare = useCompare();
  const selectId = useId();
  const [all, setAll] = useState(false);
  const measure = breakdown.measure === 'in' ? 'in' : 'out';
  const valueOf = (s: { inMinor: number; outMinor: number }) => (measure === 'in' ? s.inMinor : s.outMinor);
  const rows = breakdown.groups.filter((g) => valueOf(g.current) > 0 || (g.previous !== null && valueOf(g.previous) > 0));
  const total = rows.reduce((s, g) => s + valueOf(g.current), 0);
  const shown = all ? rows : rows.slice(0, VISIBLE);
  // Escala de las filas visibles: la mayor ocupa la pista entera.
  const max = Math.max(1, ...shown.map((g) => Math.max(valueOf(g.current), g.previous === null ? 0 : valueOf(g.previous))));
  const pct = (v: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(total === 0 ? 0 : v / total);

  return (
    <section className="home-bd" aria-labelledby={`${selectId}-h`}>
      <div className="home-bd__head">
        <h2 id={`${selectId}-h`} className="visually-hidden">
          {t(measure === 'in' ? 'home.breakdown.in' : 'home.breakdown.out')}
        </h2>
        <Segmented
          label={t('home.breakdown.measure')}
          value={measure}
          onChange={(v) => onMeasure(v)}
          options={[
            { value: 'out', label: t('home.breakdown.out') },
            { value: 'in', label: t('home.breakdown.in') },
          ]}
        />
        <span className="home-bd__by" aria-hidden="true">
          {t('home.breakdown.by')}
        </span>
        <label htmlFor={selectId} className="visually-hidden">
          {t('home.breakdown.dimension')}
        </label>
        <Select id={selectId} className="home-bd__dim" options={dimensions} value={dimension} onChange={onDimension} />
      </div>
      {rows.length === 0 ? (
        <p className="home-bd__empty">{t('home.breakdown.empty')}</p>
      ) : (
        <ol className="home-bd__list" role="list">
          {shown.map((g, i) => {
            const cur = valueOf(g.current);
            const prev = g.previous === null ? null : valueOf(g.previous);
            const label = labelFor?.(g) ?? g.label;
            const cmp = prev === null || prevLabel === null ? '' : compare(cur, prev, prevLabel);
            const amount = amountParts(cur, { locale: getLocale(), currency }).text;
            return (
              <li key={g.key ?? '∅'} style={{ '--i': i } as CSSProperties}>
                <Link
                  to={hrefFor(g.key)}
                  className={cx('home-bd__row', g.inactive && 'is-inactive')}
                  aria-label={t('home.breakdown.row', { label, amount, share: pct(cur), compare: cmp })}
                >
                  <span className="home-bd__label">
                    <span className="home-bd__dot" style={g.color === null ? undefined : { background: `var(--${g.color})` }} aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </span>
                  <span className="home-bd__track" aria-hidden="true">
                    <span className={cx('home-bd__bar', `home-bd__bar--${measure}`)} style={{ inlineSize: `${(cur / max) * 100}%` }} />
                    {prev === null || prev === 0 ? null : <span className="home-bd__prev" style={{ insetInlineStart: `${(prev / max) * 100}%` }} />}
                  </span>
                  <span className="home-bd__amount" aria-hidden="true">
                    <AmountText minor={cur} size="row" neutral currency={currency} />
                  </span>
                  <span className="home-bd__share num" aria-hidden="true">
                    {pct(cur)}
                  </span>
                  <span className="home-bd__delta" aria-hidden="true">
                    {prev === null || prevLabel === null ? '' : deltaShort(cur, prev)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <div className="home-bd__foot">
        {prevLabel === null || rows.length === 0 ? <span /> : (
          <span className="home-bd__legend">
            <span className="home-bd__legend-tick" aria-hidden="true" />
            {t('home.breakdown.prev', { period: prevLabel })}
          </span>
        )}
        {rows.length > VISIBLE ? (
          <Button variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? t('home.breakdown.less') : t('home.breakdown.more', { n: rows.length - VISIBLE })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** «+12 %», «−8 %», «nuevo» o «=»: la comparación breve de la fila (la completa va en la etiqueta accesible). */
function deltaShort(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? '' : '·';
  const r = (cur - prev) / prev;
  if (Math.abs(r) < 0.005) return '=';
  const p = new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(Math.abs(r));
  return `${r > 0 ? '+' : '−'}${p}`;
}
