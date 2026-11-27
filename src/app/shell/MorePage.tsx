import { ChevronRight, Keyboard, Lock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useT } from '../../i18n';
import { useAuth } from '../data/auth';
import { useNav, useSettingsSections } from '../registry/hooks';
import { useUiStore } from '../state/uiStore';
import { buildMoreGroups } from './more';
import { ThemeSegmented } from './ThemeToggle';
import { resolveTo } from './workspaceLink';

/** «Más» (móvil): los destinos que no caben en la barra inferior, la apariencia y la app. */
export function MorePage() {
  const t = useT();
  const { wsId } = useParams();
  const auth = useAuth();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const primary = useNav('workspace', 'primary');
  const more = [
    ...useNav('workspace', 'more'),
    ...useNav('workspace', 'settings'),
    ...useNav('root', 'more'),
    ...useNav('root', 'settings'),
  ];
  const sections = [...useSettingsSections('workspace'), ...useSettingsSections('root')];
  const groups = buildMoreGroups({ primary, more, sections });
  return (
    <div className="more">
      <h1 className="shell-title">{t('common.more.title')}</h1>
      {groups.map(({ group, entries }) => (
        <section key={group} className="more__group" aria-labelledby={`more-${group}`}>
          <h2 id={`more-${group}`} className="more__heading">
            {t(`common.group.${group}`)}
          </h2>
          <ul className="more__list">
            {entries.map(({ id, scope, to, labelKey, icon: Icon }) => (
              <li key={`${scope}:${id}`}>
                <Link to={resolveTo(scope, to, wsId)} viewTransition>
                  <Icon aria-hidden size={20} />
                  <span>{t(labelKey)}</span>
                  <ChevronRight aria-hidden size={18} className="more__chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="more__group" aria-labelledby="more-appearance">
        <h2 id="more-appearance" className="more__heading">
          {t('common.more.appearance')}
        </h2>
        <ThemeSegmented />
      </section>
      <section className="more__group" aria-labelledby="more-app">
        <h2 id="more-app" className="more__heading">
          {t('common.more.app')}
        </h2>
        <ul className="more__list">
          <li>
            <button type="button" onClick={() => openOverlay('help')}>
              <Keyboard aria-hidden size={20} />
              <span>{t('common.palette.shortcuts')}</span>
              <ChevronRight aria-hidden size={18} className="more__chevron" />
            </button>
          </li>
          {auth.enabled ? (
            <li>
              <button type="button" onClick={() => void auth.lock()}>
                <Lock aria-hidden size={20} />
                <span>{t('common.palette.lock')}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
