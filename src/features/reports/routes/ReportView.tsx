// /e/:wsId/informes/:id  (resumido | detallado | id de una vista guardada). DESIGN 10.12.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, FileDown, FileSpreadsheet, Printer, Share2, SlidersHorizontal } from 'lucide-react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts, useFields, useViews, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useUiStore } from '../../../app/state/uiStore';
import { isDomainError, reportToSheets } from '../../../core';
import type { ReportRecipe } from '../../../core';
import { useT } from '../../../i18n';
import { Banner, Button, Dialog, EmptyState, Field, Input, Sheet, Skeleton } from '../../../ui';
import { ConfigForm } from '../ConfigForm';
import {
  MIME,
  canShareFiles,
  downloadBlob,
  exportTranslate,
  fileStem,
  shareFile,
  sheetsToCsv,
  sheetsToXlsxBlob,
} from '../exporters';
import {
  PRESET_IDS,
  applyParams,
  configToParams,
  configToRecipe,
  defaultConfig,
  isPresetId,
  presetIdOf,
  recipeForSave,
  recipeToConfig,
  sameConfig,
  type ReportConfig,
} from '../model';
import { ReportPaper, documentTitle, paperZoom } from '../ReportPaper';
import { useReportDoc } from '../useReport';
import '../reports.css';

type Exporting = 'csv' | 'xlsx' | 'share' | null;

export function Component() {
  const t = useT('reports');
  const tAll = useT();
  const wsId = useWorkspaceId();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const cuadra = useCuadra();
  const pushToast = useUiStore((s) => s.pushToast);
  const views = useViews('report');
  const accounts = useAccounts();
  const fields = useFields();
  const [configOpen, setConfigOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exporting, setExporting] = useState<Exporting>(null);
  const [canShare, setCanShare] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => setCanShare(canShareFiles()), []);

  // En tableta la hoja es una Carta a escala, no una tabla apilada: se mide el escenario y se reduce.
  useEffect(() => {
    const el = stageRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setZoom(paperZoom(inner, rootPx));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const preset = isPresetId(id);
  const view = preset ? undefined : views.data?.find((v) => v.id === id);
  const baseConfig: ReportConfig | null = preset ? defaultConfig(PRESET_IDS[id]) : view === undefined ? null : recipeToConfig(view.recipe);
  const config = baseConfig === null ? null : applyParams(baseConfig, params);

  const recipe: ReportRecipe | null = useMemo(() => {
    if (config === null || baseConfig === null) return null;
    const base = view !== undefined && config.form === baseConfig.form ? view.recipe : cuadra.reports.preset(config.form, config.period);
    return configToRecipe(config, base);
  }, [config, baseConfig, view, cuadra]);

  const report = useReportDoc(wsId, recipe);
  // El documento puede ser enorme (12 meses de detalle): la configuración responde primero y la hoja se pinta después.
  const doc = useDeferredValue(report.data);
  const dirty = view !== undefined && config !== null && baseConfig !== null && !sameConfig(config, baseConfig);

  const change = (next: ReportConfig) => {
    if (baseConfig === null) return;
    if (preset && next.form !== PRESET_IDS[id]) {
      const qs = configToParams({ ...next }, defaultConfig(next.form)).toString();
      void navigate(`/e/${wsId}/informes/${presetIdOf(next.form)}${qs === '' ? '' : `?${qs}`}`, { replace: true });
      return;
    }
    setParams(configToParams(next, baseConfig), { replace: true });
  };

  const title = doc === undefined ? t(config?.form === 'detailed' ? 'docTitle.detailed' : 'docTitle.summary') : documentTitle(t, doc);
  const heading = view === undefined ? title : view.name;
  const stem = doc === undefined ? t('file.base') : fileStem(heading, doc.meta.workspaceName, doc.meta.period.label);

  // El PDF que sale de «Guardar como PDF» toma su nombre del título del documento.
  useEffect(() => {
    let previous = '';
    const before = () => {
      previous = document.title;
      document.title = stem;
    };
    const after = () => {
      if (previous !== '') document.title = previous;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [stem]);

  const save = useCuadraMutation(
    (c, input: { name: string; recipe: ReportRecipe }) => c.views.save({ workspaceId: wsId, name: input.name, recipe: input.recipe }),
    { errorToast: false, successToast: (v) => ({ key: 'reports.cfg.saved', params: { name: v.name } }) },
  );
  const update = useCuadraMutation(
    (c, input: { id: string; recipe: ReportRecipe }) => c.views.update(input.id, { recipe: input.recipe }),
    { successToast: (v) => ({ key: 'reports.cfg.updated', params: { name: v.name } }) },
  );

  const exportAs = async (kind: Exclude<Exporting, null>) => {
    if (doc === undefined) return;
    setExporting(kind);
    try {
      const sheets = reportToSheets(doc, exportTranslate(tAll));
      const asXlsx = kind === 'xlsx' || kind === 'share';
      const blob = asXlsx ? await sheetsToXlsxBlob(sheets) : new Blob([sheetsToCsv(sheets)], { type: MIME.csv });
      const file = `${stem}.${asXlsx ? 'xlsx' : 'csv'}`;
      if (kind === 'share') {
        if (await shareFile(blob, file)) pushToast({ message: 'reports.shared', params: { name: file } });
      } else {
        downloadBlob(blob, file);
        pushToast({ message: 'reports.exported', params: { name: file } });
      }
    } catch {
      pushToast({ message: 'reports.exportFailed', tone: 'warn' });
    } finally {
      setExporting(null);
    }
  };

  const listPath = `/e/${wsId}/informes`;

  if (!preset && views.isSuccess && view === undefined) {
    return (
      <div className="rep-wrap">
        <EmptyState
          message={t('notFound')}
          action={
            <Link to={listPath} className="rep-link">
              {t('notFound.action')}
            </Link>
          }
        />
      </div>
    );
  }

  const form =
    config === null ? null : (
      <ConfigForm
        config={config}
        onChange={change}
        accounts={accounts.data ?? []}
        fields={fields.data ?? []}
        onSaveAs={() => setSaveOpen(true)}
        onUpdate={dirty && view !== undefined && recipe !== null ? () => update.mutate({ id: view.id, recipe: recipeForSave(config as ReportConfig, recipe, view.recipe) }) : undefined}
        updating={update.isPending}
      />
    );

  return (
    <div className="rep-wrap">
      <div className="rep">
        <div className="rep-chrome">
          <Link to={listPath} className="rep-back">
            <ChevronLeft aria-hidden="true" />
            {t('back')}
          </Link>
          <div className="rep-actions">
            <Button variant="primary" icon={Printer} disabled={doc === undefined} onClick={() => window.print()}>
              {t('print')}
            </Button>
            <Button variant="secondary" icon={FileDown} disabled={doc === undefined} loading={exporting === 'csv'} onClick={() => void exportAs('csv')}>
              {t('csv')}
            </Button>
            <Button variant="secondary" icon={FileSpreadsheet} disabled={doc === undefined} loading={exporting === 'xlsx'} onClick={() => void exportAs('xlsx')}>
              {t('xlsx')}
            </Button>
            {canShare ? (
              <Button variant="secondary" icon={Share2} disabled={doc === undefined} loading={exporting === 'share'} onClick={() => void exportAs('share')}>
                {t('share')}
              </Button>
            ) : null}
            <Button variant="ghost" icon={SlidersHorizontal} className="rep-configure" onClick={() => setConfigOpen(true)}>
              {t('configure')}
            </Button>
          </div>
        </div>

        <aside className="rep-config" aria-label={t('configure.title')}>
          {form}
        </aside>

        <div className="rep-stage" ref={stageRef} aria-busy={report.isFetching}>
          {report.isError ? (
            <Banner
              tone="warn"
              action={
                <Button variant="secondary" onClick={() => void report.refetch()}>
                  {t('list.retry')}
                </Button>
              }
            >
              {t('error')}
            </Banner>
          ) : doc === undefined ? (
            <Skeleton label={t('loading')} rows={6} />
          ) : (
            <ReportPaper doc={doc} title={heading} kindLine={view === undefined ? undefined : title} zoom={zoom} />
          )}
        </div>
      </div>

      <Sheet
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        title={t('configure.title')}
        height="tall"
        footer={
          <Button variant="secondary" onClick={() => setConfigOpen(false)}>
            {t('configure.done')}
          </Button>
        }
      >
        {configOpen ? form : null}
      </Sheet>

      <SaveDialog
        open={saveOpen}
        busy={save.isPending}
        suggested={view === undefined ? title : `${view.name} (copia)`}
        onClose={() => setSaveOpen(false)}
        onSave={async (name) => {
          if (config === null || recipe === null) return null;
          try {
            const saved = await save.mutateAsync({ name, recipe: recipeForSave(config, recipe, view?.recipe) });
            setSaveOpen(false);
            void navigate(`/e/${wsId}/informes/${saved.value.id}`, { replace: true });
            return null;
          } catch (e) {
            return isDomainError(e) && e.code === 'duplicate_label' ? t('cfg.nameTaken') : errorMessage(e, tAll);
          }
        }}
      />
    </div>
  );
}

function SaveDialog({
  open,
  busy,
  suggested,
  onClose,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  suggested: string;
  onClose: () => void;
  onSave: (name: string) => Promise<string | null>;
}) {
  const t = useT('reports');
  const [name, setName] = useState(suggested);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(suggested);
      setError(null);
    }
  }, [open, suggested]);
  const submit = async () => {
    if (name.trim() === '') {
      setError(t('cfg.nameError'));
      return;
    }
    setError(await onSave(name.trim()));
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('cfg.saveTitle')} description={t('cfg.saveBody')} confirmLabel={t('cfg.saveConfirm')} confirmLoading={busy} onConfirm={() => void submit()}>
      <Field label={t('cfg.name')} error={error ?? undefined}>
        <Input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </Field>
    </Dialog>
  );
}
