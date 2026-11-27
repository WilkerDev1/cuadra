// Banco de pruebas del shell (solo desarrollo: el id empieza por `_`, así que collect.ts lo descarta en producción).
// Registra rutas, navegación, acciones de Anotar y secciones de ajustes de mentira para ejercitar el shell antes de que
// existan las features reales de la Ola 3. También sirve de ejemplo vivo de cómo se registra una feature.
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  FileText,
  House,
  Landmark,
  Rows3,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import type { FeatureModule } from '../../registry/types';

const page = (titleKey: string) => async () => ({ Component: (await import('./Page')).pageFor(titleKey) });
const sheet = () => import('./SheetBody');

export const feature: FeatureModule = {
  id: '_shellPreview',
  routes: [
    { path: 'movimientos', scope: 'workspace', titleKey: 'common.dev.movimientos', lazy: page('common.dev.movimientos') },
    { path: 'resumen', scope: 'workspace', titleKey: 'common.dev.resumen', lazy: page('common.dev.resumen') },
    { path: 'cuentas', scope: 'workspace', titleKey: 'common.dev.cuentas', lazy: page('common.dev.cuentas') },
    { path: 'informes', scope: 'workspace', titleKey: 'common.dev.informes', lazy: page('common.dev.informes') },
    { path: 'captura', scope: 'workspace', titleKey: 'common.dev.captura', lazy: page('common.dev.captura') },
    { path: 'ajustes', scope: 'workspace', titleKey: 'common.dev.ajustes', lazy: page('common.dev.ajustes') },
    { path: 'ajustes/campos', scope: 'workspace', titleKey: 'common.dev.campos', lazy: page('common.dev.campos') },
    { path: 'nuevo', scope: 'workspace', presentation: 'sheet', titleKey: 'common.dev.nuevo', lazy: sheet },
    { path: 'transferencia', scope: 'workspace', presentation: 'sheet', titleKey: 'common.dev.transferencia', lazy: sheet },
    { path: 'respaldo', scope: 'root', titleKey: 'common.dev.respaldo', lazy: page('common.dev.respaldo') },
  ],
  nav: [
    { id: 'preview-home', scope: 'workspace', to: '', labelKey: 'common.dev.inicio', icon: House, placement: 'primary', order: 1, goKey: 'i' },
    { id: 'preview-ledger', scope: 'workspace', to: 'movimientos', labelKey: 'common.dev.movimientos', icon: Rows3, placement: 'primary', order: 2, goKey: 'm' },
    { id: 'preview-summary', scope: 'workspace', to: 'resumen', labelKey: 'common.dev.resumen', icon: BarChart3, placement: 'primary', order: 3, goKey: 'r' },
    { id: 'preview-accounts', scope: 'workspace', to: 'cuentas', labelKey: 'common.dev.cuentas', icon: Landmark, placement: 'primary', order: 4, goKey: 'c' },
    { id: 'preview-reports', scope: 'workspace', to: 'informes', labelKey: 'common.dev.informes', icon: FileText, placement: 'more', group: 'book', order: 10 },
    { id: 'preview-capture', scope: 'workspace', to: 'captura', labelKey: 'common.dev.captura', icon: Rows3, placement: 'more', group: 'book', order: 11 },
    { id: 'preview-fields', scope: 'workspace', to: 'ajustes/campos', labelKey: 'common.dev.campos', icon: SlidersHorizontal, placement: 'more', group: 'config', order: 20 },
    { id: 'preview-backup', scope: 'root', to: 'respaldo', labelKey: 'common.dev.respaldo', icon: FileText, placement: 'more', group: 'config', order: 21 },
    { id: 'preview-settings', scope: 'workspace', to: 'ajustes', labelKey: 'common.dev.ajustes', icon: Settings, placement: 'settings', order: 90 },
  ],
  quickActions: [
    { id: 'in', labelKey: 'common.dev.entrada', icon: ArrowDownLeft, tone: 'in', to: 'nuevo?tipo=entrada', order: 1, shortcut: 'e' },
    { id: 'out', labelKey: 'common.dev.salida', icon: ArrowUpRight, tone: 'out', to: 'nuevo?tipo=salida', order: 2, shortcut: 's' },
    { id: 'xfer', labelKey: 'common.dev.transferencia', icon: ArrowLeftRight, tone: 'neutral', to: 'transferencia', order: 3, shortcut: 't' },
  ],
  // Pantalla de bloqueo de prueba: solo se ve si alguien le pone un `cuadra.auth` que diga locked (ver LockPreview).
  lockScreen: { lazy: () => import('./LockPreview') },
  settingsSections: [
    { id: 'preview-fields', scope: 'workspace', labelKey: 'common.dev.campos', icon: SlidersHorizontal, to: 'ajustes/campos', order: 1 },
  ],
};
