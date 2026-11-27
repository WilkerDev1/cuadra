// /e/:wsId/informes — resumido, detallado y los informes guardados. DESIGN 10.12.
import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, FileText, FolderOpen, Trash2 } from 'lucide-react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useViews, useWorkspaceId } from '../../../app/data/hooks';
import { useUiStore } from '../../../app/state/uiStore';
import type { DateRange, SavedView } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { Banner, Button, Dialog, EmptyState, Menu, Skeleton } from '../../../ui';
import { recipeToConfig } from '../model';
import '../reports.css';

function periodText(range: DateRange, t: (k: string, p?: Record<string, string>) => string): string {
  if ('preset' in range) return t(`ui.period.${range.preset}`);
  const from = range.from === undefined ? '…' : formatDate(range.from);
  const to = range.to === undefined ? '…' : formatDate(range.to);
  return t('ui.period.range', { from, to });
}

export function Component() {
  const t = useT('reports');
  const tAll = useT();
  const wsId = useWorkspaceId();
  const cuadra = useCuadra();
  const pushToast = useUiStore((s) => s.pushToast);
  const views = useViews('report');
  const [removing, setRemoving] = useState<SavedView<'report'> | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/e/${wsId}/informes`;

  const remove = async () => {
    if (removing === null) return;
    setBusy(true);
    try {
      await cuadra.views.remove(removing.id);
      pushToast({ message: 'reports.list.removed', params: { name: removing.name } });
      setRemoving(null);
    } catch (e) {
      pushToast({ message: 'common.error.toast', params: { message: errorMessage(e, tAll) }, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rep-wrap rep-wrap--list">
      <h1 className="rep-title">{t('title')}</h1>

      <ul className="rep-list" aria-label={t('title')}>
        {(['summary', 'detailed'] as const).map((form) => (
          <li key={form}>
            <Link to={`${base}/${form === 'summary' ? 'resumido' : 'detallado'}`} className="rep-row">
              <FileText aria-hidden="true" className="rep-row__icon" />
              <span className="rep-row__text">
                <span className="rep-row__title">{t(`list.${form}`)}</span>
                <span className="rep-row__meta">{t(`list.${form}.hint`)}</span>
              </span>
              <ChevronRight aria-hidden="true" className="rep-row__chev" />
            </Link>
          </li>
        ))}
      </ul>

      <section className="rep-saved" aria-labelledby="rep-saved-title">
        <h2 id="rep-saved-title" className="rep-subtitle">
          {t('list.saved')}
        </h2>
        {views.isError ? (
          <Banner
            tone="warn"
            action={
              <Button variant="secondary" onClick={() => void views.refetch()}>
                {t('list.retry')}
              </Button>
            }
          >
            {t('list.error')}
          </Banner>
        ) : views.data === undefined ? (
          <Skeleton rows={3} />
        ) : views.data.length === 0 ? (
          <EmptyState message={t('list.savedEmpty')} rows={3} />
        ) : (
          <ul className="rep-list">
            {views.data.map((v) => {
              const cfg = recipeToConfig(v.recipe);
              return (
                <li key={v.id} className="rep-row-wrap">
                  <Link to={`${base}/${v.id}`} className="rep-row">
                    <FolderOpen aria-hidden="true" className="rep-row__icon" />
                    <span className="rep-row__text">
                      <span className="rep-row__title">{v.name}</span>
                      <span className="rep-row__meta">
                        {t('list.meta', { form: t(`form.${cfg.form}`), period: periodText(cfg.period, tAll) })}
                      </span>
                    </span>
                  </Link>
                  <Menu
                    label={t('list.actions', { name: v.name })}
                    items={[{ id: 'remove', label: t('list.remove'), icon: Trash2, tone: 'danger', onSelect: () => setRemoving(v) }]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        variant="destructive"
        title={t('list.removeTitle', { name: removing?.name ?? '' })}
        description={t('list.removeBody')}
        confirmLabel={t('list.removeConfirm')}
        confirmLoading={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
