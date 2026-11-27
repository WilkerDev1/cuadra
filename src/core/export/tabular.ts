// Tablas neutras para exportar (ARCHITECTURE.md 3.5): listados, resúmenes, informes e historial → Sheet.
// Sin DOM ni librerías: la feature de informes pasa cada Sheet a papaparse (CSV) o write-excel-file (XLSX).
//
// - El dinero va en unidad menor (entero); `Sheet.currency` dice cuántos decimales tiene y el escritor aplica
//   el formato. Para CSV, `sheetToRows` lo convierte a texto decimal canónico ("1234.50") sin flotantes.
// - Fechas de calendario como 'YYYY-MM-DD'; marcas del sistema como texto ISO.
// - Los textos salen de `t(clave)`; si no hay traducción (t ausente o devuelve la clave) se usa el español
//   por defecto de LABELS_ES, así la exportación nunca muestra claves crudas.
import { Money } from '../money';
import type {
  Account,
  AuditEntry,
  Currency,
  Field,
  FieldValue,
  Id,
  SummaryGroup,
  SummaryResult,
  TransactionRow,
  TxKind,
} from '../types';
import type { ReportDocument } from '../services/reports';

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** 'number' (añadido por 2C): cantidades de campos numéricos, que pueden tener decimales. */
export type ColumnType = 'text' | 'date' | 'money' | 'integer' | 'number';
export type Cell = string | number | null;

export interface SheetColumn {
  /** Clave estable de la columna ('date', 'in', o el id del campo). */
  key: string;
  header: string;
  type: ColumnType;
  width?: number;
}

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  /** Dinero en unidad menor; el escritor aplica formato. */
  rows: Cell[][];
  /** Moneda de las columnas 'money' (decimales y símbolo). */
  currency?: Currency;
}

export const LABELS_ES: Readonly<Record<string, string>> = {
  'export.sheet.movements': 'Movimientos',
  'export.sheet.voided': 'Anulados',
  'export.sheet.summary': 'Resumen',
  'export.sheet.statement': 'Estado',
  'export.sheet.byAccount': 'Por cuenta',
  'export.sheet.transfers': 'Transferencias',
  'export.sheet.audit': 'Historial',
  'export.col.date': 'Fecha',
  'export.col.seq': 'Nº',
  'export.col.account': 'Cuenta',
  'export.col.kind': 'Tipo',
  'export.col.description': 'Descripción',
  'export.col.in': 'Entrada',
  'export.col.out': 'Salida',
  'export.col.net': 'Neto',
  'export.col.running': 'Saldo',
  'export.col.counterpart': 'Contrapartida',
  'export.col.notes': 'Notas',
  'export.col.status': 'Estado',
  'export.col.voidReason': 'Motivo de anulación',
  'export.col.count': 'Movimientos',
  'export.col.group': 'Grupo',
  'export.col.split': 'Detalle',
  'export.col.concept': 'Concepto',
  'export.col.amount': 'Monto',
  'export.col.from': 'Desde',
  'export.col.to': 'Hacia',
  'export.col.at': 'Fecha y hora',
  'export.col.action': 'Acción',
  'export.col.entity': 'Elemento',
  'export.col.message': 'Detalle',
  'export.col.changes': 'Cambios',
  'export.col.periodOpening': 'Saldo inicial del periodo',
  'export.col.openingsInPeriod': 'Saldos iniciales en el periodo',
  'export.col.transfersIn': 'Transferencias entrantes',
  'export.col.transfersOut': 'Transferencias salientes',
  'export.col.closing': 'Saldo final',
  'export.kind.income': 'Entrada',
  'export.kind.expense': 'Salida',
  'export.kind.transfer': 'Transferencia',
  'export.kind.opening': 'Saldo inicial',
  'export.status.active': 'Activo',
  'export.status.voided': 'Anulado',
  'export.bool.true': 'Sí',
  'export.bool.false': 'No',
  'export.total': 'Total',
  'export.meta.workspace': 'Espacio: {name}',
  'export.meta.owner': 'Titular: {name}',
  'export.meta.period': 'Periodo: {label}',
  'export.meta.generatedAt': 'Generado: {at}',
  'export.meta.filter': 'Filtro: {text}',
  'export.meta.unfiltered': 'Sin filtros',
  'export.unknownAccount': '(cuenta desconocida)',
  'export.unknownOption': '(opción desconocida)',
};

function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Texto de una clave: la traducción de `t` si la hay, si no el español por defecto. */
export function label(t: Translate | undefined, key: string, params?: Readonly<Record<string, string | number>>): string {
  const translated = t?.(key, params);
  if (translated !== undefined && translated !== key) return translated;
  const fallback = LABELS_ES[key];
  return fallback === undefined ? key : interpolate(fallback, params);
}

/** Nombre de hoja válido para Excel: ≤ 31 caracteres, sin : \ / ? * [ ], único dentro del libro. */
export function sheetName(name: string, taken: Set<string> = new Set()): string {
  const clean = name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let candidate = clean;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ── Movimientos ───────────────────────────────────────────────────────────────────────

const FIXED_COLUMNS = [
  'date',
  'seq',
  'account',
  'kind',
  'description',
  'in',
  'out',
  'running',
  'counterpart',
  'notes',
  'status',
  'voidReason',
] as const;
type FixedColumn = (typeof FIXED_COLUMNS)[number];
const FIXED_TYPES: Record<FixedColumn, ColumnType> = {
  date: 'date',
  seq: 'integer',
  account: 'text',
  kind: 'text',
  description: 'text',
  in: 'money',
  out: 'money',
  running: 'money',
  counterpart: 'text',
  notes: 'text',
  status: 'text',
  voidReason: 'text',
};
const isFixed = (key: string): key is FixedColumn => (FIXED_COLUMNS as readonly string[]).includes(key);

function fieldColumnType(field: Field): ColumnType {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

function fieldCell(field: Field, value: FieldValue | undefined, t: Translate | undefined): Cell {
  if (value === undefined) return field.type === 'bool' ? label(t, 'export.bool.false') : null;
  switch (value.type) {
    case 'list':
      return field.options.find((o) => o.id === value.optionId)?.label ?? label(t, 'export.unknownOption');
    case 'bool':
      return label(t, value.value ? 'export.bool.true' : 'export.bool.false');
    case 'number':
      return value.value;
    case 'date':
      return value.value;
    case 'text':
      return value.value;
  }
}

/**
 * Listado de movimientos como hoja. `columns` (opcional) elige y ordena: claves fijas
 * (date, seq, account, kind, description, in, out, running, counterpart, notes, status, voidReason) e ids de
 * campo. Sin `columns`: todas las fijas que tengan sentido (saldo solo si alguna fila lo trae, motivo solo si
 * hay anulados) y los campos activos más los inactivos que tengan algún valor en estas filas.
 */
export function transactionsToSheet(
  rows: TransactionRow[],
  fields: Field[],
  ctx: { accounts: Account[]; currency: Currency; columns?: string[]; name?: string },
  t?: Translate,
): Sheet {
  const accountName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  let keys: string[];
  if (ctx.columns && ctx.columns.length > 0) {
    keys = ctx.columns.filter((k) => isFixed(k) || fieldById.has(k));
  } else {
    const hasRunning = rows.some((r) => r.runningMinor !== null);
    const hasVoided = rows.some((r) => r.status === 'voided');
    const hasTransfers = rows.some((r) => r.counterpart !== null);
    keys = FIXED_COLUMNS.filter(
      (k) => (k !== 'running' || hasRunning) && (k !== 'voidReason' || hasVoided) && (k !== 'counterpart' || hasTransfers),
    );
    const used = new Set(rows.flatMap((r) => Object.keys(r.values)));
    keys.push(...fields.filter((f) => f.active || used.has(f.id)).map((f) => f.id));
  }
  const columns: SheetColumn[] = keys.map((key) => {
    if (isFixed(key)) return { key, header: label(t, `export.col.${key}`), type: FIXED_TYPES[key] };
    const field = fieldById.get(key) as Field;
    return { key, header: field.label, type: fieldColumnType(field) };
  });
  const account = (id: Id) => accountName.get(id) ?? label(t, 'export.unknownAccount');
  const out: Cell[][] = rows.map((r) =>
    keys.map((key): Cell => {
      switch (key) {
        case 'date':
          return r.date;
        case 'seq':
          return r.seq;
        case 'account':
          return account(r.accountId);
        case 'kind':
          return label(t, `export.kind.${r.kind satisfies TxKind}`);
        case 'description':
          return r.description;
        case 'in':
          return r.direction === 'in' ? r.amountMinor : null;
        case 'out':
          return r.direction === 'out' ? r.amountMinor : null;
        case 'running':
          return r.runningMinor;
        case 'counterpart':
          return r.counterpart ? account(r.counterpart.accountId) : null;
        case 'notes':
          return r.notes === '' ? null : r.notes;
        case 'status':
          return label(t, `export.status.${r.status}`);
        case 'voidReason':
          return r.voidReason;
        default: {
          const field = fieldById.get(key) as Field;
          return fieldCell(field, r.values[key], t);
        }
      }
    }),
  );
  return { name: ctx.name ?? label(t, 'export.sheet.movements'), columns, rows: out, currency: ctx.currency };
}

// ── Resúmenes ─────────────────────────────────────────────────────────────────────────

function groupsSheet(
  name: string,
  groups: SummaryGroup[],
  currency: Currency,
  t: Translate | undefined,
  headers: { group: string; split?: string },
): Sheet {
  const hasSplit = groups.some((g) => g.split !== undefined);
  const columns: SheetColumn[] = [
    { key: 'group', header: headers.group, type: 'text' },
    ...(hasSplit ? [{ key: 'split', header: headers.split ?? label(t, 'export.col.split'), type: 'text' as const }] : []),
    { key: 'in', header: label(t, 'export.col.in'), type: 'money' },
    { key: 'out', header: label(t, 'export.col.out'), type: 'money' },
    { key: 'net', header: label(t, 'export.col.net'), type: 'money' },
    { key: 'count', header: label(t, 'export.col.count'), type: 'integer' },
  ];
  const rows: Cell[][] = [];
  const line = (g: SummaryGroup, sub: SummaryGroup | null): Cell[] => [
    g.label,
    ...(hasSplit ? [sub?.label ?? null] : []),
    (sub ?? g).inMinor,
    (sub ?? g).outMinor,
    (sub ?? g).netMinor,
    (sub ?? g).count,
  ];
  for (const g of groups) {
    rows.push(line(g, null));
    for (const s of g.split ?? []) rows.push(line(g, s));
  }
  const sum = (pick: (g: SummaryGroup) => number) => groups.reduce((s, g) => Money.add(s, pick(g)), 0);
  rows.push([
    label(t, 'export.total'),
    ...(hasSplit ? [null] : []),
    sum((g) => g.inMinor),
    sum((g) => g.outMinor),
    sum((g) => g.netMinor),
    groups.reduce((s, g) => s + g.count, 0),
  ]);
  return { name, columns, rows, currency };
}

/** Resumen agrupado como hoja: una fila por grupo (y por subgrupo si hay split) más el total. */
export function summaryToSheet(
  result: SummaryResult,
  ctx: { currency: Currency; groupHeader?: string; splitHeader?: string; name?: string },
  t?: Translate,
): Sheet {
  return groupsSheet(ctx.name ?? label(t, 'export.sheet.summary'), result.groups, ctx.currency, t, {
    group: ctx.groupHeader ?? label(t, 'export.col.group'),
    ...(ctx.splitHeader !== undefined ? { split: ctx.splitHeader } : {}),
  });
}

// ── Historial ─────────────────────────────────────────────────────────────────────────

function changeText(c: AuditEntry['changes'][number]): string {
  const show = (v: unknown) => (v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v));
  if (c.path === '*') return `* ${show(c.new)}`;
  return `${c.path}: ${show(c.old)} → ${show(c.new)}`;
}

/** Historial como hoja. El mensaje se traduce con `t(message, params)` (claves 'audit.*'). */
export function auditToSheet(
  entries: AuditEntry[],
  ctx: { accounts?: Account[]; name?: string } = {},
  t?: Translate,
): Sheet {
  const names = new Map((ctx.accounts ?? []).map((a) => [a.id, a.name]));
  const columns: SheetColumn[] = [
    { key: 'at', header: label(t, 'export.col.at'), type: 'text' },
    { key: 'action', header: label(t, 'export.col.action'), type: 'text' },
    { key: 'entity', header: label(t, 'export.col.entity'), type: 'text' },
    { key: 'account', header: label(t, 'export.col.account'), type: 'text' },
    { key: 'message', header: label(t, 'export.col.message'), type: 'text' },
    { key: 'changes', header: label(t, 'export.col.changes'), type: 'text' },
  ];
  const rows: Cell[][] = entries.map((e) => {
    const params = Object.fromEntries(
      Object.entries(e.params ?? {}).filter((kv): kv is [string, string | number] => typeof kv[1] === 'string' || typeof kv[1] === 'number'),
    );
    return [
      e.at,
      e.action,
      e.entityType,
      e.accountId === null ? null : (names.get(e.accountId) ?? e.accountId),
      label(t, e.message, params),
      e.changes.length === 0 ? null : e.changes.map(changeText).join('; '),
    ];
  });
  return { name: ctx.name ?? label(t, 'export.sheet.audit'), columns, rows };
}

// ── Informes ─────────────────────────────────────────────────────────────────────────

/** Informe completo como libro de hojas: resumen + estado, por cuenta, por campo, transferencias, movimientos… */
export function reportToSheets(doc: ReportDocument, t?: Translate): Sheet[] {
  const taken = new Set<string>();
  const currency = doc.meta.currency;
  const accountName = new Map(doc.accounts.map((a) => [a.id, a.name]));
  const sheets: Sheet[] = [];
  const s = doc.statement;

  const metaRows: Cell[][] = [
    [label(t, 'export.meta.workspace', { name: doc.meta.workspaceName }), null],
    ...(doc.meta.ownerName ? [[label(t, 'export.meta.owner', { name: doc.meta.ownerName }), null]] : []),
    [label(t, 'export.meta.period', { label: doc.meta.period.label }), null],
    [label(t, 'export.meta.generatedAt', { at: doc.meta.generatedAt }), null],
    ...(doc.meta.filterDescription.length > 0
      ? doc.meta.filterDescription.map((text) => [label(t, 'export.meta.filter', { text }), null])
      : [[label(t, 'export.meta.unfiltered'), null]]),
  ];
  const statementRows: Cell[][] = [
    [label(t, 'export.col.periodOpening'), s.periodOpeningMinor],
    [label(t, 'export.col.openingsInPeriod'), s.openingsInPeriodMinor],
    [label(t, 'export.col.in'), s.inMinor],
    [label(t, 'export.col.out'), s.outMinor],
    [label(t, 'export.col.transfersIn'), s.transfersInMinor],
    [label(t, 'export.col.transfersOut'), s.transfersOutMinor],
    [label(t, 'export.col.closing'), s.closingMinor],
  ];
  sheets.push({
    name: sheetName(label(t, 'export.sheet.summary'), taken),
    columns: [
      { key: 'concept', header: label(t, 'export.col.concept'), type: 'text' },
      { key: 'amount', header: label(t, 'export.col.amount'), type: 'money' },
    ],
    rows: [...metaRows, ...statementRows],
    currency,
  });

  const moneyCols = (keys: string[]): SheetColumn[] =>
    keys.map((key) => ({ key, header: label(t, `export.col.${key}`), type: 'money' as const }));
  const lineCells = (l: ReportDocument['statement']): Cell[] => [
    l.periodOpeningMinor,
    l.openingsInPeriodMinor,
    l.inMinor,
    l.outMinor,
    l.transfersInMinor,
    l.transfersOutMinor,
    l.closingMinor,
  ];
  if (doc.byAccount.length > 0) {
    sheets.push({
      name: sheetName(label(t, 'export.sheet.byAccount'), taken),
      columns: [
        { key: 'account', header: label(t, 'export.col.account'), type: 'text' },
        ...moneyCols(['periodOpening', 'openingsInPeriod', 'in', 'out', 'transfersIn', 'transfersOut', 'closing']),
      ],
      rows: [
        ...doc.byAccount.map((line) => [line.account.name, ...lineCells(line)]),
        [label(t, 'export.total'), ...lineCells(s)],
      ],
      currency,
    });
  }

  for (const { field, groups } of doc.byField) {
    sheets.push(groupsSheet(sheetName(field.label, taken), groups, currency, t, { group: field.label }));
  }

  if (doc.transfers.length > 0) {
    const name = (id: Id) => accountName.get(id) ?? label(t, 'export.unknownAccount');
    sheets.push({
      name: sheetName(label(t, 'export.sheet.transfers'), taken),
      columns: [
        { key: 'date', header: label(t, 'export.col.date'), type: 'date' },
        { key: 'from', header: label(t, 'export.col.from'), type: 'text' },
        { key: 'to', header: label(t, 'export.col.to'), type: 'text' },
        { key: 'description', header: label(t, 'export.col.description'), type: 'text' },
        { key: 'amount', header: label(t, 'export.col.amount'), type: 'money' },
      ],
      rows: doc.transfers.map((x) => [x.date, name(x.fromAccountId), name(x.toAccountId), x.description, x.amountMinor]),
      currency,
    });
  }

  const columns = doc.recipe.columns.length > 0 ? doc.recipe.columns : undefined;
  if (doc.movements !== null) {
    const sheet = transactionsToSheet(
      doc.movements,
      doc.fields,
      { accounts: doc.accounts, currency, ...(columns ? { columns } : {}) },
      t,
    );
    sheets.push({ ...sheet, name: sheetName(sheet.name, taken) });
  }
  if (doc.voided !== null) {
    const sheet = transactionsToSheet(
      doc.voided,
      doc.fields,
      { accounts: doc.accounts, currency, name: label(t, 'export.sheet.voided') },
      t,
    );
    sheets.push({ ...sheet, name: sheetName(sheet.name, taken) });
  }
  if (doc.audit !== null) {
    const sheet = auditToSheet(doc.audit, { accounts: doc.accounts }, t);
    sheets.push({ ...sheet, name: sheetName(sheet.name, taken) });
  }
  return sheets;
}

// ── Para CSV ──────────────────────────────────────────────────────────────────────────

/**
 * Cabecera + filas listas para un CSV: el dinero pasa a texto decimal canónico ("1234.50", sin separador de
 * miles) con los decimales de la moneda; el resto queda igual. Nunca divide en flotante.
 */
export function sheetToRows(sheet: Sheet): Cell[][] {
  const digits = sheet.currency?.minorDigits ?? 2;
  const money = sheet.columns.map((c) => c.type === 'money');
  return [
    sheet.columns.map((c) => c.header),
    ...sheet.rows.map((row) =>
      row.map((cell, i) =>
        money[i] && typeof cell === 'number' ? Money.toDecimalString(cell, digits) : typeof cell === 'string' ? csvSafeText(cell) : cell,
      ),
    ),
  ];
}

/**
 * Inyección de fórmulas en CSV (OWASP "CSV Injection"): Excel, LibreOffice y Sheets ejecutan una celda de texto
 * que empieza por = + - @ (o tabulador / retorno de carro seguido de eso). Las descripciones y notas las escribe
 * el usuario o vienen de un archivo importado, así que se antepone un apóstrofo. El dinero no pasa por aquí: sale
 * como decimal canónico ("-50.00") de las columnas 'money', que sí debe leerse como número.
 */
export function csvSafeText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
