// El registro real (todas las features de src/features): sin choques y sin entradas huérfanas.
import { describe, expect, it } from 'vitest';
import { dictionary } from '../../i18n/es/index';
import { features } from './collect';
import { findRegistryProblems, selectNav, splitBottomBar } from './select';

const real = features.filter((f) => !f.id.startsWith('_'));
const routes = real.flatMap((f) => f.routes ?? []);
const hasRoute = (scope: 'root' | 'workspace', to: string) => {
  const path = to.split('?')[0] ?? '';
  return routes.some((r) => r.scope === scope && r.path === path);
};

describe('registro real', () => {
  it('no tiene ids, rutas ni atajos repetidos', () => {
    expect(findRegistryProblems(features)).toEqual([]);
  });
  it('cada entrada de navegación, sección y acción rápida apunta a una ruta registrada', () => {
    for (const f of real) {
      for (const n of f.nav ?? []) expect(hasRoute(n.scope, n.to), `${f.id}/${n.id} → ${n.to}`).toBe(true);
      for (const s of f.settingsSections ?? []) expect(hasRoute(s.scope, s.to), `${f.id}/${s.id} → ${s.to}`).toBe(true);
      for (const q of f.quickActions ?? []) expect(hasRoute('workspace', q.to), `${f.id}/${q.id} → ${q.to}`).toBe(true);
    }
  });
  it('todas las claves de texto del registro existen', () => {
    const keys = real.flatMap((f) => [
      ...(f.routes ?? []).flatMap((r) => (r.titleKey === undefined ? [] : [r.titleKey])),
      ...(f.nav ?? []).map((n) => n.labelKey),
      ...(f.quickActions ?? []).map((q) => q.labelKey),
      ...(f.settingsSections ?? []).map((s) => s.labelKey),
    ]);
    expect(keys.filter((k) => dictionary[k] === undefined)).toEqual([]);
  });
  it('la barra inferior móvil lleva Inicio y Movimientos (DESIGN §8.2)', () => {
    const { tabs } = splitBottomBar(selectNav(real, 'workspace', 'primary'));
    expect(tabs.map((n) => n.to)).toEqual(['', 'movimientos']);
  });
  it('los atajos g + letra de DESIGN §8.3 llevan a su destino', () => {
    const go = Object.fromEntries(selectNav(real, 'workspace').flatMap((n) => (n.goKey === undefined ? [] : [[n.goKey, n.to]])));
    expect(go).toMatchObject({ i: '', m: 'movimientos', c: 'cuentas', r: 'resumen' });
  });
});
