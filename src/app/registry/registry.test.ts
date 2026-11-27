import { describe, expect, it } from 'vitest';
import { selectFeatures } from './collect';
import { selectNav, selectQuickActions } from './select';
import type { FeatureModule, NavEntry } from './types';

const icon = (() => null) as unknown as NavEntry['icon'];
const nav = (id: string, order: number, placement: NavEntry['placement'] = 'primary'): NavEntry => ({
  id,
  scope: 'workspace',
  to: id,
  labelKey: id,
  icon,
  placement,
  order,
});

describe('registro de features', () => {
  const a: FeatureModule = { id: 'a', nav: [nav('a2', 2), nav('a9', 9, 'more')], quickActions: [] };
  const b: FeatureModule = {
    id: 'b',
    nav: [nav('b1', 1)],
    quickActions: [{ id: 'q', labelKey: 'q', icon, tone: 'in', to: 'nuevo', order: 3 }],
  };

  it('ordena la navegación por order y filtra por ubicación', () => {
    expect(selectNav([a, b], 'workspace', 'primary').map((n) => n.id)).toEqual(['b1', 'a2']);
    expect(selectNav([a, b], 'workspace').map((n) => n.id)).toEqual(['b1', 'a2', 'a9']);
    expect(selectNav([a, b], 'root')).toEqual([]);
  });
  it('reúne las acciones rápidas', () => {
    expect(selectQuickActions([a, b]).map((q) => q.id)).toEqual(['q']);
  });
  it('oculta features con prefijo _ fuera de desarrollo', () => {
    const mods = { './x/index.ts': { feature: { id: '_gallery' } }, './y/index.ts': { feature: { id: 'home' } } };
    expect(selectFeatures(mods, false).map((f) => f.id)).toEqual(['home']);
    expect(selectFeatures(mods, true).map((f) => f.id)).toEqual(['_gallery', 'home']);
  });
});
