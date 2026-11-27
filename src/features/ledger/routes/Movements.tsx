// /e/:wsId/movimientos — todos los movimientos del espacio con filtros, vistas, totales y exportación.
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Layers } from 'lucide-react';
import type { DateRange } from '../../../core';
import { useViews, useWorkspace, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Banner } from '../../../ui';
import { FilterBar } from '../components/FilterBar';
import { LedgerView } from '../components/LedgerView';
import { useUrlFilter } from '../data';
import { filterChips } from '../logic/filterChips';
import { normalizeFilter } from '../../../app/data/txFilterUrl';
import '../ledger.css';

const DEFAULT_PERIOD: DateRange = { preset: 'this_month' };

export function Component() {
  const t = useT();
  const ws = useWorkspaceId();
  const workspace = useWorkspace();
  const { filter, setFilter, viewId, invalid } = useUrlFilter({ defaultPeriod: DEFAULT_PERIOD });
  const views = useViews('filter');

  // `?vista=<id>`: abrir la vista y reescribir la URL con su filtro.
  useEffect(() => {
    if (viewId === null || views.data === undefined) return;
    const view = views.data.find((v) => v.id === viewId);
    const f = view?.recipe.filter;
    setFilter(f === undefined ? filter : normalizeFilter({ ...f, period: f.period ?? { preset: 'all' } }), { replace: true });
  }, [viewId, views.data, filter, setFilter]);

  const filtered =
    filterChips(filter, { accounts: [], fields: [], money: String, date: String, t }).length > 0 ||
    JSON.stringify(filter.period) !== JSON.stringify(DEFAULT_PERIOD);

  return (
    <div className="lg">
      <header className="lg-head">
        <h1>{t('ledger.title')}</h1>
        <Link className="lg-head__link" to={`/e/${ws}/lotes`}>
          <Layers aria-hidden="true" />
          {t('ledger.batches.link')}
        </Link>
      </header>
      {invalid ? <Banner tone="info">{t('ledger.filter.invalidLink')}</Banner> : null}
      <FilterBar filter={filter} setFilter={setFilter} defaultPeriod={DEFAULT_PERIOD} views exportName={`${t('ledger.export.base')} ${workspace.data?.name ?? ''}`} />
      <LedgerView filter={filter} filtered={filtered} onClearFilters={() => setFilter({ period: DEFAULT_PERIOD })} />
    </div>
  );
}
