// Orden y búsqueda del selector de espacios (lógica pura).
import type { WorkspaceSummary } from '../../core';
import { normalizeSearch } from '../../core/text';

export type SwitcherSort = 'recent' | 'name';

export function filterAndSortWorkspaces(
  list: readonly WorkspaceSummary[],
  query: string,
  sort: SwitcherSort,
): WorkspaceSummary[] {
  const q = normalizeSearch(query);
  const visible = list.filter(
    (ws) => ws.archivedAt === null && (q === '' || normalizeSearch(`${ws.name} ${ws.ownerName}`).includes(q)),
  );
  const byName = (a: WorkspaceSummary, b: WorkspaceSummary) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  if (sort === 'name') return visible.sort(byName);
  // Recientes: último movimiento primero; sin movimientos, al final, por el orden manual del espacio.
  return visible.sort((a, b) => {
    const da = a.lastMovementDate ?? '';
    const db = b.lastMovementDate ?? '';
    if (da !== db) return da < db ? 1 : -1;
    return a.sortOrder - b.sortOrder || byName(a, b);
  });
}
