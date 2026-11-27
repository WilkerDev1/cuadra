import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { isDomainError } from '../errors';
import type { ChangeEvent } from '../events';
import type { ViewRecipe } from '../types';
import { ledgerFixture } from './ledger.fixture';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function failure(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  return undefined;
}

const FILTER: ViewRecipe = { v: 1, kind: 'filter', filter: { kinds: ['expense'] }, sort: { by: 'amount', dir: 'desc' } };

async function seed() {
  h = await createTestCuadra();
  const fx = ledgerFixture(h.driver, h.ids);
  const ws = await fx.workspace();
  const cat = await fx.field(ws, { key: 'categoria', label: 'Categoría', type: 'list', options: ['Ventas', 'Compras'] });
  const events: ChangeEvent[] = [];
  h.cuadra.subscribe((e) => events.push(e));
  return { h, fx, ws, cat, events, views: h.cuadra.views };
}

const auditRows = (th: TestCuadra) =>
  th.driver.all<{ action: string; entity_type: string; message: string }>(
    'SELECT action, entity_type, message FROM audit_log ORDER BY id',
  );

describe('views: vistas guardadas', () => {
  it('save, get, list y update con una acción de historial por guardado', async () => {
    const { views, ws, events, h: th } = await seed();
    const saved = await views.save({ workspaceId: ws, name: '  Gastos   grandes ', recipe: FILTER, pinned: true });
    expect(saved.value).toMatchObject({ workspaceId: ws, kind: 'filter', name: 'Gastos grandes', pinned: true, sortOrder: 0, source: 'user', warnings: [] });
    expect(saved.auditActionId).not.toBeNull();
    expect(events).toEqual([{ workspaceId: ws, tables: expect.arrayContaining(['saved_views', 'audit_log']), reason: 'views.save' }]);
    expect(await views.get(saved.value.id)).toEqual(saved.value);

    const second = await views.save({
      workspaceId: ws,
      name: 'Por mes',
      recipe: { v: 1, kind: 'summary', filter: {}, groupBy: { by: 'period', unit: 'month' }, measure: 'net', chart: 'line' },
    });
    expect((await views.list(ws, 'filter')).map((v) => v.name)).toEqual(['Gastos grandes']);
    expect((await views.list(ws, 'summary')).map((v) => v.name)).toEqual(['Por mes']);
    expect(await views.list(ws, 'report')).toEqual([]);

    const renamed = await views.update(saved.value.id, { name: 'Salidas grandes', pinned: false });
    expect(renamed.value).toMatchObject({ name: 'Salidas grandes', pinned: false });
    const changes = await th.driver.all<{ path: string }>(
      'SELECT path FROM audit_log_changes WHERE action_id = ? ORDER BY ord',
      [renamed.auditActionId],
    );
    expect(changes.map((c) => c.path)).toEqual(['name', 'pinned']);

    // Sin cambios reales: ni historial ni evento.
    const before = events.length;
    const same = await views.update(saved.value.id, { name: 'Salidas grandes', recipe: FILTER });
    expect(same.auditActionId).toBeNull();
    expect(events).toHaveLength(before);

    // La receta cambia, pero no de tipo.
    const newRecipe: ViewRecipe = { v: 1, kind: 'filter', filter: { kinds: ['income'] } };
    expect((await views.update(saved.value.id, { recipe: newRecipe })).value.recipe).toEqual(newRecipe);
    expect(isDomainError(await failure(() => views.update(saved.value.id, { recipe: second.value.recipe })), 'invalid_recipe')).toBe(true);
    expect((await auditRows(th)).map((r) => [r.action, r.entity_type, r.message])).toEqual([
      ['create', 'view', 'audit.view.create'],
      ['create', 'view', 'audit.view.create'],
      ['edit', 'view', 'audit.view.edit'],
      ['edit', 'view', 'audit.view.edit'],
    ]);
  });

  it('duplicate, remove (ocultar, no borrar) y reorder', async () => {
    const { views, ws, h: th } = await seed();
    const a = await views.save({ workspaceId: ws, name: 'A', recipe: FILTER });
    const copy = await views.duplicate(a.value.id);
    expect(copy.value).toMatchObject({ name: 'A (copia)', recipe: FILTER, pinned: false, sortOrder: 1 });
    expect((await views.duplicate(a.value.id)).value.name).toBe('A (copia 2)');
    const named = await views.duplicate(a.value.id, 'Otra');
    expect(named.value.name).toBe('Otra');

    await views.remove(copy.value.id);
    expect(isDomainError(await failure(() => views.get(copy.value.id)), 'not_found')).toBe(true);
    expect((await views.list(ws, 'filter')).map((v) => v.name)).toEqual(['A', 'A (copia 2)', 'Otra']);
    const row = await th.driver.get<{ deleted_at: string | null }>('SELECT deleted_at FROM saved_views WHERE id = ?', [copy.value.id]);
    expect(row?.deleted_at).not.toBeNull();
    expect((await auditRows(th)).at(-1)).toMatchObject({ action: 'archive', entity_type: 'view', message: 'audit.view.remove' });
    expect(isDomainError(await failure(() => views.remove(copy.value.id)), 'not_found')).toBe(true);
    // Un nombre ocupado por una vista borrada vuelve a estar libre.
    expect((await views.save({ workspaceId: ws, name: 'a (COPIA)', recipe: FILTER })).value.name).toBe('a (COPIA)');

    const list = await views.list(ws, 'filter');
    const ids = list.map((v) => v.id);
    await views.reorder(ws, 'filter', [ids[3]!, ids[0]!]);
    expect((await views.list(ws, 'filter')).map((v) => v.name)).toEqual(['a (COPIA)', 'A', 'A (copia 2)', 'Otra']);
    expect(isDomainError(await failure(() => views.reorder(ws, 'filter', [copy.value.id])), 'not_found')).toBe(true);
  });

  it('valida nombre, receta, tipo y espacio', async () => {
    const { views, ws, fx } = await seed();
    await views.save({ workspaceId: ws, name: 'Única', recipe: FILTER });
    expect(isDomainError(await failure(() => views.save({ workspaceId: ws, name: 'ÚNICA', recipe: FILTER })), 'duplicate_label')).toBe(true);
    // Mismo nombre en otro tipo sí vale.
    await views.save({
      workspaceId: ws,
      name: 'Única',
      recipe: { v: 1, kind: 'summary', filter: {}, groupBy: { by: 'kind' }, measure: 'both', chart: 'bars' },
    });
    expect(isDomainError(await failure(() => views.save({ workspaceId: ws, name: '   ', recipe: FILTER })), 'name_required')).toBe(true);
    const bad = { v: 1, kind: 'filter', filter: { period: { from: '2026-02-30' } } } as unknown as ViewRecipe;
    expect(isDomainError(await failure(() => views.save({ workspaceId: ws, name: 'Mala', recipe: bad })), 'invalid_recipe')).toBe(true);
    expect(isDomainError(await failure(() => views.save({ workspaceId: 'no', name: 'X', recipe: FILTER })), 'not_found')).toBe(true);
    expect(isDomainError(await failure(() => views.list('no', 'filter')), 'not_found')).toBe(true);
    expect(isDomainError(await failure(() => views.list(ws, 'otro' as 'filter')), 'invalid_recipe')).toBe(true);
    expect(isDomainError(await failure(() => views.get('no')), 'not_found')).toBe(true);
    const archived = await fx.workspace({ name: 'Archivado' });
    await h!.driver.run('UPDATE workspaces SET archived_at = ? WHERE id = ?', ['2026-06-01T00:00:00.000Z', archived]);
    expect(isDomainError(await failure(() => views.save({ workspaceId: archived, name: 'X', recipe: FILTER })), 'workspace_archived')).toBe(true);
  });

  it('una receta con un campo que ya no existe se limpia y avisa field_missing; una corrupta no tumba la lista', async () => {
    const { views, ws, cat, h: th } = await seed();
    const ghost = '01900000-0000-7000-8000-0000000000ff';
    const saved = await views.save({
      workspaceId: ws,
      name: 'Con fantasma',
      recipe: {
        v: 1,
        kind: 'report',
        form: 'custom',
        filter: { fields: [{ fieldId: ghost, op: 'empty' }, { fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Ventas']!] }] },
        sections: ['header', 'statement', 'by_field'],
        groupByFieldIds: [ghost, cat.id],
        columns: ['date', ghost],
        includeVoided: false,
        signature: false,
      },
    });
    expect(saved.warnings).toEqual([{ code: 'field_missing', fieldKeyOrId: ghost }]);
    const view = await views.get(saved.value.id);
    if (view.recipe.kind !== 'report') throw new Error('kind');
    expect(view.recipe.filter.fields).toEqual([{ fieldId: cat.id, op: 'any_of', optionIds: [cat.opt['Ventas']] }]);
    expect(view.recipe.groupByFieldIds).toEqual([cat.id]);
    expect(view.recipe.columns).toEqual(['date']);
    // La receta guardada no se reescribe: si el campo vuelve (respaldo), la vista vuelve entera.
    const raw = await th.driver.get<{ recipe: string }>('SELECT recipe FROM saved_views WHERE id = ?', [saved.value.id]);
    expect(raw?.recipe).toContain(ghost);

    await th.driver.run("UPDATE saved_views SET recipe = '{\"v\":9}' WHERE id = ?", [saved.value.id]);
    expect(await views.list(ws, 'report')).toEqual([]);
    expect(isDomainError(await failure(() => views.get(saved.value.id)), 'invalid_recipe')).toBe(true);
  });
});
