// Feature `backup` (P-14 Respaldo, P-15 Ajustes de instalación, Plantillas). Liviano: solo descriptores.
import { LayoutTemplate, Save, SlidersHorizontal } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'backup',
  routes: [
    { path: 'respaldo', scope: 'root', titleKey: 'backup.title', lazy: () => import('./routes/Backup') },
    { path: 'ajustes', scope: 'root', titleKey: 'backup.settings.title', lazy: () => import('./routes/Settings') },
    { path: 'plantillas', scope: 'root', titleKey: 'backup.tpl.title', lazy: () => import('./routes/Templates') },
    { path: 'ajustes/plantilla', scope: 'workspace', titleKey: 'backup.tpl.workspaceTitle', lazy: () => import('./routes/WorkspaceTemplate') },
  ],
  nav: [
    { id: 'backup', scope: 'root', to: 'respaldo', labelKey: 'backup.nav', icon: Save, placement: 'more', group: 'config', order: 80 },
    { id: 'templates', scope: 'root', to: 'plantillas', labelKey: 'backup.templates.nav', icon: LayoutTemplate, placement: 'more', group: 'config', order: 85 },
    { id: 'install-settings', scope: 'root', to: 'ajustes', labelKey: 'backup.settings.nav', icon: SlidersHorizontal, placement: 'settings', group: 'app', order: 90 },
  ],
  settingsSections: [
    { id: 'backup-backup', scope: 'root', labelKey: 'backup.nav', icon: Save, to: 'respaldo', order: 80 },
    { id: 'backup-template', scope: 'workspace', labelKey: 'backup.tpl.workspaceNav', icon: LayoutTemplate, to: 'ajustes/plantilla', order: 70 },
  ],
};
