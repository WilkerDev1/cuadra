// Importación tabular: CSV y Excel (ARCHITECTURE.md 3.5; PLAN.md "Importar desde Excel").
//
// El servicio trabaja con datos YA tabulares (cabeceras + filas de celdas string/number/Date): la UI parsea
// el CSV con parseCsvText (papaparse) o el .xlsx con read-excel-file y pasa las filas por tableFromRows.
// Flujo: detectar columnas → mapeo editable → vista previa (nada se escribe) → confirmación, que guarda
// todo como UN lote 'import' anulable con UNA acción de historial (transactions.createMany) y nunca toca
// movimientos existentes.
//
// Dinero: siempre Money (enteros en unidad menor). Los números de Excel llegan como double: se pasan a
// texto decimal con 15 cifras significativas (la precisión de Excel) y de ahí a unidad menor sin aritmética
// flotante.
import Papa from 'papaparse';
import { addDays, diffDays, isIsoDate } from '../dates';
import { DomainError, type ErrorCode } from '../errors';
import { MAX_MINOR, Money, type MoneyParseError } from '../money';
import type { SqlExecutor } from '../ports';
import { err, ok, type Result } from '../result';
import {
  toCurrency,
  toField,
  type AccountRecord,
  type FieldOptionRecord,
  type FieldRecord,
  type WorkspaceRecord,
} from '../sql/rows';
import { editDistance, normalizeSearch } from '../text';
import { csvSafeText, csvUnsafeText } from '../export/tabular';
import type { Currency, Direction, Field, FieldValue, FieldValues, Id, IsoDate, Minor, Mutation, Warning } from '../types';
import { mutate, readTx, type CoreDeps } from '../uow';
import type { OpeningInput } from './accounts';
import { createTransactionsService, type CreateManyDraft, type TxDraft } from './transactions';
import { charLength, MAX_DESCRIPTION_LENGTH, MAX_NOTES_LENGTH } from './validation';

// ── Tipos ────────────────────────────────────────────────────────────────────────────

/** Una celda tal como la dan papaparse (string) o read-excel-file (string | number | boolean | Date | null). */
export type Cell = string | number | boolean | Date | null | undefined;

export interface RawTable {
  headers: string[];
  rows: Cell[][];
  /** Solo CSV: delimitador detectado o pedido. */
  delimiter?: string;
  /** Solo CSV leído desde bytes (decodeCsvBytes). */
  encoding?: 'utf-8' | 'latin1';
  source?: 'csv' | 'xlsx';
  /** Fila del archivo donde estaban las cabeceras (0 = primera), tras saltar el preámbulo. */
  headerRowIndex?: number;
}

export type DateFormat = 'auto' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy' | 'd/M/yy' | 'excel_serial';
export type ResolvedDateFormat = Exclude<DateFormat, 'auto'>;

export interface ColumnMapping {
  date: { column: number; format: DateFormat };
  amount:
    | { mode: 'signed'; column: number } // negativo = salida
    | { mode: 'split'; inColumn: number; outColumn: number } // columnas Debe/Haber, Entrada/Salida
    | { mode: 'with_type'; column: number; typeColumn: number; inValues: string[] };
  /** Cómo vienen los números: 'es-DO' (1,234.56), 'es-ES' (1.234,56) o 'auto'. */
  amountLocale: string;
  description: { column: number } | { fixed: string };
  notes?: { column: number };
  /** Columna con el nombre de la cuenta; vacía → la cuenta elegida al importar. */
  account?: { column: number };
  fields: Record<Id, { column: number }>; // listas: el texto se casa con opciones
  /** Alias del usuario para listas: texto (se normaliza) → id de opción existente. */
  optionMap?: Record<Id, Record<string, Id>>;
  createMissingOptions: boolean;
}

export type ImportRowStatus = 'ok' | 'warning' | 'error' | 'duplicate' | 'opening_suspect' | 'empty';

export type ImportIssue =
  | ErrorCode
  | MoneyParseError
  | Warning['code']
  | 'unparseable_date'
  | 'amount_empty'
  | 'both_amounts'
  | 'unknown_account'
  | 'unknown_option'
  | 'invalid_value'
  | 'duplicate_in_file'
  | 'opening_suspect';

/** Fila que se importaría como saldo inicial de su cuenta. */
export type ImportOpening = OpeningInput & { accountId: Id; description: string };

export interface ImportPreviewRow {
  index: number;
  status: ImportRowStatus;
  skipByDefault: boolean;
  /** Movimiento a crear (null si la fila no se puede leer). */
  draft: TxDraft | null;
  /** Si la fila parece un saldo inicial y su cuenta aún no tiene: se importa como saldo inicial. */
  opening: ImportOpening | null;
  issues: ImportIssue[];
  /** Opciones de lista que se crearán al confirmar y se pondrán en esta fila. */
  pendingOptions: Array<{ fieldId: Id; label: string }>;
  duplicateOf: { transactionId: Id; seq: number; date: IsoDate } | null;
  raw: string[];
}

export interface ImportTotals {
  inMinor: Minor;
  outMinor: Minor;
  /** Saldos iniciales (con signo), en su propia línea: nunca suman a entradas/salidas. */
  openingMinor: Minor;
  count: number;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  totals: ImportTotals; // solo filas que se importarían por defecto
  /** Todo lo legible del archivo, se importe o no (duplicados incluidos). */
  fileTotals: ImportTotals;
  newOptions: Array<{ fieldId: Id; label: string; rowCount: number; similar: Array<{ id: Id; label: string }> }>;
  accountHasOpening: boolean;
  resolved: { dateFormat: ResolvedDateFormat; amountLocale: string };
}

export interface ImportPreviewResult extends ImportPreview {
  /** Total neto declarado del archivo − neto a importar (null si no se declaró). */
  fileTotalDifferenceMinor: Minor | null;
  fileTotalDifference: { netMinor: Minor | null; inMinor: Minor | null; outMinor: Minor | null };
}

export type ColumnKind =
  | 'date'
  | 'amount'
  | 'amount_in'
  | 'amount_out'
  | 'type'
  | 'description'
  | 'notes'
  | 'account'
  | 'field'
  | 'balance'
  | 'unknown';

export interface ColumnGuess {
  column: number;
  header: string;
  kind: ColumnKind;
  fieldId?: Id;
  /** 'header': por el nombre de la columna; 'content': por lo que contiene. */
  confidence: 'header' | 'content' | 'none';
}

export interface ImportCsvService {
  parse(text: string, opts?: { delimiter?: string }): RawTable; // papaparse, detecta delimitador
  /** Bytes de un .csv → texto (UTF-8 o, si no lo es, windows-1252). */
  decode(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'latin1' };
  /** Filas de read-excel-file (u otra hoja) → RawTable, saltando el preámbulo. */
  fromRows(rows: readonly (readonly Cell[])[], opts?: { headerRow?: number }): RawTable;
  detectColumns(raw: RawTable, fields?: Field[]): ColumnGuess[];
  suggestMapping(raw: RawTable, fields: Field[]): Partial<ColumnMapping>; // "Fecha", "Monto", "Débito", "Concepto"...
  preview(
    workspaceId: Id,
    accountId: Id,
    raw: RawTable,
    mapping: ColumnMapping,
    opts?: { fileTotalMinor?: Minor; fileTotalInMinor?: Minor; fileTotalOutMinor?: Minor },
  ): Promise<ImportPreviewResult>;
  /** Nada se guarda antes de esto. Crea opciones nuevas + un lote 'import'. Nunca toca movimientos existentes. */
  commit(
    workspaceId: Id,
    accountId: Id,
    preview: ImportPreview,
    opts: { include: number[] /* índices de filas */; fileName: string; mapping: ColumnMapping },
  ): Promise<Mutation<{ batchId: Id; imported: number; skipped: number; createdOptions: number }>>;
  /** CSV modelo con las columnas de los campos del espacio (Frappe Books). */
  templateCsv(workspaceId: Id): Promise<string>;
  /** Lo mismo como tabla, para escribir un .xlsx con write-excel-file. */
  templateTable(workspaceId: Id): Promise<{ headers: string[]; rows: string[][] }>;
}

// ── Lectura de archivos ──────────────────────────────────────────────────────────────

const isBlank = (c: Cell): boolean => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');

/** Fila de cabeceras: la primera con suficientes celdas de texto (salta títulos y datos del banco). */
export function findHeaderRow(rows: readonly (readonly Cell[])[]): number {
  const scan = rows.slice(0, 30);
  const filled = scan.map((r) => r.filter((c) => !isBlank(c)).length);
  const max = Math.max(0, ...filled);
  if (max === 0) return 0;
  const need = Math.max(Math.min(2, max), Math.ceil(max * 0.6));
  for (let i = 0; i < scan.length; i++) {
    const row = scan[i] as readonly Cell[];
    if ((filled[i] ?? 0) < need) continue;
    const texts = row.filter((c) => typeof c === 'string' && c.trim() !== '' && !looksNumeric(c) && parseDateCell(c, 'auto') === null);
    if (texts.length >= Math.ceil((filled[i] ?? 0) / 2)) return i;
  }
  return 0;
}

function looksNumeric(s: string): boolean {
  return /^[\s(+\-−]*[\d.,\s]+\)?\s*-?$/.test(s) && /\d/.test(s);
}

/** Construye la tabla a partir de filas: cabeceras, filas de datos del mismo ancho y sin filas vacías. */
export function tableFromRows(
  rows: readonly (readonly Cell[])[],
  opts: { headerRow?: number; source?: 'csv' | 'xlsx' } = {},
): RawTable {
  const headerRowIndex = opts.headerRow ?? findHeaderRow(rows);
  const headerCells = rows[headerRowIndex] ?? [];
  const body = rows.slice(headerRowIndex + 1);
  // Bucle y no Math.max(...body): esparcir 120 000+ filas en argumentos desborda la pila.
  let width = headerCells.length;
  for (const r of body) if (r.length > width) width = r.length;
  const headers = Array.from({ length: width }, (_, i) => cellToText(headerCells[i]).trim());
  const source = opts.source ?? 'xlsx';
  const pad: Cell = source === 'csv' ? '' : null;
  const data = body
    .filter((r) => r.some((c) => !isBlank(c)))
    .map((r) => Array.from({ length: width }, (_, i) => (i < r.length ? r[i] : pad)));
  return { headers, rows: data, source, headerRowIndex };
}

/** CSV → tabla con papaparse: detecta delimitador (, ; tab |), quita el BOM y salta el preámbulo. */
export function parseCsvText(text: string, opts: { delimiter?: string } = {}): RawTable {
  const clean = text.replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(clean, {
    delimiter: opts.delimiter ?? '',
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: false,
  });
  // Quita el apóstrofo que pone csvSafeText al exportar (cabeceras incluidas: el CSV modelo y los exportados
  // llevan los nombres de campo protegidos y deben volver a reconocerse).
  const rows = (parsed.data.filter((r) => Array.isArray(r)) as string[][]).map((r) => r.map(csvUnsafeText));
  // papaparse deja una fila [''] por el salto de línea final.
  const table = tableFromRows(rows, { source: 'csv' });
  return { ...table, delimiter: parsed.meta.delimiter };
}

/** Bytes de un .csv → texto. UTF-8 (con o sin BOM) si es válido; si no, windows-1252 (latin1 de Excel). */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'latin1' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'latin1' };
  }
}

function cellToText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return isoFromJsDate(c) ?? '';
  if (typeof c === 'boolean') return c ? 'true' : 'false';
  return String(c);
}

// ── Fechas ───────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

function isoFromParts(y: number, m: number, d: number): IsoDate | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999) return null;
  const iso = `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** read-excel-file entrega las fechas a medianoche UTC; un Date local se lee en hora local. */
function isoFromJsDate(d: Date): IsoDate | null {
  if (Number.isNaN(d.getTime())) return null;
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return utcMidnight
    ? isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    : isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Serial de Excel (días desde 1899-12-30; la parte decimal es la hora y se ignora). */
function isoFromSerial(n: number): IsoDate | null {
  if (!Number.isFinite(n) || n < 1 || n >= 2958466) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function expandYear(y: string, todayYear: number): number {
  if (y.length === 4) return Number(y);
  if (y.length !== 2) return Number.NaN;
  const n = Number(y);
  return n <= (todayYear % 100) + 20 ? 2000 + n : 1900 + n;
}

const TIME_SUFFIX = /[t ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?(\s*[ap]\.?\s*m\.?)?$/;

function parseDateText(input: string, format: DateFormat, todayYear: number): IsoDate | null {
  let s = normalizeSearch(input);
  if (s === '') return null;
  s = s.replace(TIME_SUFFIX, '').trim();
  if (/^\d+$/.test(s)) {
    if (s.length === 8) return isoFromParts(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    if ((format === 'excel_serial' || format === 'auto') && s.length <= 6) return isoFromSerial(Number(s));
    return null;
  }
  const tokens = s
    .replace(/\bdel?\b/g, ' ')
    .split(/[\s/\-.,]+/)
    .filter((t) => t !== '');
  if (tokens.length !== 3) return null;
  const monthAt = tokens.findIndex((t) => /^[a-z]+$/.test(t));
  if (monthAt >= 0) {
    const name = tokens[monthAt] as string;
    const month = MONTHS[name] ?? MONTHS[name.slice(0, 3)];
    if (month === undefined) return null;
    const rest = tokens.filter((_, i) => i !== monthAt);
    if (!rest.every((t) => /^\d+$/.test(t))) return null;
    const [a = '', b = ''] = rest;
    // "15 mar 2026", "mar 15 2026" o "2026 mar 15".
    if (a.length === 4) return isoFromParts(Number(a), month, Number(b));
    return isoFromParts(expandYear(b, todayYear), month, Number(a));
  }
  if (!tokens.every((t) => /^\d+$/.test(t))) return null;
  const [a = '', b = '', c = ''] = tokens;
  if (a.length === 4) return isoFromParts(Number(a), Number(b), Number(c));
  if (a.length > 2 || b.length > 2) return null;
  if (format === 'MM/dd/yyyy') return isoFromParts(expandYear(c, todayYear), Number(a), Number(b));
  return isoFromParts(expandYear(c, todayYear), Number(b), Number(a));
}

/**
 * Celda → fecha 'YYYY-MM-DD' real (valida el calendario: "31/02" no existe) o null si es ilegible.
 * Acepta Date, serial de Excel (número o texto), aaaammdd, a-m-d (siempre), d/m/a o m/d/a según
 * `format`, años de dos cifras, meses en texto ("15-MAR-26", "15 de marzo de 2026") y hora al final.
 */
export function parseDateCell(cell: Cell, format: DateFormat, opts: { today?: IsoDate } = {}): IsoDate | null {
  const todayYear = opts.today !== undefined ? Number(opts.today.slice(0, 4)) : new Date().getFullYear();
  if (cell === null || cell === undefined || typeof cell === 'boolean') return null;
  if (cell instanceof Date) return isoFromJsDate(cell);
  if (typeof cell === 'number') {
    if (Number.isInteger(cell) && cell >= 19000101 && cell <= 29991231) {
      const s = String(cell);
      return isoFromParts(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    }
    return isoFromSerial(cell);
  }
  return parseDateText(cell, format, todayYear);
}

/** Formato de fecha más probable de una columna. Ambiguo (todo ≤ 12) → día primero, como en es-DO. */
export function detectDateFormat(cells: readonly Cell[]): ResolvedDateFormat {
  let iso = 0;
  let slash = 0;
  let dayFirst = 0;
  let monthFirst = 0;
  let twoDigit = 0;
  let serial = 0;
  for (const c of cells) {
    if (typeof c === 'number') {
      serial++;
      continue;
    }
    if (typeof c !== 'string') continue;
    const s = normalizeSearch(c).replace(TIME_SUFFIX, '').trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) {
      iso++;
      continue;
    }
    if (/^\d{5}$/.test(s)) {
      serial++;
      continue;
    }
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!m) continue;
    slash++;
    if (Number(m[1]) > 12) dayFirst++;
    if (Number(m[2]) > 12) monthFirst++;
    if ((m[3] ?? '').length === 2) twoDigit++;
  }
  if (monthFirst > 0 && dayFirst === 0) return 'MM/dd/yyyy';
  if (slash === 0 && iso > 0) return 'yyyy-MM-dd';
  if (slash === 0 && iso === 0 && serial > 0) return 'excel_serial';
  if (slash > 0 && twoDigit === slash) return 'd/M/yy';
  return 'dd/MM/yyyy';
}

// ── Montos ───────────────────────────────────────────────────────────────────────────

/** ¿Los números de la columna usan coma decimal (1.234,56 → 'es-ES') o punto (1,234.56 → 'es-DO')? */
export function detectNumberLocale(cells: readonly Cell[]): string {
  let comma = 0;
  let dot = 0;
  for (const c of cells) {
    if (typeof c !== 'string') continue;
    const s = c.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) continue;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) comma += 2;
      else dot += 2;
    } else if (lastComma >= 0) {
      if (/,\d{1,2}$/.test(s)) comma += 2;
      else if (/,\d{3}$/.test(s)) dot += 1;
    } else if (lastDot >= 0) {
      if (/\.\d{1,2}$/.test(s)) dot += 2;
      else if (/\.\d{3}$/.test(s)) comma += 1;
    }
  }
  return comma > dot ? 'es-ES' : 'es-DO';
}

/** double de Excel → texto decimal con la precisión de Excel (15 cifras): 0.30000000000000004 → "0.3". */
function numberToDecimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const text = String(Number(n.toPrecision(15)));
  return /e/i.test(text) ? null : text;
}

/**
 * Celda → monto con signo en unidad menor. Texto con Money.parse del locale (símbolo, grupos, paréntesis y
 * "-" final = negativo); sufijos de banco "CR" (positivo) y "DB"/"DR" (negativo). Números de Excel vía
 * texto decimal, sin aritmética flotante.
 */
export function parseAmountCell(cell: Cell, locale: string, currency: Currency): Result<Minor, MoneyParseError> {
  if (cell === null || cell === undefined || typeof cell === 'boolean' || cell instanceof Date) {
    return cell instanceof Date || typeof cell === 'boolean' ? err('not_a_number') : err('empty');
  }
  if (typeof cell === 'number') {
    const text = numberToDecimal(cell);
    if (text === null) return err(Math.abs(cell) >= 1 ? 'too_large' : 'too_many_decimals');
    return Money.fromDecimalString(text, currency.minorDigits);
  }
  let s = cell.trim();
  if (s === '') return err('empty');
  let forceNegative = false;
  const suffix = /\s*\b(cr|db|dr|deb)\.?$/i.exec(s);
  if (suffix) {
    forceNegative = (suffix[1] ?? '').toLowerCase() !== 'cr';
    s = s.slice(0, suffix.index).trim();
  }
  const r = Money.parse(s, { locale, currency, allowNegative: true });
  if (!r.ok) return r;
  return ok(forceNegative && r.value > 0 ? -r.value : r.value);
}

function separatorsOf(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/** Campo de tipo número (cantidades, no dinero): admite el separador decimal del locale. */
function parseNumberValue(cell: Cell, locale: string): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const { group, decimal } = separatorsOf(locale);
  const s = cell.replace(/\s/g, '').split(group === '.' || group === ',' ? group : '\u0000').join('').replace(decimal, '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

const TRUE_WORDS = new Set(['si', 's', 'yes', 'y', 'true', 'verdadero', '1', 'x', '✓', '✔', 'ok']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'falso', '0']);

// ── Detección de columnas ────────────────────────────────────────────────────────────

const normHeader = (h: string): string => normalizeSearch(h).replace(/[^a-z0-9]+/g, ' ').trim();

const DATE_WORDS = ['fecha', 'date', 'dia', 'f operacion', 'f valor'];
const AMOUNT_WORDS = ['monto', 'importe', 'valor', 'amount', 'total'];
const IN_WORDS = ['credito', 'creditos', 'abono', 'abonos', 'deposito', 'depositos', 'entrada', 'entradas', 'ingreso', 'ingresos', 'cobro', 'cobros', 'debe'];
const OUT_WORDS = ['debito', 'debitos', 'cargo', 'cargos', 'retiro', 'retiros', 'salida', 'salidas', 'egreso', 'egresos', 'gasto', 'gastos', 'pago', 'pagos', 'haber'];
const TYPE_WORDS = ['tipo', 'naturaleza', 'movimiento', 'd c', 'dc', 'db cr', 'type'];
const DESC_WORDS = ['descripcion', 'concepto', 'detalle', 'glosa', 'description', 'motivo', 'transaccion', 'beneficiario', 'nombre'];
const NOTES_WORDS = ['notas', 'nota', 'observaciones', 'observacion', 'comentario', 'comentarios', 'memo', 'notes'];
const ACCOUNT_WORDS = ['cuenta', 'account'];
const CATEGORY_WORDS = ['categoria', 'categorias', 'rubro', 'clasificacion', 'partida', 'category'];
const BALANCE_WORDS = ['saldo', 'balance'];
const IN_TYPE_VALUES = new Set(['entrada', 'entradas', 'ingreso', 'ingresos', 'credito', 'c', 'cr', 'abono', 'deposito', 'in', 'income', '+']);

const headerIs = (h: string, words: readonly string[]) => words.some((w) => h === w || h.startsWith(`${w} `));

const PROBE_CURRENCY: Currency = { code: 'XXX', minorDigits: 3 };

function columnCells(raw: RawTable, column: number): Cell[] {
  return raw.rows.map((r) => r[column]).filter((c) => !isBlank(c));
}

/** Columnas probables por cabecera y, si no, por contenido. */
export function detectColumns(raw: RawTable, fields: readonly Field[] = []): ColumnGuess[] {
  const guesses: ColumnGuess[] = raw.headers.map((header, column) => {
    const h = normHeader(header);
    const field = fields.find((f) => h !== '' && (normHeader(f.label) === h || normHeader(f.key) === h));
    if (field) return { column, header, kind: 'field', fieldId: field.id, confidence: 'header' };
    const kind: ColumnKind = headerIs(h, BALANCE_WORDS)
      ? 'balance'
      : headerIs(h, DATE_WORDS)
        ? 'date'
        : headerIs(h, IN_WORDS)
          ? 'amount_in'
          : headerIs(h, OUT_WORDS)
            ? 'amount_out'
            : headerIs(h, AMOUNT_WORDS)
              ? 'amount'
              : headerIs(h, TYPE_WORDS)
                ? 'type'
                : headerIs(h, DESC_WORDS)
                  ? 'description'
                  : headerIs(h, NOTES_WORDS)
                    ? 'notes'
                    : headerIs(h, ACCOUNT_WORDS)
                      ? 'account'
                      : 'unknown';
    if (kind === 'unknown' && headerIs(h, CATEGORY_WORDS)) {
      const category = fields.find((f) => f.role === 'category' && f.type === 'list');
      if (category) return { column, header, kind: 'field', fieldId: category.id, confidence: 'header' };
    }
    return { column, header, kind, confidence: kind === 'unknown' ? 'none' : 'header' };
  });
  const has = (k: ColumnKind) => guesses.some((g) => g.kind === k);
  for (const g of guesses) {
    if (g.kind !== 'unknown') continue;
    const cells = columnCells(raw, g.column);
    if (cells.length === 0) continue;
    const ratio = (pred: (c: Cell) => boolean) => cells.filter(pred).length / cells.length;
    const locale = detectNumberLocale(cells);
    if (!has('date') && ratio((c) => parseDateCell(c, 'auto') !== null && !(typeof c === 'number' && c < 20000)) >= 0.8) {
      Object.assign(g, { kind: 'date', confidence: 'content' });
    } else if (!has('amount') && !has('amount_in') && ratio((c) => parseAmountCell(c, locale, PROBE_CURRENCY).ok) >= 0.8) {
      Object.assign(g, { kind: 'amount', confidence: 'content' });
    } else if (!has('description') && ratio((c) => typeof c === 'string' && /\p{L}/u.test(c)) >= 0.8) {
      Object.assign(g, { kind: 'description', confidence: 'content' });
    }
  }
  return guesses;
}

function suggest(raw: RawTable, fields: readonly Field[]): Partial<ColumnMapping> {
  const guesses = detectColumns(raw, fields);
  const first = (k: ColumnKind) => guesses.find((g) => g.kind === k)?.column;
  const out: Partial<ColumnMapping> = { fields: {}, createMissingOptions: true };
  const date = first('date');
  if (date !== undefined) out.date = { column: date, format: detectDateFormat(columnCells(raw, date)) };
  const inCol = first('amount_in');
  const outCol = first('amount_out');
  const amount = first('amount');
  const type = first('type');
  let amountCells: Cell[] = [];
  if (inCol !== undefined && outCol !== undefined) {
    out.amount = { mode: 'split', inColumn: inCol, outColumn: outCol };
    amountCells = [...columnCells(raw, inCol), ...columnCells(raw, outCol)];
  } else if (amount !== undefined && type !== undefined) {
    const seen = new Map<string, string>();
    for (const c of columnCells(raw, type)) {
      const n = normalizeSearch(cellToText(c));
      if (IN_TYPE_VALUES.has(n) && !seen.has(n)) seen.set(n, cellToText(c).trim());
    }
    out.amount = { mode: 'with_type', column: amount, typeColumn: type, inValues: [...seen.values()] };
    amountCells = columnCells(raw, amount);
  } else {
    const single = amount ?? inCol ?? outCol;
    if (single !== undefined) {
      out.amount = { mode: 'signed', column: single };
      amountCells = columnCells(raw, single);
    }
  }
  out.amountLocale = detectNumberLocale(amountCells);
  const desc = first('description');
  if (desc !== undefined) out.description = { column: desc };
  const notes = first('notes');
  if (notes !== undefined) out.notes = { column: notes };
  const account = first('account');
  if (account !== undefined) out.account = { column: account };
  const mapped: Record<Id, { column: number }> = {};
  for (const g of guesses) {
    if (g.kind === 'field' && g.fieldId !== undefined && mapped[g.fieldId] === undefined) mapped[g.fieldId] = { column: g.column };
  }
  out.fields = mapped;
  return out;
}

// ── Contexto de la BD ────────────────────────────────────────────────────────────────

interface Ctx {
  currency: Currency;
  accounts: AccountRecord[];
  fields: Field[];
  openings: Map<Id, IsoDate>;
}

async function loadCtx(tx: SqlExecutor, workspaceId: Id, accountId: Id): Promise<Ctx> {
  const ws = await tx.get<WorkspaceRecord>('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
  if (ws === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
  if (ws.archived_at !== null) throw new DomainError('workspace_archived', { id: workspaceId });
  const account = await tx.get<AccountRecord>('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (account === undefined) throw new DomainError('not_found', { entity: 'account', id: accountId });
  if (account.workspace_id !== workspaceId) throw new DomainError('workspace_mismatch', { accountId });
  if (account.archived_at !== null) throw new DomainError('account_archived', { accountId });
  const accounts = await tx.all<AccountRecord>('SELECT * FROM accounts WHERE workspace_id = ? ORDER BY sort_order, id', [workspaceId]);
  const fieldRows = await tx.all<FieldRecord>('SELECT * FROM fields WHERE workspace_id = ? ORDER BY sort_order, id', [workspaceId]);
  const options = await tx.all<FieldOptionRecord>(
    'SELECT o.* FROM field_options o JOIN fields f ON f.id = o.field_id WHERE f.workspace_id = ? ORDER BY o.sort_order, o.id',
    [workspaceId],
  );
  const openingRows = await tx.all<{ account_id: string; date: string }>(
    "SELECT account_id, date FROM transactions WHERE workspace_id = ? AND kind = 'opening'",
    [workspaceId],
  );
  return {
    currency: toCurrency(ws),
    accounts,
    fields: fieldRows.map((f) => toField(f, options)),
    openings: new Map(openingRows.map((r) => [r.account_id, r.date])),
  };
}

const OPENING_RE =
  /^(saldo|balance)( (inicial|anterior|de apertura|apertura|al inicio|previo|arrastrado|traspasado|initial|opening|forward))|^(opening balance|apertura de cuenta|saldo$)/;

const ERROR_ISSUES = new Set<ImportIssue>([
  'unparseable_date',
  'amount_empty',
  'both_amounts',
  'unknown_account',
  'account_archived',
  'description_required',
  'text_too_long',
  'empty',
  'not_a_number',
  'too_many_decimals',
  'too_large',
  'negative_not_allowed',
]);

function similarDescription(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return editDistance(a, b) <= Math.max(2, Math.floor(Math.min(a.length, b.length) / 5));
}

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createImportCsvService(deps: CoreDeps): ImportCsvService {
  const transactions = createTransactionsService(deps);

  async function templateHeaders(workspaceId: Id): Promise<string[]> {
    const ws = await deps.driver.get('SELECT id FROM workspaces WHERE id = ?', [workspaceId]);
    if (ws === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
    const fields = await deps.driver.all<{ label: string }>(
      'SELECT label FROM fields WHERE workspace_id = ? AND deactivated_at IS NULL ORDER BY sort_order, id',
      [workspaceId],
    );
    return ['Fecha', 'Descripción', 'Entrada', 'Salida', 'Cuenta', 'Notas', ...fields.map((f) => f.label)];
  }

  async function preview(
    workspaceId: Id,
    accountId: Id,
    raw: RawTable,
    mapping: ColumnMapping,
    opts: { fileTotalMinor?: Minor; fileTotalInMinor?: Minor; fileTotalOutMinor?: Minor } = {},
  ): Promise<ImportPreviewResult> {
    const today = deps.clock.today();
    const ctx = await readTx(deps, (tx) => loadCtx(tx, workspaceId, accountId));
    for (const fieldId of Object.keys(mapping.fields)) {
      if (!ctx.fields.some((f) => f.id === fieldId)) throw new DomainError('not_found', { entity: 'field', id: fieldId });
    }
    const at = (row: Cell[], column: number | undefined): Cell => (column === undefined ? null : row[column]);

    const dateFormat: ResolvedDateFormat =
      mapping.date.format === 'auto' ? detectDateFormat(columnCells(raw, mapping.date.column)) : mapping.date.format;
    const amountColumns =
      mapping.amount.mode === 'split' ? [mapping.amount.inColumn, mapping.amount.outColumn] : [mapping.amount.column];
    const amountLocale =
      mapping.amountLocale === 'auto' || mapping.amountLocale === ''
        ? detectNumberLocale(amountColumns.flatMap((c) => columnCells(raw, c)))
        : mapping.amountLocale;
    const parseAmount = (c: Cell) => parseAmountCell(c, amountLocale, ctx.currency);
    const inValues = new Set(mapping.amount.mode === 'with_type' ? mapping.amount.inValues.map((v) => normalizeSearch(v)) : []);
    const accountsByName = new Map(ctx.accounts.map((a) => [normalizeSearch(a.name), a]));
    // Varias cuentas con el mismo nombre (una archivada): gana la activa.
    for (const a of ctx.accounts) if (a.archived_at === null) accountsByName.set(normalizeSearch(a.name), a);
    const optionAliases = new Map<Id, Map<string, Id>>();
    for (const [fieldId, aliases] of Object.entries(mapping.optionMap ?? {})) {
      optionAliases.set(fieldId, new Map(Object.entries(aliases).map(([k, v]) => [normalizeSearch(k), v])));
    }
    const newOptions = new Map<string, { fieldId: Id; label: string; rowCount: number }>();

    const rows: ImportPreviewRow[] = raw.rows.map((row, index) => {
      const issues = new Set<ImportIssue>();
      const pendingOptions: Array<{ fieldId: Id; label: string }> = [];
      const rawText = row.map(cellToText);
      const base: ImportPreviewRow = {
        index,
        status: 'empty',
        skipByDefault: true,
        draft: null,
        opening: null,
        issues: [],
        pendingOptions,
        duplicateOf: null,
        raw: rawText,
      };
      if (row.every(isBlank)) return base;

      const date = parseDateCell(at(row, mapping.date.column), dateFormat, { today });
      if (date === null) issues.add('unparseable_date');

      let signed: Minor | null = null;
      if (mapping.amount.mode === 'split') {
        const inCell = at(row, mapping.amount.inColumn);
        const outCell = at(row, mapping.amount.outColumn);
        const a = parseAmount(inCell);
        const b = parseAmount(outCell);
        const aEmpty = !a.ok && a.error === 'empty';
        const bEmpty = !b.ok && b.error === 'empty';
        if (aEmpty && bEmpty) issues.add('amount_empty');
        else if (!a.ok && !aEmpty) issues.add(a.error);
        else if (!b.ok && !bEmpty) issues.add(b.error);
        else {
          const inV = a.ok ? a.value : 0;
          const outV = b.ok ? b.value : 0;
          if (inV !== 0 && outV !== 0) issues.add('both_amounts');
          else signed = Money.sub(inV, outV);
        }
      } else {
        const r = parseAmount(at(row, mapping.amount.column));
        if (!r.ok) issues.add(r.error === 'empty' ? 'amount_empty' : r.error);
        else if (mapping.amount.mode === 'with_type') {
          const isIn = inValues.has(normalizeSearch(cellToText(at(row, mapping.amount.typeColumn))));
          const abs = r.value < 0 ? -r.value : r.value;
          signed = isIn ? abs : -abs;
        } else signed = r.value;
      }

      let rowAccount = accountId;
      if (mapping.account !== undefined) {
        const name = normalizeSearch(cellToText(at(row, mapping.account.column)));
        if (name !== '') {
          const found = accountsByName.get(name);
          if (found === undefined) issues.add('unknown_account');
          else if (found.archived_at !== null) issues.add('account_archived');
          else rowAccount = found.id;
        }
      }

      const description =
        'fixed' in mapping.description
          ? mapping.description.fixed.trim()
          : cellToText(at(row, mapping.description.column)).replace(/\s+/g, ' ').trim();
      if (description === '') issues.add('description_required');
      const notes = mapping.notes ? cellToText(at(row, mapping.notes.column)).trim() : '';
      if (charLength(description) > MAX_DESCRIPTION_LENGTH || charLength(notes) > MAX_NOTES_LENGTH) issues.add('text_too_long');

      const values: FieldValues = {};
      for (const [fieldId, { column }] of Object.entries(mapping.fields)) {
        const field = ctx.fields.find((f) => f.id === fieldId) as Field;
        const cell = at(row, column);
        if (isBlank(cell)) continue;
        if (!field.active) {
          issues.add('field_inactive');
          continue;
        }
        let value: FieldValue | null = null;
        switch (field.type) {
          case 'text':
            value = { type: 'text', value: cellToText(cell).trim() };
            break;
          case 'number': {
            const n = parseNumberValue(cell, amountLocale);
            if (n === null) issues.add('invalid_value');
            else value = { type: 'number', value: n };
            break;
          }
          case 'date': {
            const d = parseDateCell(cell, 'auto', { today });
            if (d === null) issues.add('invalid_value');
            else value = { type: 'date', value: d };
            break;
          }
          case 'bool': {
            const word = typeof cell === 'boolean' ? (cell ? 'true' : 'false') : normalizeSearch(cellToText(cell));
            if (TRUE_WORDS.has(word)) value = { type: 'bool', value: true };
            else if (FALSE_WORDS.has(word)) value = { type: 'bool', value: false };
            else issues.add('invalid_value');
            break;
          }
          case 'list': {
            const label = cellToText(cell).replace(/\s+/g, ' ').trim();
            const key = normalizeSearch(label);
            const alias = optionAliases.get(fieldId)?.get(key);
            let option = alias !== undefined ? field.options.find((o) => o.id === alias) : field.options.find((o) => normalizeSearch(o.label) === key && o.active);
            if (option === undefined && alias === undefined) option = field.options.find((o) => normalizeSearch(o.label) === key);
            // Opción fusionada: se sigue la cadena hasta la activa.
            for (let hops = 0; option !== undefined && !option.active && option.mergedIntoId !== null && hops < 10; hops++) {
              const next = option.mergedIntoId;
              option = field.options.find((o) => o.id === next);
            }
            if (option !== undefined) {
              if (option.active) value = { type: 'list', optionId: option.id };
              else issues.add('option_inactive');
            } else if (mapping.createMissingOptions) {
              pendingOptions.push({ fieldId, label });
              const k = `${fieldId}|${key}`;
              const entry = newOptions.get(k);
              if (entry) entry.rowCount++;
              else newOptions.set(k, { fieldId, label, rowCount: 1 });
            } else issues.add('unknown_option');
            break;
          }
        }
        if (value !== null && !(value.type === 'text' && value.value === '')) values[fieldId] = value;
      }

      if (signed === 0) issues.add('zero_amount');
      if (date !== null) {
        // Una importación suele traer meses de historia: solo se avisa de lo que parece un error de tecleo
        // (más de 90 días en el futuro o más de 10 años atrás).
        const ahead = diffDays(today, date);
        if (ahead > 90 || ahead < -3650) issues.add('far_date');
        const openingDate = ctx.openings.get(rowAccount);
        if (openingDate !== undefined && date < openingDate) issues.add('before_opening');
      }

      const hasError = [...issues].some((i) => ERROR_ISSUES.has(i));
      const draft: TxDraft | null =
        !hasError && date !== null && signed !== null
          ? {
              accountId: rowAccount,
              kind: signed < 0 ? 'expense' : 'income',
              amountMinor: signed < 0 ? -signed : signed,
              date,
              description,
              ...(notes !== '' ? { notes } : {}),
              values,
            }
          : null;
      return {
        ...base,
        status: hasError ? 'error' : issues.size > 0 ? 'warning' : 'ok',
        skipByDefault: hasError,
        draft,
        issues: [...issues],
      };
    });

    // Suma exacta del archivo: una fila que haría pasar la suma de montos de MAX_MINOR es ilegible (too_large),
    // así los totales de la vista previa nunca salen de los enteros seguros (sin RangeError).
    let volume = 0n;
    for (const r of rows) {
      if (r.draft === null) continue;
      if (volume + BigInt(r.draft.amountMinor) > BigInt(MAX_MINOR)) {
        r.status = 'error';
        r.skipByDefault = true;
        r.draft = null;
        r.issues = [...r.issues, 'too_large'];
        continue;
      }
      volume += BigInt(r.draft.amountMinor);
    }

    // Saldos iniciales: una fila "Saldo anterior/inicial" no es una entrada. Si la cuenta ya tiene saldo
    // inicial se salta (no se cuenta dos veces); si no, la primera se importa como saldo inicial.
    const openingTaken = new Set<Id>(ctx.openings.keys());
    for (const r of rows) {
      if (r.draft === null || !OPENING_RE.test(normalizeSearch(r.draft.description))) continue;
      const d = r.draft;
      r.status = 'opening_suspect';
      r.issues = r.issues.filter((i) => i !== 'before_opening');
      if (openingTaken.has(d.accountId)) {
        r.skipByDefault = true;
      } else {
        openingTaken.add(d.accountId);
        r.opening = {
          accountId: d.accountId,
          amountMinor: d.amountMinor,
          direction: d.kind === 'income' ? 'in' : 'out',
          date: d.date,
          description: d.description,
        };
      }
    }

    // Duplicados contra lo que ya está en la BD (activos, entradas y salidas).
    const candidates = rows.filter((r) => r.draft !== null && r.status !== 'opening_suspect');
    if (candidates.length > 0) {
      const dates = candidates.map((r) => (r.draft as TxDraft).date).sort();
      const from = addDays(dates[0] as IsoDate, -3);
      const to = addDays(dates[dates.length - 1] as IsoDate, 3);
      const accountIds = [...new Set(candidates.map((r) => (r.draft as TxDraft).accountId))];
      const existing = await deps.driver.all<{
        id: string;
        account_id: string;
        seq: number;
        direction: string;
        amount_minor: number;
        date: string;
        description: string;
      }>(
        `SELECT id, account_id, seq, direction, amount_minor, date, description FROM transactions
         WHERE workspace_id = ? AND status = 'active' AND kind IN ('income', 'expense')
           AND account_id IN (${accountIds.map(() => '?').join(', ')}) AND date BETWEEN ? AND ?
         ORDER BY date, seq`,
        [workspaceId, ...accountIds, from, to],
      );
      const keyOf = (account: string, direction: string, amount: number, date: string, desc: string) =>
        `${account}|${direction}|${String(amount)}|${date}|${normalizeSearch(desc)}`;
      const pool = new Map<string, typeof existing>();
      for (const e of existing) {
        const k = keyOf(e.account_id, e.direction, Number(e.amount_minor), e.date, e.description);
        pool.set(k, [...(pool.get(k) ?? []), e]);
      }
      const seenInFile = new Set<string>();
      for (const r of candidates) {
        const d = r.draft as TxDraft;
        const direction: Direction = d.kind === 'income' ? 'in' : 'out';
        const k = keyOf(d.accountId, direction, d.amountMinor, d.date, d.description);
        const exact = pool.get(k);
        const match = exact?.shift();
        if (match !== undefined) {
          r.status = 'duplicate';
          r.skipByDefault = true;
          r.duplicateOf = { transactionId: match.id, seq: Number(match.seq), date: match.date };
        } else if (seenInFile.has(k)) {
          r.issues.push('duplicate_in_file');
          if (r.status === 'ok') r.status = 'warning';
        } else {
          const desc = normalizeSearch(d.description);
          const near = existing.find(
            (e) =>
              e.account_id === d.accountId &&
              e.direction === direction &&
              Number(e.amount_minor) === d.amountMinor &&
              Math.abs(diffDays(e.date, d.date)) <= 3 &&
              (e.date === d.date || similarDescription(normalizeSearch(e.description), desc)),
          );
          if (near !== undefined) {
            r.issues.push('possible_duplicate');
            r.duplicateOf = { transactionId: near.id, seq: Number(near.seq), date: near.date };
            if (r.status === 'ok') r.status = 'warning';
          }
        }
        seenInFile.add(k);
      }
    }

    const sumUp = (pick: (r: ImportPreviewRow) => boolean): ImportTotals => {
      let inMinor = 0;
      let outMinor = 0;
      let openingMinor = 0;
      let count = 0;
      for (const r of rows) {
        if (r.draft === null || !pick(r)) continue;
        if (r.status === 'opening_suspect') {
          if (r.opening === null) continue;
          openingMinor = Money.add(openingMinor, Money.signed(r.opening.amountMinor, r.opening.direction));
        } else if (r.draft.kind === 'income') inMinor = Money.add(inMinor, r.draft.amountMinor);
        else outMinor = Money.add(outMinor, r.draft.amountMinor);
        count++;
      }
      return { inMinor, outMinor, openingMinor, count };
    };
    const totals = sumUp((r) => !r.skipByDefault);
    const fileTotals = sumUp(() => true);
    const net = Money.sub(totals.inMinor, totals.outMinor);
    const diff = {
      netMinor: opts.fileTotalMinor === undefined ? null : Money.sub(opts.fileTotalMinor, net),
      inMinor: opts.fileTotalInMinor === undefined ? null : Money.sub(opts.fileTotalInMinor, totals.inMinor),
      outMinor: opts.fileTotalOutMinor === undefined ? null : Money.sub(opts.fileTotalOutMinor, totals.outMinor),
    };

    const similarFor = (fieldId: Id, label: string) => {
      const field = ctx.fields.find((f) => f.id === fieldId) as Field;
      const key = normalizeSearch(label);
      return field.options
        .filter((o) => o.active && editDistance(normalizeSearch(o.label), key) <= 2)
        .map((o) => ({ id: o.id, label: o.label }));
    };

    return {
      rows,
      totals,
      fileTotals,
      newOptions: [...newOptions.values()].map((o) => ({ ...o, similar: similarFor(o.fieldId, o.label) })),
      accountHasOpening: ctx.openings.has(accountId),
      resolved: { dateFormat, amountLocale },
      fileTotalDifferenceMinor: diff.netMinor,
      fileTotalDifference: diff,
    };
  }

  async function commit(
    workspaceId: Id,
    accountId: Id,
    previewData: ImportPreview,
    opts: { include: number[]; fileName: string; mapping: ColumnMapping },
  ): Promise<Mutation<{ batchId: Id; imported: number; skipped: number; createdOptions: number }>> {
    const ctx = await readTx(deps, (tx) => loadCtx(tx, workspaceId, accountId));
    const include = new Set(opts.include);
    const openingTaken = new Set<Id>(ctx.openings.keys());
    const chosen: Array<{ row: ImportPreviewRow; draft: CreateManyDraft; accountId: Id }> = [];
    for (const row of previewData.rows) {
      if (!include.has(row.index) || row.draft === null || row.status === 'error' || row.status === 'empty') continue;
      if (row.opening !== null && !openingTaken.has(row.opening.accountId)) {
        openingTaken.add(row.opening.accountId);
        const o = row.opening;
        chosen.push({
          row,
          draft: { kind: 'opening', accountId: o.accountId, amountMinor: o.amountMinor, direction: o.direction, date: o.date, description: o.description },
          accountId: o.accountId,
        });
      } else {
        chosen.push({ row, draft: { ...row.draft, values: { ...row.draft.values } }, accountId: row.draft.accountId });
      }
    }
    if (chosen.length === 0) throw new DomainError('batch_empty');
    const nonEmpty = previewData.rows.filter((r) => r.status !== 'empty').length;
    const skipped = nonEmpty - chosen.length;

    // Opciones nuevas: una por campo y texto normalizado; si ya existe (activa), se reutiliza.
    const wanted = new Map<string, { fieldId: Id; label: string }>();
    for (const { row, draft } of chosen) {
      if (draft.kind === 'opening') continue;
      for (const p of row.pendingOptions) {
        const k = `${p.fieldId}|${normalizeSearch(p.label)}`;
        if (!wanted.has(k)) wanted.set(k, p);
      }
    }
    const optionIds = new Map<string, Id>();
    const created: Id[] = [];
    if (wanted.size > 0) {
      await mutate(deps, workspaceId, 'import.options', async (u) => {
        const now = u.clock.now().toISOString();
        for (const [k, p] of wanted) {
          const field = ctx.fields.find((f) => f.id === p.fieldId);
          if (field === undefined || field.type !== 'list') throw new DomainError('not_found', { entity: 'field', id: p.fieldId });
          if (!field.active) throw new DomainError('field_inactive', { fieldId: p.fieldId });
          const current = await u.tx.all<{ id: string; label: string }>(
            'SELECT id, label FROM field_options WHERE field_id = ? AND deactivated_at IS NULL',
            [p.fieldId],
          );
          const same = current.find((o) => normalizeSearch(o.label) === normalizeSearch(p.label));
          if (same !== undefined) {
            optionIds.set(k, same.id);
            continue;
          }
          const order = await u.tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM field_options WHERE field_id = ?', [p.fieldId]);
          const id = u.ids.next();
          await u.tx.run(
            `INSERT INTO field_options (id, field_id, key, label, color, applies_to, sort_order, deactivated_at, merged_into_id, created_at, updated_at)
             VALUES (?, ?, NULL, ?, NULL, 'both', ?, NULL, NULL, ?, ?)`,
            [id, p.fieldId, p.label, Number(order?.m ?? -1) + 1, now, now],
          );
          optionIds.set(k, id);
          created.push(id);
        }
        if (created.length > 0) u.touch('field_options');
      });
    }
    for (const { row, draft } of chosen) {
      if (draft.kind === 'opening' || !('values' in draft) || draft.values === undefined) continue;
      for (const p of row.pendingOptions) {
        const id = optionIds.get(`${p.fieldId}|${normalizeSearch(p.label)}`);
        if (id !== undefined) draft.values[p.fieldId] = { type: 'list', optionId: id };
      }
    }

    const accountsUsed = new Set(chosen.map((c) => c.accountId));
    const imported = chosen.length;
    try {
      const m = await transactions.createMany({
        workspaceId,
        batch: {
          source: 'import',
          accountId: accountsUsed.size === 1 ? ([...accountsUsed][0] as Id) : null,
          label: opts.fileName,
          meta: {
            fileName: opts.fileName,
            mapping: opts.mapping,
            rows: previewData.rows.length,
            imported,
            skipped,
            createdOptionIds: created,
            rowIndexes: chosen.map((c) => c.row.index),
          },
        },
        drafts: chosen.map((c) => c.draft),
        audit: {
          action: 'import',
          message: 'audit.import.commit',
          params: { fileName: opts.fileName, imported, skipped, createdOptions: created.length },
        },
      });
      return {
        value: { batchId: m.value.batchId, imported, skipped, createdOptions: created.length },
        warnings: m.warnings,
        auditActionId: m.auditActionId,
      };
    } catch (e) {
      // La importación no entró: las opciones recién creadas (sin uso) se retiran para no dejar rastro.
      if (created.length > 0) {
        await mutate(deps, workspaceId, 'import.options.rollback', async (u) => {
          await u.tx.run(
            `DELETE FROM field_options WHERE id IN (${created.map(() => '?').join(', ')})
             AND id NOT IN (SELECT value_option_id FROM transaction_field_values WHERE value_option_id IS NOT NULL)`,
            created,
          );
          u.touch('field_options');
        });
      }
      throw e;
    }
  }

  return {
    parse: (text, opts) => parseCsvText(text, opts),
    decode: (bytes) => decodeCsvBytes(bytes),
    fromRows: (rows, opts) => tableFromRows(rows, opts?.headerRow !== undefined ? { headerRow: opts.headerRow } : {}),
    detectColumns: (raw, fields) => detectColumns(raw, fields),
    suggestMapping: (raw, fields) => suggest(raw, fields),
    preview,
    commit,
    async templateCsv(workspaceId) {
      const headers = await templateHeaders(workspaceId);
      // Los nombres de campo van protegidos contra fórmulas (=, +, -, @); parseCsvText los devuelve tal cual.
      return `﻿${Papa.unparse([headers.map(csvSafeText)], { delimiter: ',', newline: '\r\n' })}\r\n`;
    },
    async templateTable(workspaceId) {
      return { headers: await templateHeaders(workspaceId), rows: [] };
    },
  };
}

// Reexporta para la UI los tipos de valores que viajan en los borradores.
export type { FieldValue, FieldValues } from '../types';
