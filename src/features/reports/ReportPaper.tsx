// El documento del informe: encabezado, estado por cuenta, reparto por campos, transferencias y movimientos.
// Se pinta igual en pantalla (hoja sobre fondo hundido) y al imprimir (`@media print` en reports.css).
import { useId, type ReactNode } from 'react';
import type { Account, Currency, ReportDocument, StatementLine, SummaryGroup, TransactionRow } from '../../core';
import { toIsoDate } from '../../core';
import { useT } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { AmountText, EmptyState, Table, type TableColumn } from '../../ui';
import { filterLines, hasSection, joinNames } from './model';

export interface ReportPaperProps {
  doc: ReportDocument;
  /** Título del informe (nombre de la vista guardada o «Informe resumido»). */
  title: string;
  /** Línea bajo el título cuando éste es el nombre de una vista guardada. */
  kindLine?: string | undefined;
}

const isZeroLine = (l: StatementLine) => Object.values(l).every((v) => v === 0);

/** ¿Hay algo que mostrar? Un informe sin cuentas con cifras no tiene estado que contar. */
export function isEmptyReport(doc: ReportDocument): boolean {
  return doc.byAccount.every((l) => isZeroLine(l)) && isZeroLine(doc.statement);
}

function issued(at: string): { date: string; time: string } {
  const d = new Date(at);
  return {
    date: formatDate(toIsoDate(d)),
    time: new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit' }).format(d),
  };
}

function periodRange(doc: ReportDocument): string | null {
  const { from, to } = doc.meta.period;
  if (from === null || to === null || from === to) return null;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

/** Título del documento: «Informe resumido por Categoría y Centro». */
export function documentTitle(t: (k: string, p?: Record<string, string | number>) => string, doc: ReportDocument): string {
  const base = t(doc.meta.form === 'detailed' ? 'docTitle.detailed' : 'docTitle.summary');
  const names = doc.byField.map((b) => b.field.label);
  return names.length === 0 ? base : t('docTitle.by', { title: base, fields: joinNames(names) });
}

export function ReportPaper({ doc, title, kindLine }: ReportPaperProps) {
  const t = useT('reports');
  const titleId = useId();
  const { currency } = doc.meta;
  const emitted = issued(doc.meta.generatedAt);
  const range = periodRange(doc);
  const filters = filterLines(doc.meta.filterDescription);
  const accountName = new Map(doc.accounts.map((a) => [a.id, a.name]));
  const name = (id: string) => accountName.get(id) ?? '';
  const empty = isEmptyReport(doc);
  const showStatement = hasSection(doc.recipe, 'statement') || hasSection(doc.recipe, 'by_account');

  return (
    <article className="rep-paper" aria-labelledby={titleId}>
      <div className="rep-paper__body">
        <header className="rep-head">
          <p className="rep-head__space">{doc.meta.workspaceName}</p>
          {doc.meta.ownerName === '' ? null : <p className="rep-head__owner">{t('doc.owner', { name: doc.meta.ownerName })}</p>}
          <h1 id={titleId} className="rep-head__title">
            {title}
          </h1>
          {kindLine === undefined ? null : <p className="rep-head__kind">{kindLine}</p>}
          <p className="rep-head__period">
            <strong>{doc.meta.period.label}</strong>
            {range === null ? null : <span className="num"> · {range}</span>}
          </p>
          {filters.length === 0 ? null : <p className="rep-head__filters">{filters.join(' · ')}</p>}
          <p className="rep-head__issued">{t('doc.issued', emitted)}</p>
        </header>

        {empty ? (
          <EmptyState variant="no-results" message={t('doc.empty')} rows={3} />
        ) : (
          <>
            {showStatement ? <StatementTable doc={doc} currency={currency} t={t} /> : null}
            {doc.byField.map(({ field, groups }) => (
              <GroupsTable key={field.id} label={field.label} groups={groups} currency={currency} t={t} />
            ))}
            {hasSection(doc.recipe, 'transfers') && doc.transfers.length > 0 ? (
              <TransfersTable doc={doc} name={name} t={t} />
            ) : null}
            {doc.movements === null ? null : <MovementsTable rows={doc.movements} doc={doc} accounts={doc.accounts} t={t} />}
            {doc.voided === null || doc.voided.length === 0 ? null : <VoidedTable rows={doc.voided} doc={doc} name={name} t={t} />}
          </>
        )}

        {doc.signature ? (
          <footer className="rep-sign">
            <span className="rep-sign__line" />
            <span className="rep-sign__label">{t('doc.signature')}</span>
          </footer>
        ) : null}
      </div>
    </article>
  );
}

type T = (k: string, p?: Record<string, string | number>) => string;

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rep-section">
      <h2 className="rep-section__title">{title}</h2>
      {children}
    </section>
  );
}

const Amount = ({ minor, currency, kind, rule, voided }: { minor: number; currency: Currency; kind?: 'income' | 'expense' | 'transfer'; rule?: 'single' | 'double'; voided?: boolean }) => (
  <AmountText
    minor={minor}
    currency={currency}
    size="table"
    symbol={false}
    notation={kind === undefined ? 'parens' : 'columns'}
    {...(kind === undefined || minor === 0 ? { neutral: true } : { kind })}
    {...(rule === undefined ? {} : { rule })}
    {...(voided === true ? { voided: true } : {})}
  />
);

// ── Estado por cuenta ───────────────────────────────────────────────────────────────────

type StatementRow = { id: string; name: string; line: StatementLine; total: boolean };

function StatementTable({ doc, currency, t }: { doc: ReportDocument; currency: Currency; t: T }) {
  const rows: StatementRow[] = doc.byAccount
    .filter((a) => !isZeroLine(a) || a.account.archivedAt === null)
    .map((a) => ({ id: a.account.id, name: a.account.name, line: a, total: false }));
  const s = doc.statement;
  const withTransfers = doc.byAccount.some((a) => a.transfersInMinor !== 0 || a.transfersOutMinor !== 0);
  // «Saldo inicial» junta lo anterior al periodo y los saldos iniciales fechados dentro (línea propia en el núcleo).
  const opening = (l: StatementLine) => l.periodOpeningMinor + l.openingsInPeriodMinor;
  const net = (l: StatementLine) => l.transfersInMinor - l.transfersOutMinor;
  const col = (key: string, header: string, pick: (l: StatementLine) => number, kind?: 'income' | 'expense'): TableColumn<StatementRow> => ({
    key,
    header,
    align: 'end',
    numeric: true,
    render: (r) => <Amount minor={pick(r.line)} currency={currency} {...(kind === undefined ? {} : { kind })} />,
    footer: <Amount minor={pick(s)} currency={currency} rule="double" {...(kind === undefined ? {} : { kind })} />,
  });
  const columns: TableColumn<StatementRow>[] = [
    { key: 'account', header: t('doc.col.account'), grow: true, render: (r) => r.name, footer: t('doc.total') },
    col('opening', t('doc.col.opening'), opening),
    col('in', t('doc.col.in'), (l) => l.inMinor, 'income'),
    col('out', t('doc.col.out'), (l) => l.outMinor, 'expense'),
    ...(withTransfers ? [col('xfer', t('doc.col.transfers'), net)] : []),
    col('closing', t('doc.col.closing'), (l) => l.closingMinor),
  ];
  return (
    <Section title={t('doc.statement')}>
      <Table variant="summary" caption={t('doc.statement')} columns={columns} rows={rows} rowKey={(r) => r.id} footer className="rep-table" />
    </Section>
  );
}

// ── Reparto por campo ───────────────────────────────────────────────────────────────────

function GroupsTable({ label, groups, currency, t }: { label: string; groups: SummaryGroup[]; currency: Currency; t: T }) {
  const rows = groups.filter((g) => g.count > 0 || g.inMinor !== 0 || g.outMinor !== 0);
  if (rows.length === 0) return null;
  const sum = (pick: (g: SummaryGroup) => number) => rows.reduce((acc, g) => acc + pick(g), 0);
  const columns: TableColumn<SummaryGroup>[] = [
    {
      key: 'group',
      header: label,
      grow: true,
      render: (g) => (
        <>
          {g.label}
          {g.inactive ? <span className="rep-inactive"> {t('doc.inactive')}</span> : null}
        </>
      ),
      footer: t('doc.total'),
    },
    {
      key: 'in',
      header: t('doc.col.in'),
      align: 'end',
      numeric: true,
      render: (g) => <Amount minor={g.inMinor} currency={currency} kind="income" />,
      footer: <Amount minor={sum((g) => g.inMinor)} currency={currency} kind="income" rule="double" />,
    },
    {
      key: 'out',
      header: t('doc.col.out'),
      align: 'end',
      numeric: true,
      render: (g) => <Amount minor={g.outMinor} currency={currency} kind="expense" />,
      footer: <Amount minor={sum((g) => g.outMinor)} currency={currency} kind="expense" rule="double" />,
    },
    {
      key: 'net',
      header: t('doc.col.net'),
      align: 'end',
      numeric: true,
      render: (g) => <Amount minor={g.netMinor} currency={currency} />,
      footer: <Amount minor={sum((g) => g.netMinor)} currency={currency} rule="double" />,
    },
    {
      key: 'count',
      header: t('doc.col.count'),
      align: 'end',
      numeric: true,
      hideStacked: true,
      render: (g) => g.count,
      footer: sum((g) => g.count),
    },
  ];
  const caption = t('doc.byField', { field: label });
  return (
    <Section title={caption}>
      <Table variant="summary" caption={caption} columns={columns} rows={rows} rowKey={(g) => g.key ?? '∅'} footer className="rep-table" />
    </Section>
  );
}

// ── Transferencias ──────────────────────────────────────────────────────────────────────

function TransfersTable({ doc, name, t }: { doc: ReportDocument; name: (id: string) => string; t: T }) {
  // Dos transferencias iguales el mismo día son posibles: la clave es la posición (la lista no se reordena).
  const rows = doc.transfers.map((x, i) => ({ ...x, rowId: String(i) }));
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: 'date', header: t('doc.col.date'), numeric: true, render: (x) => formatDate(x.date) },
    { key: 'from', header: t('doc.col.from'), render: (x) => name(x.fromAccountId) },
    { key: 'to', header: t('doc.col.to'), render: (x) => name(x.toAccountId) },
    { key: 'desc', header: t('doc.col.concept'), grow: true, render: (x) => x.description },
    { key: 'amt', header: t('doc.col.amount'), align: 'end', numeric: true, render: (x) => <Amount minor={x.amountMinor} currency={doc.meta.currency} kind="transfer" /> },
  ];
  return (
    <Section title={t('doc.transfers')}>
      <Table variant="summary" caption={t('doc.transfers')} columns={columns} rows={rows} rowKey={(x) => x.rowId} className="rep-table" />
    </Section>
  );
}

// ── Movimientos ─────────────────────────────────────────────────────────────────────────

function conceptOf(r: TransactionRow, accounts: Account[], t: T) {
  const other = r.counterpart === null ? '' : (accounts.find((a) => a.id === r.counterpart?.accountId)?.name ?? '');
  const tag =
    r.kind === 'transfer'
      ? t(r.direction === 'out' ? 'doc.xferTo' : 'doc.xferFrom', { name: other })
      : r.kind === 'opening'
        ? t('doc.opening')
        : null;
  return (
    <>
      {r.description}
      {tag === null ? null : <span className="rep-tag">{tag}</span>}
    </>
  );
}

function MovementsTable({ rows, doc, accounts, t }: { rows: TransactionRow[]; doc: ReportDocument; accounts: Account[]; t: T }) {
  const { currency } = doc.meta;
  const hasBalance = rows.some((r) => r.runningMinor !== null);
  const multi = new Set(rows.map((r) => r.accountId)).size > 1;
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const columns: TableColumn<TransactionRow>[] = [
    { key: 'date', header: t('doc.col.date'), numeric: true, render: (r) => formatDate(r.date) },
    { key: 'seq', header: t('doc.col.seq'), numeric: true, hideStacked: true, render: (r) => String(r.seq).padStart(4, '0') },
    ...(multi ? [{ key: 'account', header: t('doc.col.account'), hideStacked: false, render: (r: TransactionRow) => name(r.accountId) }] : []),
    { key: 'desc', header: t('doc.col.concept'), grow: true, render: (r) => conceptOf(r, accounts, t) },
    {
      key: 'in',
      header: t('doc.col.in'),
      align: 'end',
      numeric: true,
      render: (r) => (r.direction === 'in' ? <Amount minor={r.amountMinor} currency={currency} kind={r.kind === 'transfer' ? 'transfer' : 'income'} /> : null),
    },
    {
      key: 'out',
      header: t('doc.col.out'),
      align: 'end',
      numeric: true,
      render: (r) => (r.direction === 'out' ? <Amount minor={r.amountMinor} currency={currency} kind={r.kind === 'transfer' ? 'transfer' : 'expense'} /> : null),
    },
    ...(hasBalance
      ? [{ key: 'balance', header: t('doc.col.balance'), align: 'end' as const, numeric: true, render: (r: TransactionRow) => (r.runningMinor === null ? null : <Amount minor={r.runningMinor} currency={currency} />) }]
      : []),
  ];
  return (
    <Section title={t('doc.movements')}>
      <Table
        variant="ledger"
        caption={t('doc.movements')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        dense
        empty={t('doc.noMovements')}
        className="rep-table rep-table--movements"
      />
    </Section>
  );
}

function VoidedTable({ rows, doc, name, t }: { rows: TransactionRow[]; doc: ReportDocument; name: (id: string) => string; t: T }) {
  const columns: TableColumn<TransactionRow>[] = [
    { key: 'date', header: t('doc.col.date'), numeric: true, render: (r) => formatDate(r.date) },
    { key: 'seq', header: t('doc.col.seq'), numeric: true, hideStacked: true, render: (r) => String(r.seq).padStart(4, '0') },
    { key: 'account', header: t('doc.col.account'), render: (r) => name(r.accountId) },
    { key: 'desc', header: t('doc.col.concept'), grow: true, render: (r) => r.description },
    { key: 'amt', header: t('doc.col.amount'), align: 'end', numeric: true, render: (r) => <Amount minor={r.amountMinor} currency={doc.meta.currency} kind={r.direction === 'in' ? 'income' : 'expense'} voided /> },
    { key: 'why', header: t('doc.col.reason'), render: (r) => r.voidReason ?? '' },
  ];
  return (
    <Section title={t('doc.voided')}>
      <Table variant="ledger" caption={t('doc.voided')} columns={columns} rows={rows} rowKey={(r) => r.id} isVoided={() => true} dense className="rep-table" />
    </Section>
  );
}

