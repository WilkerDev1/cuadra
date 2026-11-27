import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  decodeFilter,
  encodeFilter,
  fromRecipe,
  normalizeState,
  parseParams,
  parsePeriodParam,
  sameState,
  toParams,
  toRecipe,
  type SummaryRecipe,
  type SummaryState,
} from './state';
import { parseViewRecipe } from '../../../core';

const FIELD = '0190a1b2-0000-7000-8000-000000000001';
const OPTION = '0190a1b2-0000-7000-8000-0000000000aa';

const rich: SummaryState = {
  period: { from: '2026-01-01', to: '2026-03-31' },
  groupBy: { by: 'field', fieldId: FIELD },
  split: { by: 'period', unit: 'month' },
  measure: 'count',
  chart: 'ranked',
  compare: true,
  filters: { accountIds: ['a1'], kinds: ['expense'], fields: [{ fieldId: FIELD, op: 'any_of', optionIds: [OPTION] }], text: 'café ñ' },
};

describe('query string', () => {
  it('ida y vuelta conserva el estado completo, con tildes en el texto', () => {
    const sp = toParams(rich, 'v1');
    const { viewId, patch } = parseParams(new URLSearchParams(sp.toString()));
    expect(viewId).toBe('v1');
    expect(sameState({ ...DEFAULT_STATE, ...patch }, rich)).toBe(true);
    expect(patch.filters?.text).toBe('café ñ');
  });

  it('solo trae lo que está presente; luego vacío = sin segunda agrupación', () => {
    const { patch } = parseParams(new URLSearchParams('vista=x&por=cuenta&luego='));
    expect(patch).toEqual({ groupBy: { by: 'account' }, split: null });
  });

  it('ignora valores inválidos sin romper', () => {
    const { patch, viewId } = parseParams(new URLSearchParams('periodo=ayer&por=nada&medida=x&grafica=dona&f=%%%'));
    expect(patch).toEqual({});
    expect(viewId).toBeNull();
  });

  it('periodo: preset, rango, rango abierto e inválidos', () => {
    expect(parsePeriodParam('this_year')).toEqual({ preset: 'this_year' });
    expect(parsePeriodParam('2026-01-01..2026-01-31')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(parsePeriodParam('..2026-01-31')).toEqual({ to: '2026-01-31' });
    expect(parsePeriodParam('2026-02-30..2026-03-01')).toBeNull();
    expect(parsePeriodParam('2026-03-01..2026-01-01')).toBeNull();
    expect(parsePeriodParam('..')).toBeNull();
  });

  it('filtro en base64url: ida y vuelta, y forma inválida → null', () => {
    const f = { kinds: ['income' as const], period: { preset: 'this_month' as const } };
    expect(decodeFilter(encodeFilter(f))).toEqual(f);
    expect(encodeFilter(f)).not.toMatch(/[+/=]/);
    expect(decodeFilter(encodeFilter({ kinds: ['nope'] } as never))).toBeNull();
    expect(decodeFilter('no-es-base64-json')).toBeNull();
  });
});

describe('receta', () => {
  it('toRecipe produce una receta válida para el núcleo y vuelve igual', () => {
    const recipe = toRecipe(rich);
    const parsed = parseViewRecipe(recipe);
    expect(parsed.ok).toBe(true);
    expect(recipe.measure).toBe('both');
    expect(recipe.chart).toBe('bars');
    expect(sameState(fromRecipe(recipe), rich)).toBe(true);
  });

  it('recetas de ejemplo sin la clave extra se abren con la gráfica más parecida (nunca dona)', () => {
    const base = { v: 1, kind: 'summary', filter: { period: { preset: 'this_month' } } } as const;
    const donut = fromRecipe({ ...base, groupBy: { by: 'field', fieldId: FIELD }, measure: 'out', chart: 'donut' } as SummaryRecipe);
    expect(donut.chart).toBe('ranked');
    expect(donut.measure).toBe('out');
    const both = fromRecipe({ ...base, groupBy: { by: 'period', unit: 'month' }, measure: 'both', chart: 'bars' } as SummaryRecipe);
    expect(both).toMatchObject({ chart: 'ladder', measure: 'net' });
    const line = fromRecipe({ ...base, groupBy: { by: 'period', unit: 'month' }, measure: 'in', chart: 'line' } as SummaryRecipe);
    expect(line.chart).toBe('line');
    const table = fromRecipe({ ...base, groupBy: { by: 'period', unit: 'quarter' }, measure: 'in', chart: 'table' } as SummaryRecipe);
    expect(table.chart).toBe('bars');
    const noPeriod = fromRecipe({ v: 1, kind: 'summary', filter: {}, groupBy: { by: 'kind' }, measure: 'net', chart: 'line' });
    expect(noPeriod.period).toEqual({ preset: 'all' });
    expect(noPeriod.chart).toBe('ranked');
  });
});

describe('normalizeState', () => {
  it('agrupación por campo inexistente → por mes, y lo avisa', () => {
    const r = normalizeState({ ...DEFAULT_STATE, groupBy: { by: 'field', fieldId: 'gone' }, chart: 'ranked' }, [{ id: FIELD }]);
    expect(r.state.groupBy).toEqual({ by: 'period', unit: 'month' });
    expect(r.missingFields).toEqual(['gone']);
  });

  it('mientras cargan los campos no toca nada', () => {
    const s = { ...DEFAULT_STATE, groupBy: { by: 'field' as const, fieldId: 'x' }, chart: 'ranked' as const };
    expect(normalizeState(s, undefined)).toEqual({ state: s, missingFields: [] });
  });

  it('quita la segunda agrupación repetida o de tiempo sobre tiempo, y corrige la gráfica', () => {
    const a = normalizeState({ ...DEFAULT_STATE, split: { by: 'period', unit: 'week' } }, []);
    expect(a.state.split).toBeNull();
    const b = normalizeState({ ...DEFAULT_STATE, groupBy: { by: 'account' }, split: { by: 'account' }, chart: 'line' }, []);
    expect(b.state.split).toBeNull();
    expect(b.state.chart).toBe('ranked');
  });

  it('sin límites de periodo no hay comparación', () => {
    expect(normalizeState({ ...DEFAULT_STATE, period: { preset: 'all' }, compare: true }, []).state.compare).toBe(false);
  });
});
