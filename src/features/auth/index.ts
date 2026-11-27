// Inicio de sesión local: pantalla de bloqueo y /seguridad (contraseña, clave de recuperación, bloqueo automático).
// Liviano: solo descriptores; las pantallas se cargan con `lazy`.
import { KeyRound } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';

export const feature: FeatureModule = {
  id: 'auth',
  routes: [{ path: 'seguridad', scope: 'root', titleKey: 'auth.settings.title', lazy: () => import('./routes/Security') }],
  nav: [
    { id: 'auth-security', scope: 'root', to: 'seguridad', labelKey: 'auth.nav', icon: KeyRound, placement: 'more', group: 'config', order: 88 },
  ],
  settingsSections: [{ id: 'auth-security', scope: 'root', labelKey: 'auth.nav', icon: KeyRound, to: 'seguridad', order: 80 }],
  lockScreen: { lazy: () => import('./routes/LockScreen') },
};
