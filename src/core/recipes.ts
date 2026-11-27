// Recetas (ARCHITECTURE.md 3.4): filtros, agrupaciones y vistas guardadas como JSON versionado.
// Las formas de datos viven en types.ts (la UI las necesita); aquí está la lógica: resolver periodos,
// validar contra los campos actuales, traducir claves de plantilla a ids y describir un filtro.
import { periodLabel, presetRange, isIsoDate } from './dates';
import { DomainError } from './errors';
import { Money } from './money';
import type { Clock } from './ports';
import { err, ok, type Result } from './result';
import type {
  Account,
  Currency,
  DateRange,
  Field,
  FieldCondition,
  FieldType,
  GroupBy,
  Id,
  IsoDate,
  PeriodPreset,
  ReportSection,
  TxFilter,
  TxKind,
  ViewRecipe,
  Warning,
} from './types';

export type {
  DateRange,
  FieldCondition,
  GroupBy,
  PeriodPreset,
  ReportSection,
  TxFilter,
  TxSort,
  ViewRecipe,
} from './types';

export const PERIOD_PRESETS = [
  'today',
  'this_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_30_days',
  'last_12_months',
  'all',
] as const satisfies readonly PeriodPreset[];

export const REPORT_SECTIONS = [
  'header',
  'statement',
  'by_account',
  'by_field',
  'transfers',
  'movements',
  'voided',
  'audit',
  'signature',
] as const satisfies readonly ReportSection[];

const TX_KINDS = ['income', 'expense', 'transfer', 'opening'] as const satisfies readonly TxKind[];

/** Claves de plantilla → ids de la BD. Opciones con clave completa 'campo.opcion'. */
export interface TemplateKeyMap {
  accounts: Record<string, Id>;
  fields: Record<string, Id>;
  options: Record<string, Id>;
}

// ── Periodos ─────────────────────────────────────────────────────────────────────────

const PRESET_NAMES: Record<PeriodPreset, string> = {
  today: 'Hoy',
  this_week: 'Esta semana',
  this_month: 'Este mes',
  last_month: 'Mes pasado',
  this_quarter: 'Este trimestre',
  last_quarter: 'Trimestre pasado',
  this_year: 'Este año',
  last_year: 'Año pasado',
  last_30_days: 'Últimos 30 días',
  last_12_months: 'Últimos 12 meses',
  all: 'Todo',
};

export function resolvePeriod(
  range: DateRange | undefined,
  clock: Clock,
): { from: IsoDate | null; to: IsoDate | null; label: string } {
  if (range === undefined) return { from: null, to: null, label: periodLabel(null, null) };
  if ('preset' in range) {
    const { from, to } = presetRange(range.preset, clock.today());
    return { from, to, label: periodLabel(from, to) };
  }
  const from = range.from ?? null;
  const to = range.to ?? null;
  if (from !== null && !isIsoDate(from)) throw new DomainError('invalid_date', { from });
  if (to !== null && !isIsoDate(to)) throw new DomainError('invalid_date', { to });
  return { from, to, label: periodLabel(from, to) };
}

// ── Validación de forma (lectura desde la BD o desde plantillas) ─────────────────────

type Check = string | null; // ruta del fallo o null

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isIntMinor = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const oneOf = <T extends string>(xs: readonly T[], x: unknown): x is T => typeof x === 'string' && xs.includes(x as T);

function checkRange(x: unknown, path: string): Check {
  if (!isObj(x)) return path;
  if ('preset' in x) return oneOf(PERIOD_PRESETS, x['preset']) ? null : path;
  for (const k of ['from', 'to'] as const) if (x[k] !== undefined && !isIsoDate(x[k])) return path;
  return null;
}

function checkCondition(x: unknown, path: string): Check {
  if (!isObj(x) || typeof x['fieldId'] !== 'string') return path;
  switch (x['op']) {
    case 'any_of':
      return isStrArray(x['optionIds']) ? null : path;
    case 'empty':
    case 'not_empty':
      return null;
    case 'is':
      return typeof x['value'] === 'boolean' ? null : path;
    case 'contains':
      return typeof x['value'] === 'string' ? null : path;
    case 'between':
      for (const k of ['min', 'max'] as const) {
        if (x[k] !== undefined && (typeof x[k] !== 'number' || !Number.isFinite(x[k]))) return path;
      }
      return null;
    case 'date_between':
      for (const k of ['from', 'to'] as const) if (x[k] !== undefined && !isIsoDate(x[k])) return path;
      return null;
    default:
      return path;
  }
}

function checkFilter(x: unknown, path: string): Check {
  if (!isObj(x)) return path;
  if (x['period'] !== undefined) {
    const c = checkRange(x['period'], `${path}.period`);
    if (c) return c;
  }
  if (x['accountIds'] !== undefined && !isStrArray(x['accountIds'])) return `${path}.accountIds`;
  if (x['kinds'] !== undefined && !(Array.isArray(x['kinds']) && x['kinds'].every((k) => oneOf(TX_KINDS, k)))) {
    return `${path}.kinds`;
  }
  if (x['amount'] !== undefined) {
    const a = x['amount'];
    if (!isObj(a)) return `${path}.amount`;
    for (const k of ['min', 'max'] as const) if (a[k] !== undefined && !isIntMinor(a[k])) return `${path}.amount.${k}`;
  }
  if (x['text'] !== undefined && typeof x['text'] !== 'string') return `${path}.text`;
  if (x['status'] !== undefined && !oneOf(['active', 'voided', 'all'] as const, x['status'])) return `${path}.status`;
  if (x['batchId'] !== undefined && typeof x['batchId'] !== 'string') return `${path}.batchId`;
  if (x['fields'] !== undefined) {
    if (!Array.isArray(x['fields'])) return `${path}.fields`;
    for (const [i, c] of x['fields'].entries()) {
      const r = checkCondition(c, `${path}.fields[${i}]`);
      if (r) return r;
    }
  }
  return null;
}

function checkGroupBy(x: unknown, path: string): Check {
  if (!isObj(x)) return path;
  switch (x['by']) {
    case 'period':
      return oneOf(['day', 'week', 'month', 'quarter', 'year'] as const, x['unit']) ? null : path;
    case 'account':
    case 'kind':
      return null;
    case 'field':
      return typeof x['fieldId'] === 'string' ? null : path;
    default:
      return path;
  }
}

function checkSort(x: unknown, path: string): Check {
  if (!isObj(x)) return path;
  return oneOf(['date', 'amount', 'recorded_at', 'seq'] as const, x['by']) && oneOf(['asc', 'desc'] as const, x['dir'])
    ? null
    : path;
}

function checkRecipe(x: unknown): Check {
  if (!isObj(x)) return '$';
  if (x['v'] !== 1) return '$.v';
  const f = checkFilter(x['filter'], '$.filter');
  if (f) return f;
  switch (x['kind']) {
    case 'filter':
      if (x['columns'] !== undefined && !isStrArray(x['columns'])) return '$.columns';
      if (x['sort'] !== undefined) return checkSort(x['sort'], '$.sort');
      return null;
    case 'summary': {
      const g = checkGroupBy(x['groupBy'], '$.groupBy');
      if (g) return g;
      if (x['split'] !== undefined) {
        const s = checkGroupBy(x['split'], '$.split');
        if (s) return s;
      }
      if (!oneOf(['in', 'out', 'both', 'net'] as const, x['measure'])) return '$.measure';
      if (!oneOf(['bars', 'donut', 'line', 'table'] as const, x['chart'])) return '$.chart';
      return null;
    }
    case 'report':
      if (!oneOf(['summary', 'detailed', 'custom'] as const, x['form'])) return '$.form';
      if (!(Array.isArray(x['sections']) && x['sections'].every((s) => oneOf(REPORT_SECTIONS, s)))) return '$.sections';
      if (!isStrArray(x['groupByFieldIds'])) return '$.groupByFieldIds';
      if (!isStrArray(x['columns'])) return '$.columns';
      if (typeof x['includeVoided'] !== 'boolean') return '$.includeVoided';
      if (typeof x['signature'] !== 'boolean') return '$.signature';
      return null;
    default:
      return '$.kind';
  }
}

/** Comprueba la forma de una receta (p. ej. leída de saved_views.recipe). Error = ruta del fallo. */
export function parseViewRecipe(value: unknown): Result<ViewRecipe, string> {
  const failure = checkRecipe(value);
  return failure === null ? ok(structuredClone(value) as ViewRecipe) : err(failure);
}

// ── Validación contra los campos actuales ───────────────────────────────────────────

const OPS_BY_TYPE: Record<FieldType, ReadonlySet<FieldCondition['op']>> = {
  list: new Set(['any_of', 'empty', 'not_empty']),
  bool: new Set(['is', 'empty', 'not_empty']),
  text: new Set(['contains', 'empty', 'not_empty']),
  number: new Set(['between', 'empty', 'not_empty']),
  date: new Set(['date_between', 'empty', 'not_empty']),
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class WarningSink {
  readonly list: Warning[] = [];
  private readonly seen = new Set<string>();
  add(w: Warning): void {
    const key = JSON.stringify(w);
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.list.push(w);
    }
  }
}

function validateFilter(filter: TxFilter, byId: Map<Id, Field>, sink: WarningSink): TxFilter {
  if (filter.fields === undefined) return filter;
  const fields: FieldCondition[] = [];
  for (const cond of filter.fields) {
    const field = byId.get(cond.fieldId);
    if (field === undefined || !OPS_BY_TYPE[field.type].has(cond.op)) {
      sink.add({ code: 'field_missing', fieldKeyOrId: cond.fieldId });
      continue;
    }
    if (!field.active) sink.add({ code: 'field_inactive', fieldId: field.id });
    if (cond.op === 'any_of') {
      const options = new Map(field.options.map((o) => [o.id, o]));
      const optionIds = cond.optionIds.filter((id) => options.has(id));
      for (const id of optionIds) {
        if (options.get(id)?.active === false) sink.add({ code: 'option_inactive', fieldId: field.id, optionId: id });
      }
      if (optionIds.length === 0 && cond.optionIds.length > 0) continue;
      fields.push({ ...cond, optionIds });
    } else {
      fields.push(cond);
    }
  }
  return { ...filter, fields };
}

function validateGroupBy(g: GroupBy, byId: Map<Id, Field>, sink: WarningSink): GroupBy | null {
  if (g.by !== 'field') return g;
  const field = byId.get(g.fieldId);
  if (field === undefined) {
    sink.add({ code: 'field_missing', fieldKeyOrId: g.fieldId });
    return null;
  }
  if (!field.active) sink.add({ code: 'field_inactive', fieldId: field.id });
  return g;
}

/** Columnas: se conservan las fijas ('date', 'amount'…) y los ids de campos existentes. */
function validateColumns(columns: Id[], byId: Map<Id, Field>, sink: WarningSink): Id[] {
  return columns.filter((c) => {
    if (byId.has(c) || !UUID_LIKE.test(c)) return true;
    sink.add({ code: 'field_missing', fieldKeyOrId: c });
    return false;
  });
}

/** Revisa una receta contra los campos actuales: avisa de campos inactivos, quita los inexistentes. */
export function validateRecipe<R extends ViewRecipe>(recipe: R, fields: Field[]): { recipe: R; warnings: Warning[] } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const sink = new WarningSink();
  const copy = structuredClone(recipe) as ViewRecipe;
  copy.filter = validateFilter(copy.filter, byId, sink);
  switch (copy.kind) {
    case 'filter':
      if (copy.columns !== undefined) copy.columns = validateColumns(copy.columns, byId, sink);
      break;
    case 'summary': {
      copy.groupBy = validateGroupBy(copy.groupBy, byId, sink) ?? { by: 'period', unit: 'month' };
      if (copy.split !== undefined) {
        const split = validateGroupBy(copy.split, byId, sink);
        if (split === null) delete copy.split;
        else copy.split = split;
      }
      break;
    }
    case 'report':
      copy.groupByFieldIds = copy.groupByFieldIds.filter((id) => {
        const field = byId.get(id);
        if (field === undefined) sink.add({ code: 'field_missing', fieldKeyOrId: id });
        else if (!field.active) sink.add({ code: 'field_inactive', fieldId: id });
        return field !== undefined;
      });
      copy.columns = validateColumns(copy.columns, byId, sink);
      break;
  }
  return { recipe: copy as R, warnings: sink.list };
}

// ── Plantillas: claves → ids ────────────────────────────────────────────────────────

function lookup(map: Record<string, Id>, key: string, kind: string): Id {
  const id = Object.hasOwn(map, key) ? map[key] : undefined;
  if (id === undefined) throw new DomainError('not_found', { kind, key });
  return id;
}

function mapFilterKeys(filter: Record<string, unknown>, keyMap: TemplateKeyMap): void {
  if (isStrArray(filter['accountIds'])) {
    filter['accountIds'] = filter['accountIds'].map((k) => lookup(keyMap.accounts, k, 'account'));
  }
  if (Array.isArray(filter['fields'])) {
    for (const cond of filter['fields']) {
      if (!isObj(cond) || typeof cond['fieldId'] !== 'string') continue;
      const fieldKey = cond['fieldId'];
      cond['fieldId'] = lookup(keyMap.fields, fieldKey, 'field');
      if (isStrArray(cond['optionIds'])) {
        cond['optionIds'] = cond['optionIds'].map((k) =>
          lookup(keyMap.options, k.includes('.') ? k : `${fieldKey}.${k}`, 'option'),
        );
      }
    }
  }
}

function mapGroupKeys(g: unknown, keyMap: TemplateKeyMap): void {
  if (isObj(g) && g['by'] === 'field' && typeof g['fieldId'] === 'string') {
    g['fieldId'] = lookup(keyMap.fields, g['fieldId'], 'field');
  }
}

/** Columnas de plantilla: si la clave es un campo se traduce; si no, es una columna fija. */
function mapColumnKeys(columns: unknown, keyMap: TemplateKeyMap): unknown {
  return isStrArray(columns) ? columns.map((c) => (Object.hasOwn(keyMap.fields, c) ? keyMap.fields[c] : c)) : columns;
}

/** Plantillas referencian claves ('categoria', 'categoria.ventas'); en la BD se guardan ids. */
export function resolveTemplateRecipe(recipe: unknown, keyMap: TemplateKeyMap): ViewRecipe {
  if (!isObj(recipe)) throw new DomainError('invalid_recipe', { path: '$' });
  const copy = structuredClone(recipe);
  if (isObj(copy['filter'])) mapFilterKeys(copy['filter'], keyMap);
  mapGroupKeys(copy['groupBy'], keyMap);
  mapGroupKeys(copy['split'], keyMap);
  if (isStrArray(copy['groupByFieldIds'])) {
    copy['groupByFieldIds'] = copy['groupByFieldIds'].map((k) => lookup(keyMap.fields, k, 'field'));
  }
  if (copy['columns'] !== undefined) copy['columns'] = mapColumnKeys(copy['columns'], keyMap);
  const parsed = parseViewRecipe(copy);
  if (!parsed.ok) throw new DomainError('invalid_recipe', { path: parsed.error });
  return parsed.value;
}

// ── Descripción legible y "¿hay filtros?" ───────────────────────────────────────────

const KIND_NAMES: Record<TxKind, string> = {
  income: 'Entrada',
  expense: 'Salida',
  transfer: 'Transferencia',
  opening: 'Saldo inicial',
};

/** ¿Hay criterios además del periodo y del estado por defecto? (meta.filtered de resúmenes e informes) */
export function isFiltered(filter: TxFilter): boolean {
  return (
    (filter.accountIds?.length ?? 0) > 0 ||
    (filter.kinds?.length ?? 0) > 0 ||
    filter.amount?.min !== undefined ||
    filter.amount?.max !== undefined ||
    (filter.text?.trim() ?? '') !== '' ||
    (filter.status !== undefined && filter.status !== 'active') ||
    filter.batchId !== undefined ||
    (filter.fields?.length ?? 0) > 0
  );
}

function rangeText(from: string | undefined, to: string | undefined): string {
  if (from !== undefined && to !== undefined) return `de ${from} a ${to}`;
  if (from !== undefined) return `desde ${from}`;
  return `hasta ${to ?? ''}`;
}

/** "Cuenta: Caja", "Categoría: Ventas, Compras"... en el orden de los criterios. */
export function describeFilter(
  filter: TxFilter,
  ctx: { fields: Field[]; accounts: Account[]; currency?: Currency; locale?: string },
): string[] {
  const lines: string[] = [];
  const money = (m: number) =>
    ctx.currency
      ? Money.format(m, { locale: ctx.locale ?? 'es-DO', currency: ctx.currency })
      : Money.toDecimalString(m, 2);

  if (filter.period !== undefined) {
    const p = filter.period;
    lines.push(
      `Periodo: ${'preset' in p ? PRESET_NAMES[p.preset] : periodLabel(p.from ?? null, p.to ?? null)}`,
    );
  }
  if (filter.accountIds && filter.accountIds.length > 0) {
    const names = new Map(ctx.accounts.map((a) => [a.id, a.name]));
    lines.push(`Cuenta: ${filter.accountIds.map((id) => names.get(id) ?? '(cuenta desconocida)').join(', ')}`);
  }
  if (filter.kinds && filter.kinds.length > 0) lines.push(`Tipo: ${filter.kinds.map((k) => KIND_NAMES[k]).join(', ')}`);
  if (filter.amount && (filter.amount.min !== undefined || filter.amount.max !== undefined)) {
    const { min, max } = filter.amount;
    lines.push(`Monto: ${rangeText(min === undefined ? undefined : money(min), max === undefined ? undefined : money(max))}`);
  }
  if (filter.text !== undefined && filter.text.trim() !== '') lines.push(`Texto: «${filter.text.trim()}»`);
  if (filter.status === 'voided') lines.push('Estado: Anulados');
  if (filter.status === 'all') lines.push('Estado: Todos');
  if (filter.batchId !== undefined) lines.push('Lote: uno solo');

  const byId = new Map(ctx.fields.map((f) => [f.id, f]));
  for (const cond of filter.fields ?? []) {
    const field = byId.get(cond.fieldId);
    const label = field?.label ?? '(campo desconocido)';
    switch (cond.op) {
      case 'any_of': {
        const names = new Map((field?.options ?? []).map((o) => [o.id, o.label]));
        lines.push(`${label}: ${cond.optionIds.map((id) => names.get(id) ?? '(opción desconocida)').join(', ')}`);
        break;
      }
      case 'empty':
        lines.push(`${label}: sin valor`);
        break;
      case 'not_empty':
        lines.push(`${label}: con valor`);
        break;
      case 'is':
        lines.push(`${label}: ${cond.value ? 'Sí' : 'No'}`);
        break;
      case 'contains':
        lines.push(`${label}: contiene «${cond.value}»`);
        break;
      case 'between':
        lines.push(`${label}: ${rangeText(cond.min?.toString(), cond.max?.toString())}`);
        break;
      case 'date_between':
        lines.push(`${label}: ${periodLabel(cond.from ?? null, cond.to ?? null)}`);
        break;
    }
  }
  return lines;
}
