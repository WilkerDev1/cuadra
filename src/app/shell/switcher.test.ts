import { describe, expect, it } from 'vitest';
import type { WorkspaceSummary } from '../../core';
import { filterAndSortWorkspaces } from './switcher';

const ws = (id: string, name: string, last: string | null, extra: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id, name, ownerName: '', templateId: null, currency: { code: 'DOP', minorDigits: 2 }, logoDataUrl: null, color: null,
  sortOrder: 0, isDemo: false, archivedAt: null, createdAt: '', updatedAt: '', balanceMinor: 0, accountCount: 0,
  lastMovementDate: last, ...extra,
});
const list = [
  ws('a', 'Ñandú Taller', '2026-05-01'),
  ws('b', 'Colmado La Esquina', '2026-06-10'),
  ws('c', 'Brisa SRL', null, { ownerName: 'Estudio Creativo' }),
  ws('d', 'Archivado', '2026-06-12', { archivedAt: '2026-06-13T00:00:00Z' }),
];

describe('filterAndSortWorkspaces', () => {
  it('recientes: el de movimiento más nuevo primero, sin movimientos al final, sin archivados', () => {
    expect(filterAndSortWorkspaces(list, '', 'recent').map((w) => w.id)).toEqual(['b', 'a', 'c']);
  });
  it('A–Z ignora tildes y mayúsculas al ordenar', () => {
    expect(filterAndSortWorkspaces(list, '', 'name').map((w) => w.id)).toEqual(['c', 'b', 'a']);
  });
  it('busca por nombre o por titular, sin tildes', () => {
    expect(filterAndSortWorkspaces(list, 'nandu', 'recent').map((w) => w.id)).toEqual(['a']);
    expect(filterAndSortWorkspaces(list, 'creativo', 'recent').map((w) => w.id)).toEqual(['c']);
    expect(filterAndSortWorkspaces(list, 'zzz', 'recent')).toEqual([]);
  });
  it('no modifica la lista de entrada', () => {
    const copy = [...list];
    filterAndSortWorkspaces(list, '', 'name');
    expect(list).toEqual(copy);
  });
});
