import type { FeatureModule } from './types';
import { findRegistryProblems } from './select';

// `features/*` son las áreas reales; las carpetas `_…` (galería) solo existen en desarrollo. Van en otro glob para que
// la compilación de producción ni las importe: si no, su código (y sus rutas perezosas) acababa en el precache del SW.
const real = import.meta.glob<{ feature: FeatureModule }>(['../../features/*/index.ts', '!../../features/_*/index.ts'], { eager: true });
const devOnly: Record<string, { feature: FeatureModule }> = import.meta.env.DEV
  ? import.meta.glob<{ feature: FeatureModule }>('../../features/_*/index.ts', { eager: true })
  : {};
const mods = { ...real, ...devOnly };

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
