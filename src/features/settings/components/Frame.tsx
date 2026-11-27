// Marco de Ajustes (DESIGN §10.15): en móvil, el índice es una lista y cada sección es una página con «‹ Ajustes»;
// en ancho, índice a la izquierda y contenido a la derecha. El contenedor `settings` mide el cuerpo, no la ventana.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useSettingsSections } from '../../../app/registry/hooks';
import type { SettingsSectionDef } from '../../../app/registry/types';
import { useT } from '../../../i18n';
import { cx } from '../../../ui';
import '../settings.css';

export function sectionPath(wsId: string, section: Pick<SettingsSectionDef, 'scope' | 'to'>): string {
  return section.scope === 'workspace' ? `/e/${wsId}/${section.to}` : `/${section.to}`;
}

export interface FrameProps {
  title: ReactNode;
  /** Es la página índice: en compacta solo se ve la lista. */
  index?: boolean;
  /** «‹ …» de compacta: por defecto vuelve al índice. */
  back?: { to: string; label: string };
  /** Acciones a la derecha del título (la principal, si hay). */
  actions?: ReactNode;
  children: ReactNode;
}

export function Frame({ title, index = false, back, actions, children }: FrameProps) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const sections = [...useSettingsSections('workspace'), ...useSettingsSections('root')];
  const backTo = back?.to ?? `/e/${wsId}/ajustes`;
  return (
    <div className="set">
      <header className="set-head">
        {index ? null : (
          <Link className="set-back" to={backTo} viewTransition>
            <ChevronLeft aria-hidden="true" />
            <span>{back?.label ?? t('back')}</span>
          </Link>
        )}
        <div className="set-headrow">
          <h1 className="set-title">{title}</h1>
          {actions === undefined ? null : <div className="set-actions">{actions}</div>}
        </div>
      </header>
      <div className="set-cols">
        <nav className="set-index" aria-label={t('index.label')} data-compact-hidden={index ? undefined : ''}>
          <ul className="set-index__list">
            {sections.map(({ id, scope, to, labelKey, icon: Icon }) => (
              <li key={`${scope}:${id}`}>
                <NavLink className="set-index__link" to={sectionPath(wsId, { scope, to })} viewTransition>
                  <Icon aria-hidden="true" />
                  <span>{t(labelKey)}</span>
                  <ChevronRight aria-hidden="true" className="set-index__chev" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={cx('set-body')} data-compact-hidden={index ? '' : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
