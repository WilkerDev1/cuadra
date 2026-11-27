// El documento del informe: encabezado, estado por cuenta, reparto por campos, transferencias y movimientos.
// Se pinta igual en pantalla (hoja sobre fondo hundido) y al imprimir (`@media print` en reports.css).
import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { Account, Currency, ReportDocument, StatementLine, SummaryGroup, TransactionRow } from '../../core';
import { toIsoDate } from '../../core';
import { useT } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { AmountText, EmptyState, Table, type TableColumn } from '../../ui';
import { chunkByMonth, filterLines, hasSection, joinNames, lowerFirst, withRunningBalances } from './model';

export interface ReportPaperProps {
  doc: ReportDocument;
  /** Título del informe (nombre de la vista guardada o «Informe resumido»). */
  title: string;
  /** Línea bajo el título cuando éste es el nombre de una vista guardada. */
  kindLine?: string | undefined;
  /** Reducción a escala para que la hoja de Carta quepa en el escenario (tableta). */
  zoom?: number | null | undefined;
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

/** Rango bajo la etiqueta del periodo; se omite si la etiqueta ya es ese mes completo («noviembre 2026»). */
function periodRange(doc: ReportDocument): string | null {
  const { from, to, label } = doc.meta.period;
  if (from === null || to === null || from === to) return null;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const fullMonth = sameMonth && from.endsWith('-01') && to === lastDayOf(to);
  if (fullMonth && /\d{4}/.test(label)) return null;
  if (label.includes(formatDate(from)) && label.includes(formatDate(to))) return null;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

function lastDayOf(iso: string): string {
  const [y = 0, m = 1] = iso.split('-').map(Number);
  return `${iso.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function monthName(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('es-DO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Título del documento: «Informe resumido por Categoría y Centro». */
export function documentTitle(t: (k: string, p?: Record<string, string | number>) => string, doc: ReportDocument): string {
  const base = t(doc.meta.form === 'detailed' ? 'docTitle.detailed' : 'docTitle.summary');
  const names = doc.byField.map((b) => lowerFirst(b.field.label));
  return names.length === 0 ? base : t('docTitle.by', { title: base, fields: joinNames(names) });
}

export const PAPER_WIDTH_REM = 46;
/** Por debajo de este ancho útil (px) la hoja deja de reducirse y las tablas se apilan (teléfono). */
export const PAPER_MIN_FIT_PX = 540;

/** Zoom con el que cabe la hoja en el escenario: `null` = sin reducir (cabe, o es un teléfono y se apila). */
export function paperZoom(stageInnerPx: number, rootFontPx = 16): number | null {
  const paper = PAPER_WIDTH_REM * rootFontPx;
  if (stageInnerPx >= paper || stageInnerPx < PAPER_MIN_FIT_PX) return null;
  return stageInnerPx / paper;
}

export function ReportPaper({ doc, title, kindLine, zoom }: ReportPaperProps) {
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
    <article className="rep-paper" aria-labelledby={titleId} {...(zoom == null ? {} : { 'data-fit': '', style: { '--rep-zoom': zoom } as CSSProperties })}>
      <div className="rep-paper__body">
        <header className="rep-head">
          <p className="rep-head__space">{doc.meta.workspaceName}</p>
          {doc.meta.ownerName.trim() === '' || doc.meta.ownerName.trim().toLowerCase() === doc.meta.workspaceName.trim().toLowerCase() ? null : <p className="rep-head__owner">{t('doc.owner', { name: doc.meta.ownerName })}</p>}
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

const Amount = ({ minor, currency, kind, rule, voided }: { minor: number; currency: Currency; kind?: 'income' | 'expense' | 'transfer'; rule?: 'single' | 'double'; voided?: boolean }) => {
  const amount = (
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
  // En papel no hay color: la transferencia sale entre corchetes para no confundirse con una entrada o salida.
  return kind === 'transfer' ? <span className="rep-xfer">{amount}</span> : amount;
};

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
  const caption = t('doc.byField', { field: lowerFirst(label) });
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

/** Filas por encima de las cuales el detalle se parte por mes para que el navegador solo pinte lo visible. */
const CHUNK_MIN_ROWS = 120;

function MovementsTable({ rows: raw, doc, accounts, t }: { rows: TransactionRow[]; doc: ReportDocument; accounts: Account[]; t: T }) {
  const { currency } = doc.meta;
  const rows = useMemo(() => withRunningBalances(raw, doc.byAccount) ?? raw, [raw, doc.byAccount]);
  const hasBalance = rows.some((r) => r.runningMinor !== null);
  const multi = new Set(rows.map((r) => r.accountId)).size > 1;
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const chunks = rows.length >= CHUNK_MIN_ROWS ? chunkByMonth(rows) : null;
  const byMonth = chunks !== null && chunks.length > 1;
  const columns: TableColumn<TransactionRow>[] = [
    // Partido por meses, el mes y el año ya están en el título de cada tramo: la fecha va corta.
    { key: 'date', header: t('doc.col.date'), numeric: true, width: byMonth ? '4rem' : '6.5rem', render: (r) => (byMonth ? formatDate(r.date).replace(/ \d{4}$/, '') : formatDate(r.date)) },
    { key: 'seq', header: t('doc.col.seq'), numeric: true, hideStacked: true, width: '3.25rem', render: (r) => String(r.seq).padStart(4, '0') },
    ...(multi ? [{ key: 'account', header: t('doc.col.account'), hideStacked: false, width: '6rem', render: (r: TransactionRow) => name(r.accountId) }] : []),
    { key: 'desc', header: t('doc.col.concept'), grow: true, render: (r) => conceptOf(r, accounts, t) },
    {
      key: 'in',
      header: t('doc.col.in'),
      align: 'end',
      numeric: true,
      width: '6.5rem',
      render: (r) => (r.direction === 'in' ? <Amount minor={r.amountMinor} currency={currency} kind={r.kind === 'transfer' ? 'transfer' : 'income'} /> : null),
    },
    {
      key: 'out',
      header: t('doc.col.out'),
      align: 'end',
      numeric: true,
      width: '6.5rem',
      render: (r) => (r.direction === 'out' ? <Amount minor={r.amountMinor} currency={currency} kind={r.kind === 'transfer' ? 'transfer' : 'expense'} /> : null),
    },
    ...(hasBalance
      ? [{ key: 'balance', header: t('doc.col.balance'), align: 'end' as const, numeric: true, width: '7rem', render: (r: TransactionRow) => (r.runningMinor === null ? null : <Amount minor={r.runningMinor} currency={currency} />) }]
      : []),
  ];
  return (
    <Section title={t('doc.movements')}>
      {chunks === null || !byMonth ? (
        <Table variant="ledger" caption={t('doc.movements')} columns={columns} rows={rows} rowKey={(r) => r.id} dense empty={t('doc.noMovements')} className="rep-table rep-table--movements" />
      ) : (
        chunks.map((c) => <MonthChunk key={c.month} month={c.month} rows={c.rows} columns={columns} caption={t('doc.movements')} />)
      )}
    </Section>
  );
}

/** Un mes del detalle: `content-visibility: auto` evita estilo, layout y pintura de los meses fuera de pantalla. */
function MonthChunk({ month, rows, columns, caption }: { month: string; rows: TransactionRow[]; columns: TableColumn<TransactionRow>[]; caption: string }) {
  const label = monthName(month);
  return (
    <div className="rep-chunk" style={{ '--rows': rows.length } as CSSProperties}>
      <h3 className="rep-chunk__title">{label}</h3>
      <Table variant="ledger" caption={`${caption}, ${label}`} columns={columns} rows={rows} rowKey={(r) => r.id} dense className="rep-table rep-table--movements" />
    </div>
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

