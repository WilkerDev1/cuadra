// Feature `import` (P-18): asistente de importación de CSV y Excel. Liviano: solo descriptores.
import { FileUp } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'import',
  routes: [{ path: 'importar', scope: 'workspace', titleKey: 'import.title', lazy: () => import('./routes/Import') }],
  nav: [{ id: 'import', scope: 'workspace', to: 'importar', labelKey: 'import.nav', icon: FileUp, placement: 'more', group: 'config', order: 60 }],
  settingsSections: [{ id: 'import', scope: 'workspace', labelKey: 'import.nav', icon: FileUp, to: 'importar', order: 60 }],
};
