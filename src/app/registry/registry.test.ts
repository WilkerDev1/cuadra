import { describe, expect, it } from 'vitest';
import { selectFeatures } from './collect';
import {
  pickActiveNav,
  findNavByGoKey,
  findQuickActionByShortcut,
  findRegistryProblems,
  groupNav,
  selectHomeCards,
  selectLockScreen,
  selectNav,
  selectQuickActions,
  selectSettingsSections,
  splitBottomBar,
} from './select';
import type { FeatureModule, NavEntry, QuickAction } from './types';

const icon = (() => null) as unknown as NavEntry['icon'];
const nav = (id: string, order: number, placement: NavEntry['placement'] = 'primary', extra: Partial<NavEntry> = {}): NavEntry => ({
  id,
  scope: 'workspace',
  to: id,
  labelKey: id,
  icon,
  placement,
  order,
  ...extra,
});
const quick = (id: string, order: number, shortcut?: string): QuickAction => ({
  id,
  labelKey: id,
  icon,
  tone: 'in',
  to: id,
  order,
  ...(shortcut === undefined ? {} : { shortcut }),
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
  it('desempata el mismo order por id para que el orden sea estable', () => {
    const f: FeatureModule = { id: 'f', nav: [nav('z', 1), nav('m', 1), nav('a', 1)] };
    expect(selectNav([f], 'workspace').map((n) => n.id)).toEqual(['a', 'm', 'z']);
  });
  it('oculta features con prefijo _ fuera de desarrollo', () => {
    const mods = { './x/index.ts': { feature: { id: '_gallery' } }, './y/index.ts': { feature: { id: 'home' } } };
    expect(selectFeatures(mods, false).map((f) => f.id)).toEqual(['home']);
    expect(selectFeatures(mods, true).map((f) => f.id)).toEqual(['_gallery', 'home']);
  });
  it('ordena tarjetas del inicio y secciones de ajustes por scope', () => {
    const f: FeatureModule = {
      id: 'f',
      homeCards: [
        { id: 'c2', titleKey: 'c2', order: 2, size: 'half', defaultVisible: true, lazy: async () => ({ Component: () => null }) },
        { id: 'c1', titleKey: 'c1', order: 1, size: 'full', defaultVisible: true, lazy: async () => ({ Component: () => null }) },
      ],
      settingsSections: [
        { id: 's2', scope: 'workspace', labelKey: 's2', icon, to: 's2', order: 2 },
        { id: 's1', scope: 'root', labelKey: 's1', icon, to: 's1', order: 1 },
      ],
    };
    expect(selectHomeCards([f]).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(selectSettingsSections([f], 'workspace').map((s) => s.id)).toEqual(['s2']);
    expect(selectSettingsSections([f], 'root').map((s) => s.id)).toEqual(['s1']);
  });

  describe('barra inferior y grupos', () => {
    const primary = [nav('inicio', 1), nav('mov', 2), nav('resumen', 3), nav('cuentas', 4)];
    it('deja 2 destinos en la barra inferior y el resto va a «Más»', () => {
      const { tabs, overflow } = splitBottomBar(primary);
      expect(tabs.map((n) => n.id)).toEqual(['inicio', 'mov']);
      expect(overflow.map((n) => n.id)).toEqual(['resumen', 'cuentas']);
    });
    it('agrupa en el orden Libro, Configuración, App y omite los bloques vacíos', () => {
      const entries = [
        nav('campos', 2, 'more', { group: 'config' }),
        nav('cuentas', 3, 'more'),
        nav('acerca', 1, 'more', { group: 'app' }),
        nav('resumen', 1, 'more', { group: 'book' }),
      ];
      expect(groupNav(entries).map((g) => [g.group, g.entries.map((e) => e.id)])).toEqual([
        ['book', ['resumen', 'cuentas']],
        ['config', ['campos']],
        ['app', ['acerca']],
      ]);
      expect(groupNav([nav('x', 1, 'more', { group: 'app' })]).map((g) => g.group)).toEqual(['app']);
    });
  });

  describe('atajos', () => {
    it('encuentra la acción rápida por letra sin distinguir mayúsculas', () => {
      const actions = [quick('in', 1, 'e'), quick('out', 2, 's'), quick('plain', 3)];
      expect(findQuickActionByShortcut(actions, 'E')?.id).toBe('in');
      expect(findQuickActionByShortcut(actions, 'x')).toBeUndefined();
    });
    it('encuentra el destino de g + letra', () => {
      const entries = [nav('inicio', 1, 'primary', { goKey: 'i' }), nav('mov', 2, 'primary', { goKey: 'M' })];
      expect(findNavByGoKey(entries, 'm')?.id).toBe('mov');
      expect(findNavByGoKey(entries, 'z')).toBeUndefined();
    });
  });

  describe('pantalla de bloqueo', () => {
    const lazy = async () => ({ Component: () => null });
    it('no bloquea nada si nadie la registra', () => {
      expect(selectLockScreen([a, b])).toBeNull();
    });
    it('usa la primera por id si se registra', () => {
      const x: FeatureModule = { id: 'x-auth', lockScreen: { lazy } };
      const y: FeatureModule = { id: 'a-auth', lockScreen: { lazy: async () => ({ Component: () => null }) } };
      expect(selectLockScreen([x, y])).toBe(y.lockScreen);
    });
    it('la de un banco de pruebas (_…) no desplaza a la real', () => {
      const real: FeatureModule = { id: 'auth', lockScreen: { lazy } };
      const preview: FeatureModule = { id: '_preview', lockScreen: { lazy: async () => ({ Component: () => null }) } };
      expect(selectLockScreen([preview, real])).toBe(real.lockScreen);
      expect(selectLockScreen([preview])).toBe(preview.lockScreen);
      expect(findRegistryProblems([preview, real])).toEqual([]);
    });
  });

  describe('validación del registro', () => {
    it('no avisa de nada en un registro sano', () => {
      expect(findRegistryProblems([a, b])).toEqual([]);
    });
    it('detecta ids, atajos y rutas repetidos', () => {
      const f1: FeatureModule = { id: 'f', nav: [nav('x', 1, 'primary', { goKey: 'i' })], quickActions: [quick('q', 1, 'e')] };
      const f2: FeatureModule = {
        id: 'f',
        nav: [nav('x', 2, 'primary', { goKey: 'I' })],
        quickActions: [quick('q2', 2, 'E'), quick('q3', 3, 'g')],
        routes: [
          { path: 'nuevo', scope: 'workspace', lazy: async () => ({ Component: () => null }) },
          { path: 'nuevo', scope: 'workspace', lazy: async () => ({ Component: () => null }) },
        ],
      };
      const problems = findRegistryProblems([f1, f2]);
      expect(problems).toEqual(
        expect.arrayContaining([
          'id de feature repetido: f',
          'id de navegación repetido: workspace:x',
          'atajo de acción repetido: e',
          'goKey repetido: i',
          'ruta repetido: workspace:nuevo',
          'atajo reservado: g',
        ]),
      );
    });
    it('avisa de más de 4 primarias, dos pantallas de bloqueo y hojas en scope root', () => {
      const lazy = async () => ({ Component: () => null });
      const many: FeatureModule = { id: 'm', nav: [1, 2, 3, 4, 5].map((n) => nav(`n${n}`, n)) };
      const l1: FeatureModule = { id: 'l1', lockScreen: { lazy } };
      const l2: FeatureModule = {
        id: 'l2',
        lockScreen: { lazy },
        routes: [{ path: 'x', scope: 'root', presentation: 'sheet', lazy }],
      };
      const problems = findRegistryProblems([many, l1, l2]);
      expect(problems).toEqual(
        expect.arrayContaining(['más de 4 entradas primarias (5)', 'más de una lockScreen', 'ruta sheet en scope root: l2/x']),
      );
    });
  });
});

describe('pickActiveNav', () => {
  const paths = ['/e/w', '/e/w/movimientos', '/e/w/ajustes', '/e/w/ajustes/campos', '/respaldo'];
  const exact = [true, false, false, false, false];
  it('marca solo la coincidencia más larga', () => {
    expect(pickActiveNav(paths, '/e/w/ajustes/campos', exact)).toBe(3);
    expect(pickActiveNav(paths, '/e/w/ajustes/campos/f1', exact)).toBe(3);
    expect(pickActiveNav(paths, '/e/w/ajustes/vistas', exact)).toBe(2);
    expect(pickActiveNav(paths, '/e/w/ajustes', exact)).toBe(2);
  });
  it('el índice del espacio solo cuenta exacto', () => {
    expect(pickActiveNav(paths, '/e/w', exact)).toBe(0);
    expect(pickActiveNav(paths, '/e/w/', exact)).toBe(0);
    expect(pickActiveNav(paths, '/e/w/historial', exact)).toBe(-1);
  });
  it('no confunde prefijos de texto con segmentos', () => {
    expect(pickActiveNav(['/e/w/mov'], '/e/w/movimientos')).toBe(-1);
    expect(pickActiveNav(paths, '/e/w/movimientos/tx1', exact)).toBe(1);
  });
});
