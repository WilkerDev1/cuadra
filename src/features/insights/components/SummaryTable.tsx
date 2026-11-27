// Tabla del Resumen: un grupo por fila (subgrupos debajo), Entradas/Salidas/Neto/Movimientos y, al comparar,
// el valor anterior de la medida y la variación en texto llano. Totales con doble raya. Cada grupo enlaza a
// sus movimientos.
import { Link } from 'react-router';
import type { Currency } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, Table, cx, type TableColumn } from '../../../ui';
import { change, measureOf, sumGroups, tableRows, type Point, type TableRow } from '../model/series';
import type { Measure } from '../model/state';
import { ValueText } from './SummaryChart';

export interface SummaryTableProps {
  points: readonly Point[];
  measure: Measure;
  compare: boolean;
  currency: Currency;
  groupHeader: string;
  hrefFor: (row: TableRow) => string;
  /** Texto plano de una diferencia con signo («+RD$1,200.00»). */
  diffText: (v: number) => string;
}

export function SummaryTable({ points, measure, compare, currency, groupHeader, hrefFor, diffText }: SummaryTableProps) {
  const t = useT();
  const rows = tableRows(points);
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
      render: (r) => new Intl.NumberFormat(getLocale()).format(r.group.count),
      footer: <span className="ins-rule-double num">{new Intl.NumberFormat(getLocale()).format(total.count)}</span>,
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
  return (
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
}

