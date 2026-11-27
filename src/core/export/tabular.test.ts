import { describe, expect, it } from 'vitest';
import type { Account, AuditEntry, Field, SummaryResult, TransactionRow } from '../types';
import { auditToSheet, label, sheetName, sheetToRows, summaryToSheet, transactionsToSheet } from './tabular';

const DOP = { code: 'DOP', minorDigits: 2 as const, symbol: 'RD$' };
const CLP = { code: 'CLP', minorDigits: 0 as const };

const account = (id: string, name: string): Account => ({
  id,
  workspaceId: 'w',
  name,
  type: 'cash',
  color: null,
  icon: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
});
const field = (over: Partial<Field> & Pick<Field, 'id' | 'label' | 'type'>): Field => ({
  workspaceId: 'w',
  key: over.id,
  role: null,
  appliesTo: 'both',
  sortOrder: 0,
  showInList: false,
  active: true,
  deactivatedAt: null,
  options: [],
  ...over,
});
const row = (over: Partial<TransactionRow>): TransactionRow => ({
  id: 't',
  workspaceId: 'w',
  accountId: 'caja',
  seq: 1,
  kind: 'income',
  direction: 'in',
  amountMinor: 100,
  date: '2026-06-01',
  description: 'x',
  notes: '',
  status: 'active',
  voidReason: null,
  voidedAt: null,
  batchId: null,
  transferGroupId: null,
  counterpart: null,
  recordedAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  values: {},
  runningMinor: null,
  ...over,
});

const ACCOUNTS = [account('caja', 'Caja'), account('banco', 'Banco')];
const CAT = field({
  id: 'cat',
  label: 'Categoría',
  type: 'list',
  options: [{ id: 'o1', fieldId: 'cat', key: null, label: 'Ventas', color: null, appliesTo: 'both', sortOrder: 0, active: true, mergedIntoId: null }],
});
const QTY = field({ id: 'qty', label: 'Unidades', type: 'number' });
const OK = field({ id: 'ok', label: 'Conciliado', type: 'bool' });
const OLD = field({ id: 'old', label: 'Viejo', type: 'text', active: false });
const DUE = field({ id: 'due', label: 'Vence', type: 'date', active: false });

describe('export/tabular', () => {
  it('transactionsToSheet: columnas por defecto, tipos y celdas', () => {
    const rows = [
      row({ id: 'a', seq: 7, amountMinor: 250050, description: 'Venta', runningMinor: 350050, values: { cat: { type: 'list', optionId: 'o1' }, qty: { type: 'number', value: 1.5 }, ok: { type: 'bool', value: true } } }),
      row({ id: 'b', kind: 'transfer', direction: 'out', amountMinor: 5000, description: 'Depósito', runningMinor: 345050, transferGroupId: 'g', counterpart: { accountId: 'banco', transactionId: 'c', seq: 3 } }),
      row({ id: 'd', kind: 'expense', direction: 'out', status: 'voided', voidReason: 'Error', notes: 'nota', runningMinor: 345050, values: { old: { type: 'text', value: 'histórico' } } }),
    ];
    const sheet = transactionsToSheet(rows, [CAT, QTY, OK, OLD, DUE], { accounts: ACCOUNTS, currency: DOP });
    expect(sheet.name).toBe('Movimientos');
    expect(sheet.currency).toEqual(DOP);
    expect(sheet.columns.map((c) => [c.key, c.type])).toEqual([
      ['date', 'date'],
      ['seq', 'integer'],
      ['account', 'text'],
      ['kind', 'text'],
      ['description', 'text'],
      ['in', 'money'],
      ['out', 'money'],
      ['running', 'money'],
      ['counterpart', 'text'],
      ['notes', 'text'],
      ['status', 'text'],
      ['voidReason', 'text'],
      ['cat', 'text'],
      ['qty', 'number'],
      ['ok', 'text'],
      ['old', 'text'], // inactivo pero con valor en estas filas
    ]);
    expect(sheet.rows[0]).toEqual(['2026-06-01', 7, 'Caja', 'Entrada', 'Venta', 250050, null, 350050, null, null, 'Activo', null, 'Ventas', 1.5, 'Sí', null]);
    expect(sheet.rows[1]?.slice(3, 9)).toEqual(['Transferencia', 'Depósito', null, 5000, 345050, 'Banco']);
    expect(sheet.rows[2]?.slice(9, 12)).toEqual(['nota', 'Anulado', 'Error']);
    expect(sheet.rows[2]?.[14]).toBe('No'); // sí/no sin valor = No (F-65)

    // Columnas elegidas; un id desconocido se ignora.
    const chosen = transactionsToSheet(rows, [CAT, QTY], { accounts: ACCOUNTS, currency: DOP, columns: ['description', 'qty', 'nope', 'out'] });
    expect(chosen.columns.map((c) => c.header)).toEqual(['Descripción', 'Unidades', 'Salida']);
    expect(chosen.rows.map((r) => r.length)).toEqual([3, 3, 3]);
    // Sin saldo corrido ni anulados, esas columnas no salen.
    const plain = transactionsToSheet([row({})], [], { accounts: ACCOUNTS, currency: DOP });
    expect(plain.columns.map((c) => c.key)).not.toContain('running');
    expect(plain.columns.map((c) => c.key)).not.toContain('voidReason');
  });

  it('summaryToSheet aplana el split y cierra con el total', () => {
    const g = (key: string | null, label: string, i: number, o: number, c: number, split?: SummaryResult['groups']) => ({
      key,
      label,
      color: null,
      inactive: false,
      inMinor: i,
      outMinor: o,
      netMinor: i - o,
      count: c,
      ...(split ? { split } : {}),
    });
    const result = {
      groups: [g('o1', 'Ventas', 300, 0, 2, [g('2026-Q1', 'T1 2026', 100, 0, 1), g('2026-Q2', 'T2 2026', 200, 0, 1)]), g(null, 'Sin valor', 0, 50, 1, [])],
    } as unknown as SummaryResult;
    const sheet = summaryToSheet(result, { currency: CLP, groupHeader: 'Categoría', splitHeader: 'Trimestre' });
    expect(sheet.columns.map((c) => [c.header, c.type])).toEqual([
      ['Categoría', 'text'],
      ['Trimestre', 'text'],
      ['Entrada', 'money'],
      ['Salida', 'money'],
      ['Neto', 'money'],
      ['Movimientos', 'integer'],
    ]);
    expect(sheet.rows).toEqual([
      ['Ventas', null, 300, 0, 300, 2],
      ['Ventas', 'T1 2026', 100, 0, 100, 1],
      ['Ventas', 'T2 2026', 200, 0, 200, 1],
      ['Sin valor', null, 0, 50, -50, 1],
      ['Total', null, 300, 50, 250, 3],
    ]);
    // Moneda sin decimales: el CSV no inventa ".00".
    expect(sheetToRows(sheet).at(-1)).toEqual(['Total', null, '300', '50', '250', 3]);
  });

  it('auditToSheet traduce el mensaje y resume los cambios', () => {
    const entry: AuditEntry = {
      id: 'a1',
      workspaceId: 'w',
      at: '2026-06-15T12:00:00.000Z',
      action: 'edit',
      entityType: 'transaction',
      entityId: 't1',
      accountId: 'caja',
      batchId: null,
      message: 'audit.tx.edit',
      params: { seq: 7, extra: { nested: true } },
      changes: [
        { entityId: 't1', path: 'amount_minor', old: 100, new: 200 },
        { entityId: 't1', path: 'description', old: 'a', new: 'b' },
      ],
    };
    const t = (key: string, p?: Readonly<Record<string, string | number>>) =>
      key === 'audit.tx.edit' ? `Editó el movimiento nº ${p?.['seq']}` : key;
    const sheet = auditToSheet([entry], { accounts: ACCOUNTS }, t);
    expect(sheet.rows).toEqual([
      ['2026-06-15T12:00:00.000Z', 'edit', 'transaction', 'Caja', 'Editó el movimiento nº 7', 'amount_minor: 100 → 200; description: a → b'],
    ]);
    // Sin traducción, la clave cruda queda visible solo si no hay texto por defecto.
    expect(auditToSheet([entry]).rows[0]?.[4]).toBe('audit.tx.edit');
  });

  it('label usa t, cae al español y sheetName cumple las reglas de Excel', () => {
    expect(label(undefined, 'export.meta.period', { label: 'junio 2026' })).toBe('Periodo: junio 2026');
    expect(label((k) => k, 'export.total')).toBe('Total');
    expect(label(() => 'Sum', 'export.total')).toBe('Sum');
    const taken = new Set<string>();
    expect(sheetName('Gastos: enero/febrero [2026]?', taken)).toBe('Gastos enero febrero 2026');
    expect(sheetName('Resumen', taken)).toBe('Resumen');
    expect(sheetName('resumen', taken)).toBe('resumen (2)');
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
    expect(sheetName('***', taken)).toBe('Hoja');
  });
});
