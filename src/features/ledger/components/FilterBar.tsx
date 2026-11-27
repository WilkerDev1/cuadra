// Barra de filtros: periodo, búsqueda, chips de criterios, hoja de filtros, vistas guardadas y exportar.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, Search, SlidersHorizontal } from 'lucide-react';
import papaparse from 'papaparse';
import { systemClock, transactionsToSheet, type DateRange, type SavedView, type TxFilter } from '../../../core';
import { useMoneyFormat, useViews, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { Button, Chip, Dialog, Field, FilterChips, Input, Menu, PeriodPicker } from '../../../ui';
import { exportFileName, sheetToCsv, sheetToXlsxData } from '../logic/exportFile';
import { filterChips } from '../logic/filterChips';
import { normalizeFilter, sameFilter } from '../../../app/data/txFilterUrl';
import { useCurrency, useFetchAll, useLookups } from '../data';
import { FilterSheet } from './FilterSheet';
import { saveFile } from '../../../app/data/download';

const PRESETS = ['today', 'this_week', 'this_month', 'last_month', 'last_30_days', 'this_quarter', 'this_year', 'last_year', 'all'] as const;

export interface FilterBarProps {
  filter: TxFilter;
  setFilter: (f: TxFilter, how?: { replace?: boolean }) => void;
  defaultPeriod: DateRange;
  fixedAccountId?: string;
  /** Vistas guardadas (solo en Movimientos). */
  views?: boolean;
  /** Nombre base del archivo exportado. */
  exportName: string;
}

export function FilterBar({ filter, setFilter, defaultPeriod, fixedAccountId, views = false, exportName }: FilterBarProps) {
  const t = useT();
  const currency = useCurrency();
  const { accounts, fields } = useLookups();
  const [sheet, setSheet] = useState(false);
  const money = useMoneyFormat();
  const chips = filterChips(filter, {
    accounts,
    fields,
    money,
    date: formatDate,
    t,
    ...(fixedAccountId === undefined ? {} : { fixedAccountId }),
  });
  const clear = () => {
    const keep: TxFilter = { period: filter.period ?? defaultPeriod };
    if (fixedAccountId !== undefined) keep.accountIds = [fixedAccountId];
    setFilter(keep);
  };

  return (
    <div className="lg-bar">
      {views ? <SavedViewsRow filter={filter} setFilter={setFilter} defaultPeriod={defaultPeriod} hasCriteria={chips.length > 0} /> : null}
      <div className="lg-bar__row">
        <PeriodPicker value={filter.period ?? defaultPeriod} onChange={(p) => setFilter({ ...filter, period: p })} today={systemClock.today()} presets={PRESETS} />
        <SearchBox value={filter.text ?? ''} onChange={(text) => setFilter({ ...filter, text }, { replace: true })} />
        <Chip icon={SlidersHorizontal} selected={chips.length > 0} onClick={() => setSheet(true)} aria-haspopup="dialog" className="lg-filters">
          {chips.length > 0 ? t('ledger.filter.buttonN', { n: chips.length }) : t('ledger.filter.button')}
        </Chip>
        <ExportMenu filter={filter} name={exportName} />
      </div>
      {chips.length > 0 ? (
        <FilterChips
          filters={chips.map((c) => ({ id: c.id, label: c.label, value: c.value, onOpen: () => setSheet(true), onRemove: () => setFilter(c.without) }))}
          onClear={clear}
        />
      ) : null}
      <FilterSheet
        open={sheet}
        filter={filter}
        accounts={accounts}
        fields={fields}
        fixedAccount={fixedAccountId !== undefined}
        minorDigits={currency.minorDigits}
        onApply={(f) => {
          setFilter(f);
          setSheet(false);
        }}
        onClose={() => setSheet(false)}
      />
    </div>
  );
}

/** Búsqueda en concepto y notas: escribe la URL 300 ms después de dejar de teclear. */
function SearchBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === last.current) return;
    const id = window.setTimeout(() => {
      last.current = text;
      onChange(text);
    }, 300);
    return () => window.clearTimeout(id);
  }, [text, onChange]);
  return (
    <span className="lg-search">
      <Search aria-hidden="true" className="lg-search__icon" />
      <label className="visually-hidden" htmlFor="lg-search">
        {t('ledger.search.label')}
      </label>
      <Input id="lg-search" type="search" value={text} placeholder={t('ledger.search.placeholder')} onChange={(e) => setText(e.currentTarget.value)} enterKeyHint="search" />
    </span>
  );
}

// ── Exportar ─────────────────────────────────────────────────────────────────────────

function download(blob: Blob, name: string) {
  void saveFile(blob, name);
}

function ExportMenu({ filter, name }: { filter: TxFilter; name: string }) {
  const t = useT();
  const fetchAll = useFetchAll();
  const currency = useCurrency();
  const { accounts, fields } = useLookups();
  const push = useUiStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const run = async (kind: 'csv' | 'xlsx') => {
    setBusy(true);
    try {
      const rows = await fetchAll(filter);
      const sheet = transactionsToSheet(rows, fields, { accounts, currency });
      const file = exportFileName(name, systemClock.today(), kind);
      if (kind === 'csv') {
        const csv = sheetToCsv(sheet, (r) => papaparse.unparse(r, { newline: '\r\n' }));
        download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), file);
      } else {
        const { default: writeXlsxFile } = await import('write-excel-file/browser');
        const blob = await writeXlsxFile(sheetToXlsxData(sheet) as never, { sheet: sheet.name } as never).toBlob();
        download(blob, file);
      }
      push({ message: 'ledger.export.done', params: { n: rows.length, file } });
    } catch (err) {
      push({ message: 'common.error.toast', params: { message: errorMessage(err, t) }, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      label={t('ledger.export.label')}
      items={[
        { id: 'csv', label: t('ledger.export.csv'), onSelect: () => void run('csv') },
        { id: 'xlsx', label: t('ledger.export.xlsx'), onSelect: () => void run('xlsx') },
      ]}
      trigger={(p) => (
        <Button variant="ghost" icon={Download} loading={busy} className="lg-export" {...(p as object)}>
          {t('ledger.export.button')}
        </Button>
      )}
    />
  );
}

// ── Vistas guardadas (filtros) ──────────────────────────────────────────────────────────

function viewFilter(view: SavedView<'filter'>): TxFilter {
  const f = view.recipe.filter;
  return normalizeFilter({ ...f, period: f.period ?? { preset: 'all' } });
}

function SavedViewsRow({ filter, setFilter, defaultPeriod, hasCriteria }: { filter: TxFilter; setFilter: FilterBarProps['setFilter']; defaultPeriod: DateRange; hasCriteria: boolean }) {
  const t = useT();
  const ws = useWorkspaceId();
  const list = useViews('filter');
  const [dialog, setDialog] = useState<{ mode: 'save' } | { mode: 'rename'; view: SavedView<'filter'> } | { mode: 'remove'; view: SavedView<'filter'> } | null>(null);
  const views = list.data ?? [];
  const active = useMemo(() => views.find((v) => sameFilter(viewFilter(v), filter)) ?? null, [views, filter]);

  const save = useCuadraMutation((c, name: string) => c.views.save({ workspaceId: ws, name, recipe: { v: 1, kind: 'filter', filter: normalizeFilter(filter) } }), {
    successToast: (v) => ({ key: 'ledger.views.saved', params: { name: v.name } }),
    errorToast: false,
  });
  const rename = useCuadraMutation((c, input: { id: string; name: string }) => c.views.update(input.id, { name: input.name }), {
    successToast: 'ledger.views.renamed',
    errorToast: false,
  });
  const remove = useCuadraMutation(
    async (c, id: string) => {
      await c.views.remove(id);
      return { value: id, warnings: [], auditActionId: null };
    },
    { successToast: 'ledger.views.removed' },
  );

  return (
    <div className="lg-views" role="group" aria-label={t('ledger.views.label')}>
      <div className="lg-views__scroll">
        <Chip selected={active === null && !hasCriteria} onClick={() => setFilter({ period: filter.period ?? defaultPeriod })}>
          {t('ledger.views.all')}
        </Chip>
        {views.map((v) => (
          <Chip key={v.id} selected={active?.id === v.id} onClick={() => setFilter(viewFilter(v))}>
            {v.name}
          </Chip>
        ))}
      </div>
      {active !== null ? (
        <Menu
          label={t('ledger.views.menu', { name: active.name })}
          items={[
            { id: 'rename', label: t('ledger.views.rename'), onSelect: () => setDialog({ mode: 'rename', view: active }) },
            { id: 'remove', label: t('ledger.views.remove'), tone: 'danger', onSelect: () => setDialog({ mode: 'remove', view: active }) },
          ]}
        />
      ) : hasCriteria ? (
        <Button variant="ghost" onClick={() => setDialog({ mode: 'save' })}>
          {t('ledger.views.save')}
        </Button>
      ) : null}
      {dialog?.mode === 'remove' ? (
        <Dialog
          open
          variant="destructive"
          onClose={() => setDialog(null)}
          title={t('ledger.views.removeTitle', { name: dialog.view.name })}
          description={t('ledger.views.removeText')}
          confirmLabel={t('ledger.views.remove')}
          confirmLoading={remove.isPending}
          onConfirm={() => remove.mutate(dialog.view.id, { onSettled: () => setDialog(null) })}
        />
      ) : dialog !== null ? (
        <NameDialog
          title={dialog.mode === 'save' ? t('ledger.views.saveTitle') : t('ledger.views.renameTitle')}
          confirm={dialog.mode === 'save' ? t('ledger.views.save') : t('ledger.views.rename')}
          initial={dialog.mode === 'rename' ? dialog.view.name : ''}
          busy={save.isPending || rename.isPending}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.mode === 'save') await save.mutateAsync(name);
            else await rename.mutateAsync({ id: dialog.view.id, name });
          }}
        />
      ) : null}
    </div>
  );
}

function NameDialog({ title, confirm, initial, busy, onClose, onSubmit }: { title: string; confirm: string; initial: string; busy: boolean; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (name.trim() === '') {
      setError(t('errors.name_required'));
      return;
    }
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };
  return (
    <Dialog open onClose={onClose} title={title} confirmLabel={confirm} onConfirm={() => void submit()} confirmLoading={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <Field label={t('ledger.views.name')} error={error ?? undefined}>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder={t('ledger.views.nameExample')} autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}
