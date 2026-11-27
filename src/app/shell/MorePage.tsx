import { ChevronRight, Keyboard, Lock } from 'lucide-react';
import { useId } from 'react';
import { Link, useParams } from 'react-router';
import { useT } from '../../i18n';
import { useAuth } from '../data/auth';
import { useNav, useSettingsSections } from '../registry/hooks';
import type { NavEntry } from '../registry/types';
import { useUiStore } from '../state/uiStore';
import { buildMoreGroups } from './more';
import { SingleKeySwitch } from './SingleKeySwitch';
import { ThemeSegmented } from './ThemeToggle';
import { resolveTo } from './workspaceLink';

function EntryLink({ entry, wsId }: { entry: NavEntry; wsId: string | undefined }) {
  const t = useT();
  const { scope, to, labelKey, icon: Icon } = entry;
  return (
    <li>
      <Link to={resolveTo(scope, to, wsId)} viewTransition>
        <Icon aria-hidden size={20} />
        <span>{t(labelKey)}</span>
        <ChevronRight aria-hidden size={18} className="more__chevron" />
      </Link>
    </li>
  );
}

/**
 * «Más» (móvil, DESIGN §10.15): Libro y Configuración (lo que no cabe en la barra inferior), Apariencia y, al final,
 * un único bloque App con los destinos del registro, los atajos (solo con teclado físico) y Bloquear.
 */
export function MorePage() {
  const t = useT();
  const { wsId } = useParams();
  const auth = useAuth();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const ids = useId();
  const primary = useNav('workspace', 'primary');
  const more = [
    ...useNav('workspace', 'more'),
    ...useNav('workspace', 'settings'),
    ...useNav('root', 'more'),
    ...useNav('root', 'settings'),
  ];
  const sections = [...useSettingsSections('workspace'), ...useSettingsSections('root')];
  const groups = buildMoreGroups({ primary, more, sections });
  const appEntries = groups.find((g) => g.group === 'app')?.entries ?? [];
  const headingId = (name: string) => `${ids}-${name}`;
  return (
    <div className="more">
      <h1 className="shell-title">{t('common.more.title')}</h1>
      {groups
        .filter(({ group }) => group !== 'app')
        .map(({ group, entries }) => (
          <section key={group} className="more__group" aria-labelledby={headingId(group)}>
            <h2 id={headingId(group)} className="more__heading">
              {t(`common.group.${group}`)}
            </h2>
            <ul className="more__list">
              {entries.map((entry) => (
                <EntryLink key={`${entry.scope}:${entry.id}`} entry={entry} wsId={wsId} />
              ))}
            </ul>
          </section>
        ))}
      <section className="more__group" aria-labelledby={headingId('appearance')}>
        <h2 id={headingId('appearance')} className="more__heading">
          {t('common.more.appearance')}
        </h2>
        <ThemeSegmented />
      </section>
      <section className="more__group" aria-labelledby={headingId('app')}>
        <h2 id={headingId('app')} className="more__heading">
          {t('common.group.app')}
        </h2>
        <ul className="more__list">
          {appEntries.map((entry) => (
            <EntryLink key={`${entry.scope}:${entry.id}`} entry={entry} wsId={wsId} />
          ))}
          {/* Atajos de teclado: en un teléfono sin teclado físico no sirven de nada. */}
          <li className="more__keyboard">
            <button type="button" onClick={() => openOverlay('help')}>
              <Keyboard aria-hidden size={20} />
              <span>{t('common.palette.shortcuts')}</span>
              <ChevronRight aria-hidden size={18} className="more__chevron" />
            </button>
          </li>
          <li className="more__keyboard more__switch">
            <SingleKeySwitch />
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
