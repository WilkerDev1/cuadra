// Importación tabular (CSV y Excel) — ARCHITECTURE.md 3.5, pruebas 95–103. Los datos previos se siembran
// con SQL directo; el commit usa transactions.createMany (2A) y la anulación del lote usa batches (2A).
import Papa from 'papaparse';
import { afterEach, describe, expect, it } from 'vitest';
import { sheetToRows, type Sheet } from '../export/tabular';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { createEventBus, type ChangeEvent } from '../events';
import type { SqlExecutor } from '../ports';
import type { Field } from '../types';
import type { CoreDeps } from '../uow';
import { createAuditWriter } from './audit';
import {
  createImportCsvService,
  decodeCsvBytes,
  detectColumns,
  detectDateFormat,
  detectNumberLocale,
  parseAmountCell,
  parseCsvText,
  parseDateCell,
  tableFromRows,
  type ColumnMapping,
  type ImportCsvService,
  type RawTable,
} from './importCsv';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

const T0 = '2026-01-01T10:00:00.000Z';
const DOP = { code: 'DOP', minorDigits: 2 } as const;

const S = {
  ws: '01900000-0000-7000-8000-00000000000a',
  other: '01900000-0000-7000-8000-00000000000b',
  cash: '01900000-0000-7000-8000-0000000000a1',
  bank: '01900000-0000-7000-8000-0000000000a2',
  old: '01900000-0000-7000-8000-0000000000a3',
  foreign: '01900000-0000-7000-8000-0000000000a4',
  fCat: '01900000-0000-7000-8000-0000000000f1',
  fPaid: '01900000-0000-7000-8000-0000000000f2',
  fRef: '01900000-0000-7000-8000-0000000000f3',
  fUnits: '01900000-0000-7000-8000-0000000000f4',
  oVentas: '01900000-0000-7000-8000-0000000000c1',
  oElectricidad: '01900000-0000-7000-8000-0000000000c2',
  oLuz: '01900000-0000-7000-8000-0000000000c3',
  oAlquiler: '01900000-0000-7000-8000-0000000000c4',
};

async function seed(tx: SqlExecutor): Promise<void> {
  const run = (sql: string, p: (string | number | null)[]) => tx.run(sql, p);
  for (const [id, name] of [[S.ws, 'Colmado'], [S.other, 'Otro']] as const) {
    await run('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, name, T0, T0]);
  }
  const account = (id: string, ws: string, name: string, archived: string | null = null) =>
    run('INSERT INTO accounts (id, workspace_id, name, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id, ws, name, archived, T0, T0,
    ]);
  await account(S.cash, S.ws, 'Caja');
  await account(S.bank, S.ws, 'Banco Popular');
  await account(S.old, S.ws, 'Caja vieja', T0);
  await account(S.foreign, S.other, 'Ajena');
  const field = (id: string, key: string, label: string, type: string, role: string | null) =>
    run('INSERT INTO fields (id, workspace_id, key, label, type, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id, S.ws, key, label, type, role, T0, T0,
    ]);
  await field(S.fCat, 'categoria', 'Categoría', 'list', 'category');
  await field(S.fPaid, 'pagado', 'Pagado', 'bool', null);
  await field(S.fRef, 'referencia', 'Referencia', 'text', 'reference');
  await field(S.fUnits, 'unidades', 'Unidades', 'number', null);
  const option = (id: string, label: string, order: number, merged: string | null = null) =>
    run(
      'INSERT INTO field_options (id, field_id, label, sort_order, deactivated_at, merged_into_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, S.fCat, label, order, merged ? T0 : null, merged, T0, T0],
    );
  await option(S.oVentas, 'Ventas', 0);
  await option(S.oElectricidad, 'Electricidad', 1);
  await option(S.oAlquiler, 'Alquiler', 2);
  await option(S.oLuz, 'Luz', 3, S.oElectricidad);

  let n = 0;
  const addTx = async (account: string, kind: string, direction: string, amount: number, date: string, description: string) => {
    const r = await tx.get<{ seq: number }>('UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq', [account]);
    await run(
      `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date, description,
         search_text, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`01900000-0000-7000-8000-${String(0xd00 + ++n).padStart(12, '0')}`, S.ws, account, r?.seq ?? 0, kind, direction, amount, date, description, description.toLowerCase(), T0, T0],
    );
  };
  await addTx(S.cash, 'opening', 'in', 1000000, '2026-01-01', 'Saldo inicial');
  await addTx(S.cash, 'expense', 'out', 455000, '2026-05-03', 'Factura de luz');
  await addTx(S.cash, 'income', 'in', 120000, '2026-05-10', 'Venta mostrador');
}

function coreDeps(t: TestCuadra, events: ChangeEvent[]): CoreDeps {
  const bus = createEventBus();
  bus.subscribe((e) => events.push(e));
  return { driver: t.driver, clock: t.clock, ids: t.ids, events: bus, audit: createAuditWriter(t), locale: 'es-DO' };
}

async function setup(): Promise<{ imp: ImportCsvService; events: ChangeEvent[] }> {
  h = await createTestCuadra();
  await h.driver.transaction(seed);
  const events: ChangeEvent[] = [];
  return { imp: createImportCsvService(coreDeps(h, events)), events };
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['transactions', 'transaction_field_values', 'batches', 'field_options', 'audit_log', 'settings']) {
    const r = await h!.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = Number(r?.n ?? 0);
  }
  return out;
}

const fieldStub = (id: string, label: string, type: Field['type'], role: Field['role'] = null, key = label.toLowerCase()): Field => ({
  id, workspaceId: S.ws, key, label, type, role, appliesTo: 'both', sortOrder: 0, showInList: false, active: true,
  deactivatedAt: null, options: [],
});
const FIELDS: Field[] = [
  fieldStub(S.fCat, 'Categoría', 'list', 'category', 'categoria'),
  fieldStub(S.fPaid, 'Pagado', 'bool'),
  fieldStub(S.fRef, 'Referencia', 'text', 'reference'),
];

const table = (headers: string[], rows: RawTable['rows']): RawTable => ({ headers, rows });

const base = (over: Partial<ColumnMapping>): ColumnMapping => ({
  date: { column: 0, format: 'dd/MM/yyyy' },
  amount: { mode: 'signed', column: 2 },
  amountLocale: 'es-DO',
  description: { column: 1 },
  fields: {},
  createMissingOptions: true,
  ...over,
});

describe('importCsv: lectura de archivos', () => {
  it('parseCsvText detecta el delimitador y quita el BOM', () => {
    const t = parseCsvText('﻿Fecha;Concepto;Monto\r\n01/05/2026;Venta;"1.234,50"\r\n\r\n02/05/2026;Luz;-45,50\r\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Fecha', 'Concepto', 'Monto']);
    expect(t.rows).toEqual([
      ['01/05/2026', 'Venta', '1.234,50'],
      ['02/05/2026', 'Luz', '-45,50'],
    ]);
    expect(parseCsvText('a\tb\n1\t2').delimiter).toBe('\t');
    expect(parseCsvText('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsvText('a|b\n1|2', { delimiter: '|' }).rows).toEqual([['1', '2']]);
  });

  it('parseCsvText salta el preámbulo del banco hasta la fila de cabeceras', () => {
    const csv = ['Banco Popular Dominicano', 'Cuenta: 123-456', '', 'Fecha,Descripción,Débito,Crédito', '01/05/2026,Pago,100.00,'].join('\n');
    const t = parseCsvText(csv);
    expect(t.headers).toEqual(['Fecha', 'Descripción', 'Débito', 'Crédito']);
    expect(t.headerRowIndex).toBe(3);
    expect(t.rows).toEqual([['01/05/2026', 'Pago', '100.00', '']]);
  });

  it('decodeCsvBytes acepta UTF-8 y cae a latin1 (windows-1252) si no lo es', () => {
    const utf8 = new TextEncoder().encode('Categoría');
    expect(decodeCsvBytes(utf8)).toEqual({ text: 'Categoría', encoding: 'utf-8' });
    const latin = new Uint8Array([0x43, 0x61, 0x74, 0x65, 0x67, 0x6f, 0x72, 0xed, 0x61]);
    expect(decodeCsvBytes(latin)).toEqual({ text: 'Categoría', encoding: 'latin1' });
  });

  it('tableFromRows toma filas de read-excel-file (Date, number, null) y busca las cabeceras', () => {
    const rows = [
      ['Estado de cuenta', null, null],
      [null, null, null],
      ['Fecha', 'Concepto', 'Monto'],
      [new Date(Date.UTC(2026, 4, 1)), 'Venta', 1234.5],
      [46143, 'Luz', -45.5],
    ];
    const t = tableFromRows(rows);
    expect(t.source).toBe('xlsx');
    expect(t.headers).toEqual(['Fecha', 'Concepto', 'Monto']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![0]).toBeInstanceOf(Date);
  });

  it('archivos con más de 120 000 filas no desbordan la pila', () => {
    const lines = ['Fecha,Concepto,Monto'];
    for (let i = 0; i < 130_000; i++) lines.push(`01/05/2026,Venta ${i},${(i % 900) + 1}.50`);
    const t = parseCsvText(lines.join('\n'));
    expect(t.rows).toHaveLength(130_000);
    expect(t.headers).toEqual(['Fecha', 'Concepto', 'Monto']);
    const x = tableFromRows([['Fecha', 'Monto'], ...Array.from({ length: 130_000 }, (_, i) => [i, i, i])]);
    expect(x.headers).toEqual(['Fecha', 'Monto', '']);
    expect(x.rows).toHaveLength(130_000);
  });

  it('parseDateCell entiende d/m/a, a-m-d, serial de Excel, Date, meses en texto y años de dos cifras', () => {
    expect(parseDateCell('15/03/2026', 'dd/MM/yyyy')).toBe('2026-03-15');
    expect(parseDateCell('5-3-2026', 'dd-MM-yyyy')).toBe('2026-03-05');
    expect(parseDateCell('03/15/2026', 'MM/dd/yyyy')).toBe('2026-03-15');
    expect(parseDateCell('2026-03-15', 'dd/MM/yyyy')).toBe('2026-03-15'); // ISO se reconoce siempre
    expect(parseDateCell('2026-03-15T10:20:00', 'auto')).toBe('2026-03-15');
    expect(parseDateCell('15/03/2026 14:30', 'dd/MM/yyyy')).toBe('2026-03-15');
    expect(parseDateCell('5/3/26', 'd/M/yy')).toBe('2026-03-05');
    expect(parseDateCell('15-MAR-26', 'auto')).toBe('2026-03-15');
    expect(parseDateCell('15 de marzo de 2026', 'auto')).toBe('2026-03-15');
    expect(parseDateCell('1 ago 2025', 'auto')).toBe('2025-08-01');
    expect(parseDateCell(46096, 'excel_serial')).toBe('2026-03-15');
    expect(parseDateCell(46096.75, 'auto')).toBe('2026-03-15'); // con hora
    expect(parseDateCell('46096', 'excel_serial')).toBe('2026-03-15');
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 15)), 'auto')).toBe('2026-03-15');
    expect(parseDateCell('20260315', 'auto')).toBe('2026-03-15');
    // Ilegibles: fechas que no existen, texto, vacío.
    expect(parseDateCell('31/02/2026', 'dd/MM/yyyy')).toBeNull();
    expect(parseDateCell('2026-13-01', 'auto')).toBeNull();
    expect(parseDateCell('mañana', 'auto')).toBeNull();
    expect(parseDateCell('', 'auto')).toBeNull();
    expect(parseDateCell(null, 'auto')).toBeNull();
    expect(parseDateCell('15/03/0026', 'dd/MM/yyyy')).toBeNull();
  });

  it('detectDateFormat y detectNumberLocale deciden por el contenido de la columna', () => {
    expect(detectDateFormat(['01/02/2026', '13/02/2026'])).toBe('dd/MM/yyyy');
    expect(detectDateFormat(['02/01/2026', '02/13/2026'])).toBe('MM/dd/yyyy');
    expect(detectDateFormat(['2026-02-01'])).toBe('yyyy-MM-dd');
    expect(detectDateFormat([46096, 46097])).toBe('excel_serial');
    expect(detectDateFormat(['01/02/2026'])).toBe('dd/MM/yyyy'); // ambiguo: se asume día primero (es-DO)
    expect(detectNumberLocale(['1.234,50', '12,00'])).toBe('es-ES');
    expect(detectNumberLocale(['1,234.50', '12.00'])).toBe('es-DO');
    expect(detectNumberLocale(['(45,50)', '7'])).toBe('es-ES');
    expect(detectNumberLocale([1234.5, 'x'])).toBe('es-DO');
  });

  it('parseAmountCell: 1.234,56 y 1,234.56, paréntesis negativos, CR/DB y números de Excel sin flotantes', () => {
    const v = (cell: unknown, locale = 'es-DO') => {
      const r = parseAmountCell(cell as string, locale, DOP);
      return r.ok ? r.value : r.error;
    };
    expect(v('1.234,56', 'es-ES')).toBe(123456);
    expect(v('1,234.56')).toBe(123456);
    expect(v('RD$ 1,234.56')).toBe(123456);
    expect(v('(1,234.56)')).toBe(-123456);
    expect(v('1,234.56-')).toBe(-123456);
    expect(v('500.00 DB')).toBe(-50000);
    expect(v('500.00 CR')).toBe(50000);
    expect(v(1234.56)).toBe(123456);
    expect(v(0.1 + 0.2)).toBe(30); // 0.30000000000000004 de una fórmula de Excel
    expect(v(-45.5)).toBe(-4550);
    expect(v(12.345)).toBe('too_many_decimals');
    expect(v('')).toBe('empty');
    expect(v(null)).toBe('empty');
    expect(v('abc')).toBe('not_a_number');
  });
});

describe('importCsv: mapeo', () => {
  it('suggestMapping reconoce Fecha, Monto/Importe, Débito/Crédito y Concepto/Descripción', async () => {
    const { imp } = await setup();
    const bank = table(['Fecha', 'Concepto', 'Débito', 'Crédito', 'Categoría', 'Cuenta'], [
      ['01/05/2026', 'Pago luz', '1,200.00', '', 'Electricidad', 'Caja'],
      ['13/05/2026', 'Depósito', '', '5,000.00', 'Ventas', 'Caja'],
    ]);
    const m = imp.suggestMapping(bank, FIELDS);
    expect(m.date).toEqual({ column: 0, format: 'dd/MM/yyyy' });
    expect(m.description).toEqual({ column: 1 });
    expect(m.amount).toEqual({ mode: 'split', inColumn: 3, outColumn: 2 });
    expect(m.amountLocale).toBe('es-DO');
    expect(m.fields).toEqual({ [S.fCat]: { column: 4 } });
    expect(m.account).toEqual({ column: 5 });

    const simple = imp.suggestMapping(table(['FECHA', 'Descripción', 'Importe (RD$)', 'Notas', 'Referencia'], [['2026-05-01', 'Venta', '-1.234,50', '', 'F-1']]), FIELDS);
    expect(simple.date).toEqual({ column: 0, format: 'yyyy-MM-dd' });
    expect(simple.description).toEqual({ column: 1 });
    expect(simple.amount).toEqual({ mode: 'signed', column: 2 });
    expect(simple.amountLocale).toBe('es-ES');
    expect(simple.notes).toEqual({ column: 3 });
    expect(simple.fields).toEqual({ [S.fRef]: { column: 4 } });

    const typed = imp.suggestMapping(table(['Fecha', 'Detalle', 'Monto', 'Tipo'], [['01/05/2026', 'Venta', '100', 'Entrada'], ['01/05/2026', 'Luz', '50', 'Salida']]), FIELDS);
    expect(typed.amount).toEqual({ mode: 'with_type', column: 2, typeColumn: 3, inValues: ['Entrada'] });

    const sheet = imp.suggestMapping(table(['Día', 'Ingresos', 'Egresos', 'Concepto'], [['01/05/2026', '100', '', 'Venta']]), FIELDS);
    expect(sheet.amount).toEqual({ mode: 'split', inColumn: 1, outColumn: 2 });

    // Sin cabeceras reconocibles, por contenido.
    const guess = detectColumns(table(['A', 'B', 'C'], [['15/05/2026', 'Venta', '1,000.00'], ['16/05/2026', 'Luz', '-50.00']]));
    expect(guess.map((g) => g.kind)).toEqual(['date', 'description', 'amount']);
    expect(guess[0]!.confidence).toBe('content');
  });

  it('templateCsv trae las columnas del espacio y suggestMapping lo reconoce entero', async () => {
    const { imp } = await setup();
    const csv = await imp.templateCsv(S.ws);
    expect(csv.startsWith('﻿')).toBe(true);
    const raw = parseCsvText(csv);
    expect(raw.headers).toEqual(['Fecha', 'Descripción', 'Entrada', 'Salida', 'Cuenta', 'Notas', 'Categoría', 'Pagado', 'Referencia', 'Unidades']);
    const m = imp.suggestMapping(raw, FIELDS);
    expect(m.amount).toEqual({ mode: 'split', inColumn: 2, outColumn: 3 });
    expect(m.account).toEqual({ column: 4 });
    expect(m.fields).toMatchObject({ [S.fCat]: { column: 6 }, [S.fPaid]: { column: 7 }, [S.fRef]: { column: 8 } });
    const sheet = await imp.templateTable(S.ws);
    expect(sheet.headers).toEqual(raw.headers);
  });
});

describe('importCsv: ida y vuelta con la exportación CSV', () => {
  it('quita el apóstrofo de csvSafeText: textos con - + = @ vuelven tal cual y las opciones no se duplican', async () => {
    const { imp } = await setup();
    const sheet: Sheet = {
      name: 'Movimientos',
      columns: [
        { key: 'date', header: 'Fecha', type: 'date' },
        { key: 'description', header: 'Descripción', type: 'text' },
        { key: 'amount', header: 'Monto', type: 'money' },
        { key: 'cat', header: 'Categoría', type: 'text' },
        { key: 'ref', header: 'Referencia', type: 'text' },
      ],
      rows: [
        ['2026-06-01', '-Devolución', -5000, '-Otros', '+1 809 555 0100'],
        ['2026-06-02', '=Venta', 12000, 'Ventas', '@caja'],
      ],
    };
    const csv = `\uFEFF${Papa.unparse(sheetToRows(sheet), { newline: '\r\n' })}`;
    expect(csv).toContain("'-Devolución");
    const raw = parseCsvText(csv);
    expect(raw.rows).toEqual([
      ['2026-06-01', '-Devolución', '-50.00', '-Otros', '+1 809 555 0100'],
      ['2026-06-02', '=Venta', '120.00', 'Ventas', '@caja'],
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({
      date: { column: 0, format: 'yyyy-MM-dd' },
      fields: { [S.fCat]: { column: 3 }, [S.fRef]: { column: 4 } },
    }));
    expect(p.rows.map((r) => r.draft?.description)).toEqual(['-Devolución', '=Venta']);
    expect(p.rows[0]!.draft?.values?.[S.fRef]).toEqual({ type: 'text', value: '+1 809 555 0100' });
    expect(p.newOptions.map((o) => o.label)).toEqual(['-Otros']);
  });

  it('templateCsv protege los nombres de campo contra fórmulas y suggestMapping los sigue reconociendo', async () => {
    const { imp } = await setup();
    await h!.driver.run('UPDATE fields SET label = ? WHERE id = ?', ['=HYPERLINK("https://example.invalid","Ver")', S.fRef]);
    const csv = await imp.templateCsv(S.ws);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0]!;
    expect(header).toContain('"\'=HYPERLINK(""https://example.invalid"",""Ver"")"');
    for (const cell of Papa.parse<string[]>(header).data[0]!) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
    const raw = parseCsvText(csv);
    expect(raw.headers).toContain('=HYPERLINK("https://example.invalid","Ver")');
    const fields = FIELDS.map((f) => (f.id === S.fRef ? { ...f, label: '=HYPERLINK("https://example.invalid","Ver")' } : f));
    expect(imp.suggestMapping(raw, fields).fields).toMatchObject({ [S.fRef]: { column: raw.headers.indexOf('=HYPERLINK("https://example.invalid","Ver")') } });
  });
});

describe('importCsv: vista previa', () => {
  it('preview lee fechas dd/MM/yyyy y montos "1.234,50" según el formato elegido', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [
      ['15/03/2026', 'Venta grande', '1.234,50'],
      ['16/03/2026', 'Compra', '-99,90'],
      ['17/03/2026', 'Ajuste', '12'],
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({ amountLocale: 'es-ES' }));
    expect(p.rows.map((r) => r.draft && [r.draft.date, r.draft.kind, r.draft.amountMinor])).toEqual([
      ['2026-03-15', 'income', 123450],
      ['2026-03-16', 'expense', 9990],
      ['2026-03-17', 'income', 1200],
    ]);
    expect(p.rows.every((r) => r.status === 'ok')).toBe(true);
    expect(p.totals).toMatchObject({ inMinor: 124650, outMinor: 9990, count: 3 });
    // 'auto' llega a lo mismo.
    const auto = await imp.preview(S.ws, S.cash, raw, base({ amountLocale: 'auto', date: { column: 0, format: 'auto' } }));
    expect(auto.rows.map((r) => r.draft?.amountMinor)).toEqual([123450, 9990, 1200]);
    expect(auto.resolved).toEqual({ dateFormat: 'dd/MM/yyyy', amountLocale: 'es-ES' });
  });

  it('modo split (Entrada/Salida) produce income y expense', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Entrada', 'Salida'], [
      ['01/06/2026', 'Venta', '1,500.00', ''],
      ['02/06/2026', 'Luz', '', '450.25'],
      ['03/06/2026', 'Raro', '10', '20'],
      ['04/06/2026', 'Nada', '', ''],
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({ amount: { mode: 'split', inColumn: 2, outColumn: 3 } }));
    expect(p.rows[0]!.draft).toMatchObject({ kind: 'income', amountMinor: 150000, accountId: S.cash, description: 'Venta' });
    expect(p.rows[1]!.draft).toMatchObject({ kind: 'expense', amountMinor: 45025 });
    expect(p.rows[2]).toMatchObject({ status: 'error', issues: ['both_amounts'], skipByDefault: true });
    expect(p.rows[3]).toMatchObject({ status: 'error', issues: ['amount_empty'] });
    expect(p.totals).toMatchObject({ inMinor: 150000, outMinor: 45025, count: 2 });

    const typed = await imp.preview(
      S.ws,
      S.cash,
      table(['Fecha', 'Concepto', 'Monto', 'Tipo'], [['01/06/2026', 'Venta', '100', 'entrada'], ['01/06/2026', 'Luz', '50', 'Salida']]),
      base({ amount: { mode: 'with_type', column: 2, typeColumn: 3, inValues: ['Entrada'] } }),
    );
    expect(typed.rows.map((r) => r.draft?.kind)).toEqual(['income', 'expense']);
  });

  it('preview marca filas ilegibles y no escribe nada en la BD', async () => {
    const { imp, events } = await setup();
    const before = await counts();
    const raw = table(['Fecha', 'Concepto', 'Monto', 'Cuenta'], [
      ['32/01/2026', 'Fecha imposible', '10.00', ''],
      ['ayer', 'Fecha en texto', '10.00', ''],
      ['01/02/2026', 'Monto raro', 'diez', ''],
      ['01/02/2026', '', '10.00', ''],
      ['', '', '', ''],
      ['01/02/2026', 'Cuenta que no existe', '10.00', 'Tarjeta'],
      ['01/02/2026', 'Cuenta archivada', '10.00', 'caja VIEJA'],
      ['01/02/2026', 'Cuenta por nombre', '10.00', 'banco popular'],
      ['01/02/2026', 'Cero', '0', ''],
      ['TOTAL', '', '50.00', ''],
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({ account: { column: 3 } }));
    expect(p.rows.map((r) => [r.status, r.issues])).toEqual([
      ['error', ['unparseable_date']],
      ['error', ['unparseable_date']],
      ['error', ['not_a_number']],
      ['error', ['description_required']],
      ['empty', []],
      ['error', ['unknown_account']],
      ['error', ['account_archived']],
      ['ok', []],
      ['warning', ['zero_amount']],
      ['error', ['unparseable_date', 'description_required']],
    ]);
    expect(p.rows[7]!.draft?.accountId).toBe(S.bank);
    expect(p.rows.filter((r) => r.skipByDefault).length).toBe(8);
    // Una descripción de más de 200 caracteres es error de fila (no rompe el lote al confirmar).
    const long = await imp.preview(S.ws, S.cash, table(['Fecha', 'Concepto', 'Monto', 'Cuenta'], [['01/02/2026', 'x'.repeat(201), '10.00', '']]), base({}));
    expect(long.rows.map((r) => [r.status, r.issues])).toEqual([['error', ['text_too_long']]]);
    expect(p.rows[0]!.raw).toEqual(['32/01/2026', 'Fecha imposible', '10.00', '']);
    expect(await counts()).toEqual(before);
    expect(events).toEqual([]);
  });

  it('preview marca duplicados de movimientos existentes y los salta por defecto', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [
      ['03/05/2026', 'FACTURA DE LUZ', '-4,550.00'], // ya está (mismo día, monto, cuenta y descripción)
      ['03/05/2026', 'Factura de luz', '-4,550.00'], // segunda copia en el archivo: no hay otra en la BD
      ['11/05/2026', 'Venta mostrador', '1,200.00'], // un día después, misma descripción: posible duplicado
      ['10/05/2026', 'Venta mostrador', '1,200.00'], // el que ya existe el día 10
      ['20/05/2026', 'Factura de luz', '-4,550.00'], // mismo monto pero lejos: nuevo
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({}));
    expect(p.rows.map((r) => r.status)).toEqual(['duplicate', 'warning', 'warning', 'duplicate', 'ok']);
    expect(p.rows[0]).toMatchObject({ skipByDefault: true, duplicateOf: { seq: 2 } });
    expect(p.rows[1]!.issues).toEqual(['duplicate_in_file']);
    expect(p.rows[1]!.skipByDefault).toBe(false);
    expect(p.rows[2]!.issues).toEqual(['possible_duplicate']);
    expect(p.rows[3]).toMatchObject({ skipByDefault: true, duplicateOf: { seq: 3 } });
    expect(p.totals).toMatchObject({ inMinor: 120000, outMinor: 910000, count: 3 });
  });

  it('fila que parece saldo inicial se marca opening_suspect y se salta si la cuenta ya tiene saldo inicial', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [
      ['01/01/2026', 'Saldo anterior', '25,000.00'],
      ['02/01/2026', 'Venta', '100.00'],
    ]);
    const cash = await imp.preview(S.ws, S.cash, raw, base({}));
    expect(cash.accountHasOpening).toBe(true);
    expect(cash.rows[0]).toMatchObject({ status: 'opening_suspect', skipByDefault: true, opening: null });
    expect(cash.totals).toMatchObject({ inMinor: 10000, openingMinor: 0, count: 1 });

    const bank = await imp.preview(S.ws, S.bank, raw, base({}));
    expect(bank.accountHasOpening).toBe(false);
    expect(bank.rows[0]).toMatchObject({
      status: 'opening_suspect',
      skipByDefault: false,
      opening: { accountId: S.bank, amountMinor: 2500000, direction: 'in', date: '2026-01-01' },
    });
    // El saldo inicial no se suma a las entradas: va en su propia línea.
    expect(bank.totals).toMatchObject({ inMinor: 10000, openingMinor: 2500000, count: 2 });
    // Dos filas de saldo inicial para la misma cuenta: solo la primera puede serlo.
    const twice = await imp.preview(S.ws, S.bank, table(['Fecha', 'Concepto', 'Monto'], [
      ['01/01/2026', 'Saldo inicial', '100.00'],
      ['01/02/2026', 'Balance anterior', '200.00'],
    ]), base({}));
    expect(twice.rows.map((r) => [r.status, r.skipByDefault])).toEqual([['opening_suspect', false], ['opening_suspect', true]]);
    // Fecha anterior al saldo inicial de la cuenta → aviso.
    const early = await imp.preview(S.ws, S.cash, table(['Fecha', 'Concepto', 'Monto'], [['15/12/2025', 'Venta', '1']]), base({}));
    expect(early.rows[0]!.issues).toEqual(['before_opening']);
  });

  it('preview agrupa opciones nuevas sin distinguir mayúsculas ni tildes y avisa de las parecidas', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto', 'Categoría', 'Pagado', 'Unidades', 'Ref'], [
      ['01/06/2026', 'a', '-1', 'Teléfono', 'sí', '2,5', 'F-1'],
      ['01/06/2026', 'b', '-1', 'TELEFONO', 'no', '', ''],
      ['01/06/2026', 'c', '-1', 'telefono ', 'x', '3', ''],
      ['01/06/2026', 'd', '-1', 'electrisidad', '', '', ''],
      ['01/06/2026', 'e', '-1', 'ventas', '', '', ''],
      ['01/06/2026', 'f', '-1', 'Luz', 'quizás', 'mucho', ''],
    ]);
    const mapping = base({
      amountLocale: 'es-ES',
      fields: { [S.fCat]: { column: 3 }, [S.fPaid]: { column: 4 }, [S.fUnits]: { column: 5 }, [S.fRef]: { column: 6 } },
    });
    const p = await imp.preview(S.ws, S.cash, raw, mapping);
    expect(p.newOptions).toEqual([
      { fieldId: S.fCat, label: 'Teléfono', rowCount: 3, similar: [] },
      { fieldId: S.fCat, label: 'electrisidad', rowCount: 1, similar: [{ id: S.oElectricidad, label: 'Electricidad' }] },
    ]);
    expect(p.rows[0]!.draft?.values).toEqual({
      [S.fPaid]: { type: 'bool', value: true },
      [S.fUnits]: { type: 'number', value: 2.5 },
      [S.fRef]: { type: 'text', value: 'F-1' },
    });
    expect(p.rows[0]!.pendingOptions).toEqual([{ fieldId: S.fCat, label: 'Teléfono' }]);
    expect(p.rows[1]!.draft?.values?.[S.fPaid]).toEqual({ type: 'bool', value: false });
    expect(p.rows[4]!.draft?.values?.[S.fCat]).toEqual({ type: 'list', optionId: S.oVentas });
    // "Luz" está fusionada en "Electricidad": se usa el destino.
    expect(p.rows[5]!.draft?.values?.[S.fCat]).toEqual({ type: 'list', optionId: S.oElectricidad });
    expect(p.rows[5]!.issues).toEqual(['invalid_value']);
    expect(p.rows[5]!.status).toBe('warning');

    // Con un alias del usuario, "electrisidad" va a la opción existente y no se crea nada.
    const aliased = await imp.preview(S.ws, S.cash, raw, { ...mapping, optionMap: { [S.fCat]: { electrisidad: S.oElectricidad } } });
    expect(aliased.newOptions.map((o) => o.label)).toEqual(['Teléfono']);
    expect(aliased.rows[3]!.draft?.values?.[S.fCat]).toEqual({ type: 'list', optionId: S.oElectricidad });
    // Sin crear opciones, el valor queda vacío con aviso.
    const strict = await imp.preview(S.ws, S.cash, raw, { ...mapping, createMissingOptions: false });
    expect(strict.newOptions).toEqual([]);
    expect(strict.rows[0]!.issues).toContain('unknown_option');
  });

  it('preview acepta celdas de Excel: Date, serial y números', async () => {
    const { imp } = await setup();
    const raw = tableFromRows([
      ['Fecha', 'Concepto', 'Monto'],
      [new Date(Date.UTC(2026, 4, 1)), 'Venta', 1234.5],
      [46143, 'Luz', -45.5],
    ]);
    const p = await imp.preview(S.ws, S.cash, raw, base({ date: { column: 0, format: 'auto' }, amountLocale: 'auto' }));
    expect(p.rows.map((r) => r.draft && [r.draft.date, r.draft.kind, r.draft.amountMinor])).toEqual([
      ['2026-05-01', 'income', 123450],
      ['2026-05-01', 'expense', 4550],
    ]);
    expect(p.rows[0]!.raw).toEqual(['2026-05-01', 'Venta', '1234.5']);
  });

  it('total del archivo distinto del total a importar se informa en fileTotalDifferenceMinor', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [
      ['01/06/2026', 'Venta', '1,000.00'],
      ['02/06/2026', 'Compra', '-300.00'],
      ['03/05/2026', 'Factura de luz', '-4,550.00'], // duplicado: se salta
    ]);
    const exact = await imp.preview(S.ws, S.cash, raw, base({}), { fileTotalMinor: 70000 });
    expect(exact.fileTotalDifferenceMinor).toBe(0);
    const p = await imp.preview(S.ws, S.cash, raw, base({}), { fileTotalMinor: 70000 - 455000 });
    expect(p.fileTotalDifferenceMinor).toBe(-455000);
    expect(p.fileTotals).toMatchObject({ inMinor: 100000, outMinor: 485000, count: 3 });
    const none = await imp.preview(S.ws, S.cash, raw, base({}));
    expect(none.fileTotalDifferenceMinor).toBeNull();
    const split = await imp.preview(S.ws, S.cash, raw, base({}), { fileTotalInMinor: 100000, fileTotalOutMinor: 485000 });
    expect(split.fileTotalDifference).toEqual({ netMinor: null, inMinor: 0, outMinor: 455000 });
  });

  it('preview valida espacio y cuenta', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [['01/06/2026', 'Venta', '1']]);
    await expect(imp.preview('no-existe', S.cash, raw, base({}))).rejects.toMatchObject({ code: 'not_found' });
    await expect(imp.preview(S.ws, 'no-existe', raw, base({}))).rejects.toMatchObject({ code: 'not_found' });
    await expect(imp.preview(S.ws, S.foreign, raw, base({}))).rejects.toMatchObject({ code: 'workspace_mismatch' });
    await expect(imp.preview(S.ws, S.old, raw, base({}))).rejects.toMatchObject({ code: 'account_archived' });
  });

  it('commit sin filas válidas → batch_empty y no escribe nada', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [['xx', 'Venta', '1']]);
    const p = await imp.preview(S.ws, S.cash, raw, base({}));
    const before = await counts();
    await expect(imp.commit(S.ws, S.cash, p, { include: [0], fileName: 'a.csv', mapping: base({}) })).rejects.toMatchObject({
      code: 'batch_empty',
    });
    await expect(imp.commit(S.ws, S.cash, p, { include: [], fileName: 'a.csv', mapping: base({}) })).rejects.toMatchObject({
      code: 'batch_empty',
    });
    expect(await counts()).toEqual(before);
  });
});

describe('importCsv: confirmación (usa createMany de 2A)', () => {
  it('commit crea un lote import; anular el lote deshace la importación sin tocar lo previo', async () => {
    const { imp } = await setup();
    const prior = await h!.driver.all('SELECT * FROM transactions ORDER BY id');
    const raw = table(['Fecha', 'Concepto', 'Monto', 'Categoría'], [
      ['01/06/2026', 'Venta', '1,000.00', 'Ventas'],
      ['02/06/2026', 'Compra', '-300.00', 'Alquiler'],
      ['03/05/2026', 'Factura de luz', '-4,550.00', ''], // duplicado: se salta
      ['zz', 'Ilegible', '1', ''],
    ]);
    const mapping = base({ fields: { [S.fCat]: { column: 3 } } });
    const p = await imp.preview(S.ws, S.cash, raw, mapping);
    const include = p.rows.filter((r) => !r.skipByDefault).map((r) => r.index);
    expect(include).toEqual([0, 1]);
    const m = await imp.commit(S.ws, S.cash, p, { include, fileName: 'banco-junio.csv', mapping });
    expect(m.value).toMatchObject({ imported: 2, skipped: 2, createdOptions: 0 });
    expect(m.auditActionId).not.toBeNull();

    const batch = await h!.driver.get<{ source: string; label: string; account_id: string; meta: string }>(
      'SELECT source, label, account_id, meta FROM batches WHERE id = ?',
      [m.value.batchId],
    );
    expect(batch).toMatchObject({ source: 'import', label: 'banco-junio.csv', account_id: S.cash });
    expect(JSON.parse(batch!.meta)).toMatchObject({ fileName: 'banco-junio.csv', imported: 2, skipped: 2 });
    const audit = await h!.driver.get<{ action: string; batch_id: string }>('SELECT action, batch_id FROM audit_log WHERE id = ?', [
      m.auditActionId,
    ]);
    expect(audit).toEqual({ action: 'import', batch_id: m.value.batchId });
    const imported = await h!.driver.all<{ description: string; amount_minor: number; kind: string }>(
      'SELECT description, amount_minor, kind FROM transactions WHERE batch_id = ? ORDER BY seq',
      [m.value.batchId],
    );
    expect(imported).toEqual([
      { description: 'Venta', amount_minor: 100000, kind: 'income' },
      { description: 'Compra', amount_minor: 30000, kind: 'expense' },
    ]);

    // Lo que había antes no cambió en nada.
    const after = await h!.driver.all('SELECT * FROM transactions WHERE batch_id IS NULL ORDER BY id');
    expect(after).toEqual(prior);

    await h!.cuadra.batches.void(m.value.batchId, 'importé el archivo equivocado');
    const active = await h!.driver.get<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE batch_id = ? AND status = 'active'", [
      m.value.batchId,
    ]);
    expect(Number(active?.n)).toBe(0);
    expect(await h!.driver.all('SELECT * FROM transactions WHERE batch_id IS NULL ORDER BY id')).toEqual(prior);
  });

  it('opciones nuevas se crean una sola vez sin distinguir mayúsculas ni tildes', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto', 'Categoría'], [
      ['01/06/2026', 'a', '-1.00', 'Teléfono'],
      ['02/06/2026', 'b', '-2.00', 'TELEFONO'],
      ['03/06/2026', 'c', '-3.00', 'teléfono'],
    ]);
    const mapping = base({ fields: { [S.fCat]: { column: 3 } } });
    const p = await imp.preview(S.ws, S.cash, raw, mapping);
    const m = await imp.commit(S.ws, S.cash, p, { include: [0, 1, 2], fileName: 'gastos.xlsx', mapping });
    expect(m.value.createdOptions).toBe(1);
    const options = await h!.driver.all<{ id: string; label: string }>(
      "SELECT id, label FROM field_options WHERE field_id = ? AND label LIKE 'tel%' COLLATE NOCASE",
      [S.fCat],
    );
    expect(options).toHaveLength(1);
    expect(options[0]!.label).toBe('Teléfono');
    const used = await h!.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transaction_field_values WHERE value_option_id = ?', [
      options[0]!.id,
    ]);
    expect(Number(used?.n)).toBe(3);
  });

  it('commit importa la fila de saldo inicial como saldo inicial si la cuenta no tenía', async () => {
    const { imp } = await setup();
    const raw = table(['Fecha', 'Concepto', 'Monto'], [
      ['01/01/2026', 'Saldo anterior', '25,000.00'],
      ['02/01/2026', 'Venta', '100.00'],
    ]);
    const p = await imp.preview(S.ws, S.bank, raw, base({}));
    const m = await imp.commit(S.ws, S.bank, p, { include: [0, 1], fileName: 'popular.csv', mapping: base({}) });
    expect(m.value.imported).toBe(2);
    const rows = await h!.driver.all<{ kind: string; amount_minor: number }>(
      'SELECT kind, amount_minor FROM transactions WHERE account_id = ? ORDER BY seq',
      [S.bank],
    );
    expect(rows).toEqual([
      { kind: 'opening', amount_minor: 2500000 },
      { kind: 'income', amount_minor: 10000 },
    ]);
  });
});
