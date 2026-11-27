// Estado y recetas de Informes: funciones puras (sin React ni DOM). La pantalla guarda su configuración en la
// query string para que «atrás» y compartir enlace funcionen (ARCHITECTURE 5.3).
import { isIsoDate, PERIOD_PRESETS } from '../../core';
import type { DateRange, Field, Id, PeriodPreset, ReportSection, TxFilter, ViewRecipe } from '../../core';

export type ReportForm = 'summary' | 'detailed';
export type ReportRecipe = Extract<ViewRecipe, { kind: 'report' }>;

/** Máximo de dimensiones por las que agrupar (DESIGN 10.12). */
export const MAX_GROUPS = 2;

/** Ids de ruta con significado propio; cualquier otro es el id de una vista guardada. */
export const PRESET_IDS = { resumido: 'summary', detallado: 'detailed' } as const satisfies Record<string, ReportForm>;
export type PresetId = keyof typeof PRESET_IDS;

export function isPresetId(id: string | undefined): id is PresetId {
  return id !== undefined && Object.hasOwn(PRESET_IDS, id);
}
export const presetIdOf = (form: ReportForm): PresetId => (form === 'summary' ? 'resumido' : 'detallado');

export interface ReportConfig {
  form: ReportForm;
  period: DateRange;
  /** Vacío = todas las cuentas. */
  accountIds: Id[];
  groupByFieldIds: Id[];
  includeVoided: boolean;
  signature: boolean;
  /** Resto del filtro de una vista guardada (campos, texto, montos…) que esta pantalla no edita pero conserva. */
  rest: Omit<TxFilter, 'period' | 'accountIds'>;
}

export const DEFAULT_PERIOD: DateRange = { preset: 'this_month' };

export function defaultConfig(form: ReportForm): ReportConfig {
  return { form, period: DEFAULT_PERIOD, accountIds: [], groupByFieldIds: [], includeVoided: false, signature: false, rest: {} };
}

/** Periodos que ofrece el selector de la configuración. */
export const REPORT_PERIODS: readonly PeriodPreset[] = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_12_months',
  'all',
];

// ── Receta ⇄ configuración ──────────────────────────────────────────────────────────────

/**
 * Receta lista para `reports.build`. `base` es `reports.preset(form, period)`: así las secciones salen del núcleo.
 * Con filtros que esta pantalla no edita (`rest`) se conservan tal cual.
 */
export function configToRecipe(config: ReportConfig, base: ReportRecipe): ReportRecipe {
  const filter: TxFilter = { ...config.rest, period: config.period };
  if (config.accountIds.length > 0) filter.accountIds = [...config.accountIds];
  return {
    ...base,
    form: config.form,
    filter,
    groupByFieldIds: config.groupByFieldIds.slice(0, MAX_GROUPS),
    includeVoided: config.includeVoided,
    signature: config.signature,
  };
}

/** Configuración que representa una vista guardada. Una receta `custom` se lee como detallada si lista movimientos. */
export function recipeToConfig(recipe: ReportRecipe): ReportConfig {
  const { period, accountIds, ...rest } = recipe.filter;
  const form: ReportForm =
    recipe.form === 'custom' ? (recipe.sections.includes('movements') ? 'detailed' : 'summary') : recipe.form;
  return {
    form,
    period: period ?? DEFAULT_PERIOD,
    accountIds: accountIds ?? [],
    groupByFieldIds: recipe.groupByFieldIds.slice(0, MAX_GROUPS),
    includeVoided: recipe.includeVoided,
    signature: recipe.signature || recipe.sections.includes('signature'),
    rest,
  };
}

/** Receta que se guarda como vista: la de `configToRecipe`, conservando las secciones y columnas de la vista de origen. */
export function recipeForSave(config: ReportConfig, base: ReportRecipe, origin?: ReportRecipe): ReportRecipe {
  const recipe = configToRecipe(config, base);
  if (origin === undefined || origin.form === 'custom') return recipe;
  return { ...recipe, columns: origin.columns };
}

// ── Query string ────────────────────────────────────────────────────────────────────────

const csv = (v: string | null): string[] => (v === null || v === '' ? [] : v.split(',').filter((x) => x !== ''));

function parsePeriod(params: URLSearchParams): DateRange | null {
  const preset = params.get('periodo');
  if (preset !== null && (PERIOD_PRESETS as readonly string[]).includes(preset)) return { preset: preset as PeriodPreset };
  const from = params.get('desde');
  const to = params.get('hasta');
  const f = from !== null && isIsoDate(from) ? from : undefined;
  const t = to !== null && isIsoDate(to) ? to : undefined;
  if (f === undefined && t === undefined) return null;
  return { ...(f === undefined ? {} : { from: f }), ...(t === undefined ? {} : { to: t }) };
}

/** Aplica la query string sobre una configuración base (la de la ruta o de la vista guardada). */
export function applyParams(base: ReportConfig, params: URLSearchParams): ReportConfig {
  const forma = params.get('forma');
  const next: ReportConfig = { ...base };
  if (forma === 'resumido') next.form = 'summary';
  else if (forma === 'detallado') next.form = 'detailed';
  const period = parsePeriod(params);
  if (period !== null) next.period = period;
  if (params.has('cuentas')) next.accountIds = csv(params.get('cuentas'));
  if (params.has('agrupar')) next.groupByFieldIds = csv(params.get('agrupar')).slice(0, MAX_GROUPS);
  if (params.has('anulados')) next.includeVoided = params.get('anulados') === '1';
  if (params.has('firma')) next.signature = params.get('firma') === '1';
  return next;
}

/**
 * Query string con TODO lo que difiere de `base`: la URL queda corta mientras no se toca nada y, al compartirla,
 * reproduce el informe aunque la vista guardada cambie después.
 */
export function configToParams(config: ReportConfig, base: ReportConfig): URLSearchParams {
  const p = new URLSearchParams();
  if (config.form !== base.form) p.set('forma', config.form === 'summary' ? 'resumido' : 'detallado');
  if (JSON.stringify(config.period) !== JSON.stringify(base.period)) {
    if ('preset' in config.period) p.set('periodo', config.period.preset);
    else {
      if (config.period.from !== undefined) p.set('desde', config.period.from);
      if (config.period.to !== undefined) p.set('hasta', config.period.to);
    }
  }
  if (config.accountIds.join() !== base.accountIds.join()) p.set('cuentas', config.accountIds.join(','));
  if (config.groupByFieldIds.join() !== base.groupByFieldIds.join()) p.set('agrupar', config.groupByFieldIds.join(','));
  if (config.includeVoided !== base.includeVoided) p.set('anulados', config.includeVoided ? '1' : '0');
  if (config.signature !== base.signature) p.set('firma', config.signature ? '1' : '0');
  return p;
}

/** ¿Dos configuraciones son la misma (para saber si hay cambios por guardar)? */
export function sameConfig(a: ReportConfig, b: ReportConfig): boolean {
  return (
    a.form === b.form &&
    JSON.stringify(a.period) === JSON.stringify(b.period) &&
    a.accountIds.join() === b.accountIds.join() &&
    a.groupByFieldIds.join() === b.groupByFieldIds.join() &&
    a.includeVoided === b.includeVoided &&
    a.signature === b.signature
  );
}

// ── Piezas del documento ────────────────────────────────────────────────────────────────

/** Campos por los que se puede agrupar: listas activas. */
export function groupableFields(fields: readonly Field[]): Field[] {
  return fields.filter((f) => f.type === 'list' && f.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Alterna un id en una lista con tope; al llegar al tope no añade más. */
export function toggleLimited(list: readonly Id[], id: Id, max: number): Id[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= max ? [...list] : [...list, id];
}

/** Líneas del filtro que merecen salir en la cabecera (el periodo ya tiene su propia línea). */
export function filterLines(lines: readonly string[]): string[] {
  return lines.filter((l) => !l.startsWith('Periodo:'));
}

export const hasSection = (recipe: ReportRecipe, section: ReportSection): boolean => recipe.sections.includes(section);

/** Une nombres con «y»: «Categoría y Centro». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1) ?? ''}`;
}
