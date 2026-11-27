// P-10 Resumen configurable (DESIGN 10.11, ARCHITECTURE 5.3 `/e/:wsId/resumen?vista=:viewId`).
// El estado vive en la query string; una vista guardada es la base y la URL lleva lo que cambia encima.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bookmark, Copy, Download, Pencil, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { previousRange, resolvePeriod, systemClock } from '../../../core';
import type { Field, GroupBy, SavedView, SummaryResult } from '../../../core';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts, useFieldDimensions, useMoneyFormat, useSummary, useViews, useWorkspace, useWorkspaceId } from '../../../app/data/hooks';
import { queryDefs } from '../../../app/data/queryDefs';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import {
  AmountText,
  Banner,
  Button,
  Card,
  Chip,
  DEFAULT_CURRENCY,
  Dialog,
  EmptyState,
  Field as FormField,
  FilterChips,
  InfoTip,
  Input,
  Menu,
  PeriodPicker,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  type ActiveFilter,
  type MenuItem,
  type SelectOption,
} from '../../../ui';
import { SummaryChart } from '../components/SummaryChart';
import { SummaryTable } from '../components/SummaryTable';
import { FiltersSheet } from '../components/FiltersSheet';
import { ViewList } from '../components/ViewList';
import { csvFileName, sheetToCsv, summarySheet } from '../model/csv';
import { boolValue, removeField, selectedOptions } from '../model/filters';
import { buildPoints, change, groupTxFilter, measureOf, movementsHref, sumGroups, type Point, type TableRow } from '../model/series';
import {
  CHARTS,
  chartAllowed,
  cleanFilters,
  DEFAULT_STATE,
  fromRecipe,
  groupParam,
  hasFilters,
  isTime,
  MEASURES,
  mergeState,
  normalizeState,
  parseGroupParam,
  parseParams,
  sameGroup,
  sameState,
  stateFilter,
  SUMMARY_PRESETS,
  TIME_UNITS,
  toParams,
  toRecipe,
  type ChartKind,
  type Filters,
  type Measure,
  type SummaryState,
} from '../model/state';
import '../insights.css';

type Dimension = Field & { groupable: boolean; filterable: boolean };
type NameDialog = { mode: 'save' | 'rename'; name: string; error: string | null } | null;

export function Component() {
  const t = useT();
  const cuadra = useCuadra();
  const ws = useWorkspaceId();
  const pushToast = useUiStore((s) => s.pushToast);
  const [sp, setSp] = useSearchParams();
  const views = useViews('summary');
  const accounts = useAccounts({ includeArchived: true });
  const dims = useFieldDimensions();
  const workspace = useWorkspace();
  const currency = workspace.data?.currency ?? DEFAULT_CURRENCY;
  const money = useMoneyFormat();
  const today = systemClock.today();

  // ── Estado: vista guardada (base) + lo que trae la URL ─────────────────────────────
  const { viewId, patch } = useMemo(() => parseParams(sp), [sp]);
  const view: SavedView<'summary'> | null = viewId === null ? null : (views.data?.find((v) => v.id === viewId) ?? null);
  const viewMissing = viewId !== null && views.isSuccess && view === null;
  const fields: Dimension[] = dims.data ?? [];
  const base = useMemo(() => normalizeState(view === null ? DEFAULT_STATE : fromRecipe(view.recipe), dims.data).state, [view, dims.data]);
  const { state, missingFields } = normalizeState(mergeState(base, patch), dims.data);
  const dirty = view !== null && !sameState(state, base);
  const fieldMissing = missingFields.length > 0 || (view?.warnings ?? []).some((w) => w.code === 'field_missing');

  const update = (next: Partial<SummaryState>) => {
    const s = normalizeState({ ...state, ...next }, dims.data).state;
    setSp(toParams(s, view?.id ?? null), { replace: true });
  };
  const openView = (id: string | null) => {
    if (id === null) return `?${toParams(DEFAULT_STATE, null).toString()}`;
    return `?vista=${encodeURIComponent(id)}`;
  };

  // ── Datos ──────────────────────────────────────────────────────────────────────────
  const filter = stateFilter(state);
  const input = { filter, groupBy: state.groupBy, ...(state.split === null ? {} : { split: state.split }) };
  const summary = useSummary(input);
  const resolved = resolvePeriod(state.period, systemClock);
  const canCompare = resolved.from !== null && resolved.to !== null;
  const prevRange = state.compare && canCompare ? previousRange(resolved.from, resolved.to) : null;
  const prevInput = { filter: { ...filter, period: prevRange ?? { preset: 'all' as const } }, groupBy: state.groupBy };
  const prev = useCuadraQuery({ ...queryDefs.summary(ws, prevInput), enabled: prevRange !== null, keepPrevious: true });

  const time = isTime(state.groupBy);
  const result: SummaryResult | undefined = summary.data;
  const prevGroups = state.compare && prevRange !== null ? (prev.data?.groups ?? null) : null;
  const points: Point[] = useMemo(
    () => (result === undefined ? [] : buildPoints(result.groups, state.measure, prevGroups, time)),
    [result, state.measure, prevGroups, time],
  );
  const warnings = [...(result?.warnings ?? [])];
  const anyFieldMissing = fieldMissing || warnings.some((w) => w.code === 'field_missing');

  // ── Rótulos ────────────────────────────────────────────────────────────────────────
  const groupLabel = (g: GroupBy): string => {
    switch (g.by) {
      case 'period':
        return t(`insights.group.${g.unit}`);
      case 'account':
        return t('insights.group.account');
      case 'kind':
        return t('insights.group.kind');
      case 'field':
        return fields.find((f) => f.id === g.fieldId)?.label ?? '—';
    }
  };
  const measureLabel = (m: Measure) => t(`insights.measure.${m}`);
  const title = view?.name ?? t('insights.title');
  const textOf = (v: number) =>
    state.measure === 'count' ? t('insights.count.value', { n: v }) : money(v);

  // ── Enlaces a Movimientos ──────────────────────────────────────────────────────────
  const ctx = { fields };
  const pointHref = (p: Point) => movementsHref(ws, groupTxFilter(filter, state.groupBy, p.key, ctx));
  const rowHref = (r: TableRow) =>
    r.depth === 0 || r.parent === null || state.split === null
      ? movementsHref(ws, groupTxFilter(filter, state.groupBy, r.group.key, ctx))
      : movementsHref(ws, groupTxFilter(filter, state.groupBy, r.parent.key, ctx, { split: state.split, key: r.group.key }));

  // ── Opciones de los controles ──────────────────────────────────────────────────────
  const groupOptions: SelectOption[] = [
    ...TIME_UNITS.map((u) => ({ value: groupParam({ by: 'period', unit: u }), label: t(`insights.group.${u}`) })),
    { value: 'cuenta', label: t('insights.group.account') },
    { value: 'tipo', label: t('insights.group.kind') },
    ...fields.filter((f) => f.groupable).map((f) => ({ value: `campo:${f.id}`, label: f.label, inactive: !f.active })),
  ];
  const splitOptions: SelectOption[] = [
    { value: '', label: t('insights.split.none') },
    ...groupOptions.filter((o) => {
      const g = parseGroupParam(o.value);
      return g !== null && !sameGroup(g, state.groupBy) && !(isTime(g) && time);
    }),
  ];

  // ── Filtros activos ────────────────────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setFilters = (f: Filters) => update({ filters: cleanFilters(f) });
  const many = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : t('insights.filters.more', { first: names[0] ?? '', n: names.length - 1 }));
  const active: ActiveFilter[] = [];
  const fl = state.filters;
  if (fl.kinds !== undefined) {
    active.push({
      id: 'kinds',
      label: t('insights.filters.kind'),
      value: many(fl.kinds.map((k) => t(k === 'income' ? 'insights.measure.in' : 'insights.measure.out'))),
      onOpen: () => setFiltersOpen(true),
      onRemove: () => setFilters({ ...fl, kinds: [] }),
    });
  }
  if (fl.accountIds !== undefined) {
    active.push({
      id: 'accounts',
      label: t('insights.filters.account'),
      value: many(fl.accountIds.map((id) => accounts.data?.find((a) => a.id === id)?.name ?? '…')),
      onOpen: () => setFiltersOpen(true),
      onRemove: () => setFilters({ ...fl, accountIds: [] }),
    });
  }
  for (const c of fl.fields ?? []) {
    const f = fields.find((x) => x.id === c.fieldId);
    if (f === undefined) continue;
    const value =
      f.type === 'bool'
        ? t(boolValue(fl, f.id) === true ? 'insights.filters.yes' : 'insights.filters.no')
        : many(selectedOptions(fl, f.id).map((id) => f.options.find((o) => o.id === id)?.label ?? '…'));
    active.push({ id: `f:${f.id}`, label: f.label, value, onOpen: () => setFiltersOpen(true), onRemove: () => setFilters(removeField(fl, f.id)) });
  }
  if (fl.text !== undefined) {
    active.push({ id: 'text', label: t('insights.filters.text'), value: fl.text, onOpen: () => setFiltersOpen(true), onRemove: () => setFilters({ ...fl, text: '' }) });
  }

  // ── Vistas: guardar, renombrar, duplicar, eliminar ─────────────────────────────────
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  // La hoja de vistas se cierra DESPUÉS de navegar: cerrarla en el mismo clic (top layer) cortaba la view
  // transition del router y la URL cambiaba sin que la pantalla la siguiera.
  const viewKey = sp.get('vista') ?? '';
  useEffect(() => setViewsOpen(false), [viewKey]);
  const [busy, setBusy] = useState(false);
  const toast = (message: string) => pushToast({ message });
  const fail = (e: unknown) => pushToast({ message: 'common.error.toast', params: { message: errorMessage(e, t) }, tone: 'warn' });

  const saveChanges = async () => {
    if (view === null) return;
    setBusy(true);
    try {
      await cuadra.views.update(view.id, { recipe: toRecipe(state) });
      toast('insights.views.updated');
      setSp(new URLSearchParams({ vista: view.id }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const confirmName = async () => {
    if (nameDialog === null) return;
    setBusy(true);
    try {
      if (nameDialog.mode === 'save') {
        const r = await cuadra.views.save({ workspaceId: ws, name: nameDialog.name, recipe: toRecipe(state) });
        toast('insights.views.saved');
        setSp(new URLSearchParams({ vista: r.value.id }));
      } else if (view !== null) {
        await cuadra.views.update(view.id, { name: nameDialog.name });
        toast('insights.views.renamed');
      }
      setNameDialog(null);
    } catch (e) {
      setNameDialog({ ...nameDialog, error: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async () => {
    if (view === null) return;
    try {
      // Duplica la vista tal como se ve (con los cambios sin guardar, si los hay).
      const r = await cuadra.views.duplicate(view.id);
      if (dirty) await cuadra.views.update(r.value.id, { recipe: toRecipe(state) });
      toast('insights.views.duplicated');
      setSp(new URLSearchParams({ vista: r.value.id }));
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    if (view === null) return;
    setBusy(true);
    try {
      await cuadra.views.remove(view.id);
      toast('insights.views.removed');
      setRemoveOpen(false);
      setSp(toParams(state, null));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const flows = sumGroups(points.map((p) => p.group));
  const totalValue = measureOf(flows, state.measure);
  const prevTotal = prevGroups === null ? null : points.reduce((s, p) => s + (p.prev ?? 0), 0);
  const empty = result !== undefined && flows.count === 0;

  // ── CSV ────────────────────────────────────────────────────────────────────────────
  const exportCsv = () => {
    if (result === undefined) return;
    const sheet = summarySheet({
      result,
      currency,
      groupHeader: groupLabel(state.groupBy),
      ...(state.split === null ? {} : { splitHeader: groupLabel(state.split) }),
      name: title,
      ...(prevGroups === null ? {} : { compare: { header: `${t('insights.table.previous')} (${measureLabel(state.measure)})`, points, money: state.measure !== 'count' } }),
    });
    const blob = new Blob(['﻿', sheetToCsv(sheet)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName(title, today);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('insights.export.done');
  };

  const menuItems: MenuItem[] = [
    { id: 'csv', label: t('insights.export.label'), icon: Download, disabled: result === undefined || empty, onSelect: exportCsv },
    ...(view === null
      ? []
      : [
          { id: 'saveAs', label: t('insights.views.saveAs'), icon: Bookmark, onSelect: () => setNameDialog({ mode: 'save', name: '', error: null }) },
          { id: 'rename', label: t('insights.views.rename'), icon: Pencil, onSelect: () => setNameDialog({ mode: 'rename', name: view.name, error: null }) },
          { id: 'duplicate', label: t('insights.views.duplicate'), icon: Copy, onSelect: () => void duplicate() },
          { id: 'remove', label: t('insights.views.remove'), icon: Trash2, tone: 'danger' as const, onSelect: () => setRemoveOpen(true) },
        ]),
  ];

  // ── Cuerpo ─────────────────────────────────────────────────────────────────────────

  const compareLine = () => {
    if (prevTotal === null) return null;
    const c = change(totalValue, prevTotal);
    if (c.diff === 0) return t('insights.compare.same');
    const diff =
      state.measure === 'count'
        ? new Intl.NumberFormat(getLocale(), { signDisplay: 'always' }).format(c.diff)
        : money(c.diff, { sign: 'always' });
    const pct =
      c.ratio === null ? '' : ` (${new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(c.ratio)})`;
    return `${t('insights.compare.more', { diff })}${pct}`;
  };

  const chartOptions = CHARTS.map((c: ChartKind) => ({ value: c, label: t(`insights.chart.${c}`), disabled: !chartAllowed(c, state.groupBy) }));

  let body;
  if (summary.isError) {
    body = (
      <EmptyState
        variant="no-results"
        message={t('insights.error')}
        action={
          <Button variant="secondary" onClick={() => void summary.refetch()}>
            {t('insights.retry')}
          </Button>
        }
      />
    );
  } else if (result === undefined) {
    body = <Skeleton label={t('insights.loading')} rows={6} />;
  } else if (empty) {
    body = hasFilters(state.filters) ? (
      <EmptyState
        variant="no-results"
        message={t('insights.empty.filtered')}
        action={
          <Button variant="secondary" onClick={() => setFilters({})}>
            {t('insights.filters.clear')}
          </Button>
        }
      />
    ) : (
      <EmptyState message={t('preset' in state.period && state.period.preset === 'all' ? 'insights.empty.first' : 'insights.empty.period')} />
    );
  } else {
    body = (
      <>
        <Card as="section" className="ins-card" aria-labelledby="ins-hero-label">
          <div className="ins-card__top">
            <div className="ins-hero">
              <p id="ins-hero-label" className="ins-hero__label">
                {t('insights.hero.label', { measure: measureLabel(state.measure), period: result.period.label })}
              </p>
              {state.measure === 'count' ? (
                <p className="ins-hero__count num">{t('insights.count.value', { n: totalValue })}</p>
              ) : (
                <AmountText minor={totalValue} size="l" currency={currency} highlight neutral={state.measure !== 'net' || totalValue >= 0} />
              )}
              {prevTotal === null || prevRange === null ? null : (
                <p className="ins-hero__cmp">
                  {compareLine()}
                  <InfoTip>{t('insights.compare.range', { from: formatDate(prevRange.from), to: formatDate(prevRange.to) })}</InfoTip>
                </p>
              )}
            </div>
            <div className="ins-chartpick">
              <Segmented label={t('insights.chart.label')} options={chartOptions} value={state.chart} onChange={(c) => update({ chart: c })} />
              {time ? null : <InfoTip>{t('insights.chart.onlyTime')}</InfoTip>}
            </div>
          </div>
          <SummaryChart
            points={points}
            chart={state.chart}
            measure={state.measure}
            unit={isTime(state.groupBy) ? state.groupBy.unit : null}
            compare={prevGroups !== null}
            currency={currency}
            title={t('insights.chart.title', { measure: measureLabel(state.measure), group: groupLabel(state.groupBy).toLocaleLowerCase('es') })}
            hrefFor={pointHref}
            textOf={textOf}
            axisText={(v) => money(v, { compact: true })}
          />
        </Card>
        <Card as="section" className="ins-card ins-card--table" aria-label={t('insights.table.caption')}>
          <SummaryTable
            points={points}
            measure={state.measure}
            compare={prevGroups !== null}
            currency={currency}
            groupHeader={state.split === null ? groupLabel(state.groupBy) : `${groupLabel(state.groupBy)} · ${groupLabel(state.split)}`}
            hrefFor={rowHref}
            diffText={(v) => money(v, { sign: 'always' })}
          />
        </Card>
      </>
    );
  }

  return (
    <div className="ins">
      <header className="ins-head">
        <div className="ins-head__title">
          <h1 className="ins-title">{title}</h1>
          {dirty ? <span className="ins-dirty">{t('insights.views.modified')}</span> : null}
        </div>
        <div className="ins-head__actions">
          <Button variant="secondary" icon={Bookmark} className="ins-views-btn" onClick={() => setViewsOpen(true)}>
            {t('insights.views.title')}
          </Button>
          <Button variant="secondary" icon={Download} className="ins-csv-btn" aria-label={t('insights.export.label')} disabled={result === undefined || empty} disabledReason={t('insights.empty.period')} onClick={exportCsv}>
            {t('insights.export.csv')}
          </Button>
          <Menu label={t('insights.views.actions')} items={menuItems} {...(view === null ? { className: 'ins-menu--compact' } : {})} />
          {view === null ? (
            <Button variant="secondary" icon={Save} onClick={() => setNameDialog({ mode: 'save', name: '', error: null })}>
              {t('insights.views.save')}
            </Button>
          ) : dirty ? (
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void saveChanges()}>
              {t('insights.views.saveChanges')}
            </Button>
          ) : null}
        </div>
      </header>

      {viewMissing ? <Banner tone="info">{t('insights.views.notFound')}</Banner> : null}
      {anyFieldMissing ? (
        <Banner
          tone="warn"
          action={
            view === null ? undefined : (
              <Button variant="secondary" loading={busy} onClick={() => void saveChanges()}>
                {t('insights.warn.saveFix')}
              </Button>
            )
          }
        >
          {t('insights.warn.fieldMissing')}
        </Banner>
      ) : null}

      <div className="ins-body">
        <div className="ins-main">
          <section className="ins-controls" aria-label={t('insights.title')}>
            <div className="ins-controls__row">
              <PeriodPicker value={state.period} onChange={(period) => update({ period })} today={today} presets={SUMMARY_PRESETS} />
              <Chip
                selected={state.compare}
                disabled={!canCompare}
                aria-describedby={canCompare ? undefined : 'ins-compare-why'}
                onClick={() => update({ compare: !state.compare })}
              >
                {t('insights.compare.label')}
              </Chip>
              <Chip icon={SlidersHorizontal} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
                {active.length > 0 ? `${t('insights.filters.edit')} · ${active.length}` : t('insights.filters.edit')}
              </Chip>
              {canCompare ? null : (
                <span id="ins-compare-why" className="ins-meta">
                  {t('insights.compare.disabled')}
                </span>
              )}
            </div>
            <div className="ins-controls__grid">
              <FormField label={t('insights.group.label')}>
                <Select
                  options={groupOptions}
                  value={groupParam(state.groupBy)}
                  onChange={(v) => {
                    const g = parseGroupParam(v);
                    if (g !== null) update({ groupBy: g, chart: chartAllowed(state.chart, g) ? state.chart : isTime(g) ? 'bars' : 'ranked' });
                  }}
                />
              </FormField>
              <FormField label={t('insights.split.label')}>
                <Select options={splitOptions} value={state.split === null ? '' : groupParam(state.split)} onChange={(v) => update({ split: parseGroupParam(v) })} />
              </FormField>
              <div className="ins-ctl">
                <span className="ins-ctl__label" aria-hidden="true">
                  {t('insights.measure.label')}
                </span>
                <Segmented
                  label={t('insights.measure.label')}
                  options={MEASURES.map((m) => ({ value: m, label: measureLabel(m) }))}
                  value={state.measure}
                  onChange={(m) => update({ measure: m })}
                  fullWidth
                />
              </div>
            </div>
            {active.length > 0 ? (
              <div className="ins-controls__filters">
                <FilterChips filters={active} onClear={() => setFilters({})} />
              </div>
            ) : null}
          </section>
          {body}
        </div>
        <aside className="ins-aside" aria-labelledby="ins-views-title">
          <h2 id="ins-views-title" className="ins-aside__title">
            {t('insights.views.title')}
          </h2>
          <ViewList views={views.data ?? []} currentId={view?.id ?? null} hrefFor={openView} />
        </aside>
      </div>

      <Sheet open={viewsOpen} onClose={() => setViewsOpen(false)} title={t('insights.views.title')} height="half">
        <ViewList views={views.data ?? []} currentId={view?.id ?? null} hrefFor={openView} />
      </Sheet>

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={state.filters}
        onChange={setFilters}
        accounts={accounts.data ?? []}
        fields={fields.filter((f) => f.filterable)}
      />

      <Dialog
        open={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        title={t(nameDialog?.mode === 'rename' ? 'insights.views.renameTitle' : 'insights.views.saveTitle')}
        confirmLabel={t(nameDialog?.mode === 'rename' ? 'insights.views.rename' : 'insights.views.save')}
        confirmLoading={busy}
        onConfirm={() => void confirmName()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmName();
          }}
        >
          <FormField label={t('insights.views.name')} {...(nameDialog?.error ? { error: nameDialog.error } : {})}>
            <Input
              value={nameDialog?.name ?? ''}
              maxLength={120}
              required
              onChange={(e) => {
                const name = e.currentTarget.value;
                setNameDialog((d) => (d === null ? d : { ...d, name, error: null }));
              }}
            />
          </FormField>
        </form>
      </Dialog>

      <Dialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        variant="destructive"
        title={t('insights.views.removeTitle', { name: view?.name ?? '' })}
        description={t('insights.views.removeDesc')}
        confirmLabel={t('insights.views.remove')}
        confirmLoading={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
