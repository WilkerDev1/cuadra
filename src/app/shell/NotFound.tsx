import { Link } from 'react-router';
import { useT } from '../../i18n';
import { useDocumentTitle } from './useRouteEffects';

export function NotFound() {
  const t = useT('common');
  useDocumentTitle(t('notFound.title'));
  return (
    <main className="shell-center">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link className="shell-button" to="/">
        {t('notFound.action')}
      </Link>
    </main>
  );
}
