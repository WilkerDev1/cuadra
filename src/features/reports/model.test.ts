import { describe, expect, it } from 'vitest';
import type { Field } from '../../core';
import {
  MAX_GROUPS,
  applyParams,
  configToParams,
  configToRecipe,
  defaultConfig,
  filterLines,
  groupableFields,
  isPresetId,
  joinNames,
  lowerFirst,
  chunkByMonth,
  withRunningBalances,
  presetIdOf,
  recipeForSave,
  recipeToConfig,
  sameConfig,
  toggleLimited,
  type ReportRecipe,
} from './model';

const base = (form: 'summary' | 'detailed'): ReportRecipe => ({
  v: 1,
  kind: 'report',
  form,
  filter: { period: { preset: 'this_month' } },
  sections: form === 'summary' ? ['header', 'statement', 'by_account', 'by_field', 'transfers'] : ['header', 'statement', 'by_account', 'by_field', 'transfers', 'movements'],
  groupByFieldIds: [],
  columns: [],
  includeVoided: false,
  signature: false,
});

describe('configToRecipe / recipeToConfig', () => {
  it('traduce la configuración a una receta conservando las secciones del núcleo', () => {
    const cfg = { ...defaultConfig('detailed'), period: { preset: 'last_month' as const }, accountIds: ['a1'], groupByFieldIds: ['f1', 'f2', 'f3'], includeVoided: true };
    const r = configToRecipe(cfg, base('detailed'));
    expect(r.form).toBe('detailed');
    expect(r.filter).toEqual({ period: { preset: 'last_month' }, accountIds: ['a1'] });
    expect(r.groupByFieldIds).toEqual(['f1', 'f2']);
    expect(r.includeVoided).toBe(true);
    expect(r.sections).toContain('movements');
  });

  it('sin cuentas elegidas no escribe accountIds (entran todas)', () => {
    const r = configToRecipe(defaultConfig('summary'), base('summary'));
    expect(r.filter).toEqual({ period: { preset: 'this_month' } });
  });

  it('conserva los filtros que la pantalla no edita', () => {
    const origin: ReportRecipe = { ...base('summary'), filter: { period: { preset: 'this_year' }, text: 'cemento', kinds: ['expense'] } };
    const cfg = recipeToConfig(origin);
    expect(cfg.rest).toEqual({ text: 'cemento', kinds: ['expense'] });
    expect(configToRecipe(cfg, base('summary')).filter).toEqual({ text: 'cemento', kinds: ['expense'], period: { preset: 'this_year' } });
  });

  it('una receta custom con movimientos se lee como detallada', () => {
    const custom: ReportRecipe = { ...base('detailed'), form: 'custom' };
    expect(recipeToConfig(custom).form).toBe('detailed');
    expect(recipeToConfig({ ...custom, sections: ['header', 'statement'] }).form).toBe('summary');
  });

  it('recipeForSave conserva las columnas de la vista de origen', () => {
    const origin: ReportRecipe = { ...base('detailed'), columns: ['date', 'amount'] };
    const saved = recipeForSave(recipeToConfig(origin), base('detailed'), origin);
    expect(saved.columns).toEqual(['date', 'amount']);
  });
});

describe('query string', () => {
  const b = defaultConfig('summary');

  it('sin cambios la URL queda vacía', () => {
    expect(configToParams(b, b).toString()).toBe('');
  });

  it('ida y vuelta de todos los campos', () => {
    const cfg = {
      ...b,
      form: 'detailed' as const,
      period: { from: '2026-01-01', to: '2026-03-31' },
      accountIds: ['a', 'b'],
      groupByFieldIds: ['f1'],
      includeVoided: true,
      signature: true,
    };
    const params = configToParams(cfg, b);
    expect(applyParams(b, new URLSearchParams(params.toString()))).toEqual(cfg);
  });

  it('un preset de periodo reemplaza el rango y los valores inválidos se ignoran', () => {
    const p = new URLSearchParams('periodo=nope&desde=2026-13-40&forma=x&agrupar=a,b,c');
    const cfg = applyParams(b, p);
    expect(cfg.period).toEqual(b.period);
    expect(cfg.form).toBe('summary');
    expect(cfg.groupByFieldIds).toHaveLength(MAX_GROUPS);
    expect(applyParams(b, new URLSearchParams('periodo=last_year')).period).toEqual({ preset: 'last_year' });
  });

  it('desactivar algo que la vista tenía activo se escribe como 0', () => {
    const view = { ...b, includeVoided: true };
    const off = { ...view, includeVoided: false };
    const params = configToParams(off, view);
    expect(params.get('anulados')).toBe('0');
    expect(applyParams(view, params).includeVoided).toBe(false);
  });

  it('sameConfig ignora el resto del filtro', () => {
    expect(sameConfig(b, { ...b, rest: { text: 'x' } })).toBe(true);
    expect(sameConfig(b, { ...b, signature: true })).toBe(false);
  });
});

describe('piezas', () => {
  it('toggleLimited respeta el tope', () => {
    expect(toggleLimited([], 'a', 2)).toEqual(['a']);
    expect(toggleLimited(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleLimited(['a', 'b'], 'a', 2)).toEqual(['b']);
  });

  it('presets de ruta', () => {
    expect(isPresetId('resumido')).toBe(true);
    expect(isPresetId('01a2')).toBe(false);
    expect(isPresetId(undefined)).toBe(false);
    expect(presetIdOf('detailed')).toBe('detallado');
  });

  it('solo se agrupa por listas activas, en su orden', () => {
    const f = (id: string, type: Field['type'], active: boolean, sortOrder: number) => ({ id, type, active, sortOrder }) as Field;
    expect(groupableFields([f('b', 'list', true, 2), f('x', 'text', true, 0), f('c', 'list', false, 1), f('a', 'list', true, 1)]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('el filtro de periodo no se repite en la cabecera', () => {
    expect(filterLines(['Periodo: Este mes', 'Cuenta: Caja'])).toEqual(['Cuenta: Caja']);
  });

  it('une nombres con «y»', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Categoría'])).toBe('Categoría');
    expect(joinNames(['Categoría', 'Centro'])).toBe('Categoría y Centro');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B y C');
  });
});

describe('lowerFirst', () => {
  it('baja la inicial y respeta siglas', () => {
    expect(lowerFirst('Categoría')).toBe('categoría');
    expect(lowerFirst('CxC')).toBe('CxC');
    expect(lowerFirst('')).toBe('');
    expect(lowerFirst('centro de costo')).toBe('centro de costo');
  });
});

describe('chunkByMonth', () => {
  it('agrupa filas consecutivas por mes', () => {
    const rows = [{ date: '2026-01-03' }, { date: '2026-01-20' }, { date: '2026-02-01' }];
    const parts = chunkByMonth(rows);
    expect(parts.map((p) => [p.month, p.rows.length])).toEqual([
      ['2026-01', 2],
      ['2026-02', 1],
    ]);
  });
});

describe('withRunningBalances', () => {
  const row = (accountId: string, direction: 'in' | 'out', amountMinor: number) => ({ accountId, direction, amountMinor, runningMinor: null as number | null });
  const lines = [
    { account: { id: 'a' }, periodOpeningMinor: 1000, closingMinor: 1500 },
    { account: { id: 'b' }, periodOpeningMinor: 0, closingMinor: 200 },
  ];
  it('calcula el saldo de cada cuenta por separado', () => {
    const out = withRunningBalances([row('a', 'in', 700), row('b', 'in', 200), row('a', 'out', 200)], lines);
    expect(out?.map((r) => r.runningMinor)).toEqual([1700, 200, 1500]);
  });
  it('no inventa saldo si no cuadra con el saldo final', () => {
    expect(withRunningBalances([row('a', 'in', 100), row('b', 'in', 200)], lines)).toBeNull();
  });
  it('respeta el saldo que ya dio el núcleo', () => {
    expect(withRunningBalances([{ ...row('a', 'in', 500), runningMinor: 1500 }], lines)).toBeNull();
  });
});
