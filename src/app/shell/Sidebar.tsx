import { NavLink, useParams } from 'react-router';
import { useT } from '../../i18n';
import { useNav } from '../registry/hooks';
import { resolveTo } from './workspaceLink';

/** Barra lateral (escritorio ≥ 960 px). Lee las mismas entradas que la barra inferior. */
export function Sidebar() {
  const t = useT();
  const { wsId } = useParams();
  const primary = useNav('workspace', 'primary');
  const more = useNav('workspace', 'more');
  const settings = useNav('workspace', 'settings');
  const groups = [primary, more, settings].filter((g) => g.length > 0);
  return (
    <aside className="sidebar">
      <p className="sidebar-brand">{t('common.appName')}</p>
      <nav aria-label={t('common.nav.sidebar')}>
        {groups.map((group, index) => (
          <ul key={group[0]?.placement ?? index}>
            {group.map(({ id, to, labelKey, icon: Icon }) => (
              <li key={id}>
                <NavLink to={resolveTo('workspace', to, wsId)} end={to === ''}>
                  <Icon aria-hidden size={20} />
                  <span>{t(labelKey)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        ))}
      </nav>
    </aside>
  );
}
