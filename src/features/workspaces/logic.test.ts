import { describe, expect, it } from 'vitest';
import type { WorkspaceSummary } from '../../core/types';
import { checkEdit, filterAndSort, hasEditChanges, purgeNameMatches, resolveRoot, showsTools, splitWorkspaces, tintKeyOf } from './logic';

function ws(over: Partial<WorkspaceSummary> & { id: string; name: string }): WorkspaceSummary {
  return {
    ownerName: '',
    templateId: null,
    currency: { code: 'DOP', minorDigits: 2, symbol: 'RD$' },
    logoDataUrl: null,
    color: null,
    sortOrder: 0,
    isDemo: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    balanceMinor: 0,
    accountCount: 1,
    lastMovementDate: null,
    ...over,
  };
}

describe('resolveRoot', () => {
  const a = ws({ id: 'a', name: 'A' });
  const archived = ws({ id: 'z', name: 'Z', archivedAt: '2026-02-01T00:00:00.000Z' });

  it('sin espacios va a la bienvenida, también fuera de la entrada inicial', () => {
    expect(resolveRoot([], null, true)).toEqual({ kind: 'redirect', to: '/bienvenida' });
    expect(resolveRoot([], 'a', false)).toEqual({ kind: 'redirect', to: '/bienvenida' });
  });
  it('al abrir la app con un último espacio que existe, entra en él', () => {
    expect(resolveRoot([a], 'a', true)).toEqual({ kind: 'redirect', to: '/e/a' });
  });
  it('navegar a la raíz desde la app muestra el selector', () => {
    expect(resolveRoot([a], 'a', false)).toEqual({ kind: 'select' });
  });
  it('último espacio inexistente o archivado: selector', () => {
    expect(resolveRoot([a], 'borrado', true)).toEqual({ kind: 'select' });
    expect(resolveRoot([a, archived], 'z', true)).toEqual({ kind: 'select' });
  });
  it('sin último espacio guardado: selector', () => {
    expect(resolveRoot([a], null, true)).toEqual({ kind: 'select' });
  });
  it('solo archivados cuenta como «hay espacios»: selector con la sección de archivados', () => {
    expect(resolveRoot([archived], null, true)).toEqual({ kind: 'select' });
  });
});

describe('lista', () => {
  const list = [
    ws({ id: '1', name: 'Zapatería', lastMovementDate: '2026-11-20', sortOrder: 1 }),
    ws({ id: '2', name: 'Ámbar', lastMovementDate: '2026-11-25', sortOrder: 2 }),
    ws({ id: '3', name: 'Brisa', ownerName: 'Juana Pérez', lastMovementDate: null, sortOrder: 0 }),
    ws({ id: '4', name: 'Colmado', archivedAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('separa activos y archivados', () => {
    const { active, archived } = splitWorkspaces(list);
    expect(active.map((w) => w.id)).toEqual(['1', '2', '3']);
    expect(archived.map((w) => w.id)).toEqual(['4']);
  });
  it('recientes: último movimiento primero y los vacíos al final', () => {
    expect(filterAndSort(list.slice(0, 3), '', 'recent').map((w) => w.id)).toEqual(['2', '1', '3']);
  });
  it('A–Z ignora acentos y mayúsculas', () => {
    expect(filterAndSort(list.slice(0, 3), '', 'name').map((w) => w.name)).toEqual(['Ámbar', 'Brisa', 'Zapatería']);
  });
  it('busca por nombre o titular sin acentos', () => {
    expect(filterAndSort(list, 'zapateria', 'name').map((w) => w.id)).toEqual(['1']);
    expect(filterAndSort(list, 'perez', 'name').map((w) => w.id)).toEqual(['3']);
    expect(filterAndSort(list, 'nada', 'name')).toEqual([]);
  });
  it('no muta la lista original', () => {
    const copy = [...list];
    filterAndSort(list, '', 'name');
    expect(list).toEqual(copy);
  });
  it('las herramientas aparecen cuando la lista es larga', () => {
    expect(showsTools(1)).toEqual({ search: false, sort: false });
    expect(showsTools(3)).toEqual({ search: false, sort: true });
    expect(showsTools(6)).toEqual({ search: true, sort: true });
  });
});

describe('tintas y edición', () => {
  it('reconoce la tinta guardada', () => {
    expect(tintKeyOf('tint-3')).toBe('tint-3');
    expect(tintKeyOf('5')).toBe('tint-5');
    expect(tintKeyOf('#ff0000')).toBeNull();
    expect(tintKeyOf(null)).toBeNull();
  });
  it('exige nombre y lo recorta', () => {
    expect(checkEdit({ name: '   ', color: null })).toEqual({ ok: false, reason: 'name_empty' });
    expect(checkEdit({ name: '  Brisa ', color: 'tint-2' })).toEqual({ ok: true, name: 'Brisa', color: 'tint-2' });
  });
  it('detecta cambios', () => {
    const w = { name: 'Brisa', color: 'tint-2' } as const;
    expect(hasEditChanges(w, { name: 'Brisa ', color: 'tint-2' })).toBe(false);
    expect(hasEditChanges(w, { name: 'Brisa', color: 'tint-4' })).toBe(true);
    expect(hasEditChanges(w, { name: 'Brisa SRL', color: 'tint-2' })).toBe(true);
    expect(hasEditChanges({ name: 'X', color: null }, { name: 'X', color: null })).toBe(false);
  });
});

describe('purgeNameMatches', () => {
  it('pide el nombre exacto (distingue mayúsculas y acentos)', () => {
    expect(purgeNameMatches('Colmado La Esquina', 'Colmado La Esquina')).toBe(true);
    expect(purgeNameMatches('Colmado La Esquina', ' Colmado La Esquina ')).toBe(true);
    expect(purgeNameMatches('Colmado La Esquina', 'colmado la esquina')).toBe(false);
    expect(purgeNameMatches('Ámbar', 'Ambar')).toBe(false);
    expect(purgeNameMatches('Colmado', '')).toBe(false);
  });
});
