import { useState, type ReactNode } from 'react';
import type { ColumnMapping, ImportPreviewResult, ImportPreviewRow, Currency } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { AmountText, Banner, Button, InfoTip, Segmented, Table } from '../../../ui';
import { canInclude, filterRows, flaggedColumns, rowDisplay, summarize, visibleIssues, type CellColumn, type PreviewFilter } from '../logic';

export interface StepPreviewProps {
  preview: ImportPreviewResult;
  mapping: ColumnMapping;
  currency: Currency;
  include: ReadonlySet<number>;
  onToggle: (index: number, on: boolean) => void;
}

const PAGE = 20;
const MORE = 50;

/** Paso 3 · qué se va a importar: resumen, totales, opciones nuevas y las filas con sus problemas. */
export function StepPreview({ preview, mapping, currency, include, onToggle }: StepPreviewProps) {
  const t = useT();
  const [filter, setFilter] = useState<PreviewFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const summary = summarize(preview.rows, include);
  const rows = filterRows(preview.rows, filter, include);
  const visible = rows.slice(0, shown);
  const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDate(iso, getLocale()) : iso);

  const issueLabel = (code: string) => {
    const key = `import.issue.${code}`;
    const text = t(key);
    return text === key || text.startsWith('⟦') ? t('import.issue.other') : text;
  };

  const flag = (row: ImportPreviewRow, column: CellColumn, text: string, content: ReactNode) => {
    const flagged = flaggedColumns(row).has(column) && (row.status === 'error' || row.status === 'warning');
    if (!flagged) return content;
    const why = visibleIssues(row).map(issueLabel).join(' · ');
    return (
      <span className="imp-cell imp-cell--warn" title={`${text}: ${why}`}>
        {content === '' || content === null ? '—' : content}
      </span>
    );
  };

  const statusText = (row: ImportPreviewRow): string => {
    if (row.status === 'duplicate' && row.duplicateOf !== null) {
      return t('import.prev.dupOf', { seq: row.duplicateOf.seq, date: formatDate(row.duplicateOf.date, getLocale()) });
    }
    if (row.status === 'opening_suspect') return row.opening !== null ? t('import.prev.willOpening') : t('import.prev.skipped');
    const issues = visibleIssues(row);
    if (issues.length > 0) return issues.map(issueLabel).join(' · ');
    return t(`import.status.${row.status}`);
  };

  return (
    <div className="imp-stack">
      <div className="imp-summary" aria-live="polite">
        <p className="imp-summary__line num" data-testid="preview-summary">
          {t('import.prev.summary', { ok: summary.ok + summary.opening, warn: summary.warning })}
          {summary.duplicate > 0 ? ` · ${t('import.prev.summaryDup', { n: summary.duplicate })}` : ''}
          {summary.error > 0 ? ` · ${t('import.prev.summaryErr', { n: summary.error })}` : ''}
        </p>
        <InfoTip label={t('import.cols.dateFormat')}>
          {t(`import.date.${preview.resolved.dateFormat}`)} · {t(`import.locale.${preview.resolved.amountLocale === 'es-ES' ? 'es-ES' : 'es-DO'}`)}
        </InfoTip>
      </div>

      <dl className="imp-totals">
        <div>
          <dt>{t('import.prev.totals.in')}</dt>
          <dd>
            <AmountText minor={preview.totals.inMinor} kind="income" size="l" currency={currency} />
          </dd>
        </div>
        <div>
          <dt>{t('import.prev.totals.out')}</dt>
          <dd>
            <AmountText minor={preview.totals.outMinor} kind="expense" size="l" currency={currency} />
          </dd>
        </div>
        {preview.totals.openingMinor !== 0 ? (
          <div>
            <dt>{t('import.prev.totals.opening')}</dt>
            <dd>
              <AmountText minor={preview.totals.openingMinor} kind="opening" size="l" currency={currency} />
            </dd>
          </div>
        ) : null}
      </dl>

      {preview.accountHasOpening && summary.opening > 0 ? <p className="imp-note">{t('import.prev.accountOpening')}</p> : null}

      {preview.newOptions.length > 0 ? (
        <details className="imp-newopts">
          <summary>{t('import.prev.newOptions', { n: preview.newOptions.length })}</summary>
          <ul role="list">
            {preview.newOptions.map((o) => (
              <li key={`${o.fieldId}|${o.label}`}>
                <span>{t('import.prev.newOptionRow', { label: o.label, rows: o.rowCount })}</span>
                {o.similar.length > 0 ? <span className="imp-note"> · {t('import.prev.newOptionSimilar', { similar: o.similar.map((s) => s.label).join(', ') })}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="imp-filter">
      <Segmented<PreviewFilter>
        label={t('import.prev.filter')}
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setShown(PAGE);
        }}
        options={[
          { value: 'all', label: t('import.prev.filter.all') },
          { value: 'problems', label: t('import.prev.filter.problems') },
          { value: 'duplicates', label: t('import.prev.filter.duplicates') },
          { value: 'selected', label: t('import.prev.filter.selected') },
        ]}
      />
      </div>

      <Table
        variant="summary"
        caption={t('import.prev.table')}
        rows={visible}
        rowKey={(r) => String(r.index)}
        isVoided={(r) => r.status === 'duplicate' && !include.has(r.index)}
        empty={t('import.prev.none')}
        columns={[
          {
            key: 'inc',
            header: t('import.prev.col.include'),
            width: '4rem',
            render: (r) => (
              <label className="imp-check">
                <input
                  type="checkbox"
                  checked={include.has(r.index)}
                  disabled={!canInclude(r)}
                  aria-label={t('import.prev.include', { n: r.index + 1 })}
                  onChange={(e) => onToggle(r.index, e.currentTarget.checked)}
                />
              </label>
            ),
          },
          { key: 'row', header: t('import.prev.col.row'), numeric: true, width: '3.5rem', render: (r) => r.index + 1, hideStacked: true },
          {
            key: 'date',
            header: t('import.prev.col.date'),
            width: '8rem',
            render: (r) => flag(r, 'date', t('import.prev.col.date'), fmtDate(rowDisplay(r, mapping).date)),
          },
          {
            key: 'desc',
            header: t('import.prev.col.desc'),
            grow: true,
            render: (r) => flag(r, 'description', t('import.prev.col.desc'), rowDisplay(r, mapping).description),
          },
          {
            key: 'in',
            header: t('import.prev.col.in'),
            align: 'end',
            render: (r) =>
              r.draft !== null && r.draft.kind === 'income' ? (
                <AmountText minor={r.draft.amountMinor} kind="income" notation="columns" size="table" symbol={false} currency={currency} />
              ) : (
                flag(r, 'amount', t('import.prev.col.in'), null)
              ),
          },
          {
            key: 'out',
            header: t('import.prev.col.out'),
            align: 'end',
            render: (r) =>
              r.draft !== null && r.draft.kind === 'expense' ? (
                <AmountText minor={r.draft.amountMinor} kind="expense" notation="columns" size="table" symbol={false} currency={currency} />
              ) : null,
          },
          {
            key: 'status',
            header: t('import.prev.col.status'),
            render: (r) => <span className={`imp-status imp-status--${r.status}`}>{statusText(r)}</span>,
          },
        ]}
      />

      <div className="imp-more">
        <span className="imp-note num">{t('import.prev.count', { shown: visible.length, total: rows.length })}</span>
        {rows.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((n) => n + MORE)}>
            {t('import.prev.more', { n: Math.min(MORE, rows.length - shown) })}
          </Button>
        ) : null}
      </div>

      {summary.error > 0 ? <Banner tone="info">{t('import.prev.errorRows')}</Banner> : null}
    </div>
  );
}
