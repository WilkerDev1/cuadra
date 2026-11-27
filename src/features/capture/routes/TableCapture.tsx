// /e/:wsId/captura?cuenta=&tipo= — Captura en tabla (escritorio primero, DESIGN §10.8) y, en móvil, la Ráfaga
// (§10.9). Debajo, los lotes recientes con [Anular lote].
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAccounts, useFormSchema, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useBreakpoint } from '../../../app/state/breakpoint';
import type { CaptureInput, Id, IsoDate } from '../../../core';
import { hasKey, t as tGlobal, useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { Button, Dialog, Field, Input, Segmented, Select, formatExpression } from '../../../ui';
import { BurstCapture } from '../components/BurstCapture';
import { CaptureGrid } from '../components/CaptureGrid';
import { DateGroup } from '../components/DateGroup';
import { RecentBatches } from '../components/RecentBatches';
import { LoadError, Loading, NoAccounts } from '../components/States';
import { Tape } from '../components/Tape';
import { defaultBatchLabel, isNotSaved, useSaveBatch } from '../components/useSaveBatch';
import { useCurrency, useDebounced, useSignedAmount, useToday } from '../hooks';
import { parseAmountText } from '../logic/amount';
import { isoToDmy } from '../logic/dates';
import { controlGate } from '../logic/burst';
import { parseEntryParams, pickAccount, type EntryKind } from '../logic/entry';
import { buildColumns, emptyRow, evaluateGrid, keepUnsaved, type GridRow } from '../logic/grid';
import '../capture.css';

export function Component() {
  const t = useT('capture');
  const [search] = useSearchParams();
  const params = parseEntryParams(search);
  const compact = useBreakpoint() === 'compact';
  const accounts = useAccounts();
  if (accounts.isPending) return <Loading />;
  if (accounts.isError) return <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />;
  const accountId = pickAccount(accounts.data, [params.accountId]);
  const kind: EntryKind = params.kind === 'income' ? 'income' : 'expense';
  return (
    <div className="cap-page">
      <header className="cap-page__head">
        <h1>{compact ? t('burst.title') : t('table.title')}</h1>
      </header>
      {accountId === null ? (
        <NoAccounts />
      ) : compact ? (
        <BurstCapture initialAccountId={accountId} initialKind={kind} />
      ) : (
        <GridCapture initialAccountId={accountId} initialKind={kind} />
      )}
      <RecentBatches />
    </div>
  );
}

function GridCapture({ initialAccountId, initialKind }: { initialAccountId: Id; initialKind: EntryKind }) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  const today = useToday();
  const currency = useCurrency();
  const money = useSignedAmount();
  const locale = getLocale();
  const accounts = useAccounts().data ?? [];
  const seq = useRef(0);
  const makeId = () => `row-${(seq.current += 1)}`;

  const [label, setLabel] = useState(() => defaultBatchLabel());
  const [accountId, setAccountId] = useState<Id>(initialAccountId);
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [date, setDate] = useState<IsoDate>(today);
  const [controlText, setControlText] = useState('');
  const [rows, setRows] = useState<GridRow[]>(() => [emptyRow(makeId())]);
  const [showAll, setShowAll] = useState(false);
  const [focusError, setFocusError] = useState(0);
  const [confirm, setConfirm] = useState<null | 'save' | 'discard'>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const schema = useFormSchema(kind);
  const columns = useMemo(
    () => buildColumns(schema.data?.fields ?? [], { date: t('grid.date'), description: t('grid.description'), amount: t('grid.amount') }),
    [schema.data, t],
  );
  const ctx = { today, locale, minorDigits: currency.minorDigits };
  const summary = evaluateGrid(rows, columns, ctx);
  const control = parseAmountText(controlText, locale, currency.minorDigits);
  const controlMinor = control.status === 'ok' ? control.minor : null;
  const diff = controlMinor === null ? null : controlMinor - summary.sumMinor;

  const input: CaptureInput = {
    workspaceId: ws,
    accountId,
    kind,
    date,
    label: label.trim(),
    rows: summary.results.map((r) => r.capture ?? { amount: '', description: '' }),
    controlTotalMinor: controlMinor,
  };
  // Vista previa del núcleo: valida lo que la tabla no sabe (campos u opciones desactivados, cuenta archivada…).
  const debounced = useDebounced(input, 400);
  const preview = useCuadraQuery({
    key: ['capture.preview', ws, debounced],
    tables: ['accounts', 'fields', 'field_options'],
    fn: (c) => c.batches.previewCapture(debounced),
    enabled: summary.validCount > 0,
    keepPrevious: true,
  });
  const serverErrors = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of preview.data?.rowErrors ?? []) {
      const key = `errors.${e.error}`;
      m.set(e.index, tGlobal(hasKey(key) ? key : `errors.money.${e.error}`));
    }
    return m;
  }, [preview.data]);
  const errorRows = summary.errorCount + [...serverErrors.keys()].filter((i) => (summary.results[i]?.issues.length ?? 0) === 0).length;

  const save = useSaveBatch();
  const tapeLines = summary.results
    .filter((r) => r.capture !== null && r.minor !== null)
    .map((r) => ({ id: rows[r.index]!.id, minor: r.minor!, kind, description: r.capture!.description }));

  // Un guardado a la vez: Ctrl+Enter dos veces seguidas (o Enter en el diálogo) no debe escribir el lote dos veces.
  // `save.isPending` llega tarde (tras el render); el ref se marca en el mismo evento.
  const saving = useRef(false);
  const controlRef = useRef<HTMLInputElement>(null);
  const attempt = () => {
    if (saving.current) return;
    setShowAll(true);
    setSaveError(null);
    if (summary.validCount === 0) {
      setSaveError(summary.errorCount > 0 ? t('grid.fixErrors') : t('grid.nothing'));
      setFocusError((n) => n + 1);
      return;
    }
    const gate = controlGate(control, diff, errorRows);
    if (gate === 'block') {
      setSaveError(t('batch.controlInvalid'));
      controlRef.current?.focus();
      return;
    }
    if (gate === 'confirm') {
      setConfirm('save');
      return;
    }
    void doSave();
  };
  const doSave = async () => {
    if (saving.current) return;
    saving.current = true;
    setConfirm(null);
    try {
      const r = await save.mutateAsync({ ...input, acceptControlMismatch: true });
      setRows(keepUnsaved(rows, r.value.savedRowIndexes, makeId));
      setShowAll(false);
      setControlText('');
      setLabel(defaultBatchLabel());
    } catch (e) {
      if (isNotSaved(e)) setSaveError(t('grid.nothing'));
      else setSaveError(tGlobal('common.error.unknown'));
    } finally {
      saving.current = false;
    }
  };

  const confirmText = [
    errorRows > 0 ? t('grid.confirmErrors', { n: errorRows, ok: summary.validCount }) : null,
    diff !== null && diff !== 0 ? t('grid.confirmMismatch', { amount: money(Math.abs(diff)) }) : null,
  ]
    .filter(Boolean)
    .join(' ');
  const filled = rows.filter((r) => Object.values(r.cells).some((v) => v.trim() !== '')).length;

  return (
    <>
      <div className="cap-bar" role="group" aria-label={t('batch.settings')}>
        <Field label={t('batch.label')} className="cap-bar__label">
          <Input value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
        </Field>
        <Field label={t('account.label')}>
          <Select
            value={accountId}
            onChange={(v) => setAccountId(v)}
            options={accounts.filter((a) => a.archivedAt === null).map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <div className="cap-group">
          <span className="cap-label">{t('kind.label')}</span>
          <Segmented<EntryKind>
            label={t('kind.label')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'income', label: tGlobal('ui.kind.income'), tone: 'var(--in)' },
              { value: 'expense', label: tGlobal('ui.kind.expense'), tone: 'var(--out)' },
            ]}
          />
        </div>
        <DateGroup label={t('batch.date')} value={date} onChange={(d) => d !== '' && setDate(d)} today={today} quick={false} />
        <Field label={t('batch.control')} {...(control.status === 'invalid' ? { error: t('amount.invalid') } : {})}>
          <Input
            ref={controlRef}
            className="num"
            inputMode="decimal"
            autoComplete="off"
            value={controlText}
            placeholder={t('batch.controlPlaceholder')}
            onChange={(e) => {
              setControlText(e.currentTarget.value);
              setSaveError(null);
            }}
            onBlur={() => control.status === 'ok' && setControlText(formatExpression(control.expr, locale))}
          />
        </Field>
      </div>

      <div className="cap-work">
        <div className="cap-work__grid">
          {schema.isError ? <LoadError error={schema.error} onRetry={() => void schema.refetch()} /> : null}
          <CaptureGrid
            caption={t('grid.caption')}
            columns={columns}
            rows={rows}
            onRowsChange={(r) => {
              setRows(r);
              setSaveError(null);
            }}
            results={summary.results}
            serverErrors={serverErrors}
            showAll={showAll}
            ctx={ctx}
            defaultDate={isoToDmy(date)}
            makeId={makeId}
            onSave={attempt}
            focusErrorSignal={focusError}
          />
          <p className="cap-meta cap-work__keys">{t('grid.keys')}</p>
        </div>
        <Tape className="cap-work__tape" title={t('tape.title')} lines={tapeLines} sumMinor={summary.sumMinor} controlMinor={controlMinor} empty={t('tape.empty')} />
      </div>

      <div className="cap-actions">
        {saveError === null ? null : (
          <p className="cap-error" role="alert">
            {saveError}
          </p>
        )}
        {errorRows > 0 && showAll ? <p className="cap-meta">{t('grid.errorRows', { n: errorRows })}</p> : null}
        {filled === 0 ? null : (
          <Button variant="ghost" onClick={() => setConfirm('discard')}>
            {t('grid.discard')}
          </Button>
        )}
        <Button variant="primary" onClick={attempt} loading={save.isPending} aria-keyshortcuts="Control+Enter">
          {summary.validCount > 0 ? t('grid.saveN', { n: summary.validCount }) : t('grid.save')}
        </Button>
      </div>

      <Dialog
        open={confirm === 'save'}
        onClose={() => setConfirm(null)}
        title={t('grid.confirmTitle')}
        description={confirmText}
        confirmLabel={t('grid.saveAnyway')}
        confirmLoading={save.isPending}
        onConfirm={() => void doSave()}
      />
      <Dialog
        open={confirm === 'discard'}
        variant="destructive"
        onClose={() => setConfirm(null)}
        title={t('grid.discardTitle', { n: filled })}
        description={t('grid.discardBody')}
        confirmLabel={t('grid.discard')}
        onConfirm={() => {
          setConfirm(null);
          setRows([emptyRow(makeId())]);
          setShowAll(false);
          setControlText('');
        }}
      />
    </>
  );
}
