// Estados de carga y error de una o varias consultas (DESIGN §10.16): sin esqueleto brillante, texto tras 300 ms.
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DomainError } from '../../../core';
import { useT } from '../../../i18n';
import { Banner, Button, Skeleton } from '../../../ui';

type Q = UseQueryResult<unknown, DomainError>;

/** Muestra el error (con Reintentar) o la carga mientras alguna consulta no tenga datos; luego `children`. */
export function Gate({ queries, children }: { queries: readonly Q[]; children: ReactNode }) {
  const t = useT('settings');
  if (queries.some((q) => q.isError)) {
    return (
      <Banner
        tone="warn"
        action={
          <Button variant="secondary" onClick={() => queries.forEach((q) => void q.refetch())}>
            {t('load.retry')}
          </Button>
        }
      >
        {t('load.error')}
      </Banner>
    );
  }
  if (queries.some((q) => q.data === undefined)) return <Skeleton rows={4} />;
  return <>{children}</>;
}

export function Load<T>({ query, children }: { query: UseQueryResult<T, DomainError>; children: (data: T) => ReactNode }) {
  return <Gate queries={[query]}>{query.data === undefined ? null : children(query.data)}</Gate>;
}
