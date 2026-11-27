// P-04 Cuentas (DESIGN §10.4). Móvil: grupos por tipo con subtotal y total general. Escritorio: tabla con orden
// manual arrastrando el asa; con teclado, ↑/↓ sobre el asa o Subir/Bajar en el menú de la fila.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ChevronRight, GripVertical, Pencil, Plus, Scale } from 'lucide-react';
import type { AccountWithBalance, Currency, Id } from '../../../core';
import { useAccounts, useDashboard, useSummary, useWorkspace, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { atLeast, useBreakpoint } from '../../../app/state/breakpoint';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import {
  ACCOUNT_ICON,
  AmountText,
  Banner,
  Button,
  DEFAULT_CURRENCY,
  EmptyState,
  InfoTip,
  ListRow,
  Menu,
  Skeleton,
  Sparkline,
  Table,
  Total,
  type MenuItem,
  type TableColumn,
} from '../../../ui';
import { dropSlot, fullOrder, groupByType, moveBy, moveTo, slotToIndex, splitArchived, totalOf } from '../logic/accounts';
import { AccountDialog, type AccountDialogProps } from './AccountForms';
import '../accounts.css';

type DialogMode = AccountDialogProps['mode'];

export function Component() {
  const t = useT();
  const ws = useWorkspaceId();
  const accounts = useAccounts({ includeArchived: true });
  const currency = useWorkspace().data?.currency ?? DEFAULT_CURRENCY;
  const wide = atLeast(useBreakpoint(), 'expanded');
  const [dialog, setDialog] = useState<DialogMode>(null);
  const trends = useTrends();
  const [announce, setAnnounce] = useState('');

  const { active, archived } = useMemo(() => splitArchived(accounts.data ?? []), [accounts.data]);
  // Orden local mientras el núcleo guarda: la fila no salta de vuelta.
  const [order, setOrder] = useState<Id[] | null>(null);
  useEffect(() => setOrder(null), [accounts.data]);
  const ordered = useMemo(() => {
    if (order === null) return active;
    const byId = new Map(active.map((a) => [a.id, a]));
    return order.flatMap((id) => byId.get(id) ?? []);
  }, [active, order]);

  const reorder = useCuadraMutation(async (c, ids: Id[]) => {
    await c.accounts.reorder(ws, ids);
    return { value: ids, warnings: [], auditActionId: null };
  });
  const archive = useCuadraMutation((c, a: AccountWithBalance) => c.accounts.archive(a.id), {
    successToast: (_, a) => ({ key: 'accounts.toast.archived', params: { name: a.name } }),
    undo: (c, a) => c.accounts.unarchive(a.id),
  });
  const unarchive = useCuadraMutation((c, a: AccountWithBalance) => c.accounts.unarchive(a.id), {
    successToast: (_, a) => ({ key: 'accounts.toast.unarchived', params: { name: a.name } }),
  });

  const applyOrder = (ids: Id[], moved: AccountWithBalance) => {
    const before = ordered.map((a) => a.id);
    if (ids.join() === before.join()) return;
    setOrder(ids);
    reorder.mutate(fullOrder(ids, archived));
    // Guía drag-and-drop: anunciar la nueva posición con un pequeño retraso para que el foco no lo tape.
    setAnnounce('');
    window.setTimeout(() => setAnnounce(t('accounts.order.moved', { name: moved.name, pos: ids.indexOf(moved.id) + 1, n: ids.length })), 500);
  };
  const move = (a: AccountWithBalance, delta: number) => applyOrder(moveBy(ordered.map((x) => x.id), a.id, delta), a);

  const actionsFor = (a: AccountWithBalance, index: number): MenuItem[] => [
    { id: 'edit', label: t('accounts.action.edit'), icon: Pencil, onSelect: () => setDialog({ kind: 'edit', account: a }) },
    { id: 'opening', label: t('accounts.action.opening'), icon: Scale, onSelect: () => setDialog({ kind: 'opening', account: a }) },
    { id: 'up', label: t('accounts.action.up'), icon: ArrowUp, disabled: index === 0, onSelect: () => move(a, -1) },
    { id: 'down', label: t('accounts.action.down'), icon: ArrowDown, disabled: index === ordered.length - 1, onSelect: () => move(a, 1) },
    { id: 'archive', label: t('accounts.action.archive'), icon: Archive, tone: 'danger', onSelect: () => archive.mutate(a) },
  ];

  let body;
  if (accounts.isPending) body = <Skeleton rows={6} />;
  else if (accounts.isError)
    body = (
      <Banner tone="warn" title={t('accounts.error.load')} action={<Button onClick={() => void accounts.refetch()}>{t('accounts.retry')}</Button>} />
    );
  else if (active.length === 0 && archived.length === 0)
    body = (
      <EmptyState
        message={t('accounts.empty')}
        action={
          <Button variant="secondary" icon={Plus} onClick={() => setDialog({ kind: 'create' })}>
            {t('accounts.new')}
          </Button>
        }
      />
    );
  else
    body = (
      <>
        {wide ? (
          <AccountsTable accounts={ordered} currency={currency} trends={trends} actionsFor={actionsFor} onMove={applyOrder} onKeyMove={move} />
        ) : (
          <AccountsList accounts={ordered} currency={currency} trends={trends} actionsFor={actionsFor} onNew={() => setDialog({ kind: 'create' })} />
        )}
        {archived.length > 0 ? (
          <details className="acc-archived">
            <summary>
              <ChevronRight aria-hidden="true" className="acc-archived__chev" />
              {t('accounts.archived', { n: archived.length })}
            </summary>
            <div role="list" className="ui-ledger ruled">
              {archived.map((a) => (
                <div role="listitem" key={a.id}>
                  <ListRow
                    title={a.name}
                    meta={t(`accounts.type.${a.type}`)}
                    icon={ACCOUNT_ICON[a.type]}
                    muted
                    trailing={<AmountText minor={a.balanceMinor} currency={currency} />}
                    actions={[{ id: 'restore', label: t('accounts.action.unarchive'), icon: ArchiveRestore, onSelect: () => unarchive.mutate(a) }]}
                  />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </>
    );

  return (
    <div className="acc">
      <header className="acc-head">
        <h1>{t('accounts.title')}</h1>
        {wide && (active.length > 0 || archived.length > 0) ? (
          <Button variant="secondary" icon={Plus} onClick={() => setDialog({ kind: 'create' })}>
            {t('accounts.new')}
          </Button>
        ) : null}
      </header>
      {body}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      <AccountDialog mode={dialog} currency={currency} onClose={() => setDialog(null)} />
    </div>
  );
}

// ── Tendencia (30 días) y movimientos del periodo ──────────────────────────────────────

interface Trends {
  series: Record<Id, readonly number[]>;
  counts: Record<Id, number>;
}

function useTrends(): Trends {
  const dash = useDashboard({ period: { preset: 'last_30_days' }, seriesUnit: 'day', months: 1, recentLimit: 0, topLimit: 1 });
  const summary = useSummary({ filter: { period: { preset: 'last_30_days' } }, groupBy: { by: 'account' } });
  return useMemo(() => {
    const counts: Record<Id, number> = {};
    for (const g of summary.data?.groups ?? []) if (g.key !== null) counts[g.key] = g.count;
    return { series: dash.data?.series.byAccount ?? {}, counts };
  }, [dash.data, summary.data]);
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`))
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}

function trendLabel(t: ReturnType<typeof useT>, values: readonly number[]): string {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined) return t('accounts.trend.none');
  return t(last > first ? 'accounts.trend.up' : last < first ? 'accounts.trend.down' : 'accounts.trend.flat');
}

function NegativeTip() {
  const t = useT();
  return (
    <InfoTip tone="warn" label={t('accounts.negative.label')}>
      {t('accounts.negative.tip')}
    </InfoTip>
  );
}

// ── Móvil: grupos por tipo ───────────────────────────────────────────────────────────

interface ViewProps {
  accounts: AccountWithBalance[];
  currency: Currency;
  trends: Trends;
  actionsFor: (a: AccountWithBalance, index: number) => MenuItem[];
}

function AccountsList({ accounts, currency, trends, actionsFor, onNew }: ViewProps & { onNew: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const ws = useWorkspaceId();
  const groups = groupByType(accounts);
  return (
    <div className="acc-list">
      {groups.map((g) => (
        <section key={g.type} className="acc-group" aria-labelledby={`acc-g-${g.type}`}>
          <header className="acc-group__head">
            <h2 id={`acc-g-${g.type}`}>{t(`accounts.group.${g.type}`)}</h2>
            <AmountText minor={g.subtotalMinor} currency={currency} size="m" rule="single" />
          </header>
          <div role="list" className="ui-ledger ruled">
            {g.accounts.map((a) => {
              const index = accounts.indexOf(a);
              const values = trends.series[a.id] ?? [];
              return (
                <div role="listitem" key={a.id} className="acc-row">
                  <ListRow
                    title={a.name}
                    name={a.name}
                    icon={ACCOUNT_ICON[a.type]}
                    meta={
                      a.isNegative ? (
                        <span className="acc-neg">{t('accounts.negative.label')}</span>
                      ) : a.lastMovementDate === null ? (
                        t('accounts.meta.noMovements')
                      ) : (
                        t('accounts.meta.last', { date: shortDate(a.lastMovementDate) })
                      )
                    }
                    trailing={
                      <span className="acc-trail">
                        {values.length > 1 ? (
                          <span className="acc-spark">
                            <Sparkline values={values} label={trendLabel(t, values)} />
                          </span>
                        ) : null}
                        <AmountText minor={a.balanceMinor} currency={currency} />
                      </span>
                    }
                    onOpen={() => void navigate(`/e/${ws}/cuentas/${a.id}`)}
                    actions={actionsFor(a, index).filter((m) => m.disabled !== true).map((m) => ({ ...m, tone: m.tone ?? 'default' }))}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className="acc-foot">
        <Total label={t('accounts.total')} minor={totalOf(accounts)} currency={currency} />
        <button type="button" className="acc-new-row" onClick={onNew}>
          <Plus aria-hidden="true" />
          <span>{t('accounts.new')}</span>
        </button>
      </div>
    </div>
  );
}

// ── Escritorio: tabla con orden manual ──────────────────────────────────────────────────

interface DragState {
  id: Id;
  from: number;
  pointerId: number;
  midpoints: number[];
  slot: number;
}

function AccountsTable({
  accounts,
  currency,
  trends,
  actionsFor,
  onMove,
  onKeyMove,
}: ViewProps & { onMove: (ids: Id[], moved: AccountWithBalance) => void; onKeyMove: (a: AccountWithBalance, delta: number) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const ws = useWorkspaceId();
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marker, setMarker] = useState<number | null>(null);
  const focusAfter = useRef<Id | null>(null);

  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    wrap.current?.querySelector<HTMLButtonElement>(`[data-handle="${id}"]`)?.focus({ preventScroll: true });
  });

  const rows = () => Array.from(wrap.current?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []);
  const markerFor = (slot: number): number | null => {
    const host = wrap.current?.getBoundingClientRect();
    const list = rows();
    if (host === undefined || list.length === 0) return null;
    const ref = list[slot] ?? list.at(-1);
    if (ref === undefined) return null;
    const r = ref.getBoundingClientRect();
    return (slot < list.length ? r.top : r.bottom) - host.top;
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, a: AccountWithBalance, index: number) => {
    if (e.button !== 0 || drag !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const midpoints = rows().map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    document.documentElement.classList.add('acc-dragging');
    setDrag({ id: a.id, from: index, pointerId: e.pointerId, midpoints, slot: index });
    setMarker(markerFor(index));
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag === null || e.pointerId !== drag.pointerId) return;
    const slot = dropSlot(drag.midpoints, e.clientY);
    if (slot !== drag.slot) {
      setDrag({ ...drag, slot });
      setMarker(markerFor(slot));
    }
  };
  const end = (commit: boolean) => {
    document.documentElement.classList.remove('acc-dragging');
    if (drag !== null && commit) {
      const to = slotToIndex(drag.from, drag.slot);
      const moved = accounts[drag.from];
      if (to !== drag.from && moved !== undefined) {
        focusAfter.current = moved.id;
        onMove(moveTo(accounts.map((a) => a.id), drag.from, to), moved);
      }
    }
    setDrag(null);
    setMarker(null);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, a: AccountWithBalance) => {
    if (e.key === 'Escape' && drag !== null) {
      e.preventDefault();
      end(false);
      return;
    }
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    focusAfter.current = a.id;
    onKeyMove(a, delta);
  };

  const columns: TableColumn<AccountWithBalance>[] = [
    {
      key: 'handle',
      header: t('accounts.col.order'),
      width: '3rem',
      render: (a, i) => (
        <button
          type="button"
          className="acc-handle"
          data-handle={a.id}
          aria-label={t('accounts.order.handle', { name: a.name })}
          aria-describedby="acc-order-hint"
          aria-pressed={drag?.id === a.id ? true : undefined}
          onPointerDown={(e) => onPointerDown(e, a, i)}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => e.pointerId === drag?.pointerId && end(true)}
          onPointerCancel={() => end(false)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => onHandleKey(e, a)}
        >
          <GripVertical aria-hidden="true" />
        </button>
      ),
    },
    {
      key: 'name',
      header: t('accounts.col.account'),
      grow: true,
      render: (a) => {
        const Icon = ACCOUNT_ICON[a.type];
        return (
          <span className="acc-name">
            <Icon aria-hidden="true" />
            <Link to={`/e/${ws}/cuentas/${a.id}`} className="acc-name__link truncate" onClick={(e) => e.stopPropagation()}>
              {a.name}
            </Link>
            {a.isNegative ? <NegativeTip /> : null}
          </span>
        );
      },
    },
    { key: 'type', header: t('accounts.col.type'), width: '9rem', render: (a) => t(`accounts.type.${a.type}`) },
    {
      key: 'count',
      header: t('accounts.col.count'),
      align: 'end',
      numeric: true,
      width: '9rem',
      render: (a) => trends.counts[a.id] ?? 0,
    },
    {
      key: 'balance',
      header: t('accounts.col.balance'),
      align: 'end',
      numeric: true,
      width: '11rem',
      render: (a) => <AmountText minor={a.balanceMinor} currency={currency} size="table" notation="parens" />,
      footer: <AmountText minor={totalOf(accounts)} currency={currency} size="table" notation="parens" rule="double" />,
    },
    {
      key: 'trend',
      header: t('accounts.col.trend'),
      width: '6rem',
      render: (a) => {
        const values = trends.series[a.id] ?? [];
        return values.length > 1 ? <Sparkline values={values} label={trendLabel(t, values)} /> : null;
      },
    },
    {
      key: 'actions',
      header: t('accounts.col.actions'),
      width: '3.5rem',
      render: (a, i) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu label={t('accounts.action.menu', { name: a.name })} items={actionsFor(a, i)} />
        </span>
      ),
    },
  ];
  columns[1]!.footer = <span className="acc-foot-label">{t('accounts.total')}</span>;

  return (
    <div ref={wrap} className="acc-table" data-dragging={drag === null ? undefined : ''}>
      <Table
        variant="ledger"
        caption={t('accounts.title')}
        columns={columns}
        rows={accounts}
        rowKey={(a) => a.id}
        onRowClick={(a) => void navigate(`/e/${ws}/cuentas/${a.id}`)}
        footer
        selectedKey={drag?.id ?? null}
      />
      {marker === null ? null : <span className="acc-drop" style={{ insetBlockStart: `${marker}px` }} aria-hidden="true" />}
      <p id="acc-order-hint" className="visually-hidden">
        {t('accounts.order.hint')}
      </p>
    </div>
  );
}
