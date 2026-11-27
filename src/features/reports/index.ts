// Informes (DESIGN 10.12): lista, informe imprimible y exportación a CSV y Excel. Liviano: solo descriptores.
import { FileText } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'reports',
  routes: [
    { path: 'informes', scope: 'workspace', titleKey: 'reports.title', lazy: () => import('./routes/ReportList') },
    { path: 'informes/:id', scope: 'workspace', titleKey: 'reports.viewTitle', lazy: () => import('./routes/ReportView') },
  ],
  nav: [
    { id: 'reports', scope: 'workspace', to: 'informes', labelKey: 'reports.nav', icon: FileText, placement: 'more', group: 'book', order: 30, goKey: 'n' },
  ],
};
