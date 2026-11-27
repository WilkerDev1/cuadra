// Vistas guardadas (ARCHITECTURE.md 3.4, 3.5): filtros, resúmenes e informes como recetas JSON versionadas.
//
// - La receta se guarda tal cual (forma comprobada) y se revisa contra los campos actuales al leerla: un campo
//   desactivado sigue funcionando y avisa field_inactive; uno que ya no existe se quita y avisa field_missing;
//   una opción fusionada sigue a su destino. Así, reactivar un campo devuelve la vista a su forma original.
// - "Borrar" una vista es ocultarla (deleted_at) y queda en el historial. Nada se borra.
// - Cada guardado escribe como mucho una acción de historial (entity_type 'view').
import { DomainError } from '../errors';
import type { SqlExecutor } from '../ports';
import { parseViewRecipe, validateRecipe } from '../recipes';
import {
  fromJson,
  insertSql,
  recordValues,
  selectColumns,
  toField,
  toSavedView,
  type FieldOptionRecord,
  type FieldRecord,
  type SavedViewRecord,
} from '../sql/rows';
import type { Field, Id, Mutation, ViewRecipe, Warning } from '../types';
import { mutate, type CoreDeps, type UowCtx } from '../uow';

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

const KINDS = ['filter', 'summary', 'report'] as const;
const NAME_MAX = 120;

/** Campos del espacio con sus opciones (incluye inactivos), para revisar recetas. */
async function loadFields(exec: SqlExecutor, workspaceId: Id): Promise<Field[]> {
  const [fields, options] = await Promise.all([
    exec.all<FieldRecord>(`SELECT ${selectColumns('fields')} FROM fields WHERE workspace_id = ?`, [workspaceId]),
    exec.all<FieldOptionRecord>(
      `SELECT ${selectColumns('field_options', 'o')} FROM field_options o
       JOIN fields f ON f.id = o.field_id WHERE f.workspace_id = ?`,
      [workspaceId],
    ),
  ]);
  return fields.map((f) => toField(f, options));
}

function checkRecipe(recipe: unknown): ViewRecipe {
  const parsed = parseViewRecipe(recipe);
  if (!parsed.ok) throw new DomainError('invalid_recipe', { path: parsed.error });
  return parsed.value;
}

function checkName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  // Sin código propio en ErrorCode para "nombre requerido": se informa como receta inválida en $.name.
  if (trimmed === '' || trimmed.length > NAME_MAX) throw new DomainError('name_required', { path: '$.name', max: NAME_MAX });
  return trimmed;
}

function checkKind(kind: unknown): ViewRecipe['kind'] {
  if (!KINDS.includes(kind as ViewRecipe['kind'])) throw new DomainError('invalid_recipe', { path: '$.kind' });
  return kind as ViewRecipe['kind'];
}

/** Vista con su receta revisada contra los campos actuales (y los avisos). */
function present(record: SavedViewRecord, fields: Field[]): SavedView {
  const view = toSavedView(record);
  const { recipe, warnings } = validateRecipe(view.recipe, fields);
  return { ...view, recipe, warnings };
}

export function createViewsService(deps: CoreDeps): ViewsService {
  const { driver } = deps;

  async function readRecord(exec: SqlExecutor, id: Id): Promise<SavedViewRecord> {
    const r = await exec.get<SavedViewRecord>(`SELECT ${selectColumns('saved_views')} FROM saved_views WHERE id = ?`, [id]);
    if (r === undefined || r.deleted_at !== null) throw new DomainError('not_found', { entity: 'view', id });
    return r;
  }

  async function assertWritableWorkspace(exec: SqlExecutor, workspaceId: Id): Promise<void> {
    const w = await exec.get<{ archived_at: string | null }>('SELECT archived_at FROM workspaces WHERE id = ?', [workspaceId]);
    if (w === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
    if (w.archived_at !== null) throw new DomainError('workspace_archived', { id: workspaceId });
  }

  /** Nombre único entre las vistas visibles del mismo tipo (sin distinguir mayúsculas). */
  async function assertUniqueName(
    exec: SqlExecutor,
    workspaceId: Id,
    kind: ViewRecipe['kind'],
    name: string,
    exceptId: Id | null,
  ): Promise<void> {
    const clash = await exec.get(
      `SELECT id FROM saved_views WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL
         AND name = ? COLLATE NOCASE AND id IS NOT ?`,
      [workspaceId, kind, name, exceptId],
    );
    if (clash !== undefined) throw new DomainError('duplicate_label', { entity: 'view', name });
  }

  async function nextSort(exec: SqlExecutor, workspaceId: Id, kind: ViewRecipe['kind']): Promise<number> {
    const r = await exec.get<{ n: number | null }>(
      'SELECT MAX(sort_order) AS n FROM saved_views WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL',
      [workspaceId, kind],
    );
    return (r?.n ?? -1) + 1;
  }

  async function insertView(
    ctx: UowCtx,
    input: { workspaceId: Id; name: string; recipe: ViewRecipe; pinned: boolean; message: string; params: Record<string, unknown> },
  ): Promise<SavedView> {
    const { tx } = ctx;
    await assertWritableWorkspace(tx, input.workspaceId);
    await assertUniqueName(tx, input.workspaceId, input.recipe.kind, input.name, null);
    const now = ctx.clock.now().toISOString();
    const record: SavedViewRecord = {
      id: ctx.ids.next(),
      workspace_id: input.workspaceId,
      kind: input.recipe.kind,
      name: input.name,
      recipe: JSON.stringify(input.recipe),
      recipe_version: input.recipe.v,
      pinned: input.pinned ? 1 : 0,
      sort_order: await nextSort(tx, input.workspaceId, input.recipe.kind),
      source: 'user',
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    await tx.run(insertSql('saved_views'), recordValues('saved_views', record));
    await ctx.audit.record(tx, {
      workspaceId: input.workspaceId,
      action: 'create',
      entityType: 'view',
      entityId: record.id,
      accountId: null,
      batchId: null,
      message: input.message,
      params: input.params,
      changes: [{ entityId: record.id, path: '*', new: { kind: record.kind, name: record.name, recipe: input.recipe, pinned: input.pinned } }],
    });
    ctx.touch('saved_views');
    const view = present(record, await loadFields(tx, input.workspaceId));
    for (const w of view.warnings) ctx.warn(w);
    return view;
  }

  return {
    async list<K extends ViewRecipe['kind']>(workspaceId: Id, kind: K): Promise<SavedView<K>[]> {
      checkKind(kind);
      const [ws, records, fields] = await Promise.all([
        driver.get('SELECT 1 AS ok FROM workspaces WHERE id = ?', [workspaceId]),
        driver.all<SavedViewRecord>(
          `SELECT ${selectColumns('saved_views')} FROM saved_views
           WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id`,
          [workspaceId, kind],
        ),
        loadFields(driver, workspaceId),
      ]);
      if (ws === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
      const out: SavedView<K>[] = [];
      for (const r of records) {
        // Una receta corrupta no tumba la lista: se omite aquí y get() la informa con invalid_recipe.
        if (!parseViewRecipe(fromJson(r.recipe)).ok) continue;
        out.push(present(r, fields) as unknown as SavedView<K>);
      }
      return out;
    },

    async get(id) {
      const record = await readRecord(driver, id);
      return present(record, await loadFields(driver, record.workspace_id));
    },

    async save(input) {
      const name = checkName(input.name);
      const recipe = checkRecipe(input.recipe);
      return mutate(deps, input.workspaceId, 'views.save', (ctx) =>
        insertView(ctx, {
          workspaceId: input.workspaceId,
          name,
          recipe,
          pinned: input.pinned ?? false,
          message: 'audit.view.create',
          params: { name, kind: recipe.kind },
        }),
      );
    },

    async update(id, patch) {
      const name = patch.name === undefined ? undefined : checkName(patch.name);
      const recipe = patch.recipe === undefined ? undefined : checkRecipe(patch.recipe);
      const before = await readRecord(driver, id);
      return mutate(deps, before.workspace_id, 'views.update', async (ctx) => {
        const { tx } = ctx;
        const prev = await readRecord(tx, id);
        await assertWritableWorkspace(tx, prev.workspace_id);
        if (recipe !== undefined && recipe.kind !== prev.kind) {
          throw new DomainError('invalid_recipe', { path: '$.kind', expected: prev.kind });
        }
        const prevRecipe = fromJson<ViewRecipe>(prev.recipe);
        const changes: Array<{ entityId: Id; path: string; old: unknown; new: unknown }> = [];
        if (name !== undefined && name !== prev.name) changes.push({ entityId: id, path: 'name', old: prev.name, new: name });
        if (recipe !== undefined && JSON.stringify(recipe) !== JSON.stringify(prevRecipe)) {
          changes.push({ entityId: id, path: 'recipe', old: prevRecipe, new: recipe });
        }
        const pinned = patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0;
        if (pinned !== undefined && pinned !== prev.pinned) {
          changes.push({ entityId: id, path: 'pinned', old: prev.pinned === 1, new: pinned === 1 });
        }
        const fields = await loadFields(tx, prev.workspace_id);
        if (changes.length === 0) {
          const view = present(prev, fields);
          for (const w of view.warnings) ctx.warn(w);
          return view;
        }
        if (name !== undefined && name !== prev.name) await assertUniqueName(tx, prev.workspace_id, prev.kind as ViewRecipe['kind'], name, id);
        const next: SavedViewRecord = {
          ...prev,
          name: name ?? prev.name,
          recipe: recipe === undefined ? prev.recipe : JSON.stringify(recipe),
          recipe_version: recipe?.v ?? prev.recipe_version,
          pinned: pinned ?? prev.pinned,
          updated_at: ctx.clock.now().toISOString(),
        };
        await tx.run(
          'UPDATE saved_views SET name = ?, recipe = ?, recipe_version = ?, pinned = ?, updated_at = ? WHERE id = ?',
          [next.name, next.recipe, next.recipe_version, next.pinned, next.updated_at, id],
        );
        await ctx.audit.record(tx, {
          workspaceId: prev.workspace_id,
          action: 'edit',
          entityType: 'view',
          entityId: id,
          accountId: null,
          batchId: null,
          message: 'audit.view.edit',
          params: { name: next.name, kind: prev.kind },
          changes,
        });
        ctx.touch('saved_views');
        const view = present(next, fields);
        for (const w of view.warnings) ctx.warn(w);
        return view;
      });
    },

    async duplicate(id, name) {
      const requested = name === undefined ? undefined : checkName(name);
      const source = await readRecord(driver, id);
      const recipe = checkRecipe(fromJson(source.recipe));
      return mutate(deps, source.workspace_id, 'views.duplicate', async (ctx) => {
        let finalName = requested;
        if (finalName === undefined) {
          const taken = new Set(
            (
              await ctx.tx.all<{ name: string }>(
                'SELECT name FROM saved_views WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL',
                [source.workspace_id, source.kind],
              )
            ).map((r) => r.name.toLocaleLowerCase('es')),
          );
          const base = `${source.name} (copia`;
          finalName = `${base})`;
          for (let n = 2; taken.has(finalName.toLocaleLowerCase('es')); n++) finalName = `${base} ${n})`;
          finalName = checkName(finalName.length > NAME_MAX ? finalName.slice(-NAME_MAX) : finalName);
        }
        return insertView(ctx, {
          workspaceId: source.workspace_id,
          name: finalName,
          recipe,
          pinned: false,
          message: 'audit.view.duplicate',
          params: { name: finalName, kind: recipe.kind, sourceId: id },
        });
      });
    },

    async remove(id) {
      const before = await readRecord(driver, id);
      await mutate(deps, before.workspace_id, 'views.remove', async (ctx) => {
        const prev = await readRecord(ctx.tx, id);
        const now = ctx.clock.now().toISOString();
        await ctx.tx.run('UPDATE saved_views SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
        await ctx.audit.record(ctx.tx, {
          workspaceId: prev.workspace_id,
          action: 'archive',
          entityType: 'view',
          entityId: id,
          accountId: null,
          batchId: null,
          message: 'audit.view.remove',
          params: { name: prev.name, kind: prev.kind },
          changes: [{ entityId: id, path: 'deleted_at', old: null, new: now }],
        });
        ctx.touch('saved_views');
      });
    },

    async reorder(workspaceId, kind, ids) {
      checkKind(kind);
      if (new Set(ids).size !== ids.length) throw new DomainError('invalid_recipe', { path: 'ids' });
      await mutate(deps, workspaceId, 'views.reorder', async (ctx) => {
        const rows = await ctx.tx.all<{ id: string; sort_order: number }>(
          `SELECT id, sort_order FROM saved_views WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL
           ORDER BY sort_order, created_at, id`,
          [workspaceId, kind],
        );
        if (rows.length === 0) await assertWritableWorkspace(ctx.tx, workspaceId);
        const known = new Set(rows.map((r) => r.id));
        for (const id of ids) if (!known.has(id)) throw new DomainError('not_found', { entity: 'view', id });
        // Los que no vienen en `ids` conservan su orden relativo, detrás de los indicados.
        const order = [...ids, ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
        const current = new Map(rows.map((r) => [r.id, r.sort_order]));
        const updates = order.map((id, i) => [i, id] as const).filter(([i, id]) => current.get(id) !== i);
        if (updates.length === 0) return;
        await ctx.tx.runMany('UPDATE saved_views SET sort_order = ? WHERE id = ?', updates.map(([i, id]) => [i, id]));
        ctx.touch('saved_views');
      });
    },
  };
}
