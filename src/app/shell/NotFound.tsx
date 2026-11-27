import { Link } from 'react-router';
import { useT } from '../../i18n';

export function NotFound() {
  const t = useT('common');
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
