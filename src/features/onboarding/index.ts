// Feature `onboarding`: bienvenida, plantillas con vista previa, saldos iniciales y datos de ejemplo.
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'onboarding',
  routes: [
    { path: 'bienvenida', scope: 'root', titleKey: 'onboarding.title', lazy: () => import('./routes/Wizard') },
    { path: 'bienvenida/plantilla/:templateId', scope: 'root', titleKey: 'onboarding.title', lazy: () => import('./routes/Preview') },
  ],
};
