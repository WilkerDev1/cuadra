// /e/:wsId/historial — historial general del espacio, agrupado por día. DESIGN 10.12.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useAccounts, useFields, useMoneyFormat, useWorkspace, useWorkspaceId } from '../../../app/data/hooks';
import { useUiStore } from '../../../app/state/uiStore';
import { systemClock } from '../../../core';
import type { AuditEntry } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { Banner, Button, EmptyState, Field, LedgerDay, PeriodPicker, Select, Skeleton } from '../../../ui';
import { EntryRow } from '../EntryRow';
import { downloadCsv, fileName } from '../download';
import { exportTranslate, historyCsv, historySheet } from '../exportAudit';
import {
  dayHeading,
  ACTION_GROUP_KEYS,
  AUDIT_PERIODS,
  ENTITY_TYPES,
  NO_FILTERS,
  filtersFromParams,
  filtersToParams,
  groupByDay,
  isFiltered,
  mergePages,
  toQuery,
  type AuditFilters,
} from '../model';
import '../audit.css';

const PAGE = 50;
const EXPORT_PAGE = 500;
const EXPORT_MAX_PAGES = 40;

export function Component() {
  const t = useT('auditlog');
  const tAll = useT();
  const wsId = useWorkspaceId();
  const cuadra = useCuadra();
  const pushToast = useUiStore((s) => s.pushToast);
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const accounts = useAccounts({ includeArchived: true });
  const fields = useFields({ includeInactive: true });
  const workspace = useWorkspace();
  const formatMoney = useMoneyFormat();

  const today = systemClock.today();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const query = useMemo(() => toQuery(filters, today), [filters, today]);
  const setFilters = (next: AuditFilters) => setParams(filtersToParams(next), { replace: true });

  const pages = useInfiniteQuery({
    queryKey: ['audit.infinite', wsId, query],
    queryFn: ({ pageParam }) => cuadra.audit.list(wsId, { ...query, limit: PAGE, ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    meta: { tables: ['audit_log'] },
  });

  const entries = useMemo(() => mergePages(pages.data?.pages ?? []), [pages.data]);
  const days = useMemo(() => groupByDay(entries), [entries]);
  const accountName = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a.name])), [accounts.data]);
  const ctx = useMemo(
    () => ({ t: tAll, formatMoney, formatDate, fields: fields.data ?? [] }),
    [tAll, formatMoney, fields.data],
  );
  const currency = workspace.data?.currency;
  const filtered = isFiltered(filters);

  const exportCsv = async () => {
    if (currency === undefined) return;
    setExporting(true);
    try {
      const all: AuditEntry[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < EXPORT_MAX_PAGES; i += 1) {
        const page = await cuadra.audit.list(wsId, { ...query, limit: EXPORT_PAGE, ...(cursor === undefined ? {} : { cursor }) });
        all.push(...page.items);
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      const sheet = historySheet(
        all,
        { accounts: accounts.data ?? [], currency, amountHeader: t('export.amount'), actionLabel: (e) => t(`action.${e.action}`), change: ctx, emptyValue: t('empty.value') },
        exportTranslate(tAll),
      );
      const name = fileName(t('export.base'), workspace.data?.name ?? '', today);
      downloadCsv(historyCsv(sheet), name);
      pushToast({ message: 'auditlog.exported', params: { name } });
    } catch {
      pushToast({ message: 'auditlog.exportFailed', tone: 'warn' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="aud">
      <header className="aud-head">
        <h1 className="aud-title">{t('title')}</h1>
        <Button variant="secondary" icon={FileDown} loading={exporting} disabled={currency === undefined || entries.length === 0} onClick={() => void exportCsv()}>
          {t('csv')}
        </Button>
      </header>
      <p className="aud-note">{t('note')}</p>

      <div className="aud-filters" role="group" aria-label={t('filter.group')}>
        <div className="aud-filters__period">
          <span className="aud-filters__label">{t('filter.period')}</span>
          <PeriodPicker value={filters.period} onChange={(period) => setFilters({ ...filters, period })} today={today} presets={AUDIT_PERIODS} />
        </div>
        <Field label={t('filter.account')}>
          <Select
            value={filters.accountId ?? ''}
            placeholder={t('filter.allAccounts')}
            options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => setFilters({ ...filters, accountId: v === '' ? null : v })}
          />
        </Field>
        <Field label={t('filter.action')}>
          <Select
            value={filters.group ?? ''}
            placeholder={t('filter.allActions')}
            options={ACTION_GROUP_KEYS.map((g) => ({ value: g, label: t(`group.${g}`) }))}
            onChange={(v) => setFilters({ ...filters, group: v === '' ? null : (v as AuditFilters['group']) })}
          />
        </Field>
        <Field label={t('filter.entity')}>
          <Select
            value={filters.entity ?? ''}
            placeholder={t('filter.allEntities')}
            options={ENTITY_TYPES.map((e) => ({ value: e, label: t(`entity.${e}`) }))}
            onChange={(v) => setFilters({ ...filters, entity: v === '' ? null : (v as AuditFilters['entity']) })}
          />
        </Field>
        {filtered ? (
          <Button variant="ghost" className="aud-filters__clear" onClick={() => setFilters(NO_FILTERS)}>
            {t('clear')}
          </Button>
        ) : null}
      </div>

      {pages.isError ? (
        <Banner
          tone="warn"
          action={
            <Button variant="secondary" onClick={() => void pages.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {t('error')}
        </Banner>
      ) : pages.data === undefined || currency === undefined ? (
        <Skeleton label={t('loading')} rows={6} />
      ) : days.length === 0 ? (
        <EmptyState
          variant={filtered ? 'no-results' : 'first-use'}
          message={t(filtered ? 'emptyFiltered' : 'empty')}
          {...(filtered
            ? {
                action: (
                  <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                    {t('clear')}
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <>
          <div role="list" aria-label={t('listLabel')} className="aud-list ui-ledger" aria-busy={pages.isFetching}>
            {days.map((d) => (
              <LedgerDay
                key={d.day}
                label={
                  <>
                    {dayHeading(d.day, today)}
                    <span className="aud-day__date num"> · {formatDate(d.day)}</span>
                  </>
                }
                total={<span className="num">{t('count', { n: d.entries.length })}</span>}
              >
                {d.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} wsId={wsId} currency={currency} accountName={e.accountId === null ? null : (accountName.get(e.accountId) ?? null)} ctx={ctx} />
                ))}
              </LedgerDay>
            ))}
          </div>
          {pages.hasNextPage ? (
            <div className="aud-more">
              <Button variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                {t('more')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
