import { Link } from 'react-router';
import { useT } from '../../i18n';
import { Card, EmptyState } from '../../ui';
import { useBootInfo } from './bootInfo';

/**
 * Índice de `/e/:wsId` mientras ninguna feature reclama la ruta vacía del espacio (la reclamará `home`).
 * Muestra cómo se abrió el libro: sirve de comprobación del arranque en cualquier navegador.
 */
export function WorkspaceStatus() {
  const t = useT('common');
  const { storage, schema, sqliteVersion } = useBootInfo();
  const where = storage.persistent ? t(`status.kind.${storage.kind}`) : t('status.memoryOnly');
  return (
    <div className="shell-page">
      <h1 className="shell-title">{t('appName')}</h1>
      <Card as="section" aria-labelledby="shell-status-title">
        <h2 id="shell-status-title" className="shell-subtitle">
          {t('status.title')}
        </h2>
        <dl className="shell-facts">
          <dt>{t('status.storage')}</dt>
          <dd>{where}</dd>
          <dt>{t('status.engine')}</dt>
          <dd>{t('status.engineValue', { version: sqliteVersion })}</dd>
          <dt>{t('status.schema')}</dt>
          <dd>
            {t('status.schemaValue', { n: schema.to })} · {t('status.migrations', { n: schema.applied.length })}
          </dd>
          <dt>{t('status.tabLock')}</dt>
          <dd>{storage.tabLock ? t('status.yes') : t('status.no')}</dd>
        </dl>
      </Card>
      <EmptyState
        message={t('status.empty')}
        rows={3}
        {...(import.meta.env.DEV ? { action: <Link to="/_ui">{t('status.gallery')}</Link> } : {})}
      />
    </div>
  );
}
