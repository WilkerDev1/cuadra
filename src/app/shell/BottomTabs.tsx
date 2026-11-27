import { NavLink, useParams } from 'react-router';
import { useT } from '../../i18n';
import { useNav } from '../registry/hooks';
import { resolveTo } from './workspaceLink';

/** Barra inferior (móvil). Muestra las entradas `primary` del registro, hasta 4. */
export function BottomTabs() {
  const t = useT();
  const { wsId } = useParams();
  const entries = useNav('workspace', 'primary').slice(0, 4);
  return (
    <nav className="bottom-tabs" aria-label={t('common.nav.primary')}>
      <ul>
        {entries.map(({ id, to, labelKey, icon: Icon }) => (
          <li key={id}>
            <NavLink to={resolveTo('workspace', to, wsId)} end={to === ''}>
              <Icon aria-hidden size={22} />
              <span>{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
