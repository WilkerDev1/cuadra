// Galería del sistema de diseño (#/_ui). Solo en desarrollo: collect.ts descarta features con `_`.
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: '_gallery',
  routes: [{ path: '_ui', scope: 'root', titleKey: 'ui.gallery.title', lazy: () => import('./routes/Gallery') }],
};
