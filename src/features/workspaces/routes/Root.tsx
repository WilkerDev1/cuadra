import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useWorkspaces } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useUiStore } from '../../../app/state/uiStore';
import type { WorkspaceSummary } from '../../../core';
import { useT } from '../../../i18n';
import { Banner, Button, EmptyState, Input, Segmented, Skeleton, type MenuItem } from '../../../ui';
import { ActiveRow, ArchivedRow } from '../components/WorkspaceRow';
import { EditDialog } from '../components/EditDialog';
import { PurgeDialog } from '../components/PurgeDialog';
import { filterAndSort, resolveRoot, showsTools, splitWorkspaces, type WorkspaceSort } from '../logic';
import '../workspaces.css';

/**
 * ¿Es esta la primera entrada de la sesión (se acaba de abrir la app en `/`)? React Router marca con `idx: 0` el
 * estado del historial en que arrancó; cualquier navegación posterior (el enlace «Ver todos», Atrás desde otra
 * pantalla, un cambio manual del hash) tiene otro valor y debe mostrar el selector, no rebotar al último espacio.
 */
function isAppEntry(): boolean {
  return (window.history.state as { idx?: number } | null)?.idx === 0;
}

export function Component() {
  const t = useT();
  const list = useWorkspaces({ includeArchived: true });
  const lastId = useUiStore((s) => s.lastWorkspaceId);
  const [initialEntry] = useState(isAppEntry);
  const target = useMemo(
    () => (list.data === undefined ? null : resolveRoot(list.data, lastId, initialEntry)),
    // `lastId` cambia al visitar un espacio; solo cuenta al abrir la app, y esa decisión se toma una vez por carga.
    [list.data, initialEntry],
  );

  if (list.isError) {
    return (
      <div className="wsp">
        <Banner
          tone="warn"
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t('workspaces.retry')}
            </Button>
          }
        >
          {t('workspaces.error')}
        </Banner>
      </div>
    );
  }
  if (list.data === undefined || target === null) {
    return (
      <div className="wsp">
        <Skeleton label={t('workspaces.loading')} />
      </div>
    );
  }
  if (target.kind === 'redirect') return <Navigate to={target.to} replace />;
  return <Picker list={list.data} />;
}

function Picker({ list }: { list: readonly WorkspaceSummary[] }) {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkspaceSort>('recent');
  const [editing, setEditing] = useState<{ ws: WorkspaceSummary; open: boolean } | null>(null);
  const [purging, setPurging] = useState<{ ws: WorkspaceSummary; open: boolean } | null>(null);

  const { active, archived } = useMemo(() => splitWorkspaces(list), [list]);
  const shown = useMemo(() => filterAndSort(active, query, sort), [active, query, sort]);
  const tools = showsTools(active.length);

  const archive = useCuadraMutation((c, ws: WorkspaceSummary) => c.workspaces.archive(ws.id), {
    successToast: (w) => ({ key: 'workspaces.toast.archived', params: { name: w.name } }),
    undo: (c, w) => c.workspaces.unarchive(w.id),
  });
  const unarchive = useCuadraMutation((c, ws: WorkspaceSummary) => c.workspaces.unarchive(ws.id), {
    successToast: (w) => ({ key: 'workspaces.toast.unarchived', params: { name: w.name } }),
  });

  const menuFor = (ws: WorkspaceSummary, isArchived: boolean): MenuItem[] => [
    { id: 'edit', label: t('workspaces.edit'), icon: Pencil, onSelect: () => setEditing({ ws, open: true }) },
    isArchived
      ? { id: 'unarchive', label: t('workspaces.unarchive'), icon: ArchiveRestore, onSelect: () => unarchive.mutate(ws) }
      : { id: 'archive', label: t('workspaces.archive'), icon: Archive, onSelect: () => archive.mutate(ws) },
    { id: 'purge', label: t('workspaces.purge'), icon: Trash2, tone: 'danger', onSelect: () => setPurging({ ws, open: true }) },
  ];

  const create = () => void navigate('/bienvenida', { viewTransition: true });

  return (
    <div className="wsp">
      <p className="wsp-brand" aria-hidden="true">
        {t('common.appName')}
        <span className="wsp-brand__seal" />
      </p>
      <header className="wsp-head">
        <h1 className="wsp-head__title">{t('workspaces.title')}</h1>
        <Button variant="primary" icon={Plus} onClick={create} className="wsp-new wsp-new--head">
          {t('workspaces.new')}
        </Button>
      </header>

      {tools.search || tools.sort ? (
        <div className="wsp-tools">
          {tools.search ? (
            <Input
              type="search"
              className="wsp-search"
              placeholder={t('workspaces.search')}
              aria-label={t('workspaces.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          ) : null}
          {tools.sort ? (
            <Segmented
              label={t('workspaces.sort')}
              options={[
                { value: 'recent', label: t('workspaces.sort.recent') },
                { value: 'name', label: t('workspaces.sort.name') },
              ]}
              value={sort}
              onChange={setSort}
            />
          ) : null}
        </div>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          message={t('workspaces.empty')}
          action={
            <Button variant="secondary" icon={Plus} onClick={create}>
              {t('workspaces.new')}
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState variant="no-results" message={t('workspaces.noMatch')} rows={3} />
      ) : (
        <ul className="wsp-list" role="list">
          {shown.map((ws) => (
            <ActiveRow key={ws.id} ws={ws} items={menuFor(ws, false)} />
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <details className="wsp-archived">
          <summary className="wsp-archived__sum">{t('workspaces.archived', { n: archived.length })}</summary>
          <ul className="wsp-list wsp-list--archived" role="list">
            {archived.map((ws) => (
              <ArchivedRow
                key={ws.id}
                ws={ws}
                items={menuFor(ws, true)}
                onRestore={() => unarchive.mutate(ws)}
                restoring={unarchive.isPending && unarchive.variables?.id === ws.id}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {active.length === 0 ? null : (
        <div className="wsp-newbar">
          <Button variant="primary" icon={Plus} fullWidth onClick={create} className="wsp-new">
            {t('workspaces.new')}
          </Button>
        </div>
      )}

      <EditDialog ws={editing?.ws ?? null} open={editing?.open === true} onClose={() => setEditing((e) => (e === null ? e : { ...e, open: false }))} />
      <PurgeDialog ws={purging?.ws ?? null} open={purging?.open === true} onClose={() => setPurging((p) => (p === null ? p : { ...p, open: false }))} />
    </div>
  );
}
