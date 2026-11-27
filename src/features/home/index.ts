// Inicio del espacio (DESIGN §10.3, PLAN «Panel de escritorio»): panel propio en escritorio e inicio propio en móvil.
import { House } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'home',
  routes: [{ path: '', scope: 'workspace', titleKey: 'home.title', lazy: () => import('./routes/Home') }],
  nav: [{ id: 'home', scope: 'workspace', to: '', labelKey: 'home.title', icon: House, placement: 'primary', group: 'book', order: 10, goKey: 'i' }],
};
