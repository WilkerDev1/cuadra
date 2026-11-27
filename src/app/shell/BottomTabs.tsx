import { Ellipsis } from 'lucide-react';
import { NavLink, useParams } from 'react-router';
import { useT } from '../../i18n';
import { useNav } from '../registry/hooks';
import { splitBottomBar } from '../registry/select';
import { Anotar } from './Anotar';
import { resolveTo } from './workspaceLink';

/**
 * Barra inferior (compacta): los dos primeros destinos primarios, «Más» y la pastilla Anotar a la derecha
 * (DESIGN §8.2). El resto de destinos vive en la página «Más».
 */
export function BottomTabs() {
  const t = useT();
  const { wsId } = useParams();
  const primary = useNav('workspace', 'primary');
  const { tabs } = splitBottomBar(primary);
  return (
    <div className="bottom-bar">
      <nav className="bottom-tabs" aria-label={t('common.nav.primary')}>
        <ul>
          {tabs.map(({ id, to, labelKey, icon: Icon }) => (
            <li key={id}>
              <NavLink to={resolveTo('workspace', to, wsId)} end={to === ''} viewTransition>
                <Icon aria-hidden size={22} />
                <span>{t(labelKey)}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to={resolveTo('workspace', 'mas', wsId)} viewTransition>
              <Ellipsis aria-hidden size={22} />
              <span>{t('common.nav.more')}</span>
            </NavLink>
          </li>
        </ul>
      </nav>
      <Anotar variant="pill" />
    </div>
  );
}
