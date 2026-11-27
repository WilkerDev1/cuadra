// Captura (DESIGN §10.6–10.9): Nuevo movimiento y editar, Transferencia, Captura en tabla y Ráfaga.
// Liviano: solo descriptores; las pantallas se cargan con `lazy`.
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, TableProperties, Zap } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'capture',
  routes: [
    { path: 'nuevo', scope: 'workspace', presentation: 'sheet', sheetHeight: 'full', titleKey: 'capture.entry.title', lazy: () => import('./routes/QuickEntry') },
    { path: 'transferencia', scope: 'workspace', presentation: 'sheet', sheetHeight: 'full', titleKey: 'capture.transfer.title', lazy: () => import('./routes/Transfer') },
    { path: 'captura', scope: 'workspace', titleKey: 'capture.table.title', lazy: () => import('./routes/TableCapture') },
  ],
  nav: [
    { id: 'capture', scope: 'workspace', to: 'captura', labelKey: 'capture.nav', icon: TableProperties, placement: 'more', group: 'book', order: 38 },
  ],
  quickActions: [
    { id: 'in', labelKey: 'capture.quick.in', icon: ArrowDownLeft, tone: 'in', to: 'nuevo?tipo=entrada', order: 1, shortcut: 'e' },
    { id: 'out', labelKey: 'capture.quick.out', icon: ArrowUpRight, tone: 'out', to: 'nuevo?tipo=salida', order: 2, shortcut: 's' },
    { id: 'transfer', labelKey: 'capture.quick.transfer', icon: ArrowLeftRight, tone: 'neutral', to: 'transferencia', order: 3, shortcut: 't' },
    { id: 'burst', labelKey: 'capture.quick.burst', icon: Zap, tone: 'neutral', to: 'captura', order: 4, shortcut: 'r' },
  ],
};
