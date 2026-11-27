import { describe, expect, it } from 'vitest';
import { Money, type AccountWithBalance, type Field, type FieldOption, type Transaction } from '../../../core';
import { exprFromMinor, parseAmountText } from './amount';
import { controlGate, removeLine, remaining, sumLines, tail, toCaptureRows, upsertLine, type BurstLine } from './burst';
import { isoToDmy, parseLooseDate } from './dates';
import {
  applySuggestion,
  buildPatch,
  buildTxDraft,
  isDirty,
  nextEntry,
  parseEntryParams,
  pickAccount,
  resolveDescription,
  staleValues,
  topOptions,
  validateEntry,
  visibleSuggestions,
  type EntryState,
} from './entry';
import {
  applyPaste,
  buildColumns,
  completeOption,
  copyFromAbove,
  duplicateAbove,
  emptyRow,
  ensureTrailingRow,
  evaluateGrid,
  evaluateRow,
  isTabular,
  keepUnsaved,
  moveFocus,
  normalizeCell,
  parseTsv,
  resolveOption,
  type GridRow,
} from './grid';
import { choose, defaultPair, previewBalances, swap, validateTransfer } from './transfer';

const TODAY = '2026-11-27';

const opt = (id: string, label: string, extra: Partial<FieldOption> = {}): FieldOption => ({
  id,
  fieldId: 'cat',
  key: null,
  label,
  color: null,
  appliesTo: 'both',
  sortOrder: 0,
  active: true,
  mergedIntoId: null,
  ...extra,
});

const field = (id: string, type: Field['type'], label: string, extra: Partial<Field> = {}): Field => ({
  id,
  workspaceId: 'ws',
  key: id,
  label,
  type,
  role: null,
  appliesTo: 'both',
  sortOrder: 0,
  showInList: true,
  active: true,
  deactivatedAt: null,
  options: [],
  ...extra,
});

const CATEGORY = field('cat', 'list', 'Categoría', {
  role: 'category',
  options: [opt('o1', 'Materiales'), opt('o2', 'Mercancía'), opt('o3', 'Electricidad'), opt('o4', 'Viejo', { active: false })],
});
const REF = field('ref', 'text', 'Comprobante');
const DUE = field('due', 'date', 'Vencimiento');
const PAID = field('paid', 'bool', 'Conciliado');
const QTY = field('qty', 'number', 'Cantidad');
const FIELDS = [CATEGORY, REF, DUE, PAID, QTY];

const account = (id: string, name: string, balanceMinor: number, archived = false): AccountWithBalance => ({
  id,
  workspaceId: 'ws',
  name,
  type: 'cash',
  color: null,
  icon: null,
  sortOrder: 0,
  archivedAt: archived ? '2026-01-01T00:00:00.000Z' : null,
  createdAt: '',
  updatedAt: '',
  balanceMinor,
  lastMovementDate: null,
  isNegative: balanceMinor < 0,
  openingTransactionId: null,
});
const ACCOUNTS = [account('caja', 'Caja', 1_240_000), account('banco', 'Banco', 310_000), account('old', 'Vieja', 0, true)];

const state = (over: Partial<EntryState> = {}): EntryState => ({
  kind: 'expense',
  accountId: 'caja',
  expr: '',
  date: TODAY,
  description: '',
  notes: '',
  values: {},
  ...over,
});

describe('fechas sueltas', () => {
  it('entiende palabras y desplazamientos', () => {
    expect(parseLooseDate('hoy', TODAY)).toBe(TODAY);
    expect(parseLooseDate('Ayer', TODAY)).toBe('2026-11-26');
    expect(parseLooseDate('-2', TODAY)).toBe('2026-11-25');
    expect(parseLooseDate('+1', TODAY)).toBe('2026-11-28');
    expect(parseLooseDate('mañana', TODAY)).toBe('2026-11-28');
  });
  it('un día suelto es el más reciente que no sea futuro', () => {
    expect(parseLooseDate('15', TODAY)).toBe('2026-11-15');
    expect(parseLooseDate('27', TODAY)).toBe(TODAY);
    expect(parseLooseDate('30', TODAY)).toBe('2026-10-30');
    // Noviembre no tiene 31: queda el de este mes aunque sea futuro (y el formulario avisa de la fecha lejana).
    expect(parseLooseDate('31', '2026-12-05')).toBe('2026-12-31');
  });
  it('día/mes, día/mes/año e ISO', () => {
    expect(parseLooseDate('15/11', TODAY)).toBe('2026-11-15');
    expect(parseLooseDate('15/12', TODAY)).toBe('2025-12-15');
    expect(parseLooseDate('3/2/2025', TODAY)).toBe('2025-02-03');
    expect(parseLooseDate('03-02-25', TODAY)).toBe('2025-02-03');
    expect(parseLooseDate('2026-01-31', TODAY)).toBe('2026-01-31');
  });
  it('rechaza lo que no es fecha', () => {
    expect(parseLooseDate('', TODAY)).toBeNull();
    expect(parseLooseDate('31/02/2026', TODAY)).toBeNull();
    expect(parseLooseDate('mañanita', TODAY)).toBeNull();
    expect(parseLooseDate('2026-02-30', TODAY)).toBeNull();
  });
  it('isoToDmy se vuelve a leer igual', () => {
    expect(isoToDmy('2026-03-07')).toBe('07/03/2026');
    expect(parseLooseDate(isoToDmy('2026-03-07'), TODAY)).toBe('2026-03-07');
  });
});

describe('montos como texto', () => {
  it('mismo parser que el teclado: aritmética y separadores', () => {
    expect(parseAmountText('1,500+350', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 185_000, hasOps: true });
    expect(parseAmountText('RD$ 1,250.50', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 125_050, hasOps: false });
    expect(parseAmountText('350*2', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 70_000 });
  });
  it('ignora el signo o los paréntesis de Excel', () => {
    expect(parseAmountText('-350', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 35_000 });
    expect(parseAmountText('(1,200.00)', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 120_000 });
  });
  it('vacío e inválido', () => {
    expect(parseAmountText('  ', 'es-DO', 2).status).toBe('empty');
    expect(parseAmountText('abc', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('US$ 20', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 2000 });
    expect(parseAmountText('100-500', 'es-DO', 2)).toMatchObject({ status: 'invalid', reason: 'negative' });
  });
  it('rechaza separadores que no son del locale en vez de recortarlos', () => {
    for (const s of ['1.500.000', '10.999', '1.234,56', '1,5,0', '1,50,000', '0.001']) {
      expect(parseAmountText(s, 'es-DO', 2), s).toMatchObject({ status: 'invalid', reason: 'invalid' });
    }
    // También dentro de una expresión y en el total de control con palabras.
    expect(parseAmountText('100+10.999', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('1,500,000 pesos', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('1.500.000', 'es-ES', 2)).toMatchObject({ status: 'ok', minor: 150_000_000 });
    expect(parseAmountText('1.234,56', 'es-ES', 2)).toMatchObject({ status: 'ok', minor: 123_456 });
  });
  it('lee cada número igual que Money.parse del núcleo (saldo inicial, importación)', () => {
    const currency = { code: 'DOP', minorDigits: 2 as const };
    for (const s of ['1,5', '1,50', '1,500', '1,500.5', '10.90', '1.500', '0.5', '007', '12,345,678.9', '10.999', '1.500.000']) {
      const core = Money.parse(s, { locale: 'es-DO', currency });
      const here = parseAmountText(s, 'es-DO', 2);
      expect(here.status === 'ok' ? here.minor : 'error', s).toEqual(core.ok ? core.value : 'error');
    }
    expect(parseAmountText('1,5', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 150 });
  });
  it('los factores de × no se recortan y redondean al final', () => {
    expect(parseAmountText('3*0.333', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 100, expr: '3*0.333' });
    expect(parseAmountText('1,000 × 1.18', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 118_000 });
    expect(parseAmountText('100 x 2', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 20_000 });
    expect(parseAmountText('100*1.2.3', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('100*0.1234567', 'es-DO', 2).status).toBe('invalid');
  });
  it('operador final se ignora; operador doble o al principio es error', () => {
    expect(parseAmountText('150+', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 15_000, expr: '150' });
    expect(parseAmountText('150++5', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('*5', 'es-DO', 2).status).toBe('invalid');
    expect(parseAmountText('RD$100 + RD$50', 'es-DO', 2)).toMatchObject({ status: 'ok', minor: 15_000 });
  });
  it('exprFromMinor corta texto sin dividir', () => {
    expect(exprFromMinor(185_050, 2)).toBe('1850.5');
    expect(exprFromMinor(185_000, 2)).toBe('1850');
    expect(exprFromMinor(5, 2)).toBe('0.05');
    expect(exprFromMinor(1234, 0)).toBe('1234');
    expect(exprFromMinor(0, 2)).toBe('');
  });
});

describe('parámetros y cuenta inicial', () => {
  it('lee tipo, cuenta, desde y editar', () => {
    expect(parseEntryParams(new URLSearchParams('tipo=entrada&cuenta=caja'))).toEqual({ kind: 'income', accountId: 'caja', fromTxId: null, editId: null });
    expect(parseEntryParams(new URLSearchParams('tipo=raro&desde=t1'))).toMatchObject({ kind: null, fromTxId: 't1' });
    expect(parseEntryParams(new URLSearchParams('editar=t2')).editId).toBe('t2');
  });
  it('elige la primera preferida activa', () => {
    expect(pickAccount(ACCOUNTS, ['old', 'banco'])).toBe('banco');
    expect(pickAccount(ACCOUNTS, [null, undefined])).toBe('caja');
    expect(pickAccount([], ['x'])).toBeNull();
  });
});

describe('borrador de movimiento', () => {
  it('sin concepto usa el nombre de la categoría', () => {
    const s = state({ values: { cat: { type: 'list', optionId: 'o1' } } });
    expect(resolveDescription('', s.values, FIELDS)).toBe('Materiales');
    expect(resolveDescription('  Cemento ', s.values, FIELDS)).toBe('Cemento');
    expect(validateEntry(state(), 5000, FIELDS)).toEqual(['description']);
    expect(validateEntry(state({ accountId: null }), 0, FIELDS)).toEqual(['amount', 'account', 'description']);
  });
  it('arma el TxDraft solo con lo que hay', () => {
    const d = buildTxDraft(state({ description: 'Cemento', values: { cat: { type: 'list', optionId: 'o1' }, gone: { type: 'text', value: 'x' } } }), 185_000, FIELDS);
    expect(d).toEqual({ accountId: 'caja', kind: 'expense', amountMinor: 185_000, date: TODAY, description: 'Cemento', values: { cat: { type: 'list', optionId: 'o1' } } });
    expect(buildTxDraft(state(), null, FIELDS)).toBeNull();
  });
  it('el parche solo lleva lo que cambió y vacía con null', () => {
    const tx = {
      kind: 'expense',
      amountMinor: 150_000,
      date: '2026-11-20',
      description: 'Cemento',
      notes: '',
      values: { cat: { type: 'list', optionId: 'o1' }, ref: { type: 'text', value: 'B01' }, hidden: { type: 'text', value: 'x' } },
    } as unknown as Transaction;
    const s = state({ kind: 'income', date: '2026-11-20', description: 'Cemento', values: { cat: { type: 'list', optionId: 'o2' } } });
    expect(buildPatch(tx, s, 185_000, FIELDS)).toEqual({
      kind: 'income',
      amountMinor: 185_000,
      values: { cat: { type: 'list', optionId: 'o2' }, ref: null },
    });
    const same = state({ date: '2026-11-20', description: 'Cemento', values: { ...tx.values } });
    expect(buildPatch(tx, same, 150_000, FIELDS)).toEqual({});
  });
  it('cambiar de tipo al editar vacía lo que solo aplicaba al tipo original', () => {
    // Formulario de entrada: Categoría con Ventas (solo entradas) y un campo Cliente que solo existe en entradas.
    const cat = (options: FieldOption[]) => field('cat', 'list', 'Categoría', { role: 'category', options });
    const ventas = opt('ventas', 'Ventas', { appliesTo: 'in' });
    const otros = opt('otros', 'Otros');
    const cliente = field('cli', 'list', 'Cliente', { appliesTo: 'in', options: [opt('c1', 'Al contado', { fieldId: 'cli' })] });
    const inFields = [cat([ventas, otros]), cliente, REF];
    const outFields = [cat([otros, opt('alq', 'Alquiler', { appliesTo: 'out' })]), REF];
    const tx = {
      kind: 'income',
      amountMinor: 521_000,
      date: '2026-11-20',
      description: 'Venta',
      notes: '',
      values: { cat: { type: 'list', optionId: 'ventas' }, cli: { type: 'list', optionId: 'c1' }, ref: { type: 'text', value: 'B01' }, old: { type: 'list', optionId: 'x' } },
    } as unknown as Transaction;
    const s = state({ kind: 'expense', date: '2026-11-20', description: 'Venta', values: { ...tx.values } });
    expect(staleValues(s.values, inFields, outFields).map((x) => `${x.field.id}:${x.label}`)).toEqual(['cat:Ventas', 'cli:Al contado']);
    expect(buildPatch(tx, s, 521_000, outFields, inFields)).toEqual({ kind: 'expense', values: { cat: null, cli: null } });
    // Una opción que aplica a los dos tipos se conserva; sin el formulario original no se toca nada (compatibilidad).
    const both = state({ kind: 'expense', date: '2026-11-20', description: 'Venta', values: { ...tx.values, cat: { type: 'list', optionId: 'otros' } } });
    expect(buildPatch({ ...tx, values: both.values } as Transaction, both, 521_000, outFields, inFields)).toEqual({ kind: 'expense', values: { cli: null } });
    expect(buildPatch(tx, s, 521_000, outFields)).toEqual({ kind: 'expense' });
    // Sin cambio de tipo, nada se vacía aunque se pase el formulario original.
    const same = state({ kind: 'income', date: '2026-11-20', description: 'Venta', values: { ...tx.values } });
    expect(buildPatch(tx, same, 521_000, inFields, inFields)).toEqual({});
  });
  it('sucio, siguiente y sugerencias', () => {
    const a = state();
    expect(isDirty(a, { ...a })).toBe(false);
    expect(isDirty(a, { ...a, expr: '5' })).toBe(true);
    expect(isDirty(a, { ...a, values: { paid: { type: 'bool', value: true } } })).toBe(true);
    const n = nextEntry(state({ expr: '50', description: 'Pan', values: { cat: { type: 'list', optionId: 'o1' } } }));
    expect(n).toMatchObject({ expr: '', description: '', values: { cat: { type: 'list', optionId: 'o1' } } });
    const s = applySuggestion(state({ values: { cat: { type: 'list', optionId: 'o2' } } }), {
      description: 'Gasolina',
      uses: 3,
      lastValues: { cat: { type: 'list', optionId: 'o1' }, ref: { type: 'text', value: 'B02' }, gone: { type: 'text', value: 'x' } },
    }, FIELDS);
    expect(s.description).toBe('Gasolina');
    expect(s.values).toEqual({ cat: { type: 'list', optionId: 'o2' }, ref: { type: 'text', value: 'B02' } });
    const list = [
      { description: 'Pan', uses: 9, lastValues: {} },
      { description: 'pan', uses: 2, lastValues: {} },
      { description: 'Panela', uses: 1, lastValues: {} },
      { description: 'Pintura', uses: 1, lastValues: {} },
      { description: 'Pino', uses: 1, lastValues: {} },
    ];
    expect(visibleSuggestions(list, 'Pan').map((x) => x.description)).toEqual(['Panela', 'Pintura', 'Pino']);
  });
  it('categorías más usadas y relleno', () => {
    const top = topOptions(CATEGORY.options.slice(0, 3), [{ key: 'o3', count: 9 }, { key: null, count: 50 }, { key: 'zz', count: 4 }, { key: 'o2', count: 2 }], 3);
    expect(top.map((o) => o.id)).toEqual(['o3', 'o2', 'o1']);
  });
});

describe('transferencia', () => {
  it('par por defecto, elegir e invertir', () => {
    expect(defaultPair(ACCOUNTS, 'banco')).toEqual({ fromId: 'banco', toId: 'caja' });
    expect(defaultPair(ACCOUNTS, 'old')).toEqual({ fromId: 'caja', toId: 'banco' });
    const p = { fromId: 'caja', toId: 'banco' };
    expect(choose(p, 'from', 'banco')).toEqual({ fromId: 'banco', toId: 'caja' });
    expect(swap(p)).toEqual({ fromId: 'banco', toId: 'caja' });
  });
  it('saldos resultantes', () => {
    expect(previewBalances(ACCOUNTS, { fromId: 'caja', toId: 'banco' }, 300_000)).toEqual([
      { accountId: 'caja', name: 'Caja', beforeMinor: 1_240_000, afterMinor: 940_000 },
      { accountId: 'banco', name: 'Banco', beforeMinor: 310_000, afterMinor: 610_000 },
    ]);
    // Al editar, el saldo ya incluye el monto anterior: solo cuenta la diferencia.
    expect(previewBalances(ACCOUNTS, { fromId: 'caja', toId: 'banco' }, 300_000, 200_000)[0]?.afterMinor).toBe(1_140_000);
    expect(previewBalances(ACCOUNTS, { fromId: 'caja', toId: 'caja' }, 1)).toEqual([]);
    expect(validateTransfer({ fromId: 'caja', toId: 'caja' }, 0)).toEqual(['amount', 'same']);
  });
});

describe('tabla de captura', () => {
  const columns = buildColumns(FIELDS, { date: 'Fecha', description: 'Concepto', amount: 'Monto' });
  const ctx = { today: TODAY, locale: 'es-DO', minorDigits: 2 };
  let n = 0;
  const makeId = () => `r${(n += 1)}`;
  const row = (cells: Record<string, string>): GridRow => ({ id: makeId(), cells });

  it('columnas: fecha, concepto, campos activos y monto', () => {
    expect(columns.map((c) => c.key)).toEqual(['date', 'description', 'cat', 'ref', 'due', 'paid', 'qty', 'amount']);
  });

  it('TSV de Excel con comillas, tabuladores y saltos', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('"x\ty"\t"di ""no"""\n\n"multi\nlínea"\t3')).toEqual([['x\ty', 'di "no"'], ['multi\nlínea', '3']]);
    expect(isTabular('1500')).toBe(false);
    expect(isTabular('1500\n')).toBe(false);
    expect(isTabular('1500\t2')).toBe(true);
    expect(isTabular('1\n2')).toBe(true);
  });

  it('pega por posición desde la celda activa y crea filas', () => {
    const rows = [emptyRow('a')];
    const r = applyPaste(rows, { row: 0, col: 1 }, [['Pan', 'Mercancía'], ['Leche', 'Mat']], columns, makeId);
    expect(r.filledRows).toBe(2);
    expect(r.headerUsed).toBe(false);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]?.cells).toEqual({ description: 'Pan', cat: 'Mercancía' });
    expect(r.rows[1]?.cells).toEqual({ description: 'Leche', cat: 'Mat' });
  });

  it('pega por cabeceras cuando la primera fila las nombra', () => {
    const r = applyPaste([emptyRow('a')], { row: 0, col: 4 }, [['Importe', 'Descripción', 'Otra'], ['1,500', 'Cemento', 'x']], columns, makeId);
    expect(r.headerUsed).toBe(true);
    expect(r.rows[0]?.cells).toEqual({ amount: '1,500', description: 'Cemento' });
  });

  it('opciones: exacta, prefijo único y autocompletado', () => {
    expect(resolveOption('materiales', CATEGORY.options)?.id).toBe('o1');
    expect(resolveOption('Elec', CATEGORY.options)?.id).toBe('o3');
    expect(resolveOption('M', CATEGORY.options)).toBeUndefined();
    expect(resolveOption('viejo', CATEGORY.options)).toBeUndefined();
    expect(completeOption('me', CATEGORY.options)).toBe('Mercancía');
    expect(completeOption('', CATEGORY.options)).toBeNull();
  });

  it('fila válida → CaptureRow', () => {
    const r = evaluateRow(row({ date: '15', description: '', cat: 'mat', ref: 'B01', paid: 'sí', qty: '2', amount: '1,500+350' }), 0, columns, ctx);
    expect(r.issues).toEqual([]);
    expect(r.capture).toEqual({
      amount: 185_000,
      description: 'Materiales',
      date: '2026-11-15',
      values: {
        cat: { type: 'list', optionId: 'o1' },
        ref: { type: 'text', value: 'B01' },
        paid: { type: 'bool', value: true },
        qty: { type: 'number', value: 2 },
      },
    });
  });

  it('fila con errores por celda; la vacía se ignora', () => {
    const bad = evaluateRow(row({ date: '31/02', cat: 'nada', paid: 'quizá', qty: 'dos', amount: '' }), 3, columns, ctx);
    expect(bad.capture).toBeNull();
    expect(bad.issues.map((i) => `${i.col}:${i.issue}`)).toEqual(['date:date', 'amount:amount_missing', 'cat:option', 'paid:bool', 'qty:number', 'description:description']);
    expect(evaluateRow(row({ description: '  ' }), 0, columns, ctx).blank).toBe(true);
  });

  it('suma en vivo solo de las válidas', () => {
    const s = evaluateGrid([row({ description: 'A', amount: '100' }), row({ description: 'B', amount: 'uno' }), row({}), row({ description: 'C', amount: '50.25' })], columns, ctx);
    expect(s.sumMinor).toBe(15_025);
    expect(s.validCount).toBe(2);
    expect(s.errorCount).toBe(1);
  });

  it('normaliza celdas al salir y atajos de copia', () => {
    expect(normalizeCell(columns[0]!, 'ayer', ctx)).toBe('26/11/2026');
    expect(normalizeCell(columns[2]!, 'elec', ctx)).toBe('Electricidad');
    expect(normalizeCell(columns[2]!, 'zzz', ctx)).toBe('zzz');
    const rows = [row({ description: 'A', cat: 'Materiales' }), row({})];
    expect(copyFromAbove(rows, 1, 'cat')[1]?.cells).toEqual({ cat: 'Materiales' });
    expect(duplicateAbove(rows, 1)[1]?.cells).toEqual({ description: 'A', cat: 'Materiales' });
    expect(copyFromAbove(rows, 0, 'cat')).toEqual(rows);
  });

  it('una sola fila vacía al final y conservar las no guardadas', () => {
    expect(ensureTrailingRow([row({ description: 'A' })], makeId)).toHaveLength(2);
    expect(ensureTrailingRow([row({ description: 'A' }), row({}), row({})], makeId)).toHaveLength(2);
    expect(ensureTrailingRow([], makeId)).toHaveLength(1);
    const rows = [row({ description: 'A' }), row({ description: 'B' }), row({ description: 'C' })];
    expect(keepUnsaved(rows, [0, 2], makeId).map((r) => r.cells['description'] ?? '')).toEqual(['B', '']);
  });

  it('navegación con flechas y Enter', () => {
    expect(moveFocus({ row: 0, col: 0 }, 'up', 3, 4)).toEqual({ row: 0, col: 0, grow: false });
    expect(moveFocus({ row: 1, col: 3 }, 'right', 3, 4)).toEqual({ row: 1, col: 3, grow: false });
    expect(moveFocus({ row: 2, col: 1 }, 'enter', 3, 4)).toEqual({ row: 3, col: 1, grow: true });
    expect(moveFocus({ row: 0, col: 1 }, 'down', 3, 4)).toEqual({ row: 1, col: 1, grow: false });
  });
});

describe('ráfaga', () => {
  const l = (id: string, minor: number): BurstLine => ({ id, minor, description: id, values: {} });
  it('añadir, corregir, quitar y sumar', () => {
    let lines = upsertLine([], l('a', 100), null);
    lines = upsertLine(lines, l('b', 250), null);
    lines = upsertLine(lines, l('c', 50), 0);
    expect(lines.map((x) => x.id)).toEqual(['c', 'b']);
    expect(sumLines(lines)).toBe(300);
    expect(remaining(1000, 300)).toBe(700);
    expect(remaining(null, 300)).toBeNull();
    expect(removeLine(lines, 0).map((x) => x.id)).toEqual(['b']);
  });
  it('minicinta: las últimas, la más reciente arriba', () => {
    const lines = ['a', 'b', 'c', 'd'].map((id, i) => l(id, i + 1));
    expect(tail(lines).map((x) => `${x.line.id}${x.index}`)).toEqual(['d3', 'c2', 'b1']);
    expect(toCaptureRows([l('a', 5)])).toEqual([{ amount: 5, description: 'a' }]);
  });
  it('total de control: ilegible bloquea, descuadre o filas con error confirman (I-14)', () => {
    const control = (text: string) => parseAmountText(text, 'es-DO', 2);
    expect(controlGate(control('1,500,000 pesos'), null)).toBe('block');
    expect(controlGate(control('10.999'), null, 2)).toBe('block');
    expect(controlGate(control(''), null)).toBe('save');
    expect(controlGate(control(''), null, 1)).toBe('confirm');
    expect(controlGate(control('1,562.49'), remaining(156_249, 156_249))).toBe('save');
    expect(controlGate(control('1,500'), remaining(150_000, 156_249))).toBe('confirm');
  });
});
