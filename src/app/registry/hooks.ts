import { features } from './collect';
import {
  selectHomeCards,
  selectLockScreen,
  selectNav,
  selectQuickActions,
  selectSettingsSections,
} from './select';
import type { FeatureRoute, HomeCardDef, LockScreenDef, NavEntry, QuickAction, Scope, SettingsSectionDef } from './types';

// El registro es estático (se resuelve en tiempo de compilación con import.meta.glob), así que
// estos hooks devuelven siempre las mismas listas ya ordenadas y estables entre renders.
const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

export function useNav(scope: Scope = 'workspace', placement?: NavEntry['placement']): NavEntry[] {
  return memo(`nav|${scope}|${placement ?? '*'}`, () => selectNav(features, scope, placement));
}

export function useQuickActions(): QuickAction[] {
  return memo('quick', () => selectQuickActions(features));
}

export function useHomeCards(): HomeCardDef[] {
  return memo('home', () => selectHomeCards(features));
}

export function useSettingsSections(scope: Scope = 'workspace'): SettingsSectionDef[] {
  return memo(`settings|${scope}`, () => selectSettingsSections(features, scope));
}

/** La ruta índice del espacio (`home`), o `null`. El shell la pinta detrás de una hoja abierta por enlace directo. */
export function useWorkspaceIndexRoute(): FeatureRoute | null {
  return memo('ws-index', () => features.flatMap((f) => f.routes ?? []).find((r) => r.scope === 'workspace' && r.path === '') ?? null);
}

/** La pantalla de bloqueo registrada por la feature de autenticación, o `null` si nadie la registró. */
export function useLockScreenDef(): LockScreenDef | null {
  return memo('lock', () => selectLockScreen(features));
}
