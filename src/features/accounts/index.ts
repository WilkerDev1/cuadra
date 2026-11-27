// Cuentas: saldos, tendencia, orden manual, archivo y saldo inicial (DESIGN §10.4).
import { Landmark } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'accounts',
  routes: [{ path: 'cuentas', scope: 'workspace', titleKey: 'accounts.title', lazy: () => import('./routes/Accounts') }],
  nav: [
    { id: 'accounts', scope: 'workspace', to: 'cuentas', labelKey: 'accounts.nav', icon: Landmark, placement: 'primary', group: 'book', order: 30, goKey: 'c' },
  ],
};
