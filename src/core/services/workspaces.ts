// Espacios (ARCHITECTURE.md 3.5). Stub de la Oleada 1: firma completa, lo implementa la Oleada 2 (2B).
import { notImplemented } from '../errors';
import type { Currency, Id, Mutation, Workspace, WorkspaceSummary } from '../types';
import type { CoreDeps } from '../uow';

export interface WorkspacesService {
  list(opts?: { includeArchived?: boolean }): Promise<WorkspaceSummary[]>;
  get(id: Id): Promise<Workspace>;
  create(input: { name: string; ownerName?: string; currency?: Currency; color?: string }): Promise<Mutation<Workspace>>;
  update(
    id: Id,
    patch: Partial<Pick<Workspace, 'name' | 'ownerName' | 'logoDataUrl' | 'color'>> & {
      currency?: Currency; // minorDigits solo cambia si no hay movimientos → 'currency_locked'
    },
  ): Promise<Mutation<Workspace>>;
  reorder(ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Workspace>>;
  unarchive(id: Id): Promise<Mutation<Workspace>>;
  /** F-03: exige escribir el nombre exacto; el llamador hace antes una copia automática. */
  purge(id: Id, confirmName: string): Promise<void>;
}

export function createWorkspacesService(_deps: CoreDeps): WorkspacesService {
  return {
    list: async () => notImplemented('workspaces.list'),
    get: async () => notImplemented('workspaces.get'),
    create: async () => notImplemented('workspaces.create'),
    update: async () => notImplemented('workspaces.update'),
    reorder: async () => notImplemented('workspaces.reorder'),
    archive: async () => notImplemented('workspaces.archive'),
    unarchive: async () => notImplemented('workspaces.unarchive'),
    purge: async () => notImplemented('workspaces.purge'),
  };
}
