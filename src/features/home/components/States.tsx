// Estados del inicio: cargando (sin shimmer), error de carga y libro en blanco.
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useT } from '../../../i18n';
import { Button, EmptyState, Skeleton } from '../../../ui';

export function HomeLoading({ heading }: { heading: ReactNode }) {
  return (
    <div className="home home--state">
      {heading}
      <Skeleton rows={6} />
    </div>
  );
}

export function HomeError({ heading, onRetry }: { heading: ReactNode; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="home home--state">
      {heading}
      <EmptyState
        message={t('home.error.message')}
        action={
          <div className="home-state__actions">
            <Button variant="secondary" onClick={onRetry}>
              {t('home.error.retry')}
            </Button>
            <Link to="/respaldo" className="home-link">
              {t('home.error.backup')}
            </Link>
          </div>
        }
      />
    </div>
  );
}

export function HomeEmpty({ heading, recordHref }: { heading: ReactNode; recordHref: string }) {
  const t = useT();
  const navigate = useNavigate();
  const seed = useCuadraMutation((c) => c.demo.seed('colmado'));
  return (
    <div className="home home--state">
      {heading}
      <EmptyState
        message={t('home.empty.message')}
        rows={6}
        action={
          <div className="home-state__actions">
            {/* El relleno lima ya lo lleva el botón Anotar del shell (DESIGN §6: una acción principal por pantalla). */}
            <Button variant="secondary" onClick={() => void navigate(recordHref)}>
              {t('home.empty.record')}
            </Button>
            <Button
              variant="ghost"
              loading={seed.isPending}
              onClick={() =>
                void seed.mutateAsync(undefined).then((r) => navigate(`/e/${r.value.workspace.id}`), () => undefined)
              }
            >
              {t('home.empty.demo')}
            </Button>
          </div>
        }
      />
    </div>
  );
}
