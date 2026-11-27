// Estados de carga, error y vacío comunes a las pantallas de captura (DESIGN §10.16, sin shimmer).
import { Link } from 'react-router';
import { errorMessage } from '../../../app/data/errorMessage';
import { useWorkspaceId } from '../../../app/data/hooks';
import { t as tGlobal, useT } from '../../../i18n';
import { Button, EmptyState, Skeleton } from '../../../ui';

export function Loading() {
  const t = useT('capture');
  return <Skeleton label={t('state.loading')} rows={4} />;
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT('capture');
  return (
    <div className="cap-state" role="alert">
      <p className="cap-state__text">{t('state.error')}</p>
      <p className="cap-meta">{errorMessage(error, tGlobal)}</p>
      <Button variant="secondary" onClick={onRetry}>
        {t('state.retry')}
      </Button>
    </div>
  );
}

/** Sin cuentas activas no se puede anotar: se lleva a Cuentas. */
export function NoAccounts({ message }: { message?: string }) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  return (
    <EmptyState
      message={message ?? t('state.noAccounts')}
      action={
        <Link className="ui-btn ui-btn--secondary" to={`/e/${ws}/cuentas`}>
          <span className="ui-btn__label">{t('state.goAccounts')}</span>
        </Link>
      }
    />
  );
}

/** Movimiento anulado: no se edita (primero se restaura desde su detalle). */
export function VoidedNotice({ txId }: { txId: string }) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  return (
    <EmptyState
      message={t('state.voided')}
      action={
        <Link className="ui-btn ui-btn--secondary" to={`/e/${ws}/movimientos/${txId}`}>
          <span className="ui-btn__label">{t('state.openDetail')}</span>
        </Link>
      }
    />
  );
}
