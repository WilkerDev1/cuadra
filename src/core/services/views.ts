// Vistas guardadas (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2C).
import { notImplemented } from '../errors';
import type { Id, Mutation, ViewRecipe, Warning } from '../types';
import type { CoreDeps } from '../uow';

export interface SavedView<K extends ViewRecipe['kind'] = ViewRecipe['kind']> {
  id: Id;
  workspaceId: Id;
  kind: K;
  name: string;
  recipe: Extract<ViewRecipe, { kind: K }>;
  pinned: boolean;
  sortOrder: number;
  source: 'user' | 'template';
  warnings: Warning[];
}

export interface ViewsService {
  list<K extends ViewRecipe['kind']>(workspaceId: Id, kind: K): Promise<SavedView<K>[]>;
  get(id: Id): Promise<SavedView>;
  save(input: { workspaceId: Id; name: string; recipe: ViewRecipe; pinned?: boolean }): Promise<Mutation<SavedView>>;
  update(id: Id, patch: { name?: string; recipe?: ViewRecipe; pinned?: boolean }): Promise<Mutation<SavedView>>;
  duplicate(id: Id, name?: string): Promise<Mutation<SavedView>>;
  remove(id: Id): Promise<void>; // deleted_at; auditado
  reorder(workspaceId: Id, kind: ViewRecipe['kind'], ids: Id[]): Promise<void>;
}

export function createViewsService(_deps: CoreDeps): ViewsService {
  return {
    list: async () => notImplemented('views.list'),
    get: async () => notImplemented('views.get'),
    save: async () => notImplemented('views.save'),
    update: async () => notImplemented('views.update'),
    duplicate: async () => notImplemented('views.duplicate'),
    remove: async () => notImplemented('views.remove'),
    reorder: async () => notImplemented('views.reorder'),
  };
}
