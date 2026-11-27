// Tabla de captura (DESIGN §10.8): columnas, filas como texto, pegado desde Excel (texto tabulado), navegación y
// conversión de cada fila a `CaptureRow` con sus errores. Todo puro: la tabla guarda texto y esto lo interpreta.
import type { CaptureRow, Field, FieldOption, FieldValue, FieldValues, Id, IsoDate, Minor } from '../../../core';
import { normalizeSearch } from '../../../core';
import { parseAmountText } from './amount';
import { isoToDmy, parseLooseDate } from './dates';
import { resolveDescription } from './entry';

export type ColumnKind = 'date' | 'description' | 'field' | 'amount';

export interface GridColumn {
  key: string;
  kind: ColumnKind;
  label: string;
  field?: Field;
}

export interface GridRow {
  id: string;
  cells: Readonly<Record<string, string>>;
}

export const COL_DATE = 'date';
export const COL_DESCRIPTION = 'description';
export const COL_AMOUNT = 'amount';

/** Fecha | Concepto | [campos del formulario, en su orden] | Monto. */
export function buildColumns(fields: readonly Field[], labels: { date: string; description: string; amount: string }): GridColumn[] {
  return [
    { key: COL_DATE, kind: 'date', label: labels.date },
    { key: COL_DESCRIPTION, kind: 'description', label: labels.description },
    ...fields.filter((f) => f.active).map((f): GridColumn => ({ key: f.id, kind: 'field', label: f.label, field: f })),
    { key: COL_AMOUNT, kind: 'amount', label: labels.amount },
  ];
}

export function emptyRow(id: string): GridRow {
  return { id, cells: {} };
}

export function isRowBlank(row: GridRow): boolean {
  return Object.values(row.cells).every((v) => v.trim() === '');
}

/** Siempre queda UNA fila vacía al final (la fila de entrada abierta), nunca dos seguidas. */
export function ensureTrailingRow(rows: readonly GridRow[], makeId: () => string): GridRow[] {
  const out = [...rows];
  while (out.length > 1 && isRowBlank(out[out.length - 1]!) && isRowBlank(out[out.length - 2]!)) out.pop();
  if (out.length === 0 || !isRowBlank(out[out.length - 1]!)) out.push(emptyRow(makeId()));
  return out;
}

export function setCell(rows: readonly GridRow[], index: number, key: string, value: string): GridRow[] {
  return rows.map((r, i) => (i === index ? { ...r, cells: { ...r.cells, [key]: value } } : r));
}

// ── Pegado ────────────────────────────────────────────────────────────────────────────

/** ¿El texto pegado es una tabla (varias celdas o varias filas) y no un valor suelto? */
export function isTabular(text: string): boolean {
  return /\t/.test(text) || /\r?\n./.test(text.replace(/\r?\n$/, ''));
}

/** Texto tabulado de Excel/Sheets → matriz. Respeta celdas entre comillas (con tabuladores, saltos o `""`). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
    i += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => c.trim()));
}

const SYNONYMS: Record<ColumnKind, string[]> = {
  date: ['fecha', 'dia', 'date'],
  description: ['concepto', 'descripcion', 'detalle', 'description'],
  amount: ['monto', 'importe', 'valor', 'total', 'amount'],
  field: [],
};

function headerIndex(cell: string, columns: readonly GridColumn[]): number {
  const k = normalizeSearch(cell);
  if (k === '') return -1;
  return columns.findIndex((c) => normalizeSearch(c.label) === k || SYNONYMS[c.kind].includes(k));
}

/** ¿La primera fila pegada son cabeceras? (al menos dos celdas que nombran columnas, o una si es la única). */
function headerMap(first: readonly string[], columns: readonly GridColumn[]): number[] | null {
  const map = first.map((c) => headerIndex(c, columns));
  const hits = map.filter((m) => m >= 0).length;
  const filled = first.filter((c) => c.trim() !== '').length;
  return hits >= 2 || (hits === 1 && filled === 1) ? map : null;
}

export interface PasteResult {
  rows: GridRow[];
  /** Filas de la tabla que recibieron datos. */
  filledRows: number;
  headerUsed: boolean;
}

/**
 * Pega una matriz a partir de la celda (`row`, `col`). Si la primera fila son cabeceras («Fecha», «Concepto»,
 * «Monto», el nombre de un campo…), las columnas se asignan por nombre y no por posición.
 */
export function applyPaste(
  rows: readonly GridRow[],
  at: { row: number; col: number },
  matrix: readonly (readonly string[])[],
  columns: readonly GridColumn[],
  makeId: () => string,
): PasteResult {
  if (matrix.length === 0) return { rows: [...rows], filledRows: 0, headerUsed: false };
  const map = headerMap(matrix[0]!, columns);
  const body = map === null ? matrix : matrix.slice(1);
  const target = (j: number) => (map === null ? at.col + j : (map[j] ?? -1));
  const out = [...rows];
  body.forEach((line, i) => {
    const r = at.row + i;
    while (out.length <= r) out.push(emptyRow(makeId()));
    const cells: Record<string, string> = { ...out[r]!.cells };
    line.forEach((value, j) => {
      const c = target(j);
      const col = c >= 0 ? columns[c] : undefined;
      if (col !== undefined) cells[col.key] = value;
    });
    out[r] = { ...out[r]!, cells };
  });
  return { rows: ensureTrailingRow(out, makeId), filledRows: body.length, headerUsed: map !== null };
}

// ── Listas ────────────────────────────────────────────────────────────────────────────

/** Opción por su nombre: exacto (sin tildes ni mayúsculas) o, si es la única que empieza así, por prefijo. */
export function resolveOption(text: string, options: readonly FieldOption[]): FieldOption | undefined {
  const k = normalizeSearch(text);
  if (k === '') return undefined;
  const usable = options.filter((o) => o.active && o.mergedIntoId === null);
  const exact = usable.find((o) => normalizeSearch(o.label) === k);
  if (exact !== undefined) return exact;
  const starts = usable.filter((o) => normalizeSearch(o.label).startsWith(k));
  return starts.length === 1 ? starts[0] : undefined;
}

/** Autocompletado en línea: la primera opción que empieza por lo tecleado, o `null`. */
export function completeOption(typed: string, options: readonly FieldOption[]): string | null {
  const k = normalizeSearch(typed);
  if (k === '') return null;
  const hit = options.find((o) => o.active && o.mergedIntoId === null && normalizeSearch(o.label).startsWith(k));
  return hit?.label ?? null;
}

// ── Fila → CaptureRow ─────────────────────────────────────────────────────────────────

export type CellIssue = 'date' | 'amount' | 'amount_missing' | 'description' | 'option' | 'number' | 'bool';

export interface RowResult {
  index: number;
  blank: boolean;
  /** `null` si la fila está vacía o tiene errores. */
  capture: CaptureRow | null;
  minor: Minor | null;
  issues: Array<{ col: string; issue: CellIssue }>;
}

export interface EvalContext {
  today: IsoDate;
  locale: string;
  minorDigits: number;
}

const YES = new Set(['si', 's', 'x', '1', 'true', 'yes', 'y', 'verdadero']);
const NO = new Set(['no', 'n', '0', 'false', 'falso']);

function fieldValue(field: Field, text: string, ctx: EvalContext): FieldValue | 'bad' | undefined {
  const raw = text.trim();
  if (raw === '') return undefined;
  switch (field.type) {
    case 'text':
      return { type: 'text', value: raw };
    case 'number': {
      const n = raw.replace(/\s|,/g, '');
      return /^-?\d+(\.\d+)?$/.test(n) ? { type: 'number', value: Number(n) } : 'bad';
    }
    case 'date': {
      const d = parseLooseDate(raw, ctx.today);
      return d === null ? 'bad' : { type: 'date', value: d };
    }
    case 'bool': {
      const k = normalizeSearch(raw);
      if (YES.has(k)) return { type: 'bool', value: true };
      if (NO.has(k)) return { type: 'bool', value: false };
      return 'bad';
    }
    case 'list': {
      const o = resolveOption(raw, field.options);
      return o === undefined ? 'bad' : { type: 'list', optionId: o.id };
    }
  }
}

const FIELD_ISSUE: Record<Field['type'], CellIssue> = { text: 'description', number: 'number', date: 'date', list: 'option', bool: 'bool' };

export function evaluateRow(row: GridRow, index: number, columns: readonly GridColumn[], ctx: EvalContext): RowResult {
  if (isRowBlank(row)) return { index, blank: true, capture: null, minor: null, issues: [] };
  const issues: RowResult['issues'] = [];
  const cell = (key: string) => row.cells[key] ?? '';

  let date: IsoDate | undefined;
  if (cell(COL_DATE).trim() !== '') {
    const d = parseLooseDate(cell(COL_DATE), ctx.today);
    if (d === null) issues.push({ col: COL_DATE, issue: 'date' });
    else date = d;
  }

  let minor: Minor | null = null;
  const amount = parseAmountText(cell(COL_AMOUNT), ctx.locale, ctx.minorDigits);
  if (amount.status === 'empty') issues.push({ col: COL_AMOUNT, issue: 'amount_missing' });
  else if (amount.status === 'invalid' || amount.minor <= 0) issues.push({ col: COL_AMOUNT, issue: 'amount' });
  else minor = amount.minor;

  const values: FieldValues = {};
  const fields: Field[] = [];
  for (const col of columns) {
    if (col.kind !== 'field' || col.field === undefined) continue;
    fields.push(col.field);
    const v = fieldValue(col.field, cell(col.key), ctx);
    if (v === 'bad') issues.push({ col: col.key, issue: FIELD_ISSUE[col.field.type] });
    else if (v !== undefined) values[col.field.id] = v;
  }

  const description = resolveDescription(cell(COL_DESCRIPTION), values, fields);
  if (description === '') issues.push({ col: COL_DESCRIPTION, issue: 'description' });

  if (issues.length > 0) return { index, blank: false, capture: null, minor, issues };
  const capture: CaptureRow = {
    amount: minor as Minor,
    description,
    ...(date === undefined ? {} : { date }),
    ...(Object.keys(values).length === 0 ? {} : { values }),
  };
  return { index, blank: false, capture, minor, issues };
}

export interface GridSummary {
  results: RowResult[];
  /** Suma de las filas válidas (las que se guardarían). */
  sumMinor: Minor;
  validCount: number;
  errorCount: number;
}

export function evaluateGrid(rows: readonly GridRow[], columns: readonly GridColumn[], ctx: EvalContext): GridSummary {
  const results = rows.map((r, i) => evaluateRow(r, i, columns, ctx));
  let sum = 0n;
  let validCount = 0;
  let errorCount = 0;
  for (const r of results) {
    if (r.capture !== null && r.minor !== null) {
      sum += BigInt(r.minor);
      validCount += 1;
    } else if (!r.blank) errorCount += 1;
  }
  const sumMinor = sum > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(sum);
  return { results, sumMinor, validCount, errorCount };
}

/** Texto que la celda muestra al salir de ella: fechas a `dd/mm/aaaa`, listas al nombre completo de la opción. */
export function normalizeCell(col: GridColumn, text: string, ctx: EvalContext): string {
  const raw = text.trim();
  if (raw === '') return '';
  if (col.kind === 'date' || (col.kind === 'field' && col.field?.type === 'date')) {
    const d = parseLooseDate(raw, ctx.today);
    return d === null ? text : isoToDmy(d);
  }
  if (col.kind === 'field' && col.field?.type === 'list') return resolveOption(raw, col.field.options)?.label ?? text;
  return text;
}

// ── Atajos de la rejilla ──────────────────────────────────────────────────────────────

/** `Alt+↓`: copia la celda de arriba. */
export function copyFromAbove(rows: readonly GridRow[], index: number, key: string): GridRow[] {
  if (index <= 0) return [...rows];
  return setCell(rows, index, key, rows[index - 1]?.cells[key] ?? '');
}

/** `Ctrl+D`: la fila toma todos los valores de la de arriba. */
export function duplicateAbove(rows: readonly GridRow[], index: number): GridRow[] {
  if (index <= 0) return [...rows];
  const above = rows[index - 1]!;
  return rows.map((r, i) => (i === index ? { ...r, cells: { ...above.cells } } : r));
}

export type Move = 'up' | 'down' | 'left' | 'right' | 'enter';

/** Celda destino. `Enter` baja a la misma columna y, en la última fila, la crea (`grow`). */
export function moveFocus(pos: { row: number; col: number }, move: Move, rowCount: number, colCount: number) {
  const clampRow = (r: number) => Math.min(Math.max(r, 0), rowCount - 1);
  switch (move) {
    case 'up':
      return { row: clampRow(pos.row - 1), col: pos.col, grow: false };
    case 'down':
      return { row: clampRow(pos.row + 1), col: pos.col, grow: false };
    case 'left':
      return { row: pos.row, col: Math.max(pos.col - 1, 0), grow: false };
    case 'right':
      return { row: pos.row, col: Math.min(pos.col + 1, colCount - 1), grow: false };
    case 'enter':
      return pos.row + 1 >= rowCount ? { row: pos.row + 1, col: pos.col, grow: true } : { row: pos.row + 1, col: pos.col, grow: false };
  }
}

/** Ids de filas que sobreviven a un guardado parcial (las que el núcleo no guardó). */
export function keepUnsaved(rows: readonly GridRow[], savedIndexes: readonly number[], makeId: () => string): GridRow[] {
  const saved = new Set(savedIndexes);
  return ensureTrailingRow(rows.filter((_, i) => !saved.has(i)), makeId);
}

/** Valores de campos de un `Id` → texto (para precargar celdas desde una sugerencia o un duplicado). */
export function optionLabel(field: Field, id: Id): string {
  return field.options.find((o) => o.id === id)?.label ?? '';
}
