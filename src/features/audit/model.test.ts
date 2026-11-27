import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry, Field } from '../../core';
import { Money } from '../../core';
import { t as translate } from '../../i18n';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { historyCsv, historySheet, exportTranslate } from './exportAudit';
import {
  ACTION_GROUPS,
  NO_FILTERS,
  actionLabelKey,
  dayHeading,
  changeLines,
  describeChange,
  entryAmount,
  entryTarget,
  filtersFromParams,
  filtersToParams,
  groupByDay,
  isFiltered,
  mergePages,
  textParams,
  toQuery,
  type ChangeContext,
} from './model';

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'e1',
  workspaceId: 'w',
  at: '2026-11-26T18:32:00.000Z',
  action: 'edit',
  entityType: 'transaction',
  entityId: 'tx1',
  accountId: 'a1',
  batchId: null,
  message: 'audit.tx.edit',
  params: { seq: 12, description: 'Cemento', amountMinor: 185000, kind: 'expense' },
  changes: [],
  ...over,
});

const field = { id: 'f1', label: 'Categoría', type: 'list', options: [{ id: 'o1', label: 'Materiales' }, { id: 'o2', label: 'Varios' }] } as unknown as Field;
const ctx: ChangeContext = {
  t: (k, p) => translate(k, p),
  formatMoney: (m) => Money.format(m, { locale: 'es-DO', currency: { code: 'DOP', minorDigits: 2, symbol: 'RD$' } }),
  formatDate: (d) => d,
  fields: [field],
};

describe('filtros ⇄ URL', () => {
  it('sin filtros la URL queda vacía y se lee igual', () => {
    expect(filtersToParams(NO_FILTERS).toString()).toBe('');
    expect(filtersFromParams(new URLSearchParams())).toEqual(NO_FILTERS);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it('ida y vuelta con todo', () => {
    const f = { period: { from: '2026-01-01', to: '2026-02-01' }, accountId: 'a1', group: 'void' as const, entity: 'batch' as const };
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
    expect(isFiltered(f)).toBe(true);
  });

  it('valores inválidos se ignoran', () => {
    const f = filtersFromParams(new URLSearchParams('accion=nada&elemento=otro&periodo=ayer&desde=2026-02-31'));
    expect(f).toEqual(NO_FILTERS);
  });

  it('el grupo de acciones se traduce a las del núcleo y el periodo se resuelve contra hoy', () => {
    const q = toQuery({ ...NO_FILTERS, period: { preset: 'this_month' }, group: 'record', entity: 'transaction', accountId: 'a1' }, '2026-11-27');
    expect(q).toEqual({ from: '2026-11-01', to: '2026-11-30', accountId: 'a1', actions: [...ACTION_GROUPS.record], entityType: 'transaction' });
    expect(toQuery(NO_FILTERS, '2026-11-27')).toEqual({});
  });
});

describe('agrupar por día', () => {
  it('agrupa consecutivos por día local y conserva el orden', () => {
    const mk = (id: string, at: string) => entry({ id, at });
    const groups = groupByDay([mk('a', '2026-11-26T16:00:00-04:00'), mk('b', '2026-11-26T09:00:00-04:00'), mk('c', '2026-11-25T23:30:00-04:00')]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(groups[1]?.entries.map((e) => e.id)).toEqual(['c']);
  });

  it('une páginas sin repetir', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b' });
    expect(mergePages([{ items: [a, b] }, { items: [b, entry({ id: 'c' })] }]).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('texto de cada entrada', () => {
  it('monto: el del movimiento o la suma del lote; nada si no hay', () => {
    expect(entryAmount(entry({}))).toEqual({ minor: 185000, kind: 'expense' });
    expect(entryAmount(entry({ params: { sumMinor: 5000, count: 3, kind: 'income' } }))).toEqual({ minor: 5000, kind: 'income' });
    // Un lote mixto (datos de ejemplo) suma entradas con salidas: no se enseña.
    expect(entryAmount(entry({ params: { sumMinor: 5000, count: 3 } }))).toBeNull();
    expect(entryAmount(entry({ params: { name: 'Caja' } }))).toBeNull();
    expect(entryAmount(entry({ params: null }))).toBeNull();
  });

  it('solo interpola texto y números', () => {
    expect(textParams({ a: 'x', b: 2, c: true, d: { z: 1 }, e: null })).toEqual({ a: 'x', b: 2 });
  });

  it('enlaces: movimiento, transferencia (por una de sus filas), lote y cuenta', () => {
    expect(entryTarget(entry({}), 'ws')?.to).toBe('/e/ws/movimientos/tx1');
    const xfer = entry({ entityType: 'transfer', entityId: 'grp', changes: [{ entityId: 'tx9', path: 'amount_minor', old: 1, new: 2 }] });
    expect(entryTarget(xfer, 'ws')).toEqual({ to: '/e/ws/movimientos/tx9', kind: 'transfer' });
    expect(entryTarget(entry({ entityType: 'batch', entityId: 'b1', batchId: 'b1' }), 'ws')).toEqual({ to: '/e/ws/lotes/b1', kind: 'batch' });
    expect(entryTarget(entry({ entityType: 'account', entityId: 'a1' }), 'ws')?.to).toBe('/e/ws/cuentas/a1');
    expect(entryTarget(entry({ entityType: 'view', entityId: 'v1' }), 'ws')).toBeNull();
    expect(entryTarget(entry({ entityType: 'transaction', entityId: null }), 'ws')).toBeNull();
  });

  it('un cambio de monto sale con el dinero formateado, nunca como entero crudo', () => {
    const line = describeChange({ entityId: 'tx1', path: 'amount_minor', old: 150000, new: 185000 }, ctx);
    expect(line).toMatchObject({ label: 'Monto', old: 'RD$1,500.00', new: 'RD$1,850.00' });
  });

  it('campos: etiqueta del campo y nombre de la opción', () => {
    const line = describeChange({ entityId: 'tx1', path: 'field:f1', old: { type: 'list', optionId: 'o2' }, new: { type: 'list', optionId: 'o1' } }, ctx);
    expect(line).toMatchObject({ label: 'Categoría', old: 'Varios', new: 'Materiales' });
    expect(describeChange({ entityId: null, path: 'field:f1', old: null, new: { type: 'bool', value: true } }, ctx)?.new).toBe('Sí');
  });

  it('estado, tipo y la instantánea de un alta', () => {
    expect(describeChange({ entityId: null, path: 'status', old: 'active', new: 'voided' }, ctx)).toMatchObject({ old: 'Activo', new: 'Anulado' });
    expect(describeChange({ entityId: null, path: 'kind', old: 'income', new: 'expense' }, ctx)).toMatchObject({ old: 'Entrada', new: 'Salida' });
    expect(describeChange({ entityId: null, path: '*', old: undefined, new: { a: 1 } }, ctx)).toBeNull();
    expect(describeChange({ entityId: null, path: 'recipe', old: { v: 1 }, new: { v: 2 } }, ctx)).toBeNull();
  });

  it('edición: lista cada cambio; anulación: solo el motivo; lote: nada', () => {
    const edit = entry({ changes: [{ entityId: 'tx1', path: 'amount_minor', old: 100, new: 200 }, { entityId: 'tx1', path: 'notes', old: '', new: 'ojo' }] });
    expect(changeLines(edit, ctx).map((l) => l.label)).toEqual(['Monto', 'Notas']);
    const voided = entry({
      action: 'void',
      changes: [
        { entityId: 'tx1', path: 'status', old: 'active', new: 'voided' },
        { entityId: 'tx1', path: 'void_reason', old: null, new: 'Registrado dos veces' },
      ],
    });
    expect(changeLines(voided, ctx)).toHaveLength(1);
    expect(changeLines(voided, ctx)[0]).toMatchObject({ path: 'void_reason', new: 'Registrado dos veces' });
    expect(changeLines(entry({ action: 'batch_void', changes: [{ entityId: 'x', path: 'status', old: 'active', new: 'voided' }] }), ctx)).toEqual([]);
    expect(changeLines(entry({ action: 'create', changes: [{ entityId: 'x', path: '*', old: undefined, new: {} }] }), ctx)).toEqual([]);
  });
});

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

describe('de punta a punta contra el núcleo', () => {
  it('cada acción real tiene texto, y el CSV lleva el monto exacto y los cambios legibles', async () => {
    h = await createTestCuadra();
    const { cuadra } = h;
    const { value: ws } = await cuadra.workspaces.create({ name: 'Colmado' });
    const { value: caja } = await cuadra.accounts.create({ workspaceId: ws.id, name: 'Caja', type: 'cash' });
    const { value: tx } = await cuadra.transactions.create({ accountId: caja.id, kind: 'expense', amountMinor: 123456, date: '2026-06-10', description: '=HYPERLINK("x")' });
    await cuadra.transactions.update(tx.id, { amountMinor: 200000 });
    await cuadra.transactions.void(tx.id, 'Registrado dos veces');
    const page = await cuadra.audit.list(ws.id, {});
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    for (const e of page.items) {
      const text = translate(e.message, textParams(e.params));
      expect(text, e.message).not.toMatch(/⟦|^audit\./);
    }
    const accounts = await cuadra.accounts.list(ws.id, { includeArchived: true });
    const sheet = historySheet(page.items, { accounts, currency: ws.currency, amountHeader: 'Monto', actionLabel: (e) => e.action, change: { ...ctx, fields: [] }, emptyValue: 'vacío' }, exportTranslate(translate));
    const csv = historyCsv(sheet);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('1234.56');
    expect(csv).toContain('Monto: RD$1,234.56 → RD$2,000.00');
    expect(csv).not.toContain('amount_minor');
    expect(csv).not.toContain('accountId');
    expect(csv).toContain('Motivo de anulación: vacío → Registrado dos veces');
    expect(csv).not.toMatch(/,-?\d+\.\d{3,}/);
    const edit = page.items.find((e) => e.action === 'edit')!;
    const lines = changeLines(edit, { ...ctx, fields: [] });
    expect(lines[0]).toMatchObject({ label: 'Monto', old: 'RD$1,234.56', new: 'RD$2,000.00' });
  });
});

describe('rótulos del historial', () => {
  it('«Anotado» solo para movimientos; otras creaciones son «Creación»', () => {
    expect(actionLabelKey({ action: 'create', entityType: 'transaction' })).toBe('action.create');
    expect(actionLabelKey({ action: 'create', entityType: 'view' })).toBe('action.created');
    expect(actionLabelKey({ action: 'create', entityType: 'account' })).toBe('action.created');
    expect(actionLabelKey({ action: 'edit', entityType: 'view' })).toBe('action.edit');
  });

  it('cabecera de día: Hoy, Ayer o el día de la semana sin repetir el número', () => {
    expect(dayHeading('2026-11-27', '2026-11-27')).toBe('Hoy');
    expect(dayHeading('2026-11-26', '2026-11-27')).toBe('Ayer');
    expect(dayHeading('2026-11-25', '2026-11-27')).toBe('miércoles');
  });
});
