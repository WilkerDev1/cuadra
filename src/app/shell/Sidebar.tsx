import { Lock, Search } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useT } from '../../i18n';
import { IconButton } from '../../ui';
import { useAuth } from '../data/auth';
import { useNav } from '../registry/hooks';
import { groupNav, pickActiveNav } from '../registry/select';
import type { NavEntry } from '../registry/types';
import { useUiStore } from '../state/uiStore';
import { Anotar } from './Anotar';
import { ThemeButton } from './ThemeToggle';
import { resolveTo } from './workspaceLink';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const navKey = (entry: NavEntry) => `${entry.scope}:${entry.id}`;

function NavItem({ entry, wsId, active }: { entry: NavEntry; wsId: string | undefined; active: boolean }) {
  const t = useT();
  const { to, labelKey, icon: Icon } = entry;
  return (
    <li>
      <Link to={resolveTo(entry.scope, to, wsId)} aria-current={active ? 'page' : undefined} title={t(labelKey)} viewTransition>
        <Icon aria-hidden size={20} />
        <span>{t(labelKey)}</span>
      </Link>
    </li>
  );
}

/**
 * Riel de 72 px (600–1023 px) y barra lateral de bosque de 248 px (≥ 1024 px): el mismo elemento, con las
 * etiquetas solo visibles cuando hay sitio. Lee las mismas entradas del registro que la barra inferior.
 */
export function Sidebar() {
  const t = useT();
  const { wsId } = useParams();
  const auth = useAuth();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const primary = useNav('workspace', 'primary');
  const wsMore = useNav('workspace', 'more');
  const wsSettings = useNav('workspace', 'settings');
  const rootMore = useNav('root', 'more');
  const rootSettings = useNav('root', 'settings');
  const blocks = [
    primary,
    ...groupNav([...wsMore, ...rootMore]).map((g) => g.entries),
  ].filter((g) => g.length > 0);
  const footer = [...wsSettings, ...rootSettings];
  // Una sola entrada activa: la de ruta más larga que coincida (DESIGN §8.3, el indicador lima va una vez).
  const { pathname } = useLocation();
  const all = [...blocks.flat(), ...footer];
  const activeIndex = pickActiveNav(
    all.map((e) => resolveTo(e.scope, e.to, wsId)),
    pathname,
    all.map((e) => e.to === ''),
  );
  const activeKey = activeIndex < 0 ? null : navKey(all[activeIndex] as NavEntry);
  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <p className="sidebar__brand">{t('common.appName')}</p>
        <WorkspaceSwitcher presentation="popover" tone="on-forest" />
        <button type="button" className="sidebar__search" title={t('common.nav.search')} onClick={() => openOverlay('palette')}>
          <Search aria-hidden size={18} />
          <span>{t('common.nav.search')}</span>
          <kbd aria-hidden>Ctrl K</kbd>
        </button>
        <Anotar variant="side" />
      </div>
      <nav aria-label={t('common.nav.sidebar')}>
        {blocks.map((entries, index) => (
          <Fragment key={entries[0]?.id ?? index}>
            <ul>
              {entries.map((entry) => (
                <NavItem key={navKey(entry)} entry={entry} wsId={wsId} active={navKey(entry) === activeKey} />
              ))}
            </ul>
          </Fragment>
        ))}
      </nav>
      <div className="sidebar__foot">
        {footer.length === 0 ? null : (
          <ul>
            {footer.map((entry) => (
              <NavItem key={navKey(entry)} entry={entry} wsId={wsId} active={navKey(entry) === activeKey} />
            ))}
          </ul>
        )}
        <div className="sidebar__tools">
          <ThemeButton />
          {auth.enabled ? <IconButton variant="on-forest" icon={Lock} label={t('common.lock.action')} onClick={() => void auth.lock()} /> : null}
        </div>
      </div>
    </aside>
  );
}
