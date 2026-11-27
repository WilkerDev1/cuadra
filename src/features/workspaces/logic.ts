// Lógica pura del selector de espacios (sin React ni DOM): a dónde lleva la raíz, orden y búsqueda, tintas
// y confirmación de borrado. Las pruebas viven en logic.test.ts.
import { normalizeSearch } from '../../core/text';
import type { Id, WorkspaceSummary } from '../../core/types';

// ── Qué hace la ruta raíz ───────────────────────────────────────────────────────────────

export type RootTarget =
  | { kind: 'redirect'; to: string }
  | { kind: 'select' };

/**
 * Decide qué hace `/`:
 *  - sin ningún espacio (ni archivado) → bienvenida;
 *  - al abrir la app (`initialEntry`: primera entrada de la sesión) con un último espacio que existe y no está archivado → ese espacio;
 *  - en cualquier otro caso → el selector. Navegar a `/` desde la app («Ver todos») siempre muestra el
 *    selector: si rebotara al último espacio, nunca se podría ver la lista.
 */
export function resolveRoot(
  list: ReadonlyArray<Pick<WorkspaceSummary, 'id' | 'archivedAt'>>,
  lastId: Id | null,
  initialEntry: boolean,
): RootTarget {
  if (list.length === 0) return { kind: 'redirect', to: '/bienvenida' };
  if (initialEntry && lastId !== null) {
    const last = list.find((w) => w.id === lastId);
    if (last !== undefined && last.archivedAt === null) return { kind: 'redirect', to: `/e/${last.id}` };
  }
  return { kind: 'select' };
}

// ── Lista ───────────────────────────────────────────────────────────────────────────────

export type WorkspaceSort = 'recent' | 'name';

export function splitWorkspaces(list: readonly WorkspaceSummary[]): { active: WorkspaceSummary[]; archived: WorkspaceSummary[] } {
  const active: WorkspaceSummary[] = [];
  const archived: WorkspaceSummary[] = [];
  for (const w of list) (w.archivedAt === null ? active : archived).push(w);
  return { active, archived };
}

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/** Filtra por nombre o titular y ordena: recientes (último movimiento primero) o A–Z. No muta la entrada. */
export function filterAndSort(list: readonly WorkspaceSummary[], query: string, sort: WorkspaceSort): WorkspaceSummary[] {
  const q = normalizeSearch(query);
  const visible = list.filter((w) => q === '' || normalizeSearch(`${w.name} ${w.ownerName}`).includes(q));
  if (sort === 'name') return visible.sort(byName);
  return visible.sort((a, b) => {
    const da = a.lastMovementDate ?? '';
    const db = b.lastMovementDate ?? '';
    if (da !== db) return da < db ? 1 : -1;
    return a.sortOrder - b.sortOrder || byName(a, b);
  });
}

/** El buscador y el orden solo aparecen cuando la lista ya es larga (un contador con 20 clientes). */
export function showsTools(activeCount: number): { search: boolean; sort: boolean } {
  return { search: activeCount >= 6, sort: activeCount >= 2 };
}

// ── Tintas ──────────────────────────────────────────────────────────────────────────────

export const TINTS = ['tint-1', 'tint-2', 'tint-3', 'tint-4', 'tint-5', 'tint-6', 'tint-7', 'tint-8'] as const;
export type TintKey = (typeof TINTS)[number];

/** Tinta del sistema que corresponde al color guardado (`tint-3` o `3`); `null` si es otro valor. */
export function tintKeyOf(color: string | null | undefined): TintKey | null {
  const m = /^(?:tint-)?([1-8])$/.exec(color?.trim() ?? '');
  return m === null ? null : (`tint-${m[1]}` as TintKey);
}

// ── Cambios del formulario de edición ───────────────────────────────────────────────────

export type EditCheck = { ok: true; name: string; color: TintKey | null } | { ok: false; reason: 'name_empty' };

export function checkEdit(input: { name: string; color: TintKey | null }): EditCheck {
  const name = input.name.trim();
  if (name === '') return { ok: false, reason: 'name_empty' };
  return { ok: true, name, color: input.color };
}

/** ¿Hay algo que guardar? (nombre o color distintos de los iniciales del formulario). */
export function hasEditChanges(
  initial: { name: string; color: TintKey | null },
  next: { name: string; color: TintKey | null },
): boolean {
  return next.name.trim() !== initial.name || next.color !== initial.color;
}

// ── Borrado definitivo ──────────────────────────────────────────────────────────────────

/** El nombre escrito coincide con el del espacio (ignora espacios sobrantes en los extremos de lo escrito). */
export function purgeNameMatches(name: string, typed: string): boolean {
  return typed.trim() === name;
}
