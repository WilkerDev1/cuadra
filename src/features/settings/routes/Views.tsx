// ajustes/vistas: las vistas guardadas de los tres tipos (filtros, resúmenes, informes): renombrar, duplicar,
// reordenar y eliminar. Eliminar solo las saca de la lista: queda en el historial.
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describeFilter, type Account, type Field, type SavedView, type TxFilter, type Warning } from '../../../core';
import { useAccounts, useFields, useViews, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Banner, Dialog, EmptyState, Field as FormField, InfoTip, Input, LedgerList, Menu } from '../../../ui';
import { Frame } from '../components/Frame';
import { Gate } from '../components/Load';
import { ReorderButtons, useAnnouncer } from '../components/Reorder';
import { fullOrder, moveId, positionOf } from '../lib/reorder';
import { useRun } from '../lib/useRun';

const KINDS = ['filter', 'summary', 'report'] as const;
type Kind = (typeof KINDS)[number];

export function Component() {
  const t = useT('settings');
  const filters = useViews('filter');
  const summaries = useViews('summary');
  const reports = useViews('report');
  const fields = useFields({ includeInactive: true });
  const accounts = useAccounts({ includeArchived: true });
  const empty = [filters, summaries, reports].every((q) => (q.data?.length ?? 0) === 0);
  const ctx = { fields: fields.data ?? [], accounts: accounts.data ?? [] };
  return (
    <Frame title={t('sec.views')}>
      <Gate queries={[filters, summaries, reports, fields, accounts]}>
        {empty ? (
          <EmptyState message={t('views.empty')} />
        ) : (
          <div className="set-stack">
            <ViewsKind kind="filter" views={toRows(filters.data)} {...ctx} />
            <ViewsKind kind="summary" views={toRows(summaries.data)} {...ctx} />
            <ViewsKind kind="report" views={toRows(reports.data)} {...ctx} />
          </div>
        )}
      </Gate>
    </Frame>
  );
}

/** Lo que esta pantalla necesita de una vista, sea del tipo que sea. */
interface ViewRow {
  id: string;
  name: string;
  source: 'user' | 'template';
  warnings: Warning[];
  filter: TxFilter;
}

type AnyView = Pick<SavedView, 'id' | 'name' | 'source' | 'warnings'> & { recipe: { filter: TxFilter } };
const toRows = (views: readonly AnyView[] | undefined): ViewRow[] =>
  (views ?? []).map((v) => ({ id: v.id, name: v.name, source: v.source, warnings: v.warnings, filter: v.recipe.filter }));

function recipeSummary(view: ViewRow, ctx: { fields: Field[]; accounts: Account[] }, none: string): string {
  const lines = describeFilter(view.filter, ctx);
  return lines.length === 0 ? none : lines.slice(0, 2).join(' · ');
}

function ViewsKind({ kind, views, fields, accounts }: { kind: Kind; views: ViewRow[]; fields: Field[]; accounts: Account[] }) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const { run, error } = useRun();
  const [live, announce] = useAnnouncer();
  const [renaming, setRenaming] = useState<ViewRow | null>(null);
  const [deleting, setDeleting] = useState<ViewRow | null>(null);
  const ids = views.map((v) => v.id);
  if (views.length === 0) return null;

  const move = async (view: ViewRow, delta: -1 | 1) => {
    const next = moveId(ids, view.id, delta);
    if (next === null) return;
    const where = positionOf(next, view.id);
    const r = await run((c) => c.views.reorder(wsId, kind, fullOrder(next, [])));
    if (r.ok && where !== null) announce(t('moved', { name: view.name, position: where.position, total: where.total }));
  };
  const duplicate = (view: ViewRow) =>
    run(
      (c) => c.views.duplicate(view.id),
      (m) => ({ key: 'settings.views.duplicated', params: { name: m.value.name } }),
    );

  return (
    <section className="set-sec" aria-labelledby={`set-views-${kind}`}>
      <h2 id={`set-views-${kind}`} className="set-h2">
        {t(`views.kind.${kind}`)}
      </h2>
      {error === null ? null : <Banner tone="warn">{error}</Banner>}
      {live}
      <LedgerList label={t(`views.kind.${kind}`)}>
        {views.map((view, i) => (
          <div key={view.id} role="listitem" className="set-row">
            <span className="set-row__text">
              <span className="set-row__title truncate">
                {view.name}
                {view.warnings.length > 0 ? (
                  <>
                    {' '}
                    <InfoTip tone="warn" label={view.name}>
                      {t('views.warn')}
                    </InfoTip>
                  </>
                ) : null}
              </span>
              <span className="set-row__meta truncate">
                {recipeSummary(view, { fields, accounts }, t('views.noFilters'))}
              </span>
            </span>
            <ReorderButtons name={view.name} canUp={i > 0} canDown={i < views.length - 1} onMove={(d) => void move(view, d)} />
            <Menu
              label={t('views.more', { name: view.name })}
              items={[
                { id: 'rename', label: t('views.rename'), icon: Pencil, onSelect: () => setRenaming(view) },
                { id: 'duplicate', label: t('views.duplicate'), icon: Copy, onSelect: () => void duplicate(view) },
                { id: 'delete', label: t('views.delete'), icon: Trash2, tone: 'danger', onSelect: () => setDeleting(view) },
              ]}
            />
          </div>
        ))}
      </LedgerList>
      <RenameDialog view={renaming} onClose={() => setRenaming(null)} />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="destructive"
        title={t('views.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('views.deleteBody')}
        confirmLabel={t('views.delete')}
        onConfirm={() => {
          const view = deleting;
          setDeleting(null);
          if (view !== null) {
            void run(
              (c) => c.views.remove(view.id),
              () => ({ key: 'settings.views.deleted', params: { name: view.name } }),
            );
          }
        }}
      />
    </section>
  );
}

function RenameDialog({ view, onClose }: { view: ViewRow | null; onClose: () => void }) {
  return view === null ? null : <RenameBody key={view.id} view={view} onClose={onClose} />;
}

function RenameBody({ view, onClose }: { view: ViewRow; onClose: () => void }) {
  const t = useT('settings');
  const { run, error, busy } = useRun();
  const [name, setName] = useState(view.name);
  const save = async () => {
    const next = name.trim();
    if (next === view.name) return onClose();
    const r = await run(
      (c) => c.views.update(view.id, { name: next }),
      (m) => ({ key: 'settings.views.renamed', params: { name: m.value.name } }),
    );
    if (r.ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t('views.renameTitle')} confirmLabel={t('save')} onConfirm={() => void save()} confirmLoading={busy}>
      <div className="set-dialog">
        {error === null ? null : <Banner tone="warn">{error}</Banner>}
        <FormField label={t('views.renameLabel')}>
          <Input
            value={name}
            autoFocus
            autoComplete="off"
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
          />
        </FormField>
      </div>
    </Dialog>
  );
}
