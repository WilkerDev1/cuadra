// Tabla del Resumen: un grupo por fila (subgrupos debajo), Entradas/Salidas/Neto/Movimientos y, al comparar,
// el valor anterior de la medida y la variación en texto llano. Totales con doble raya. Cada grupo enlaza a
// sus movimientos. Con muchos grupos (p. ej. por día de todo el historial) pinta una ventana de grupos enteros y
// ofrece «Mostrar más»; los totales siempre suman todos los grupos.
import { useState } from 'react';
import { Link } from 'react-router';
import type { Currency } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, Button, Table, cx, type TableColumn } from '../../../ui';
import { change, measureOf, sumGroups, TABLE_ROW_BUDGET, tableRows, tableWindow, type Point, type TableRow } from '../model/series';
import type { Measure } from '../model/state';
import { ValueText } from './SummaryChart';

export interface SummaryTableProps {
  points: readonly Point[];
  measure: Measure;
  compare: boolean;
  currency: Currency;
  groupHeader: string;
  /** Agrupado por tiempo: la ventana muestra los grupos más recientes. */
  time: boolean;
  hrefFor: (row: TableRow) => string;
  /** Texto plano de una diferencia con signo («+RD$1,200.00»). */
  diffText: (v: number) => string;
}

export function SummaryTable({ points, measure, compare, currency, groupHeader, time, hrefFor, diffText }: SummaryTableProps) {
  const t = useT();
  const [budget, setBudget] = useState(TABLE_ROW_BUDGET);
  const win = tableWindow(tableRows(points), budget, time);
  const rows = win.rows;
  const nf = new Intl.NumberFormat(getLocale());
  const total = sumGroups(points.map((p) => p.group));
  const prevTotal = points.reduce((s, p) => s + (p.prev ?? 0), 0);
  const curTotal = points.reduce((s, p) => s + p.value, 0);
  const pct = (r: number | null) =>
    r === null ? '' : new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(r);
  const variation = (cur: number, prev: number) => {
    const c = change(cur, prev);
    if (c.diff === 0) return '=';
    const d = measure === 'count' ? new Intl.NumberFormat(getLocale(), { signDisplay: 'always' }).format(c.diff) : diffText(c.diff);
    return c.ratio === null ? d : `${d} (${pct(c.ratio)})`;
  };
  const money = (minor: number, kind: 'income' | 'expense' | null, rule = false) => (
    <AmountText
      minor={minor}
      size="table"
      currency={currency}
      notation={kind === null ? 'parens' : 'columns'}
      {...(kind === null ? {} : { kind })}
      {...(rule ? { rule: 'double' as const } : {})}
    />
  );
  const columns: TableColumn<TableRow>[] = [
    {
      key: 'group',
      header: groupHeader,
      grow: true,
      render: (r) => (
        <Link to={hrefFor(r)} className={cx('ins-tlink', r.depth === 1 && 'ins-tlink--sub', r.group.inactive && 'is-inactive')} title={t('insights.table.open', { label: r.group.label })}>
          {r.group.label}
        </Link>
      ),
      footer: <span className="ins-total-label">{t('insights.table.total')}</span>,
    },
    { key: 'in', header: t('insights.table.in'), align: 'end', numeric: true, render: (r) => (r.group.inMinor === 0 ? '' : money(r.group.inMinor, 'income')), footer: money(total.inMinor, 'income', true) },
    { key: 'out', header: t('insights.table.out'), align: 'end', numeric: true, render: (r) => (r.group.outMinor === 0 ? '' : money(r.group.outMinor, 'expense')), footer: money(total.outMinor, 'expense', true) },
    { key: 'net', header: t('insights.table.net'), align: 'end', numeric: true, render: (r) => money(r.group.netMinor, null), footer: money(total.netMinor, null, true) },
    {
      key: 'count',
      header: t('insights.table.count'),
      align: 'end',
      numeric: true,
      hideStacked: true,
      render: (r) => nf.format(r.group.count),
      footer: <span className="ins-rule-double num">{nf.format(total.count)}</span>,
    },
    ...(compare
      ? ([
          {
            key: 'prev',
            header: t('insights.table.previous'),
            align: 'end',
            numeric: true,
            render: (r) => (r.prev === null ? '' : <ValueText value={r.prev} measure={measure} currency={currency} size="table" />),
            footer: <ValueText value={prevTotal} measure={measure} currency={currency} size="table" />,
          },
          {
            key: 'change',
            header: t('insights.table.change'),
            align: 'end',
            numeric: true,
            render: (r) => (r.prev === null ? '' : <span className="ins-change">{variation(measureOf(r.group, measure), r.prev)}</span>),
            footer: <span className="ins-change">{variation(curTotal, prevTotal)}</span>,
          },
        ] satisfies TableColumn<TableRow>[])
      : []),
  ];
  const table = (
    <Table
      variant="summary"
      caption={t('insights.table.caption')}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      footer
      className="ins-table"
    />
  );
  if (win.hiddenGroups === 0) return table;
  const shown = nf.format(win.totalGroups - win.hiddenGroups);
  const all = nf.format(win.totalGroups);
  return (
    <>
      {table}
      <div className="ins-table__more">
        <p className="ins-meta">{t(time ? 'insights.table.partialRecent' : 'insights.table.partialFirst', { shown, total: all })}</p>
        <Button variant="secondary" onClick={() => setBudget((b) => b + TABLE_ROW_BUDGET)}>
          {t(time ? 'insights.table.moreEarlier' : 'insights.table.more')}
        </Button>
      </div>
    </>
  );
}

