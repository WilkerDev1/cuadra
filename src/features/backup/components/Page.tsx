import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '../../../i18n';
import { Banner, Button, cx } from '../../../ui';
import '../backup.css';

export interface PageProps {
  title: string;
  /** Dentro de un espacio el shell ya pone el relleno y no hay vínculo de regreso. */
  embedded?: boolean;
  children: ReactNode;
  className?: string;
}

/** Marco de las pantallas de la feature: título H1 y, fuera de un espacio, vínculo de regreso a «Espacios». */
export function Page({ title, embedded = false, children, className }: PageProps) {
  const t = useT();
  return (
    <div className={cx('bk-page', embedded && 'bk-page--embedded', className)}>
      <header className="bk-head">
        {embedded ? null : (
          <Link to="/" className="bk-back">
            <ArrowLeft aria-hidden="true" />
            {t('backup.back')}
          </Link>
        )}
        <h1 className="bk-title">{title}</h1>
      </header>
      {children}
    </div>
  );
}

/** Error de carga con reintento (DESIGN §10.16: errores de carga). */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <Banner
      tone="warn"
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t('backup.retry')}
        </Button>
      }
    >
      {t('backup.error')}
    </Banner>
  );
}
