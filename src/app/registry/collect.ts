import type { FeatureModule } from './types';
import { findRegistryProblems } from './select';

// `features/*` son las áreas reales. `app/dev/*` son bancos de pruebas del shell (solo con id `_…`, solo en dev).
const mods = import.meta.glob<{ feature: FeatureModule }>(['../../features/*/index.ts', '../dev/*/index.ts'], {
  eager: true,
});

/** Las features con id que empieza por `_` (galería, pruebas) solo existen en desarrollo. */
export function selectFeatures(modules: Record<string, { feature: FeatureModule }>, dev: boolean): FeatureModule[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.feature)
    .filter((f): f is FeatureModule => f !== undefined)
    .filter((f) => dev || !f.id.startsWith('_'));
}

export const features: FeatureModule[] = selectFeatures(mods, import.meta.env.DEV);

if (import.meta.env.DEV) {
  for (const problem of findRegistryProblems(features)) console.warn(`[registro] ${problem}`);
}
