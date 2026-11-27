import type { ComponentType } from 'react';
import { useT } from '../../../i18n';
import { EmptyState } from '../../../ui';

/** Pantalla de relleno del banco de pruebas: un h1 con el título dado y un vacío. */
export function pageFor(titleKey: string): ComponentType {
  return function PreviewPage() {
    const t = useT();
    return (
      <div className="shell-page">
        <h1 className="shell-title">{t(titleKey)}</h1>
        <EmptyState message={t('common.dev.empty')} rows={4} />
      </div>
    );
  };
}
