// Ajustes del espacio (DESIGN §10.13 y §10.15): índice, espacio, cuentas, campos y listas, vistas guardadas.
import { Bookmark, Building2, Settings, Tags, Wallet } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'settings',
  routes: [
    { path: 'ajustes', scope: 'workspace', titleKey: 'settings.title', lazy: () => import('./routes/Index') },
    { path: 'ajustes/espacio', scope: 'workspace', titleKey: 'settings.sec.space', lazy: () => import('./routes/Workspace') },
    { path: 'ajustes/cuentas', scope: 'workspace', titleKey: 'settings.sec.accounts', lazy: () => import('./routes/Accounts') },
    { path: 'ajustes/campos', scope: 'workspace', titleKey: 'settings.sec.fields', lazy: () => import('./routes/Fields') },
    { path: 'ajustes/campos/:fieldId', scope: 'workspace', titleKey: 'settings.sec.fields', lazy: () => import('./routes/FieldDetail') },
    { path: 'ajustes/vistas', scope: 'workspace', titleKey: 'settings.sec.views', lazy: () => import('./routes/Views') },
  ],
  nav: [
    { id: 'settings', scope: 'workspace', to: 'ajustes', labelKey: 'settings.nav', icon: Settings, placement: 'settings', group: 'config', order: 90 },
    { id: 'fields', scope: 'workspace', to: 'ajustes/campos', labelKey: 'settings.sec.fields', icon: Tags, placement: 'more', group: 'config', order: 40 },
  ],
  settingsSections: [
    { id: 'space', scope: 'workspace', labelKey: 'settings.sec.space', icon: Building2, to: 'ajustes/espacio', order: 10 },
    { id: 'accounts', scope: 'workspace', labelKey: 'settings.sec.accounts', icon: Wallet, to: 'ajustes/cuentas', order: 20 },
    { id: 'fields', scope: 'workspace', labelKey: 'settings.sec.fields', icon: Tags, to: 'ajustes/campos', order: 30 },
    { id: 'views', scope: 'workspace', labelKey: 'settings.sec.views', icon: Bookmark, to: 'ajustes/vistas', order: 40 },
  ],
};
