import type { FeatureModule, HomeCardDef, NavEntry, QuickAction, Scope, SettingsSectionDef } from './types';

const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;

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
