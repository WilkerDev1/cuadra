// Estado del Resumen (DESIGN 10.11): periodo, agrupación, medida, gráfica, comparación y filtros.
// Vive en la query string (ARCHITECTURE 5.3) y se guarda como receta `summary` (vistas guardadas).
// Todo es puro y sin React: se prueba en state.test.ts.
import { isIsoDate, PERIOD_PRESETS } from '../../../core';
import { decodeTxFilter, encodeBase64Url } from '../../../app/data/txFilterUrl';
import type { DateRange, Field, GroupBy, PeriodPreset, TxFilter, TxKind, ViewRecipe } from '../../../core';

export type Measure = 'in' | 'out' | 'net' | 'count';
export type ChartKind = 'bars' | 'line' | 'ladder' | 'ranked';
export type TimeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type SummaryRecipe = Extract<ViewRecipe, { kind: 'summary' }>;

/** Filtros combinables (el periodo va aparte). */
export type Filters = Pick<TxFilter, 'accountIds' | 'kinds' | 'fields' | 'text'>;

export interface SummaryState {
  period: DateRange;
  groupBy: GroupBy;
  split: GroupBy | null;
  measure: Measure;
  chart: ChartKind;
  compare: boolean;
  filters: Filters;
}

export const MEASURES: readonly Measure[] = ['in', 'out', 'net', 'count'];
export const CHARTS: readonly ChartKind[] = ['bars', 'line', 'ladder', 'ranked'];
export const TIME_UNITS: readonly TimeUnit[] = ['day', 'week', 'month', 'quarter', 'year'];
export const SUMMARY_PRESETS: readonly PeriodPreset[] = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_12_months',
  'all',
];

export const DEFAULT_STATE: SummaryState = {
  period: { preset: 'last_12_months' },
  groupBy: { by: 'period', unit: 'month' },
  split: null,
  measure: 'net',
  chart: 'ladder',
  compare: false,
  filters: {},
};

export const isTime = (g: GroupBy | null): g is Extract<GroupBy, { by: 'period' }> => g !== null && g.by === 'period';

/** Gráficas que tienen sentido para una agrupación: líneas y Escalera solo sobre el tiempo. */
export function chartAllowed(chart: ChartKind, groupBy: GroupBy): boolean {
  return chart === 'bars' || chart === 'ranked' || isTime(groupBy);
}

export function defaultChart(groupBy: GroupBy): ChartKind {
  return isTime(groupBy) ? 'bars' : 'ranked';
}

// ── Claves de agrupación (URL y selects) ─────────────────────────────────────────────

const UNIT_PARAM: Record<TimeUnit, string> = { day: 'dia', week: 'semana', month: 'mes', quarter: 'trimestre', year: 'ano' };
const PARAM_UNIT = Object.fromEntries(Object.entries(UNIT_PARAM).map(([k, v]) => [v, k])) as Record<string, TimeUnit>;

export function groupParam(g: GroupBy): string {
  switch (g.by) {
    case 'period':
      return UNIT_PARAM[g.unit];
    case 'account':
      return 'cuenta';
    case 'kind':
      return 'tipo';
    case 'field':
      return `campo:${g.fieldId}`;
  }
}

export function parseGroupParam(s: string | null): GroupBy | null {
  if (s === null || s === '') return null;
  const unit = PARAM_UNIT[s];
  if (unit !== undefined) return { by: 'period', unit };
  if (s === 'cuenta') return { by: 'account' };
  if (s === 'tipo') return { by: 'kind' };
  if (s.startsWith('campo:') && s.length > 6) return { by: 'field', fieldId: s.slice(6) };
  return null;
}

export const sameGroup = (a: GroupBy | null, b: GroupBy | null): boolean =>
  (a === null ? '' : groupParam(a)) === (b === null ? '' : groupParam(b));

// ── Normalización ────────────────────────────────────────────────────────────────────

export interface NormalizeResult {
  state: SummaryState;
  /** Ids de campos que la agrupación pedía y ya no existen. */
  missingFields: string[];
}

/**
 * Deja el estado coherente: agrupación por un campo inexistente → por mes (y se avisa), segunda agrupación
 * igual a la primera o de tiempo sobre tiempo → sin segunda, gráfica imposible → la de su agrupación.
 * `fields` = campos del espacio (incluye inactivos); `undefined` mientras cargan (no se toca nada).
 */
export function normalizeState(s: SummaryState, fields: readonly Pick<Field, 'id'>[] | undefined): NormalizeResult {
  const missingFields: string[] = [];
  const known = (g: GroupBy): boolean => {
    if (g.by !== 'field' || fields === undefined) return true;
    if (fields.some((f) => f.id === g.fieldId)) return true;
    missingFields.push(g.fieldId);
    return false;
  };
  let groupBy = s.groupBy;
  if (!known(groupBy)) groupBy = { by: 'period', unit: 'month' };
  let split = s.split;
  if (split !== null && (!known(split) || sameGroup(split, groupBy) || (isTime(split) && isTime(groupBy)))) split = null;
  const chart = chartAllowed(s.chart, groupBy) ? s.chart : defaultChart(groupBy);
  const compare = s.compare && !('preset' in s.period && s.period.preset === 'all');
  return { state: { ...s, groupBy, split, chart, compare }, missingFields };
}

// ── Filtros ↔ base64url ──────────────────────────────────────────────────────────────

/** Quita lo vacío para que dos filtros iguales den la misma cadena. */
export function cleanFilters(f: Filters): Filters {
  const out: Filters = {};
  if (f.accountIds !== undefined && f.accountIds.length > 0) out.accountIds = [...f.accountIds];
  if (f.kinds !== undefined && f.kinds.length > 0) out.kinds = [...f.kinds];
  if (f.fields !== undefined && f.fields.length > 0) out.fields = f.fields.map((c) => ({ ...c }));
  if (f.text !== undefined && f.text.trim() !== '') out.text = f.text;
  return out;
}

export const hasFilters = (f: Filters): boolean => Object.keys(cleanFilters(f)).length > 0;

/** Filtros de la propia pantalla → parámetro `f` (base64url de JSON, el mismo formato que Movimientos). */
export function encodeFilter(filter: TxFilter): string {
  return encodeBase64Url(JSON.stringify(filter));
}

/** Parámetro `f` → TxFilter con forma válida (la comprueba el núcleo), o `null`. */
export const decodeFilter = decodeTxFilter;

// ── Periodo ↔ parámetro ──────────────────────────────────────────────────────────────

export function periodParam(p: DateRange): string {
  return 'preset' in p ? p.preset : `${p.from ?? ''}..${p.to ?? ''}`;
}

export function parsePeriodParam(s: string | null): DateRange | null {
  if (s === null || s === '') return null;
  if ((PERIOD_PRESETS as readonly string[]).includes(s)) return { preset: s as PeriodPreset };
  const m = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(s);
  if (m === null) return null;
  const [, from, to] = m;
  if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to))) return null;
  if (from === undefined && to === undefined) return null;
  if (from !== undefined && to !== undefined && from > to) return null;
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

// ── Estado ↔ query string ────────────────────────────────────────────────────────────

const MEASURE_PARAM: Record<Measure, string> = { in: 'entradas', out: 'salidas', net: 'neto', count: 'conteo' };
const CHART_PARAM: Record<ChartKind, string> = { bars: 'barras', line: 'lineas', ladder: 'escalera', ranked: 'orden' };
const invert = <K extends string>(r: Record<K, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [v, k])) as Record<string, K>;
const PARAM_MEASURE = invert(MEASURE_PARAM);
const PARAM_CHART = invert(CHART_PARAM);

export const PARAM_KEYS = ['periodo', 'por', 'luego', 'medida', 'grafica', 'comparar', 'f'] as const;

/** Lo que trae la URL (solo las claves presentes y válidas). `luego=` vacío = sin segunda agrupación. */
export function parseParams(sp: URLSearchParams): { viewId: string | null; patch: Partial<SummaryState> } {
  const patch: Partial<SummaryState> = {};
  const period = parsePeriodParam(sp.get('periodo'));
  if (period !== null) patch.period = period;
  const groupBy = parseGroupParam(sp.get('por'));
  if (groupBy !== null) patch.groupBy = groupBy;
  if (sp.has('luego')) patch.split = parseGroupParam(sp.get('luego'));
  const measure = PARAM_MEASURE[sp.get('medida') ?? ''];
  if (measure !== undefined) patch.measure = measure;
  const chart = PARAM_CHART[sp.get('grafica') ?? ''];
  if (chart !== undefined) patch.chart = chart;
  if (sp.has('comparar')) patch.compare = sp.get('comparar') === '1';
  if (sp.has('f')) {
    const f = decodeFilter(sp.get('f'));
    if (f !== null) patch.filters = cleanFilters(f);
  }
  const viewId = sp.get('vista');
  return { viewId: viewId === null || viewId === '' ? null : viewId, patch };
}

/** Estado completo → query string (orden fijo: dos estados iguales dan la misma cadena). */
export function toParams(s: SummaryState, viewId: string | null): URLSearchParams {
  const sp = new URLSearchParams();
  if (viewId !== null) sp.set('vista', viewId);
  sp.set('periodo', periodParam(s.period));
  sp.set('por', groupParam(s.groupBy));
  sp.set('luego', s.split === null ? '' : groupParam(s.split));
  sp.set('medida', MEASURE_PARAM[s.measure]);
  sp.set('grafica', CHART_PARAM[s.chart]);
  sp.set('comparar', s.compare ? '1' : '0');
  const f = cleanFilters(s.filters);
  if (Object.keys(f).length > 0) sp.set('f', encodeFilter(f));
  return sp;
}

export function sameState(a: SummaryState, b: SummaryState): boolean {
  return toParams(a, null).toString() === toParams(b, null).toString();
}

export function mergeState(base: SummaryState, patch: Partial<SummaryState>): SummaryState {
  return { ...base, ...patch };
}

// ── Estado ↔ receta guardada ─────────────────────────────────────────────────────────

/**
 * La receta del núcleo solo conoce `measure: in|out|both|net` y `chart: bars|donut|line|table`. Lo que el Resumen
 * añade (conteo, Escalera, barras ordenadas, comparar) viaja en la clave extra `insights`, que el núcleo conserva
 * tal cual; la parte estándar queda con el valor más parecido para que otros lectores la entiendan.
 */
export interface InsightsExtra {
  measure: Measure;
  chart: ChartKind;
  compare: boolean;
}

function readExtra(recipe: SummaryRecipe): Partial<InsightsExtra> {
  const x = (recipe as SummaryRecipe & { insights?: unknown }).insights;
  if (typeof x !== 'object' || x === null) return {};
  const o = x as Record<string, unknown>;
  return {
    ...(MEASURES.includes(o['measure'] as Measure) ? { measure: o['measure'] as Measure } : {}),
    ...(CHARTS.includes(o['chart'] as ChartKind) ? { chart: o['chart'] as ChartKind } : {}),
    ...(typeof o['compare'] === 'boolean' ? { compare: o['compare'] } : {}),
  };
}

export function fromRecipe(recipe: SummaryRecipe): SummaryState {
  const extra = readExtra(recipe);
  const { period, accountIds, kinds, fields, text } = recipe.filter;
  const time = isTime(recipe.groupBy);
  const measure: Measure = extra.measure ?? (recipe.measure === 'both' ? 'net' : recipe.measure);
  let chart: ChartKind;
  if (extra.chart !== undefined) chart = extra.chart;
  else if (recipe.measure === 'both' && time) chart = 'ladder';
  else if (recipe.chart === 'line' && time) chart = 'line';
  else chart = defaultChart(recipe.groupBy); // bars, donut (nunca se dibuja) y table
  return {
    period: period ?? { preset: 'all' },
    groupBy: recipe.groupBy,
    split: recipe.split ?? null,
    measure,
    chart,
    compare: extra.compare ?? false,
    filters: cleanFilters({
      ...(accountIds === undefined ? {} : { accountIds }),
      ...(kinds === undefined ? {} : { kinds }),
      ...(fields === undefined ? {} : { fields }),
      ...(text === undefined ? {} : { text }),
    }),
  };
}

export function toRecipe(s: SummaryState): SummaryRecipe {
  const recipe = {
    v: 1 as const,
    kind: 'summary' as const,
    filter: { ...cleanFilters(s.filters), period: s.period },
    groupBy: s.groupBy,
    ...(s.split === null ? {} : { split: s.split }),
    measure: s.measure === 'count' ? ('both' as const) : s.measure,
    chart: s.chart === 'line' ? ('line' as const) : ('bars' as const),
    insights: { measure: s.measure, chart: s.chart, compare: s.compare } satisfies InsightsExtra,
  };
  return recipe;
}

/** El TxFilter completo del estado (lo que se pide al núcleo). */
export function stateFilter(s: SummaryState): TxFilter {
  return { ...cleanFilters(s.filters), period: s.period };
}

export const FLOW_KINDS: readonly TxKind[] = ['income', 'expense'];
