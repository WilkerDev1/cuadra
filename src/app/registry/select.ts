// Selección pura sobre el registro (sin React ni import.meta): se prueba con listas literales.
import type {
  FeatureModule,
  HomeCardDef,
  LockScreenDef,
  NavEntry,
  NavGroup,
  QuickAction,
  Scope,
  SettingsSectionDef,
} from './types';

const byOrder = <T extends { order: number; id: string }>(a: T, b: T): number => a.order - b.order || a.id.localeCompare(b.id);

export function selectNav(
  features: readonly FeatureModule[],
  scope: Scope,
  placement?: NavEntry['placement'],
): NavEntry[] {
  return features
    .flatMap((f) => f.nav ?? [])
    .filter((n) => n.scope === scope && (placement === undefined || n.placement === placement))
    .sort(byOrder);
}

export function selectQuickActions(features: readonly FeatureModule[]): QuickAction[] {
  return features.flatMap((f) => f.quickActions ?? []).sort(byOrder);
}

export function selectHomeCards(features: readonly FeatureModule[]): HomeCardDef[] {
  return features.flatMap((f) => f.homeCards ?? []).sort(byOrder);
}

export function selectSettingsSections(features: readonly FeatureModule[], scope: Scope): SettingsSectionDef[] {
  return features
    .flatMap((f) => f.settingsSections ?? [])
    .filter((s) => s.scope === scope)
    .sort(byOrder);
}

/**
 * La pantalla de bloqueo: la primera feature (por id) que la declara; las de banco de pruebas (`_…`) solo valen si
 * ninguna real la declara. `null` = no se bloquea nada.
 */
export function selectLockScreen(features: readonly FeatureModule[]): LockScreenDef | null {
  const rank = (f: FeatureModule) => (f.id.startsWith('_') ? 1 : 0);
  const owners = features
    .filter((f) => f.lockScreen !== undefined)
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return owners[0]?.lockScreen ?? null;
}

/** Barra inferior móvil: las `max` primeras entradas primarias; el resto va a «Más». */
export const BOTTOM_BAR_MAX = 2;
export function splitBottomBar(
  primary: readonly NavEntry[],
  max: number = BOTTOM_BAR_MAX,
): { tabs: NavEntry[]; overflow: NavEntry[] } {
  return { tabs: primary.slice(0, max), overflow: primary.slice(max) };
}

export const NAV_GROUP_ORDER: readonly NavGroup[] = ['book', 'config', 'app'];

/** Agrupa por bloque en el orden fijo Libro → Configuración → App; los bloques vacíos no salen. */
export function groupNav(entries: readonly NavEntry[]): Array<{ group: NavGroup; entries: NavEntry[] }> {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    entries: entries.filter((e) => (e.group ?? 'book') === group).sort(byOrder),
  })).filter((g) => g.entries.length > 0);
}

/** Atajo de una letra de «Anotar» (e/s/t/r…). Insensible a mayúsculas. */
export function findQuickActionByShortcut(actions: readonly QuickAction[], key: string): QuickAction | undefined {
  const k = key.toLowerCase();
  return actions.find((a) => a.shortcut !== undefined && a.shortcut.toLowerCase() === k);
}

/** Destino de `g` + letra. */
export function findNavByGoKey(entries: readonly NavEntry[], key: string): NavEntry | undefined {
  const k = key.toLowerCase();
  return entries.find((n) => n.goKey !== undefined && n.goKey.toLowerCase() === k);
}

/** Problemas del registro (ids o atajos repetidos, demasiados primarios). Vacío = bien. Se avisa en desarrollo. */
export function findRegistryProblems(features: readonly FeatureModule[]): string[] {
  const problems: string[] = [];
  const seen = (label: string, values: string[]) => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [v, n] of counts) if (n > 1) problems.push(`${label} repetido: ${v}`);
  };
  seen('id de feature', features.map((f) => f.id));
  seen('id de navegación', features.flatMap((f) => f.nav ?? []).map((n) => `${n.scope}:${n.id}`));
  seen('id de acción rápida', features.flatMap((f) => f.quickActions ?? []).map((q) => q.id));
  seen('id de tarjeta de inicio', features.flatMap((f) => f.homeCards ?? []).map((c) => c.id));
  seen('id de sección de ajustes', features.flatMap((f) => f.settingsSections ?? []).map((s) => `${s.scope}:${s.id}`));
  seen(
    'ruta',
    features.flatMap((f) => f.routes ?? []).map((r) => `${r.scope}:${r.path}`),
  );
  seen('atajo de acción', features.flatMap((f) => f.quickActions ?? []).flatMap((q) => (q.shortcut === undefined ? [] : [q.shortcut.toLowerCase()])));
  seen('goKey', features.flatMap((f) => f.nav ?? []).flatMap((n) => (n.goKey === undefined ? [] : [n.goKey.toLowerCase()])));
  const reserved = new Set(['n', 'g', 'j', 'k', 'd', 'a', '/', '?']);
  for (const q of features.flatMap((f) => f.quickActions ?? [])) {
    if (q.shortcut !== undefined && reserved.has(q.shortcut.toLowerCase())) problems.push(`atajo reservado: ${q.shortcut}`);
  }
  const primaries = features.flatMap((f) => f.nav ?? []).filter((n) => n.scope === 'workspace' && n.placement === 'primary');
  if (primaries.length > 4) problems.push(`más de 4 entradas primarias (${primaries.length})`);
  if (features.filter((f) => f.lockScreen !== undefined && !f.id.startsWith('_')).length > 1) problems.push('más de una lockScreen');
  for (const f of features) {
    for (const r of f.routes ?? []) {
      if (r.presentation === 'sheet' && r.scope === 'root') problems.push(`ruta sheet en scope root: ${f.id}/${r.path}`);
    }
  }
  return problems;
}
