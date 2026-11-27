import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts, useFields, useWorkspace, useWorkspaceId } from '../../../app/data/hooks';
import { useUiStore } from '../../../app/state/uiStore';
import { Money, type ColumnMapping, type ImportPreviewResult } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountText, Banner, Button, cx, EmptyState, Skeleton, Stamp } from '../../../ui';
import { StepColumns } from '../components/StepColumns';
import { StepFile } from '../components/StepFile';
import { StepPreview } from '../components/StepPreview';
import { defaultInclude, mappingFromTargets, summarize, targetsFromMapping, type MapOptions, type MappingProblem, type Target } from '../logic';
import type { LoadedFile } from '../readFile';
import '../import.css';

const STEPS = ['file', 'columns', 'preview', 'confirm'] as const;
const DEFAULT_OPTIONS: MapOptions = { dateFormat: 'auto', amountLocale: 'auto', inValues: [], fixedDescription: '', createMissingOptions: true };

interface Done {
  batchId: string;
  imported: number;
  skipped: number;
  createdOptions: number;
  fileName: string;
}

/** P-18 · Asistente de importación de CSV y Excel en cuatro pasos (DESIGN §10.14). */
export function Component() {
  const t = useT();
  const cuadra = useCuadra();
  const wsId = useWorkspaceId();
  const toast = useUiStore((s) => s.pushToast);
  const workspace = useWorkspace();
  const accounts = useAccounts();
  const fields = useFields();

  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [options, setOptions] = useState<MapOptions>(DEFAULT_OPTIONS);
  const [showProblems, setShowProblems] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [usedMapping, setUsedMapping] = useState<ColumnMapping | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const accountList = accounts.data ?? [];
  const fieldList = useMemo(() => fields.data ?? [], [fields.data]);
  useEffect(() => {
    if (accountId === '' || !accountList.some((a) => a.id === accountId)) setAccountId(accountList[0]?.id ?? '');
  }, [accountList, accountId]);

  // Al cambiar de paso, el foco pasa al título del paso nuevo (DESIGN §12) sin tocarlo al abrir la pantalla.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, done]);

  const result = useMemo(() => mappingFromTargets(targets, options), [targets, options]);
  const problems: MappingProblem[] = result.ok ? [] : result.problems;

  const onLoaded = (next: LoadedFile, f: File) => {
    setLoaded(next);
    setFile(f);
    setPreview(null);
    setUsedMapping(null);
    setShowProblems(false);
    const suggested = cuadra.importCsv.suggestMapping(next.raw, fieldList);
    setTargets(targetsFromMapping(next.raw.headers.length, suggested));
    setOptions({
      ...DEFAULT_OPTIONS,
      inValues: suggested.amount?.mode === 'with_type' ? [...suggested.amount.inValues] : [],
    });
  };

  const fail = (error: unknown) => toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });

  const toPreview = async () => {
    if (loaded === null) return;
    setShowProblems(true);
    if (!result.ok || accountId === '') return;
    setBusy('preview');
    try {
      const p = await cuadra.importCsv.preview(wsId, accountId, loaded.raw, result.mapping);
      setPreview(p);
      setUsedMapping(result.mapping);
      setInclude(new Set(defaultInclude(p.rows)));
      setStep(2);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (loaded === null || preview === null || usedMapping === null) return;
    setBusy('commit');
    try {
      const out = await cuadra.importCsv.commit(wsId, accountId, preview, { include: [...include].sort((a, b) => a - b), fileName: loaded.fileName, mapping: usedMapping });
      setDone({ ...out.value, fileName: loaded.fileName });
      toast({ message: 'import.done.toast' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setStep(0);
    setLoaded(null);
    setFile(null);
    setPreview(null);
    setUsedMapping(null);
    setInclude(new Set());
    setDone(null);
    setShowProblems(false);
  };

  const toggle = (index: number, on: boolean) =>
    setInclude((s) => {
      const next = new Set(s);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  // ── Estados de la pantalla ──
  const titleEl = (
    <h1 className="imp-title" ref={heading} tabIndex={-1}>
      {t('import.title')}
    </h1>
  );

  if (workspace.isPending || accounts.isPending || fields.isPending) {
    return (
      <div className="imp-page">
        {titleEl}
        <Skeleton label={t('import.loading')} rows={4} />
      </div>
    );
  }
  if (workspace.isError || accounts.isError || fields.isError) {
    return (
      <div className="imp-page">
        {titleEl}
        <Banner
          tone="warn"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void workspace.refetch();
                void accounts.refetch();
                void fields.refetch();
              }}
            >
              {t('import.retry')}
            </Button>
          }
        >
          {t('import.error')}
        </Banner>
      </div>
    );
  }
  if (workspace.data.archivedAt !== null) {
    return (
      <div className="imp-page">
        {titleEl}
        <EmptyState message={t('import.archived')} rows={3} />
      </div>
    );
  }
  if (accountList.length === 0) {
    return (
      <div className="imp-page">
        {titleEl}
        <EmptyState message={t('import.noAccounts')} rows={3} action={<Link to={`/e/${wsId}/cuentas`}>{t('import.goAccounts')}</Link>} />
      </div>
    );
  }

  const currency = workspace.data.currency;
  const accountName = accountList.find((a) => a.id === accountId)?.name ?? '';
  const stepName = (i: number) => t(`import.step.${STEPS[i]}`);

  // Totales de lo marcado para el paso de confirmación.
  let inTotal = 0;
  let outTotal = 0;
  if (preview !== null) {
    for (const r of preview.rows) {
      if (!include.has(r.index) || r.draft === null || r.status === 'opening_suspect') continue;
      if (r.draft.kind === 'income') inTotal = Money.add(inTotal, r.draft.amountMinor);
      else outTotal = Money.add(outTotal, r.draft.amountMinor);
    }
  }
  const sum = preview === null ? null : summarize(preview.rows, include);
  const skipped = preview === null || sum === null ? 0 : preview.rows.filter((r) => r.status !== 'empty').length - sum.selected;

  return (
    <div className="imp-page">
      <header className="imp-head">
        {titleEl}
        <nav aria-label={t('import.stepper')} className="imp-steps">
          <p className="imp-steps__line num">
            {t('import.step', { n: done === null ? step + 1 : STEPS.length, total: STEPS.length })}
          </p>
          <ol className="imp-steps__list">
            {STEPS.map((s, i) => {
              const state = done !== null || i < step ? 'done' : i === step ? 'current' : 'todo';
              return (
                <li key={s} className={cx('imp-steps__item', `is-${state}`)} {...(state === 'current' && done === null ? { 'aria-current': 'step' as const } : {})}>
                  <span className="imp-steps__dot" aria-hidden="true">
                    {state === 'done' ? <Check /> : i + 1}
                  </span>
                  <span className="imp-steps__label">{stepName(i)}</span>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      {done !== null ? (
        <section className="imp-done" aria-labelledby="imp-done-h" role="status">
          <Stamp animate size="4rem" />
          <div className="imp-done__text">
            <h2 id="imp-done-h" className="imp-h2">
              {t('import.done.title')}
            </h2>
            <p>{t('import.done.body', { name: done.fileName })}</p>
            <p className="imp-note num">
              {t('import.done.counts', { n: done.imported })}
              {done.skipped > 0 ? ` · ${t('import.done.skipped', { n: done.skipped })}` : ''}
              {done.createdOptions > 0 ? ` · ${t('import.done.options', { n: done.createdOptions })}` : ''}
            </p>
            <div className="imp-actions">
              <Link className="imp-primarylink" to={`/e/${wsId}/lotes/${done.batchId}`}>
                {t('import.done.open')}
              </Link>
              <Button variant="ghost" onClick={reset}>
                {t('import.done.another')}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="imp-step" aria-labelledby="imp-step-h">
          <h2 id="imp-step-h" className="imp-h2">
            {t(`import.${STEPS[step] === 'file' ? 'file' : STEPS[step] === 'columns' ? 'cols' : STEPS[step] === 'preview' ? 'prev' : 'confirm'}.title`)}
          </h2>

          {/* Los pasos inactivos no se montan: fuera del orden de tabulación y del árbol de accesibilidad. */}
          {step === 0 ? <StepFile workspaceId={wsId} loaded={loaded} file={file} onLoaded={onLoaded} /> : null}

          {step === 1 && loaded !== null ? (
            <StepColumns
              raw={loaded.raw}
              accounts={accountList}
              fields={fieldList}
              accountId={accountId}
              onAccount={setAccountId}
              targets={targets}
              onTargets={setTargets}
              options={options}
              onOptions={setOptions}
              problems={problems}
              showProblems={showProblems}
            />
          ) : null}

          {step === 2 && preview !== null && usedMapping !== null ? (
            <StepPreview preview={preview} mapping={usedMapping} currency={currency} include={include} onToggle={toggle} />
          ) : null}

          {step === 3 && preview !== null && sum !== null ? (
            <div className="imp-stack">
              <p className="imp-confirm__lede">
                {t('import.confirm.summary', {
                  in: Money.format(inTotal, { locale: getLocale(), currency }),
                  out: Money.format(outTotal, { locale: getLocale(), currency }),
                  account: accountName,
                })}
              </p>
              <div className="imp-confirm__fig">
                <AmountText minor={Money.sub(inTotal, outTotal)} size="l" currency={currency} rule="double" />
              </div>
              <ul role="list" className="imp-confirm__list">
                <li>{t('import.confirm.undo')}</li>
                {skipped > 0 ? <li>{t('import.confirm.skipped', { n: skipped })}</li> : null}
                {preview.newOptions.length > 0 ? <li>{t('import.confirm.options', { n: preview.newOptions.length })}</li> : null}
              </ul>
            </div>
          ) : null}

          <footer className="imp-nav">
            {step > 0 ? (
              <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
                {t('import.back')}
              </Button>
            ) : (
              <span />
            )}
            {step === 0 ? (
              <Button variant="primary" icon={ArrowRight} disabled={loaded === null} onClick={() => setStep(1)}>
                {t('import.next')}
              </Button>
            ) : null}
            {step === 1 ? (
              <Button variant="primary" icon={ArrowRight} loading={busy === 'preview'} onClick={() => void toPreview()}>
                {t('import.next')}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                variant="primary"
                icon={ArrowRight}
                disabled={include.size === 0}
                {...(include.size === 0 ? { disabledReason: t('import.confirm.nothing') } : {})}
                onClick={() => setStep(3)}
              >
                {t('import.next')}
              </Button>
            ) : null}
            {step === 3 ? (
              <Button variant="primary" loading={busy === 'commit'} disabled={include.size === 0} onClick={() => void commit()}>
                {busy === 'commit' ? t('import.confirm.running') : t('import.confirm.action', { n: include.size })}
              </Button>
            ) : null}
          </footer>
        </section>
      )}
    </div>
  );
}
