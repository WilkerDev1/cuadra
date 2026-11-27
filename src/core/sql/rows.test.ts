import { describe, expect, it } from 'vitest';
import type { Workspace } from '../types';
import {
  COLUMNS,
  fieldValueToRecord,
  fromJson,
  groupFieldValues,
  insertSql,
  recordValues,
  selectColumns,
  toAuditEntry,
  toBatch,
  toField,
  toSavedView,
  toTransaction,
  toWorkspace,
  workspaceToRecord,
  type FieldOptionRecord,
  type TransactionRecord,
} from './rows';

const NOW = '2026-06-15T12:00:00.000Z';

describe('rows', () => {
  it('workspace ida y vuelta, con y sin símbolo de moneda', () => {
    const ws: Workspace = {
      id: 'w',
      name: 'Colmado',
      ownerName: 'La Esquina',
      templateId: 'negocio',
      currency: { code: 'DOP', minorDigits: 2, symbol: 'RD$' },
      logoDataUrl: null,
      color: null,
      sortOrder: 1,
      isDemo: true,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const record = workspaceToRecord(ws);
    expect(record.is_demo).toBe(1);
    expect(toWorkspace(record)).toEqual(ws);
    expect(toWorkspace({ ...record, currency_symbol: null }).currency).toEqual({ code: 'DOP', minorDigits: 2 });
  });

  it('valores EAV en las dos direcciones', () => {
    const records = [
      fieldValueToRecord('t1', 'f1', { type: 'list', optionId: 'o1' }),
      fieldValueToRecord('t1', 'f2', { type: 'bool', value: false }),
      fieldValueToRecord('t1', 'f3', { type: 'number', value: 2.5 }),
      fieldValueToRecord('t2', 'f4', { type: 'date', value: '2026-06-01' }),
      fieldValueToRecord('t2', 'f5', { type: 'text', value: '' }),
    ];
    expect(records[1]).toEqual({
      transaction_id: 't1',
      field_id: 'f2',
      value_text: null,
      value_number: null,
      value_date: null,
      value_option_id: null,
      value_bool: 0,
    });
    const grouped = groupFieldValues(records);
    expect(grouped.get('t1')).toEqual({
      f1: { type: 'list', optionId: 'o1' },
      f2: { type: 'bool', value: false },
      f3: { type: 'number', value: 2.5 },
    });
    expect(grouped.get('t2')).toEqual({ f4: { type: 'date', value: '2026-06-01' }, f5: { type: 'text', value: '' } });
  });

  it('transacción con valores y contraparte', () => {
    const r: TransactionRecord = {
      id: 't1', workspace_id: 'w', account_id: 'a', seq: 3, kind: 'transfer', direction: 'out', amount_minor: 500,
      date: '2026-06-12', description: 'Depósito', notes: '', search_text: 'deposito', status: 'active',
      void_reason: null, voided_at: null, voided_with_batch: 0, batch_id: null, transfer_group_id: 'g',
      recorded_at: NOW, updated_at: NOW,
    };
    const tx = toTransaction(r, {}, { accountId: 'b', transactionId: 't2', seq: 9 });
    expect(tx).toMatchObject({ seq: 3, kind: 'transfer', amountMinor: 500, transferGroupId: 'g', counterpart: { seq: 9 } });
    expect(toTransaction(r).counterpart).toBeNull();
  });

  it('campo con sus opciones ordenadas y activas/inactivas', () => {
    const opt = (id: string, label: string, sort: number, deactivated: string | null): FieldOptionRecord => ({
      id, field_id: 'f', key: null, label, color: null, applies_to: 'both', sort_order: sort,
      deactivated_at: deactivated, merged_into_id: null, created_at: NOW, updated_at: NOW,
    });
    const field = toField(
      { id: 'f', workspace_id: 'w', key: 'categoria', label: 'Categoría', type: 'list', role: 'category', applies_to: 'both', sort_order: 0, show_in_list: 1, deactivated_at: null, created_at: NOW, updated_at: NOW },
      [opt('o2', 'B', 1, NOW), opt('o1', 'A', 0, null), { ...opt('x', 'Otro', 0, null), field_id: 'g' }],
    );
    expect(field.showInList).toBe(true);
    expect(field.options.map((o) => [o.id, o.active])).toEqual([['o1', true], ['o2', false]]);
  });

  it('lote, historial y vista guardada', () => {
    const batch = toBatch({ id: 'b', workspace_id: 'w', account_id: null, source: 'demo', label: '', control_total_minor: null, control_mismatch_accepted: 1, meta: null, created_at: NOW, active_count: 3, voided_count: 1 });
    expect(batch).toMatchObject({ controlMismatchAccepted: true, activeCount: 3, voidedCount: 1, controlTotalMinor: null });

    const entry = toAuditEntry(
      { id: 'a1', workspace_id: 'w', at: NOW, action: 'edit', entity_type: 'transaction', entity_id: 't', account_id: 'acc', batch_id: null, message: 'audit.tx.edit', params: '{"seq":3}', meta: null },
      [
        { action_id: 'a1', ord: 1, entity_id: 't', path: 'date', old_value: '"2026-06-01"', new_value: '"2026-06-02"' },
        { action_id: 'a1', ord: 0, entity_id: 't', path: 'amount_minor', old_value: '100', new_value: null },
        { action_id: 'other', ord: 0, entity_id: null, path: 'x', old_value: null, new_value: null },
      ],
    );
    expect(entry.params).toEqual({ seq: 3 });
    expect(entry.changes).toEqual([
      { entityId: 't', path: 'amount_minor', old: 100, new: undefined },
      { entityId: 't', path: 'date', old: '2026-06-01', new: '2026-06-02' },
    ]);

    const viewRecord = { id: 'v', workspace_id: 'w', kind: 'filter', name: 'No conciliados', recipe: '{"v":1,"kind":"filter","filter":{}}', recipe_version: 1, pinned: 1, sort_order: 0, source: 'template', deleted_at: null, created_at: NOW, updated_at: NOW };
    expect(toSavedView(viewRecord)).toMatchObject({ kind: 'filter', pinned: true, source: 'template', recipe: { v: 1, kind: 'filter', filter: {} } });
    expect(() => toSavedView({ ...viewRecord, kind: 'summary' })).toThrow('invalid_recipe');
    expect(() => toSavedView({ ...viewRecord, recipe: '{"v":9}' })).toThrow('invalid_recipe');
  });

  it('SQL de columnas e inserción en orden de DDL', () => {
    expect(selectColumns('settings', 's')).toBe('s.scope_id, s.key, s.value, s.updated_at');
    expect(insertSql('settings')).toBe('INSERT INTO settings (scope_id, key, value, updated_at) VALUES (?, ?, ?, ?)');
    expect(recordValues('settings', { key: 'k', scope_id: '', value: '1' })).toEqual(['', 'k', '1', null]);
    expect(COLUMNS.transactions).toHaveLength(19);
    expect(fromJson(null, [])).toEqual([]);
    expect(fromJson('{"a":1}')).toEqual({ a: 1 });
  });
});
