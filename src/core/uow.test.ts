import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../test/harness';
import { createEventBus, type ChangeEvent } from './events';
import { createAuditWriter } from './services/audit';
import { mutate, UowError, type CoreDeps } from './uow';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function setup(): Promise<{ deps: CoreDeps; events: ChangeEvent[] }> {
  h = await createTestCuadra();
  const events: ChangeEvent[] = [];
  const bus = createEventBus();
  bus.subscribe((e) => events.push(e));
  const deps: CoreDeps = {
    driver: h.driver,
    clock: h.clock,
    ids: h.ids,
    events: bus,
    audit: createAuditWriter({ clock: h.clock, ids: h.ids }),
    locale: 'es-DO',
  };
  return { deps, events };
}

const now = () => '2026-06-15T12:00:00.000Z';

async function insertWorkspace(deps: CoreDeps, id: string, name: string) {
  return mutate(deps, id, 'workspace.create', async (ctx) => {
    await ctx.tx.run(
      'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, name, now(), now()],
    );
    const actionId = await ctx.audit.record(ctx.tx, {
      workspaceId: id,
      action: 'create',
      entityType: 'workspace',
      entityId: id,
      accountId: null,
      batchId: null,
      message: 'audit.workspace.create',
      params: { name },
      changes: [{ entityId: id, path: '*', new: { name } }, { path: 'name', old: null, new: name }],
    });
    ctx.touch('workspaces');
    ctx.warn({ code: 'zero_amount' });
    ctx.warn({ code: 'zero_amount' });
    return actionId;
  });
}

describe('mutate (unidad de trabajo)', () => {
  it('hace COMMIT, escribe una acción con sus líneas y emite un evento con las tablas tocadas', async () => {
    const { deps, events } = await setup();
    const result = await insertWorkspace(deps, 'ws-1', 'Colmado');
    expect(result.auditActionId).toBe(result.value);
    expect(result.warnings).toEqual([{ code: 'zero_amount' }]);
    expect(events).toEqual([{ workspaceId: 'ws-1', tables: ['audit_log', 'workspaces'], reason: 'workspace.create' }]);

    const log = await deps.driver.all('SELECT * FROM audit_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ id: result.value, action: 'create', at: now(), params: '{"name":"Colmado"}' });
    const changes = await deps.driver.all('SELECT * FROM audit_log_changes ORDER BY ord');
    expect(changes).toEqual([
      { action_id: result.value, ord: 0, entity_id: 'ws-1', path: '*', old_value: null, new_value: '{"name":"Colmado"}' },
      { action_id: result.value, ord: 1, entity_id: null, path: 'name', old_value: 'null', new_value: '"Colmado"' },
    ]);
  });

  it('si fn lanza hace ROLLBACK: no queda nada escrito ni se emite evento', async () => {
    const { deps, events } = await setup();
    await expect(
      mutate(deps, 'ws-1', 'workspace.create', async (ctx) => {
        await ctx.tx.run('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
          'ws-1',
          'X',
          now(),
          now(),
        ]);
        ctx.touch('workspaces');
        throw new Error('validación');
      }),
    ).rejects.toThrow('validación');
    expect(await deps.driver.all('SELECT id FROM workspaces')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('una segunda acción de historial en la misma unidad lanza y deshace todo (I-10)', async () => {
    const { deps, events } = await setup();
    const entry = {
      workspaceId: null,
      action: 'config' as const,
      entityType: 'settings',
      entityId: null,
      accountId: null,
      batchId: null,
      message: 'audit.settings',
      params: null,
      changes: [],
    };
    await expect(
      mutate(deps, null, 'settings', async (ctx) => {
        await ctx.audit.record(ctx.tx, entry);
        await ctx.audit.record(ctx.tx, entry);
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof UowError && /como mucho una acción de historial/.test(e.message));
    expect(await deps.driver.all('SELECT id FROM audit_log')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('sin tablas tocadas no hay evento ni acción (edición sin cambios)', async () => {
    const { deps, events } = await setup();
    const result = await mutate(deps, 'ws-1', 'tx.update', async () => 'sin cambios');
    expect(result).toEqual({ value: 'sin cambios', warnings: [], auditActionId: null });
    expect(events).toEqual([]);
  });

  it('el historial solo se escribe con el tx de la unidad y mientras está abierta', async () => {
    const { deps } = await setup();
    let leaked: Parameters<Parameters<typeof mutate>[3]>[0] | undefined;
    await expect(
      mutate(deps, null, 'x', async (ctx) => {
        await ctx.audit.record(deps.driver, {
          workspaceId: null,
          action: 'config',
          entityType: 'settings',
          entityId: null,
          accountId: null,
          batchId: null,
          message: 'm',
          params: null,
          changes: [],
        });
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof UowError && /con el tx de la unidad/.test(e.message));
    await mutate(deps, null, 'x', async (ctx) => {
      leaked = ctx;
    });
    await expect(
      leaked!.audit.record(leaked!.tx, {
        workspaceId: null,
        action: 'config',
        entityType: 'settings',
        entityId: null,
        accountId: null,
        batchId: null,
        message: 'm',
        params: null,
        changes: [],
      }),
    ).rejects.toBeInstanceOf(UowError);
  });

  it('el evento se emite después del COMMIT: el oyente ya ve los datos', async () => {
    const { deps } = await setup();
    const seen: unknown[] = [];
    const bus = createEventBus();
    bus.subscribe(() => {
      void deps.driver.get('SELECT name FROM workspaces').then((r) => seen.push(r));
    });
    await insertWorkspace({ ...deps, events: bus }, 'ws-2', 'Despacho');
    await deps.driver.get('SELECT 1');
    expect(seen).toEqual([{ name: 'Despacho' }]);
  });
});
