// Lógica pura del asistente de importación: asignación de columnas ↔ ColumnMapping, filtros y totales de la vista
// previa y textos de celdas. Sin DOM ni React: se prueba en logic.test.ts.
import type {
  Account,
  Cell,
  ColumnMapping,
  DateFormat,
  Field,
  ImportIssue,
  ImportPreviewRow,
  RawTable,
  ResolvedDateFormat,
} from '../../core';

// ── Asignación de columnas ─────────────────────────────────────────────────────────────

/** A qué se destina una columna del archivo. `field:<id>` es un campo personalizado del espacio. */
export type Target =
  | 'ignore'
  | 'date'
  | 'description'
  | 'notes'
  | 'amount'
  | 'in'
  | 'out'
  | 'type'
  | 'account'
  | `field:${string}`;

export const SINGLE_TARGETS: readonly Target[] = ['date', 'description', 'notes', 'amount', 'in', 'out', 'type', 'account'];

export const isFieldTarget = (t: Target): t is `field:${string}` => t.startsWith('field:');
export const fieldIdOf = (t: `field:${string}`): string => t.slice('field:'.length);

/** Asigna un destino a una columna. Un destino único (fecha, monto…) solo puede estar en una columna: se le quita a la otra. */
export function assignTarget(targets: readonly Target[], column: number, target: Target): Target[] {
  const next = targets.map((t, i) => (i === column ? target : t === target && target !== 'ignore' ? ('ignore' as const) : t));
  // Monto único y Entra/Sale son estilos distintos: elegir uno suelta el otro.
  if (target === 'amount') return next.map((t) => (t === 'in' || t === 'out' ? ('ignore' as const) : t));
  if (target === 'in' || target === 'out') return next.map((t) => (t === 'amount' || t === 'type' ? ('ignore' as const) : t));
  return next;
}

/** Destinos por columna a partir de lo que sugiere `importCsv.suggestMapping`. */
export function targetsFromMapping(width: number, mapping: Partial<ColumnMapping>): Target[] {
  const out: Target[] = Array.from({ length: width }, () => 'ignore');
  const put = (column: number | undefined, target: Target) => {
    if (column !== undefined && column >= 0 && column < width && out[column] === 'ignore') out[column] = target;
  };
  put(mapping.date?.column, 'date');
  const amount = mapping.amount;
  if (amount !== undefined) {
    if (amount.mode === 'split') {
      put(amount.inColumn, 'in');
      put(amount.outColumn, 'out');
    } else if (amount.mode === 'with_type') {
      put(amount.column, 'amount');
      put(amount.typeColumn, 'type');
    } else put(amount.column, 'amount');
  }
  if (mapping.description !== undefined && 'column' in mapping.description) put(mapping.description.column, 'description');
  put(mapping.notes?.column, 'notes');
  put(mapping.account?.column, 'account');
  for (const [fieldId, { column }] of Object.entries(mapping.fields ?? {})) put(column, `field:${fieldId}`);
  return out;
}

export interface MapOptions {
  dateFormat: DateFormat;
  /** `auto`, `es-DO` (1,234.56) o `es-ES` (1.234,56). */
  amountLocale: string;
  /** Valores de la columna Tipo que significan entrada. */
  inValues: readonly string[];
  fixedDescription: string;
  createMissingOptions: boolean;
}

export type MappingProblem =
  | 'date_missing'
  | 'amount_missing'
  | 'amount_conflict'
  | 'out_alone'
  | 'type_needs_amount'
  | 'type_values'
  | 'description_missing';

export type MappingResult = { ok: true; mapping: ColumnMapping } | { ok: false; problems: MappingProblem[] };

const columnOf = (targets: readonly Target[], target: Target): number | undefined => {
  const i = targets.indexOf(target);
  return i < 0 ? undefined : i;
};

/** Arma el `ColumnMapping` del servicio con las asignaciones, o explica qué falta. */
export function mappingFromTargets(targets: readonly Target[], opts: MapOptions): MappingResult {
  const problems: MappingProblem[] = [];
  const date = columnOf(targets, 'date');
  const amount = columnOf(targets, 'amount');
  const inCol = columnOf(targets, 'in');
  const outCol = columnOf(targets, 'out');
  const type = columnOf(targets, 'type');
  const description = columnOf(targets, 'description');

  if (date === undefined) problems.push('date_missing');

  let amountMapping: ColumnMapping['amount'] | undefined;
  if (amount !== undefined && (inCol !== undefined || outCol !== undefined)) {
    problems.push('amount_conflict');
  } else if (amount !== undefined) {
    if (type === undefined) amountMapping = { mode: 'signed', column: amount };
    else {
      if (opts.inValues.length === 0) problems.push('type_values');
      amountMapping = { mode: 'with_type', column: amount, typeColumn: type, inValues: [...opts.inValues] };
    }
  } else if (type !== undefined) {
    problems.push('type_needs_amount');
  } else if (inCol !== undefined && outCol !== undefined) {
    amountMapping = { mode: 'split', inColumn: inCol, outColumn: outCol };
  } else if (inCol !== undefined) {
    amountMapping = { mode: 'signed', column: inCol };
  } else if (outCol !== undefined) {
    problems.push('out_alone');
  } else {
    problems.push('amount_missing');
  }

  if (description === undefined && opts.fixedDescription.trim() === '') problems.push('description_missing');

  if (problems.length > 0 || date === undefined || amountMapping === undefined) return { ok: false, problems };

  const fields: Record<string, { column: number }> = {};
  targets.forEach((t, column) => {
    if (isFieldTarget(t)) fields[fieldIdOf(t)] = { column };
  });
  const notes = columnOf(targets, 'notes');
  const account = columnOf(targets, 'account');
  const mapping: ColumnMapping = {
    date: { column: date, format: opts.dateFormat },
    amount: amountMapping,
    amountLocale: opts.amountLocale,
    description: description === undefined ? { fixed: opts.fixedDescription.trim() } : { column: description },
    ...(notes === undefined ? {} : { notes: { column: notes } }),
    ...(account === undefined ? {} : { account: { column: account } }),
    fields,
    createMissingOptions: opts.createMissingOptions,
  };
  return { ok: true, mapping };
}

// ── Celdas del archivo ─────────────────────────────────────────────────────────────────

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    // read-excel-file entrega las fechas a medianoche UTC.
    return `${c.getUTCFullYear()}-${p(c.getUTCMonth() + 1)}-${p(c.getUTCDate())}`;
  }
  return String(c).trim();
}

/** Hasta `limit` valores distintos y no vacíos de una columna, en orden de aparición. */
export function distinctValues(raw: RawTable, column: number, limit = 24): string[] {
  const seen = new Set<string>();
  for (const row of raw.rows) {
    const v = cellText(row[column]);
    if (v !== '') seen.add(v);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Primeros valores no vacíos de una columna, como muestra. */
export function sampleValues(raw: RawTable, column: number, count = 3): string[] {
  const out: string[] = [];
  for (const row of raw.rows) {
    const v = cellText(row[column]);
    if (v !== '') out.push(v);
    if (out.length >= count) break;
  }
  return out;
}

// ── Vista previa ───────────────────────────────────────────────────────────────────────

export type PreviewFilter = 'all' | 'problems' | 'duplicates' | 'selected';

const BLOCKING: ReadonlySet<ImportRowStatus> = new Set(['error', 'empty']);
type ImportRowStatus = ImportPreviewRow['status'];

/** Filas que se importan por defecto: las legibles que el servicio no manda saltar. */
export function defaultInclude(rows: readonly ImportPreviewRow[]): number[] {
  return rows.filter((r) => !r.skipByDefault && !BLOCKING.has(r.status) && r.draft !== null).map((r) => r.index);
}

export function canInclude(row: ImportPreviewRow): boolean {
  return row.draft !== null && !BLOCKING.has(row.status);
}

export interface PreviewSummary {
  ok: number;
  warning: number;
  duplicate: number;
  error: number;
  opening: number;
  empty: number;
  selected: number;
}

export function summarize(rows: readonly ImportPreviewRow[], include: ReadonlySet<number>): PreviewSummary {
  const s: PreviewSummary = { ok: 0, warning: 0, duplicate: 0, error: 0, opening: 0, empty: 0, selected: 0 };
  for (const r of rows) {
    if (include.has(r.index)) s.selected += 1;
    if (r.status === 'ok') s.ok += 1;
    else if (r.status === 'warning') s.warning += 1;
    else if (r.status === 'duplicate') s.duplicate += 1;
    else if (r.status === 'error') s.error += 1;
    else if (r.status === 'opening_suspect') s.opening += 1;
    else s.empty += 1;
  }
  return s;
}

/** Filas no vacías que cumplen el filtro. Las filas vacías del archivo nunca se muestran. */
export function filterRows(rows: readonly ImportPreviewRow[], filter: PreviewFilter, include: ReadonlySet<number>): ImportPreviewRow[] {
  const visible = rows.filter((r) => r.status !== 'empty');
  switch (filter) {
    case 'problems':
      return visible.filter((r) => r.status === 'error' || r.status === 'warning' || r.status === 'opening_suspect');
    case 'duplicates':
      return visible.filter((r) => r.status === 'duplicate' || r.issues.includes('possible_duplicate') || r.issues.includes('duplicate_in_file'));
    case 'selected':
      return visible.filter((r) => include.has(r.index));
    default:
      return visible;
  }
}

/** Avisos que no merecen resaltar la fila (el aviso de monto cero sí; el de saldo inicial lo dice el estado). */
const QUIET: ReadonlySet<ImportIssue> = new Set(['opening_suspect']);

export function visibleIssues(row: ImportPreviewRow): ImportIssue[] {
  return row.issues.filter((i) => !QUIET.has(i));
}

export type CellColumn = 'date' | 'description' | 'amount' | 'account' | 'status';

/** En qué celda se marca un problema (fondo de aviso). */
export function issueColumn(issue: ImportIssue): CellColumn {
  switch (issue) {
    case 'unparseable_date':
    case 'far_date':
    case 'before_opening':
      return 'date';
    case 'description_required':
      return 'description';
    case 'unknown_account':
    case 'account_archived':
      return 'account';
    case 'amount_empty':
    case 'both_amounts':
    case 'empty':
    case 'not_a_number':
    case 'too_many_decimals':
    case 'too_large':
    case 'negative_not_allowed':
    case 'zero_amount':
      return 'amount';
    default:
      return 'status';
  }
}

export function flaggedColumns(row: ImportPreviewRow): ReadonlySet<CellColumn> {
  return new Set(visibleIssues(row).map(issueColumn));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` si el día existe en el calendario (31/02 no). */
function isoIfReal(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Fecha del archivo para mostrarla en una fila que no se pudo leer entera (p. ej. por el monto): con el formato que
 * resolvió el núcleo, solo los casos comunes. Si no se entiende o el día no existe, null (se muestra el texto crudo).
 */
export function displayDate(text: string, format: ResolvedDateFormat): string | null {
  const s = text.trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) return isoIfReal(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (format === 'excel_serial' && /^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const yy = m[3] ?? '';
  const y = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return format === 'MM/dd/yyyy' ? isoIfReal(y, a, b) : isoIfReal(y, b, a);
}

/** Fecha y concepto que se muestran de una fila: el borrador si se pudo leer, o lo que se entiende del archivo. */
export function rowDisplay(
  row: ImportPreviewRow,
  mapping: ColumnMapping,
  dateFormat?: ResolvedDateFormat,
): { date: string; dateRaw: string; description: string } {
  const dateRaw = row.raw[mapping.date.column] ?? '';
  if (row.draft !== null) return { date: row.draft.date, dateRaw, description: row.draft.description };
  const description = 'column' in mapping.description ? (row.raw[mapping.description.column] ?? '') : mapping.description.fixed;
  const parsed = dateFormat === undefined ? null : displayDate(dateRaw, dateFormat);
  return { date: parsed ?? dateRaw, dateRaw, description };
}

/** Monto tal como viene en el archivo, para las filas que no se pudieron leer: en qué columna (entra/sale) y texto. */
export function rawAmount(row: ImportPreviewRow, mapping: ColumnMapping): { side: 'in' | 'out'; text: string } | null {
  const cell = (i: number) => (row.raw[i] ?? '').trim();
  const a = mapping.amount;
  if (a.mode === 'split') {
    const inText = cell(a.inColumn);
    if (inText !== '') return { side: 'in', text: inText };
    const outText = cell(a.outColumn);
    return outText === '' ? null : { side: 'out', text: outText };
  }
  const text = cell(a.column);
  if (text === '') return null;
  if (a.mode === 'with_type') {
    const norm = (v: string) => v.trim().toLocaleLowerCase('es');
    const type = norm(cell(a.typeColumn));
    return { side: a.inValues.some((v) => norm(v) === type) ? 'in' : 'out', text };
  }
  return { side: /^\s*(-|\(|−)/.test(text) ? 'out' : 'in', text };
}

/** Columnas asignadas además de las básicas (cuenta y campos del espacio), en el orden del archivo. */
export type ExtraColumn = { key: string; column: number; kind: 'account' } | { key: string; column: number; kind: 'field'; field: Field };

export function extraColumns(mapping: ColumnMapping, fields: readonly Field[]): ExtraColumn[] {
  const out: ExtraColumn[] = [];
  if (mapping.account !== undefined) out.push({ key: 'account', column: mapping.account.column, kind: 'account' });
  for (const [fieldId, { column }] of Object.entries(mapping.fields)) {
    const field = fields.find((f) => f.id === fieldId);
    if (field !== undefined) out.push({ key: `field:${fieldId}`, column, kind: 'field', field });
  }
  return out.sort((a, b) => a.column - b.column);
}

export type ExtraCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'date'; iso: string }
  | { kind: 'bool'; value: boolean }
  /** Opción de lista que se creará al importar. */
  | { kind: 'new'; text: string }
  /** Texto del archivo sin interpretar (fila con error). */
  | { kind: 'raw'; text: string };

/** Lo que va a quedar en la cuenta o el campo de una fila: el valor interpretado, la opción nueva o el texto crudo. */
export function extraCell(row: ImportPreviewRow, col: ExtraColumn, accounts: readonly Account[]): ExtraCell {
  const raw = (row.raw[col.column] ?? '').trim();
  if (col.kind === 'account') {
    if (row.draft === null) return raw === '' ? { kind: 'empty' } : { kind: 'raw', text: raw };
    const id = row.draft.accountId;
    const name = accounts.find((a) => a.id === id)?.name;
    return name === undefined ? { kind: 'raw', text: raw } : { kind: 'text', text: name };
  }
  const fieldId = col.field.id;
  const pending = row.pendingOptions.find((p) => p.fieldId === fieldId);
  if (pending !== undefined) return { kind: 'new', text: pending.label };
  const value = row.draft?.values?.[fieldId];
  if (value === undefined) return raw === '' ? { kind: 'empty' } : { kind: 'raw', text: raw };
  switch (value.type) {
    case 'list':
      return { kind: 'text', text: col.field.options.find((o) => o.id === value.optionId)?.label ?? raw };
    case 'date':
      return { kind: 'date', iso: value.value };
    case 'bool':
      return { kind: 'bool', value: value.value };
    case 'number':
      return { kind: 'text', text: raw === '' ? String(value.value) : raw };
    default:
      return value.value === '' ? { kind: 'empty' } : { kind: 'text', text: value.value };
  }
}

/** Texto del archivo: nombre sin extensión para rotular el lote. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
