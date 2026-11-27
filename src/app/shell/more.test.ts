import { describe, expect, it } from 'vitest';
import type { NavEntry, SettingsSectionDef } from '../registry/types';
import { buildMoreGroups } from './more';

const icon = (() => null) as unknown as NavEntry['icon'];
const nav = (id: string, placement: NavEntry['placement'], order: number, extra: Partial<NavEntry> = {}): NavEntry => ({
  id, scope: 'workspace', to: id, labelKey: id, icon, placement, order, ...extra,
});
const section = (id: string, to: string, order: number): SettingsSectionDef => ({
  id, scope: 'workspace', labelKey: id, icon, to, order,
});

describe('buildMoreGroups', () => {
  it('lo que no cabe en la barra inferior (3.ª primaria en adelante) pasa a «Más»', () => {
    const groups = buildMoreGroups({
      primary: [nav('inicio', 'primary', 1), nav('mov', 'primary', 2), nav('resumen', 'primary', 3)],
      more: [nav('informes', 'more', 4)],
      sections: [],
    });
    expect(groups).toEqual([{ group: 'book', entries: [expect.objectContaining({ id: 'resumen' }), expect.objectContaining({ id: 'informes' })] }]);
  });
  it('las secciones de ajustes van a Configuración y no se repiten si ya hay una entrada con el mismo destino', () => {
    const groups = buildMoreGroups({
      primary: [],
      more: [nav('ajustes-campos', 'settings', 1, { to: 'ajustes/campos' })],
      sections: [section('fields', 'ajustes/campos', 1), section('views', 'ajustes/vistas', 2)],
    });
    expect(groups.map((g) => g.group)).toEqual(['config']);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['ajustes-campos', 'settings:views']);
  });
  it('sin nada que mostrar devuelve una lista vacía', () => {
    expect(buildMoreGroups({ primary: [nav('a', 'primary', 1)], more: [], sections: [] })).toEqual([]);
  });
});
