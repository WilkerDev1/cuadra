import { describe, expect, it } from 'vitest';
import type { ColumnMapping, ImportPreviewRow, RawTable } from '../../core';
import {
  assignTarget,
  baseName,
  canInclude,
  cellText,
  defaultInclude,
  distinctValues,
  filterRows,
  flaggedColumns,
  issueColumn,
  mappingFromTargets,
  rowDisplay,
  sampleValues,
  summarize,
  targetsFromMapping,
  type MapOptions,
  type Target,
} from './logic';

const OPTS: MapOptions = { dateFormat: 'auto', amountLocale: 'auto', inValues: [], fixedDescription: '', createMissingOptions: true };

describe('assignTarget', () => {
  it('un destino único pasa a la columna nueva y suelta la anterior', () => {
    const t: Target[] = ['date', 'description', 'amount'];
    expect(assignTarget(t, 2, 'date')).toEqual(['ignore', 'description', 'date']);
  });
  it('Ignorar y los campos no se quitan a otras columnas', () => {
    expect(assignTarget(['ignore', 'ignore'], 1, 'ignore')).toEqual(['ignore', 'ignore']);
  });
  it('Monto único y Entra/Sale no conviven', () => {
    expect(assignTarget(['in', 'out', 'ignore'], 2, 'amount')).toEqual(['ignore', 'ignore', 'amount']);
    expect(assignTarget(['amount', 'type', 'ignore'], 2, 'in')).toEqual(['ignore', 'ignore', 'in']);
  });
});

describe('mappingFromTargets', () => {
  it('monto con signo', () => {
    const r = mappingFromTargets(['date', 'description', 'amount'], OPTS);
    expect(r).toMatchObject({ ok: true, mapping: { date: { column: 0, format: 'auto' }, amount: { mode: 'signed', column: 2 }, description: { column: 1 }, fields: {} } });
  });
  it('Entra y Sale separadas', () => {
    const r = mappingFromTargets(['date', 'description', 'in', 'out', 'account', 'notes', 'field:f1'], OPTS);
    expect(r.ok && r.mapping.amount).toEqual({ mode: 'split', inColumn: 2, outColumn: 3 });
    expect(r.ok && r.mapping.account).toEqual({ column: 4 });
    expect(r.ok && r.mapping.notes).toEqual({ column: 5 });
    expect(r.ok && r.mapping.fields).toEqual({ f1: { column: 6 } });
  });
  it('monto + tipo pide los valores de entrada', () => {
    const t: Target[] = ['date', 'description', 'amount', 'type'];
    expect(mappingFromTargets(t, OPTS)).toEqual({ ok: false, problems: ['type_values'] });
    const ok = mappingFromTargets(t, { ...OPTS, inValues: ['Crédito'] });
    expect(ok.ok && ok.mapping.amount).toEqual({ mode: 'with_type', column: 2, typeColumn: 3, inValues: ['Crédito'] });
  });
  it('explica lo que falta', () => {
    expect(mappingFromTargets(['ignore', 'description', 'amount'], OPTS)).toEqual({ ok: false, problems: ['date_missing'] });
    expect(mappingFromTargets(['date', 'description'], OPTS)).toEqual({ ok: false, problems: ['amount_missing'] });
    expect(mappingFromTargets(['date', 'description', 'out'], OPTS)).toEqual({ ok: false, problems: ['out_alone'] });
    expect(mappingFromTargets(['date', 'description', 'type'], OPTS)).toEqual({ ok: false, problems: ['type_needs_amount'] });
    expect(mappingFromTargets(['date', 'amount', 'in'], { ...OPTS, fixedDescription: 'x' })).toEqual({ ok: false, problems: ['amount_conflict'] });
  });
  it('sin columna de descripción exige una fija', () => {
    expect(mappingFromTargets(['date', 'amount'], OPTS)).toEqual({ ok: false, problems: ['description_missing'] });
    const r = mappingFromTargets(['date', 'amount'], { ...OPTS, fixedDescription: ' Importado ' });
    expect(r.ok && r.mapping.description).toEqual({ fixed: 'Importado' });
  });
  it('una sola columna Entra se toma como monto', () => {
    const r = mappingFromTargets(['date', 'description', 'in'], OPTS);
    expect(r.ok && r.mapping.amount).toEqual({ mode: 'signed', column: 2 });
  });
  it('lleva el formato de fecha y de números elegidos', () => {
    const r = mappingFromTargets(['date', 'description', 'amount'], { ...OPTS, dateFormat: 'dd/MM/yyyy', amountLocale: 'es-ES', createMissingOptions: false });
    expect(r.ok && r.mapping).toMatchObject({ date: { format: 'dd/MM/yyyy' }, amountLocale: 'es-ES', createMissingOptions: false });
  });
});

describe('targetsFromMapping', () => {
  it('traduce lo que sugiere el servicio', () => {
    const m: Partial<ColumnMapping> = {
      date: { column: 0, format: 'auto' },
      amount: { mode: 'split', inColumn: 2, outColumn: 3 },
      description: { column: 1 },
      account: { column: 4 },
      fields: { cat: { column: 5 } },
    };
    expect(targetsFromMapping(7, m)).toEqual(['date', 'description', 'in', 'out', 'account', 'field:cat', 'ignore']);
  });
  it('ignora columnas fuera de rango y destinos repetidos', () => {
    expect(targetsFromMapping(2, { date: { column: 9, format: 'auto' }, amount: { mode: 'signed', column: 0 }, description: { column: 0 } })).toEqual(['amount', 'ignore']);
  });
});

describe('celdas', () => {
  const raw: RawTable = {
    headers: ['a', 'b'],
    rows: [['x', ''], ['x', 'q'], ['y', null], [new Date(Date.UTC(2026, 10, 26)), 5]],
  };
  it('cellText formatea fechas de Excel en UTC', () => {
    expect(cellText(new Date(Date.UTC(2026, 10, 26)))).toBe('2026-11-26');
    expect(cellText(null)).toBe('');
    expect(cellText(12.5)).toBe('12.5');
  });
  it('muestras y valores distintos', () => {
    expect(sampleValues(raw, 1)).toEqual(['q', '5']);
    expect(distinctValues(raw, 0)).toEqual(['x', 'y', '2026-11-26']);
    expect(distinctValues(raw, 0, 2)).toEqual(['x', 'y']);
  });
  it('nombre del lote sin extensión', () => {
    expect(baseName('Banco nov.csv')).toBe('Banco nov');
    expect(baseName('a.b.xlsx')).toBe('a.b');
  });
});

function row(index: number, status: ImportPreviewRow['status'], extra: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  const draft = status === 'error' || status === 'empty' ? null : { accountId: 'a', kind: 'expense' as const, amountMinor: 100, date: '2026-11-01', description: 'd', values: {} };
  return { index, status, skipByDefault: status === 'error' || status === 'duplicate' || status === 'empty', draft, opening: null, issues: [], pendingOptions: [], duplicateOf: null, raw: ['2026-11-01', 'desc'], ...extra };
}

describe('vista previa', () => {
  const rows = [
    row(0, 'ok'),
    row(1, 'warning', { issues: ['zero_amount'] }),
    row(2, 'duplicate', { issues: [] }),
    row(3, 'error', { issues: ['unparseable_date'] }),
    row(4, 'empty'),
    row(5, 'opening_suspect', { issues: ['opening_suspect'], skipByDefault: false }),
    row(6, 'warning', { issues: ['possible_duplicate'] }),
  ];
  it('se importan por defecto las legibles que el servicio no salta', () => {
    expect(defaultInclude(rows)).toEqual([0, 1, 5, 6]);
    expect(canInclude(rows[3] as ImportPreviewRow)).toBe(false);
    expect(canInclude(rows[2] as ImportPreviewRow)).toBe(true);
  });
  it('resume por estado y cuenta las marcadas', () => {
    expect(summarize(rows, new Set([0, 1]))).toEqual({ ok: 1, warning: 2, duplicate: 1, error: 1, opening: 1, empty: 1, selected: 2 });
  });
  it('filtra y nunca muestra las filas vacías', () => {
    const inc = new Set([0, 5]);
    expect(filterRows(rows, 'all', inc).map((r) => r.index)).toEqual([0, 1, 2, 3, 5, 6]);
    expect(filterRows(rows, 'problems', inc).map((r) => r.index)).toEqual([1, 3, 5, 6]);
    expect(filterRows(rows, 'duplicates', inc).map((r) => r.index)).toEqual([2, 6]);
    expect(filterRows(rows, 'selected', inc).map((r) => r.index)).toEqual([0, 5]);
  });
  it('marca la celda del problema', () => {
    expect(issueColumn('unparseable_date')).toBe('date');
    expect(issueColumn('not_a_number')).toBe('amount');
    expect(issueColumn('description_required')).toBe('description');
    expect(issueColumn('unknown_account')).toBe('status');
    expect([...flaggedColumns(rows[3] as ImportPreviewRow)]).toEqual(['date']);
    expect([...flaggedColumns(rows[5] as ImportPreviewRow)]).toEqual([]);
  });
  it('muestra el crudo cuando la fila no se pudo leer', () => {
    const m: ColumnMapping = { date: { column: 0, format: 'auto' }, amount: { mode: 'signed', column: 2 }, amountLocale: 'auto', description: { column: 1 }, fields: {}, createMissingOptions: true };
    expect(rowDisplay(rows[3] as ImportPreviewRow, m)).toEqual({ date: '2026-11-01', description: 'desc' });
    expect(rowDisplay(rows[0] as ImportPreviewRow, m)).toEqual({ date: '2026-11-01', description: 'd' });
    expect(rowDisplay(rows[3] as ImportPreviewRow, { ...m, description: { fixed: 'Fijo' } }).description).toBe('Fijo');
  });
});
