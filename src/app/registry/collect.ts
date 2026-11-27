import type { FeatureModule } from './types';

const mods = import.meta.glob<{ feature: FeatureModule }>('../../features/*/index.ts', { eager: true });

/** Las features con id que empieza por `_` (galería, pruebas) solo existen en desarrollo. */
export function selectFeatures(modules: Record<string, { feature: FeatureModule }>, dev: boolean): FeatureModule[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.feature)
    .filter((f): f is FeatureModule => f !== undefined)
    .filter((f) => dev || !f.id.startsWith('_'));
}

export const features: FeatureModule[] = selectFeatures(mods, import.meta.env.DEV);
