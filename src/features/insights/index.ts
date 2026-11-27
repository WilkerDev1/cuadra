// Resumen configurable (P-10, DESIGN 10.11). Liviano: solo descriptores; la pantalla carga con `lazy`.
import { ChartColumnBig } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'insights',
  routes: [{ path: 'resumen', scope: 'workspace', titleKey: 'insights.title', lazy: () => import('./routes/Summary') }],
  nav: [
    {
      id: 'insights',
      scope: 'workspace',
      to: 'resumen',
      labelKey: 'insights.nav',
      icon: ChartColumnBig,
      placement: 'primary',
      group: 'book',
      order: 35,
      goKey: 'r',
    },
  ],
};
