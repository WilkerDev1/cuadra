// Historial: diff por campo, lectura general con filtros y paginación, y por entidad.
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { Transaction } from '../types';
import type { Id } from '../types';
import { mutate, type CoreDeps } from '../uow';
import { createAuditWriter, diffTransaction } from './audit';
import { codeOf, seedAccount, seedWorkspace } from './movements.testkit';

let t: TestCuadra;
let ws: Id;
let cash: Id;

beforeEach(async () => {
  t = await createTestCuadra();
  ws = await seedWorkspace(t);
  cash = await seedAccount(t, ws, { name: 'Caja' });
});

const base: Transaction = {
  id: 't1', workspaceId: 'w', accountId: 'a', seq: 1, kind: 'income', direction: 'in', amountMinor: 100,
  date: '2026-06-01', description: 'Venta', notes: '', status: 'active', voidReason: null, voidedAt: null,
  batchId: null, transferGroupId: null, counterpart: null, recordedAt: 'x', updatedAt: 'x',
  values: { f1: { type: 'text', value: 'a' } },
};

describe('diffTransaction', () => {
  it('sin cambios no da líneas; ignora marcas del sistema', () => {
    expect(diffTransaction(base, { ...base, updatedAt: 'y', values: { f1: { type: 'text', value: 'a' } } })).toEqual([]);
  });

  it('una línea por campo con valor anterior y nuevo; ausente es null', () => {
    const after: Transaction = {
      ...base, kind: 'expense', direction: 'out', notes: 'n',
      values: { f2: { type: 'bool', value: false } },
    };
    expect(diffTransaction(base, after)).toEqual([
      { path: 'kind', old: 'income', new: 'expense' },
      { path: 'notes', old: '', new: 'n' },
      { path: 'field:f1', old: { type: 'text', value: 'a' }, new: null },
      { path: 'field:f2', old: null, new: { type: 'bool', value: false } },
    ]);
  });

  it('el sentido solo aparece cuando el tipo no cambió (saldo inicial)', () => {
    const opening = { ...base, kind: 'opening' as const };
    expect(diffTransaction(opening, { ...opening, direction: 'out' })).toEqual([{ path: 'direction', old: 'in', new: 'out' }]);
    expect(diffTransaction(base, { ...base, status: 'voided', voidReason: 'x', voidedAt: 'y' })).toEqual([
      { path: 'status', old: 'active', new: 'voided' },
      { path: 'void_reason', old: null, new: 'x' },
    ]);
  });
});

describe('AuditService', () => {
  const sale = (amountMinor: number) =>
    t.cuadra.transactions.create({ accountId: cash, kind: 'income', amountMinor, date: '2026-06-10', description: 'Venta' });

  it('pagina del más reciente al más antiguo sin repetir ni saltar', async () => {
    const ids: Id[] = [];
    for (let i = 1; i <= 7; i++) ids.push((await sale(i)).auditActionId!);
    const seen: Id[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await t.cuadra.audit.list(ws, { limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
    expect(await codeOf(t.cuadra.audit.list(ws, { cursor: 'basura' }))).toBe('not_found');
  });

  it('filtra por fechas locales del día de la acción', async () => {
    t.clock.setToday('2026-06-01');
    const a = await sale(1);
    t.clock.setToday('2026-06-05');
    const b = await sale(2);
    t.clock.setToday('2026-06-09');
    const c = await sale(3);
    const ids = async (input: { from?: string; to?: string }) => (await t.cuadra.audit.list(ws, input)).items.map((e) => e.id);
    expect(await ids({ from: '2026-06-05' })).toEqual([c.auditActionId, b.auditActionId]);
    expect(await ids({ to: '2026-06-05' })).toEqual([b.auditActionId, a.auditActionId]);
    expect(await ids({ from: '2026-06-02', to: '2026-06-08' })).toEqual([b.auditActionId]);
    expect(await codeOf(t.cuadra.audit.list(ws, { from: '2026-02-30' }))).toBe('invalid_date');
  });

  it('forEntity encuentra la acción por su entidad y por las entidades de sus líneas', async () => {
    const deps: CoreDeps = {
      driver: t.driver, clock: t.clock, ids: t.ids,
      events: { subscribe: () => () => undefined, emit: () => undefined, size: 0 },
      audit: createAuditWriter({ clock: t.clock, ids: t.ids }), locale: 'es-DO',
    };
    const m = await mutate(deps, ws, 'fields.mergeOptions', async (ctx) => {
      await ctx.audit.record(ctx.tx, {
        workspaceId: ws, action: 'merge', entityType: 'option', entityId: 'opt-target', accountId: null, batchId: null,
        message: 'audit.option.merge', params: { moved: 3 },
        changes: [{ entityId: 'opt-source', path: 'merged_into_id', old: null, new: 'opt-target' }],
      });
      return null;
    });
    const byEntity = await t.cuadra.audit.forEntity('option', 'opt-target');
    const byLine = await t.cuadra.audit.forEntity('option', 'opt-source');
    expect(byEntity.map((e) => e.id)).toEqual([m.auditActionId]);
    expect(byLine.map((e) => e.id)).toEqual([m.auditActionId]);
    expect(byLine[0]!.changes).toEqual([{ entityId: 'opt-source', path: 'merged_into_id', old: null, new: 'opt-target' }]);
    expect(byLine[0]!.params).toEqual({ moved: 3 });
    expect(await t.cuadra.audit.forEntity('option', 'nadie')).toEqual([]);
    expect(await codeOf(t.cuadra.transactions.history('no-existe'))).toBe('not_found');
  });

  it('el alta guarda una instantánea completa en la línea "*"', async () => {
    const { value, auditActionId } = await sale(4_200);
    const [entry] = await t.cuadra.audit.forEntity('transaction', value.id);
    expect(entry!.id).toBe(auditActionId);
    expect(entry).toMatchObject({ action: 'create', entityType: 'transaction', accountId: cash, message: 'audit.tx.create' });
    expect(entry!.params).toMatchObject({ seq: 1, amountMinor: 4_200, kind: 'income' });
    expect(entry!.changes).toEqual([
      {
        entityId: value.id, path: '*', old: undefined,
        new: {
          accountId: cash, seq: 1, kind: 'income', direction: 'in', amountMinor: 4_200, date: '2026-06-10',
          description: 'Venta', notes: '', status: 'active', values: {},
        },
      },
    ]);
  });
});
