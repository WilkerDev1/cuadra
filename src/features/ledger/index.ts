// Libro: movimientos del espacio, libro de una cuenta, detalle con historial y lotes (DESIGN §10.5, §10.10).
import { Layers, Rows3 } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'ledger',
  routes: [
    { path: 'movimientos', scope: 'workspace', titleKey: 'ledger.title', lazy: () => import('./routes/Movements') },
    { path: 'cuentas/:accountId', scope: 'workspace', titleKey: 'ledger.account.title', lazy: () => import('./routes/AccountLedger') },
    {
      path: 'movimientos/:txId',
      scope: 'workspace',
      presentation: 'sheet',
      titleKey: 'ledger.detail.title',
      lazy: () => import('./routes/TransactionDetail'),
    },
    { path: 'lotes', scope: 'workspace', titleKey: 'ledger.batches.title', lazy: () => import('./routes/Batches') },
    { path: 'lotes/:batchId', scope: 'workspace', titleKey: 'ledger.batch.title', lazy: () => import('./routes/BatchDetail') },
  ],
  nav: [
    { id: 'movements', scope: 'workspace', to: 'movimientos', labelKey: 'ledger.nav', icon: Rows3, placement: 'primary', group: 'book', order: 20, goKey: 'm' },
    { id: 'batches', scope: 'workspace', to: 'lotes', labelKey: 'ledger.batches.title', icon: Layers, placement: 'more', group: 'book', order: 45 },
  ],
};
