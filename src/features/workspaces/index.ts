// Feature `workspaces`: la raíz `/` (redirige al último espacio, a la bienvenida o muestra el selector).
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'workspaces',
  routes: [{ path: '', scope: 'root', titleKey: 'workspaces.title', lazy: () => import('./routes/Root') }],
};
