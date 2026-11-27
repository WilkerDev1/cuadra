// Historial general (DESIGN 10.12): rastro de cambios del espacio, por día, con filtros y CSV. Liviano: solo descriptores.
import { History } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'audit',
  routes: [{ path: 'historial', scope: 'workspace', titleKey: 'auditlog.title', lazy: () => import('./routes/History') }],
  nav: [
    { id: 'audit', scope: 'workspace', to: 'historial', labelKey: 'auditlog.nav', icon: History, placement: 'more', group: 'book', order: 40, goKey: 'h' },
  ],
};
