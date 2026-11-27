// Lista de vistas guardadas de tipo resumen (fijadas primero). La activa lleva aria-current.
import { Link } from 'react-router';
import { Pin, Plus } from 'lucide-react';
import type { SavedView } from '../../../core';
import { useT } from '../../../i18n';
import { cx } from '../../../ui';

export interface ViewListProps {
  views: readonly SavedView<'summary'>[];
  currentId: string | null;
  /** Enlace de cada vista y del resumen nuevo. */
  hrefFor: (id: string | null) => string;
  onPick?: () => void;
}

export function ViewList({ views, currentId, hrefFor, onPick }: ViewListProps) {
  const t = useT();
  const sorted = [...views].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);
  return (
    <nav className="ins-views" aria-label={t('insights.views.open')}>
      <ul role="list" className="ins-views__list">
        <li>
          <Link to={hrefFor(null)} className={cx('ins-views__item', currentId === null && 'is-current')} aria-current={currentId === null ? 'page' : undefined} onClick={onPick}>
            <Plus aria-hidden="true" className="ins-views__icon" />
            <span className="ins-views__name">{t('insights.views.new')}</span>
          </Link>
        </li>
        {sorted.map((v) => (
          <li key={v.id}>
            <Link
              to={hrefFor(v.id)}
              className={cx('ins-views__item', v.id === currentId && 'is-current')}
              aria-current={v.id === currentId ? 'page' : undefined}
              onClick={onPick}
            >
              {v.pinned ? <Pin aria-label={t('insights.views.pinned')} className="ins-views__icon" /> : <span className="ins-views__icon" aria-hidden="true" />}
              <span className="ins-views__name">{v.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {views.length === 0 ? <p className="ins-views__empty">{t('insights.views.empty')}</p> : null}
    </nav>
  );
}
