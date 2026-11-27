import { describe, expect, it } from 'vitest';
import type { AuditEntry, Batch, Field, Totals, TransactionRow } from '../../../core';
import { batchBalance } from './batch';
import { activeDayIndex, collapseTransfers, groupByDay, padSeq } from './days';
import { exportFileName, moneyFormat, sheetToCsv, sheetToXlsxData } from './exportFile';
import { filterChips, setFieldCondition, toggle } from './filterChips';
import { actionKey, changeLines } from './history';
import {
  decodeBase64Url,
  encodeBase64Url,
  movementsHref,
  normalizeFilter,
  parsePeriodParam,
  readLedgerSearch,
  sameFilter,
  writeLedgerSearch,
} from '../../../app/data/txFilterUrl';

function row(p: Partial<TransactionRow> & { id: string; date: string }): TransactionRow {
  return {
    workspaceId: 'w',
    accountId: 'a1',
    seq: 1,
    kind: 'expense',
    direction: 'out',
    amountMinor: 100,
    description: 'x',
    notes: '',
    status: 'active',
    voidReason: null,
    voidedAt: null,
    batchId: null,
    transferGroupId: null,
    counterpart: null,
    recordedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    values: {},
    runningMinor: null,
    ...p,
  };
}

const FIELD: Field = {
  id: 'f1',
  workspaceId: 'w',
  key: 'categoria',
  label: 'Categoría',
  type: 'list',
  role: 'category',
  appliesTo: 'both',
  sortOrder: 0,
  showInList: true,
  active: true,
  deactivatedAt: null,
  options: [
    { id: 'o1', fieldId: 'f1', key: null, label: 'Materiales', color: null, appliesTo: 'both', sortOrder: 0, active: true, mergedIntoId: null },
    { id: 'o2', fieldId: 'f1', key: null, label: 'Varios', color: null, appliesTo: 'both', sortOrder: 1, active: true, mergedIntoId: null },
  ],
};

const t = (key: string, p?: Record<string, string | number>) => (p === undefined ? key : `${key}${JSON.stringify(p)}`);
const money = (m: number) => `$${m}`;

describe('urlState', () => {
  it('base64url ida y vuelta con tildes y sin relleno', () => {
    const text = JSON.stringify({ text: 'café ñandú', kinds: ['expense'] });
    const enc = encodeBase64Url(text);
    expect(enc).not.toMatch(/[+/=]/);
    expect(decodeBase64Url(enc)).toBe(text);
    expect(decodeBase64Url('%%%')).toBeNull();
  });

  it('lee periodo como preset o rango', () => {
    expect(parsePeriodParam('this_month')).toEqual({ preset: 'this_month' });
    expect(parsePeriodParam('2026-11-01..2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(parsePeriodParam('..2026-11-30')).toEqual({ to: '2026-11-30' });
    expect(parsePeriodParam('2026-12-01..2026-11-30')).toBeNull();
    expect(parsePeriodParam('mañana')).toBeNull();
    expect(parsePeriodParam('2026-02-31..')).toBeNull();
  });

  it('periodo y cuenta explícitos ganan a f; el periodo por defecto rellena', () => {
    const f = encodeBase64Url(JSON.stringify({ period: { preset: 'last_year' }, accountIds: ['x'], kinds: ['income'], status: 'all' }));
    const s = readLedgerSearch(new URLSearchParams({ periodo: 'this_year', cuenta: 'a1,a2', f }), { period: { preset: 'this_month' } });
    expect(s.invalid).toBe(false);
    expect(s.filter).toEqual({ period: { preset: 'this_year' }, accountIds: ['a1', 'a2'], kinds: ['income'], status: 'all' });
    const d = readLedgerSearch(new URLSearchParams(), { period: { preset: 'this_month' } });
    expect(d.filter).toEqual({ period: { preset: 'this_month' } });
    const fromF = readLedgerSearch(new URLSearchParams({ f }), { period: { preset: 'this_month' } });
    expect(fromF.filter.period).toEqual({ preset: 'last_year' });
  });

  it('f inválido se ignora y se marca', () => {
    const bad = encodeBase64Url(JSON.stringify({ kinds: ['robo'] }));
    const s = readLedgerSearch(new URLSearchParams({ f: bad, periodo: 'nunca' }), { period: { preset: 'all' } });
    expect(s.invalid).toBe(true);
    expect(s.filter).toEqual({ period: { preset: 'all' } });
  });

  it('escribe la URL corta y la vuelve a leer igual', () => {
    const filter = { period: { preset: 'last_month' as const }, accountIds: ['a1'], text: ' pan ', status: 'voided' as const, amount: { min: 500 } };
    const qs = writeLedgerSearch(filter, { defaultPeriod: { preset: 'this_month' }, keep: new URLSearchParams({ vista: 'v1', otra: '1' }) });
    expect(qs.get('vista')).toBeNull();
    expect(qs.get('otra')).toBe('1');
    expect(qs.get('periodo')).toBe('last_month');
    expect(qs.get('cuenta')).toBe('a1');
    const back = readLedgerSearch(qs, { period: { preset: 'this_month' } });
    expect(sameFilter(back.filter, filter)).toBe(true);
    // periodo por defecto y estado activo no se escriben
    expect(writeLedgerSearch({ period: { preset: 'this_month' }, status: 'active' }, { defaultPeriod: { preset: 'this_month' } }).toString()).toBe('');
  });

  it('en la pantalla de una cuenta la cuenta no va en la query', () => {
    const qs = writeLedgerSearch({ accountIds: ['a1'], period: { preset: 'all' } }, { defaultPeriod: { preset: 'all' }, fixedAccountId: 'a1' });
    expect(qs.toString()).toBe('');
  });

  it('normaliza para comparar vistas', () => {
    expect(sameFilter({ kinds: ['income', 'expense'], text: '' }, { kinds: ['expense', 'income'], status: 'active' })).toBe(true);
    expect(normalizeFilter({ amount: {} })).toEqual({});
    expect(movementsHref('w1', { period: { preset: 'this_month' }, kinds: ['expense'] })).toMatch(/^\/e\/w1\/movimientos\?f=/);
  });
});

describe('days', () => {
  it('agrupa por día con subtotal de entradas y salidas activas', () => {
    const rows = [
      row({ id: '1', date: '2026-11-24', kind: 'income', direction: 'in', amountMinor: 5000 }),
      row({ id: '2', date: '2026-11-24', amountMinor: 1200 }),
      row({ id: '3', date: '2026-11-24', amountMinor: 999, status: 'voided' }),
      row({ id: '4', date: '2026-11-24', kind: 'transfer', amountMinor: 700 }),
      row({ id: '5', date: '2026-11-23', amountMinor: 300 }),
    ];
    const items = groupByDay(rows, { hasMore: false });
    expect(items.map((i) => i.type)).toEqual(['day', 'row', 'row', 'row', 'row', 'day', 'row']);
    const d = items[0];
    expect(d?.type === 'day' && [d.inMinor, d.outMinor, d.netMinor, d.count]).toEqual([5000, 1200, 3800, 4]);
  });

  it('retiene el último día si puede venir cortado', () => {
    const rows = [row({ id: '1', date: '2026-11-24' }), row({ id: '2', date: '2026-11-23' })];
    expect(groupByDay(rows, { hasMore: true }).length).toBe(2);
    expect(groupByDay([rows[0]!], { hasMore: true }).length).toBe(2);
  });

  it('una transferencia es una sola fila en la vista de espacio', () => {
    const out = row({ id: 'o', date: '2026-11-24', kind: 'transfer', direction: 'out', accountId: 'a1', counterpart: { accountId: 'a2', transactionId: 'i', seq: 3 } });
    const inn = row({ id: 'i', date: '2026-11-24', kind: 'transfer', direction: 'in', accountId: 'a2', counterpart: { accountId: 'a1', transactionId: 'o', seq: 9 } });
    expect(collapseTransfers([out, inn], undefined).map((r) => r.id)).toEqual(['o']);
    expect(collapseTransfers([inn], ['a2', 'a3']).map((r) => r.id)).toEqual(['i']);
    expect(collapseTransfers([out, inn], ['a2']).map((r) => r.id)).toEqual(['o', 'i']);
  });

  it('cabecera activa y n.º', () => {
    const items = groupByDay([row({ id: '1', date: '2026-11-24' }), row({ id: '2', date: '2026-11-23' })], { hasMore: false });
    expect(activeDayIndex(items, [0, 2], 0)).toBe(0);
    expect(activeDayIndex(items, [0, 2], 3)).toBe(2);
    expect(padSeq(142)).toBe('0142');
  });
});

describe('history', () => {
  const ctx = { money, date: (d: string) => `D${d}`, fields: [FIELD], t };
  const entry = (changes: AuditEntry['changes'], action: AuditEntry['action'] = 'edit'): AuditEntry => ({
    id: 'e',
    workspaceId: 'w',
    at: '2026-11-26T14:32:00Z',
    action,
    entityType: 'transaction',
    entityId: 'x',
    accountId: null,
    batchId: null,
    message: 'audit.tx.edit',
    params: null,
    changes,
  });

  it('traduce montos, fechas, opciones y omite la instantánea y duplicados', () => {
    const lines = changeLines(
      entry([
        { entityId: 'a', path: '*', old: null, new: {} },
        { entityId: 'a', path: 'amount_minor', old: 150000, new: 185000 },
        { entityId: 'b', path: 'amount_minor', old: 150000, new: 185000 },
        { entityId: 'a', path: 'date', old: '2026-11-01', new: '2026-11-02' },
        { entityId: 'a', path: 'field:f1', old: { type: 'list', optionId: 'o2' }, new: { type: 'list', optionId: 'o1' } },
        { entityId: 'a', path: 'notes', old: '', new: 'ojo' },
        { entityId: 'a', path: 'status', old: 'active', new: 'voided' },
      ]),
      ctx,
    );
    expect(lines).toEqual([
      { labelKey: 'amount', old: '$150000', new: '$185000' },
      { labelKey: 'date', old: 'D2026-11-01', new: 'D2026-11-02' },
      { labelKey: 'field', fieldLabel: 'Categoría', old: 'Varios', new: 'Materiales' },
      { labelKey: 'notes', old: null, new: 'ojo' },
      { labelKey: 'status', old: 'ledger.status.active', new: 'ledger.status.voided' },
    ]);
    expect(actionKey(entry([], 'batch_void'))).toBe('ledger.action.void');
    expect(actionKey(entry([], 'demo_seed'))).toBe('ledger.action.create');
  });
});

describe('filterChips', () => {
  it('un chip por criterio, cada uno con el filtro sin él', () => {
    const filter = {
      period: { preset: 'this_month' as const },
      accountIds: ['a1', 'a2'],
      kinds: ['expense' as const],
      amount: { min: 100, max: 900 },
      fields: [{ fieldId: 'f1', op: 'any_of' as const, optionIds: ['o1'] }],
    };
    const chips = filterChips(filter, {
      accounts: [{ id: 'a1', name: 'Caja' } as never, { id: 'a2', name: 'Banco' } as never],
      fields: [FIELD],
      money,
      date: (d) => d,
      t,
    });
    expect(chips.map((c) => c.id)).toEqual(['account', 'kind', 'amount', 'field:f1']);
    expect(chips[0]?.value).toBe('ledger.filter.many{"first":"Caja","n":1}');
    expect(chips[3]?.value).toBe('Materiales');
    expect(chips[3]?.without.fields).toBeUndefined();
    expect(chips[0]?.without.accountIds).toBeUndefined();
    expect(chips[2]?.value).toBe('ledger.filter.between{"min":"$100","max":"$900"}');
  });

  it('la cuenta fija de la pantalla no sale', () => {
    const chips = filterChips({ accountIds: ['a1'] }, { accounts: [], fields: [], money, date: (d) => d, t, fixedAccountId: 'a1' });
    expect(chips).toEqual([]);
  });

  it('cambia y alterna', () => {
    const f = setFieldCondition({}, 'f1', { fieldId: 'f1', op: 'is', value: true });
    expect(f.fields).toHaveLength(1);
    expect(setFieldCondition(f, 'f1', null).fields).toBeUndefined();
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('export', () => {
  const sheet = {
    name: 'Movimientos',
    columns: [
      { key: 'description', header: 'Descripción', type: 'text' as const },
      { key: 'in', header: 'Entrada', type: 'money' as const },
      { key: 'seq', header: 'Nº', type: 'integer' as const },
    ],
    rows: [
      ['=SUMA(A1)', 185050, 7],
      ['Pan', null, 8],
    ],
    currency: { code: 'DOP', minorDigits: 2 as const, symbol: 'RD$' },
  };
  it('CSV con BOM, dinero decimal y protección de fórmulas', () => {
    const csv = sheetToCsv(sheet, (rows) => rows.map((r) => r.map((c) => (c === null ? '' : String(c))).join(',')).join('\n'));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain("'=SUMA(A1),1850.50,7");
  });
  it('XLSX con número y formato de moneda', () => {
    const data = sheetToXlsxData(sheet);
    expect(data[0]?.[0]).toMatchObject({ value: 'Descripción', fontWeight: 'bold' });
    expect(data[1]?.[1]).toEqual({ value: 1850.5, type: Number, format: '#,##0.00' });
    expect(data[2]?.[1]).toEqual({ value: null });
    expect(moneyFormat(0)).toBe('#,##0');
    expect(exportFileName('Colmado La Esquina (Ejemplo)', '2026-11-27', 'csv')).toBe('colmado-la-esquina-ejemplo-2026-11-27.csv');
  });
});

describe('batch', () => {
  const totals: Totals = { inMinor: 0, outMinor: 1264000, netMinor: -1264000, transfersInMinor: 0, transfersOutMinor: 0, openingsMinor: 0, count: 6, voidedCount: 0 };
  const batch: Batch = {
    id: 'b',
    workspaceId: 'w',
    accountId: 'a1',
    source: 'capture',
    label: 'Lote',
    controlTotalMinor: 1500000,
    controlMismatchAccepted: true,
    createdAt: '',
    activeCount: 6,
    voidedCount: 0,
  };
  it('descuadre y acciones', () => {
    expect(batchBalance(batch, totals)).toEqual({
      sumMinor: 1264000,
      controlMinor: 1500000,
      differenceMinor: -236000,
      balanced: false,
      canVoid: true,
      canRestore: false,
    });
    const voided = batchBalance({ ...batch, activeCount: 0, voidedCount: 6, controlTotalMinor: null }, { ...totals, outMinor: 0 });
    expect([voided.differenceMinor, voided.balanced, voided.canVoid, voided.canRestore]).toEqual([null, true, false, true]);
  });
});
