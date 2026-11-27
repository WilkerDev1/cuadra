// Lista de libro virtualizada (ventana completa: la página es quien hace scroll). Móvil: filas por día con
// cabecera pegada y acciones al deslizar. Escritorio: tabla densa con columnas de campos y subtotales por día.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from '@tanstack/react-virtual';
import { systemClock, type Field, type TransactionRow, type TxFilter } from '../../../core';
import { useInfiniteTransactions, useWorkspaceId } from '../../../app/data/hooks';
import { atLeast, useBreakpoint } from '../../../app/state/breakpoint';
import { errorMessage } from '../../../app/data/errorMessage';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { AmountText, Banner, Button, EmptyState, ListRow, Skeleton, amountParts, cx } from '../../../ui';
import { activeDayIndex, collapseTransfers, groupByDay, padSeq, type DayItem, type LedgerItem } from '../logic/days';
import { useCurrency, useLookups } from '../data';
import { dayHeader } from './format';
import { fieldText, RowAmount, useRowActions, useRowText, VoidDialog, type RowCtx } from './rowParts';
import { TotalsBar } from './TotalsBar';

const PAGE = 200;

export interface LedgerViewProps {
  filter: TxFilter;
  /** Estado vacío cuando no hay filtros (primer uso) o con filtros (sin resultados). */
  filtered: boolean;
  onClearFilters?: () => void;
  /** Muestra la barra de totales del filtro. */
  totals?: boolean;
  emptyMessage?: string;
}

export function LedgerView({ filter, filtered, onClearFilters, totals = true, emptyMessage }: LedgerViewProps) {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const currency = useCurrency();
  const { accounts, fields } = useLookups();
  const wide = atLeast(useBreakpoint(), 'expanded');
  const query = useInfiniteTransactions(filter, { limit: PAGE });
  const [voiding, setVoiding] = useState<{ id: string; label: string } | null>(null);

  const single = filter.accountIds?.length === 1;
  const rows = useMemo(() => collapseTransfers(query.data?.pages.flatMap((p) => p.items) ?? [], filter.accountIds), [query.data, filter.accountIds]);
  const items = useMemo(() => groupByDay(rows, { hasMore: query.hasNextPage }), [rows, query.hasNextPage]);
  const firstPage = query.data?.pages[0];
  const ctx: RowCtx = { accounts, fields, currency, singleAccount: single };

  const more = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  if (query.isPending) return <Skeleton rows={8} />;
  if (query.isError)
    return (
      <Banner tone="warn" title={t('ledger.error.load')} action={<Button onClick={() => void query.refetch()}>{t('ledger.retry')}</Button>}>
        {errorMessage(query.error, t)}
      </Banner>
    );

  const open = (row: TransactionRow) => void navigate(`/e/${ws}/movimientos/${row.id}`);
  const list =
    items.length === 0 ? (
      filtered ? (
        <EmptyState
          variant="no-results"
          message={t('ledger.empty.filtered')}
          {...(onClearFilters === undefined ? {} : { action: <Button onClick={onClearFilters}>{t('ledger.filter.clear')}</Button> })}
        />
      ) : (
        <EmptyState
          message={emptyMessage ?? t('ledger.empty.first')}
          action={
            <Button variant="secondary" onClick={() => void navigate(`/e/${ws}/nuevo`)}>
              {t('ledger.empty.firstAction')}
            </Button>
          }
        />
      )
    ) : wide ? (
      <LedgerTable items={items} ctx={ctx} fields={fields} onOpen={open} onEnd={more} />
    ) : (
      <LedgerRows items={items} ctx={ctx} onOpen={open} onEnd={more} onVoid={(r) => setVoiding({ id: r.id, label: r.description })} />
    );

  return (
    <div className="lg-view">
      {totals && firstPage !== undefined ? <TotalsBar totals={firstPage.totals} currency={currency} /> : null}
      {list}
      {query.isFetchingNextPage ? <p className="lg-more">{t('ledger.loadingMore')}</p> : null}
      <VoidDialog target={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

// ── Virtualizador de ventana con margen de scroll medido ─────────────────────────────────

function useScrollMargin() {
  const ref = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setMargin((m) => (Math.abs(m - top) < 1 ? m : top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    if (el.parentElement !== null) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);
  return { ref, margin };
}

function useLedgerVirtualizer(items: LedgerItem[], opts: { margin: number; estimate: number; sticky: boolean; onEnd: () => void }) {
  const dayIndexes = useMemo(() => items.flatMap((it, i) => (it.type === 'day' ? [i] : [])), [items]);
  const active = useRef<number | null>(null);
  const rangeExtractor = useCallback(
    (range: Range) => {
      if (!opts.sticky) return defaultRangeExtractor(range);
      active.current = activeDayIndex(items, dayIndexes, range.startIndex);
      const next = new Set([...(active.current === null ? [] : [active.current]), ...defaultRangeExtractor(range)]);
      return [...next].sort((a, b) => a - b);
    },
    [items, dayIndexes, opts.sticky],
  );
  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => (items[i]?.type === 'day' ? opts.estimate : opts.estimate),
    overscan: 10,
    scrollMargin: opts.margin,
    rangeExtractor,
    getItemKey: (i) => items[i]?.key ?? i,
  });
  const virtual = v.getVirtualItems();
  const last = virtual.at(-1)?.index ?? -1;
  const { onEnd } = opts;
  useEffect(() => {
    if (last >= items.length - 20) onEnd();
  }, [last, items.length, onEnd]);
  return { v, virtual, active };
}

/** Alto de `--fila` en píxeles (cambia con `pointer: fine`). */
function useRowPx(): number {
  const [px, setPx] = useState(56);
  useLayoutEffect(() => {
    const probe = document.createElement('div');
    probe.style.blockSize = 'var(--fila)';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    setPx(probe.getBoundingClientRect().height || 56);
    probe.remove();
  }, []);
  return px;
}

function DayTotal({ day, currency }: { day: DayItem; currency: RowCtx['currency'] }) {
  const t = useT();
  // Un día con solo transferencias o saldos iniciales no tiene neto que mostrar.
  if (day.inMinor === 0 && day.outMinor === 0) return null;
  return (
    <span className="lg-daytotal">
      <span className="lg-daytotal__label">{t('ledger.day.net')}</span>
      <AmountText minor={Math.abs(day.netMinor)} kind={day.netMinor < 0 ? 'expense' : 'income'} currency={currency} />
    </span>
  );
}

// ── Móvil: filas por día ───────────────────────────────────────────────────────────────

function LedgerRows({
  items,
  ctx,
  onOpen,
  onEnd,
  onVoid,
}: {
  items: LedgerItem[];
  ctx: RowCtx;
  onOpen: (row: TransactionRow) => void;
  onEnd: () => void;
  onVoid: (row: TransactionRow) => void;
}) {
  const t = useT();
  const today = systemClock.today();
  const { ref, margin } = useScrollMargin();
  const rowPx = useRowPx();
  const { v, virtual, active } = useLedgerVirtualizer(items, { margin, estimate: rowPx, sticky: true, onEnd });
  const text = useRowText();
  const actions = useRowActions(onVoid);
  // Saldo corrido bajo el monto: texto en --ink-3 (DESIGN §10.5), con el signo menos tipográfico.
  const money = (m: number) => amountParts(m, { locale: getLocale(), currency: ctx.currency }).text;

  return (
    <div ref={ref} role="list" aria-label={t('ledger.list.label')} className="lg-vlist" style={{ blockSize: v.getTotalSize() }}>
      {virtual.map((vi) => {
        const item = items[vi.index];
        if (item === undefined) return null;
        const stuck = vi.index === active.current;
        const style = stuck ? undefined : { transform: `translateY(${vi.start - margin}px)` };
        if (item.type === 'day') {
          return (
            <div
              key={vi.key}
              ref={v.measureElement}
              data-index={vi.index}
              role="listitem"
              className={cx('lg-day', stuck ? 'lg-day--stuck' : 'lg-abs')}
              style={style}
            >
              <span className="lg-day__date" role="heading" aria-level={2}>
                {dayHeader(item.date, today, t)}
              </span>
              <DayTotal day={item} currency={ctx.currency} />
            </div>
          );
        }
        const row = item.row;
        return (
          <div key={vi.key} ref={v.measureElement} data-index={vi.index} role="listitem" className="lg-abs lg-item" style={style}>
            <ListRow
              title={text.title(row)}
              name={text.title(row)}
              meta={text.meta(row, ctx)}
              voided={row.status === 'voided'}
              trailing={<RowAmount row={row} currency={ctx.currency} />}
              {...(ctx.singleAccount && row.runningMinor !== null && row.status === 'active' ? { trailingMeta: money(row.runningMinor) } : {})}
              onOpen={() => onOpen(row)}
              actions={actions(row)}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Escritorio: tabla densa ─────────────────────────────────────────────────────────────

/** «Caja → Banco» bajo el concepto, salvo que el concepto ya lo diga («Transferencia Caja → Banco»). */
function TableSub({ title, sub }: { title: string; sub: string }) {
  if (sub === '' || title.includes(sub)) return null;
  return <span className="lg-t__sub truncate">{sub}</span>;
}

function LedgerTable({
  items,
  ctx,
  fields,
  onOpen,
  onEnd,
}: {
  items: LedgerItem[];
  ctx: RowCtx;
  fields: Field[];
  onOpen: (row: TransactionRow) => void;
  onEnd: () => void;
}) {
  const t = useT();
  const ws = useWorkspaceId();
  const today = systemClock.today();
  const { ref, margin } = useScrollMargin();
  const rowPx = useRowPx();
  const { v, virtual } = useLedgerVirtualizer(items, { margin, estimate: rowPx, sticky: false, onEnd });
  const text = useRowText();
  const listFields = fields.filter((f) => f.showInList && (f.active || items.some((i) => i.type === 'row' && i.row.values[f.id] !== undefined)));
  const colCount = 3 + (ctx.singleAccount ? 0 : 1) + listFields.length + 2 + 1;
  const padTop = virtual.length > 0 ? (virtual[0]?.start ?? margin) - margin : 0;
  const padBottom = virtual.length > 0 ? v.getTotalSize() - ((virtual.at(-1)?.end ?? margin) - margin) : 0;

  // J/K (DESIGN §8.3): mover el foco entre filas; Enter abre (el enlace).
  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== 'j' && e.key !== 'k') return;
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>('a.lg-t__link'));
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = links[i === -1 ? 0 : Math.max(0, Math.min(links.length - 1, i + (e.key === 'j' ? 1 : -1)))];
    if (next !== undefined) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <div ref={ref} className="lg-table">
      <table className="lg-t" onKeyDown={onKey} aria-rowcount={items.length + 1}>
        <caption className="visually-hidden">{t('ledger.list.label')}</caption>
        <thead>
          <tr>
            <th scope="col" className="lg-t__date">{t('ledger.col.date')}</th>
            <th scope="col" className="lg-t__seq is-end">{t('ledger.col.seq')}</th>
            <th scope="col" className="lg-t__concept">{t('ledger.col.concept')}</th>
            {ctx.singleAccount ? null : <th scope="col">{t('ledger.col.account')}</th>}
            {listFields.map((f, i) => (
              <th scope="col" key={f.id} className={cx('lg-t__field', i > 0 && 'lg-t__extra')}>
                {f.label}
              </th>
            ))}
            <th scope="col" className="lg-t__money is-end">{t('ledger.col.in')}</th>
            <th scope="col" className="lg-t__money is-end">{t('ledger.col.out')}</th>
            <th scope="col" className="lg-t__money is-end">{ctx.singleAccount ? t('ledger.col.balance') : t('ledger.col.other')}</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 ? (
            <tr aria-hidden="true" className="lg-t__pad">
              <td colSpan={colCount} style={{ blockSize: padTop }} />
            </tr>
          ) : null}
          {virtual.map((vi) => {
            const item = items[vi.index];
            if (item === undefined) return null;
            if (item.type === 'day') {
              return (
                <tr key={vi.key} ref={v.measureElement} data-index={vi.index} className="lg-t__day" aria-rowindex={vi.index + 2}>
                  <th scope="rowgroup" colSpan={colCount}>
                    <span className="lg-t__dayin">
                      <span>{dayHeader(item.date, today, t)}</span>
                      <DayTotal day={item} currency={ctx.currency} />
                    </span>
                  </th>
                </tr>
              );
            }
            const row = item.row;
            const voided = row.status === 'voided';
            const inCol = row.direction === 'in' && (ctx.singleAccount ? row.kind !== 'opening' : row.kind === 'income');
            const outCol = row.direction === 'out' && (ctx.singleAccount ? row.kind !== 'opening' : row.kind === 'expense');
            const otherCol = !ctx.singleAccount && (row.kind === 'transfer' || row.kind === 'opening');
            return (
              <tr
                key={vi.key}
                ref={v.measureElement}
                data-index={vi.index}
                aria-rowindex={vi.index + 2}
                data-voided={voided || undefined}
                className="lg-t__row"
                onClick={() => onOpen(row)}
              >
                <td className="lg-t__date num">{formatDate(row.date)}</td>
                <td className="lg-t__seq num is-end">{padSeq(row.seq)}</td>
                <td className="lg-t__concept">
                  <Link className="lg-t__link truncate" to={`/e/${ws}/movimientos/${row.id}`} onClick={(e) => e.stopPropagation()}>
                    {text.title(row)}
                  </Link>
                  {voided ? <span className="lg-void">{t('ledger.status.voided')}</span> : null}
                  {row.kind === 'transfer' || row.kind === 'opening' ? <TableSub title={text.title(row)} sub={text.meta(row, { ...ctx, singleAccount: true }).split(' · ')[0] ?? ''} /> : null}
                </td>
                {ctx.singleAccount ? null : <td className="truncate">{ctx.accounts.find((a) => a.id === row.accountId)?.name ?? '—'}</td>}
                {listFields.map((f, i) => (
                  <td key={f.id} className={cx('truncate', i > 0 && 'lg-t__extra')}>
                    {fieldText(row, f, t, formatDate) ?? ''}
                  </td>
                ))}
                <td className="is-end">{inCol ? <AmountText minor={row.amountMinor} currency={ctx.currency} size="table" notation="columns" kind={row.kind} voided={voided} symbol={false} /> : null}</td>
                <td className="is-end">{outCol ? <AmountText minor={row.amountMinor} currency={ctx.currency} size="table" notation="columns" kind={row.kind} voided={voided} symbol={false} /> : null}</td>
                <td className="is-end">
                  {ctx.singleAccount ? (
                    row.runningMinor !== null && !voided ? (
                      <AmountText minor={row.runningMinor} currency={ctx.currency} size="table" notation="parens" symbol={false} />
                    ) : null
                  ) : otherCol ? (
                    <RowAmount row={row} currency={ctx.currency} size="table" />
                  ) : null}
                </td>
              </tr>
            );
          })}
          {padBottom > 0 ? (
            <tr aria-hidden="true" className="lg-t__pad">
              <td colSpan={colCount} style={{ blockSize: padBottom }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
