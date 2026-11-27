import { describe, expect, it } from 'vitest';
import { isDomainError } from './errors';
import {
  describeFilter,
  isFiltered,
  parseViewRecipe,
  resolveTemplateRecipe,
  validateRecipe,
  type TemplateKeyMap,
} from './recipes';
import type { Account, Field, ViewRecipe } from './types';

const ID = {
  cat: '01900000-0000-7000-8000-000000000001',
  conc: '01900000-0000-7000-8000-000000000002',
  ref: '01900000-0000-7000-8000-000000000003',
  old: '01900000-0000-7000-8000-000000000004',
  ventas: '01900000-0000-7000-8000-000000000011',
  compras: '01900000-0000-7000-8000-000000000012',
  luz: '01900000-0000-7000-8000-000000000013',
  caja: '01900000-0000-7000-8000-000000000021',
  banco: '01900000-0000-7000-8000-000000000022',
  ghost: '01900000-0000-7000-8000-0000000000ff',
};

const field = (over: Partial<Field> & Pick<Field, 'id' | 'key' | 'label' | 'type'>): Field => ({
  workspaceId: 'ws',
  role: null,
  appliesTo: 'both',
  sortOrder: 0,
  showInList: false,
  active: true,
  deactivatedAt: null,
  options: [],
  ...over,
});
const option = (id: string, label: string, active = true) => ({
  id,
  fieldId: ID.cat,
  key: null,
  label,
  color: null,
  appliesTo: 'both' as const,
  sortOrder: 0,
  active,
  mergedIntoId: null,
});

const FIELDS: Field[] = [
  field({
    id: ID.cat,
    key: 'categoria',
    label: 'Categoría',
    type: 'list',
    options: [option(ID.ventas, 'Ventas'), option(ID.compras, 'Compras'), option(ID.luz, 'Electricidad', false)],
  }),
  field({ id: ID.conc, key: 'conciliado', label: 'Conciliado', type: 'bool' }),
  field({ id: ID.ref, key: 'referencia', label: 'Referencia', type: 'text' }),
  field({ id: ID.old, key: 'viejo', label: 'Viejo', type: 'number', active: false, deactivatedAt: '2026-01-01T00:00:00.000Z' }),
];
const account = (id: string, name: string): Account => ({
  id,
  workspaceId: 'ws',
  name,
  type: 'cash',
  color: null,
  icon: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
});
const ACCOUNTS = [account(ID.caja, 'Caja'), account(ID.banco, 'Banco')];

describe('validateRecipe', () => {
  it('avisa de campos inactivos y conserva (con aviso) las condiciones sobre lo que ya no existe', () => {
    const recipe: ViewRecipe = {
      v: 1,
      kind: 'filter',
      filter: {
        fields: [
          { fieldId: ID.old, op: 'between', min: 1 },
          { fieldId: ID.ghost, op: 'empty' },
          { fieldId: ID.cat, op: 'any_of', optionIds: [ID.ventas, ID.luz, ID.ghost] },
        ],
      },
      columns: [ID.ref, ID.ghost, 'date'],
    };
    const { recipe: out, warnings } = validateRecipe(recipe, FIELDS);
    expect(out.filter.fields).toEqual([
      { fieldId: ID.old, op: 'between', min: 1 },
      // Un campo borrado no tiene valores: la condición casa con lo mismo y no se quita (no ensancha).
      { fieldId: ID.ghost, op: 'empty' },
      // Con opciones vivas, la borrada sobra (no casa con nada en el OR).
      { fieldId: ID.cat, op: 'any_of', optionIds: [ID.ventas, ID.luz] },
    ]);
    expect(out.columns).toEqual([ID.ref, 'date']);
    expect(warnings).toEqual(
      expect.arrayContaining([
        { code: 'field_inactive', fieldId: ID.old },
        { code: 'field_missing', fieldKeyOrId: ID.ghost },
        { code: 'option_inactive', fieldId: ID.cat, optionId: ID.luz },
        { code: 'option_missing', fieldId: ID.cat, optionId: ID.ghost },
      ]),
    );
    // No muta la receta original.
    expect(recipe.filter.fields).toHaveLength(3);
  });

  it('si todas las opciones de un any_of ya no existen, conserva la condición: no casa con nada', () => {
    const { recipe, warnings } = validateRecipe(
      { v: 1, kind: 'filter', filter: { fields: [{ fieldId: ID.cat, op: 'any_of', optionIds: [ID.ghost] }] } },
      FIELDS,
    );
    // optionIds: [] significaría "sin restricción" (chip limpio) y la vista mostraría todo el espacio.
    expect(recipe.filter.fields).toEqual([{ fieldId: ID.cat, op: 'any_of', optionIds: [ID.ghost] }]);
    expect(warnings).toEqual([{ code: 'option_missing', fieldId: ID.cat, optionId: ID.ghost }]);
  });

  it('quita condiciones con operador incompatible con el tipo', () => {
    const { recipe, warnings } = validateRecipe(
      { v: 1, kind: 'filter', filter: { fields: [{ fieldId: ID.conc, op: 'contains', value: 'x' }] } },
      FIELDS,
    );
    expect(recipe.filter.fields).toEqual([]);
    expect(warnings).toEqual([{ code: 'field_missing', fieldKeyOrId: ID.conc }]);
  });

  it('en resúmenes cambia una agrupación por un campo inexistente por mes y quita el split', () => {
    const { recipe, warnings } = validateRecipe(
      {
        v: 1,
        kind: 'summary',
        filter: {},
        groupBy: { by: 'field', fieldId: ID.ghost },
        split: { by: 'field', fieldId: ID.ghost },
        measure: 'out',
        chart: 'bars',
      },
      FIELDS,
    );
    expect(recipe.groupBy).toEqual({ by: 'period', unit: 'month' });
    expect(recipe.split).toBeUndefined();
    expect(warnings).toEqual([{ code: 'field_missing', fieldKeyOrId: ID.ghost }]);
  });

  it('en informes filtra groupByFieldIds y columnas', () => {
    const { recipe } = validateRecipe(
      {
        v: 1,
        kind: 'report',
        form: 'custom',
        filter: {},
        sections: ['header', 'statement'],
        groupByFieldIds: [ID.cat, ID.ghost],
        columns: [ID.ghost, ID.ref],
        includeVoided: false,
        signature: true,
      },
      FIELDS,
    );
    expect(recipe.groupByFieldIds).toEqual([ID.cat]);
    expect(recipe.columns).toEqual([ID.ref]);
  });
});

describe('resolveTemplateRecipe', () => {
  const keyMap: TemplateKeyMap = {
    accounts: { caja: ID.caja, banco: ID.banco },
    fields: { categoria: ID.cat, conciliado: ID.conc, referencia: ID.ref },
    options: { 'categoria.ventas': ID.ventas, 'categoria.compras': ID.compras },
  };

  it('traduce claves de plantilla a ids', () => {
    const recipe = resolveTemplateRecipe(
      {
        v: 1,
        kind: 'summary',
        filter: {
          period: { preset: 'this_month' },
          accountIds: ['caja'],
          fields: [
            { fieldId: 'categoria', op: 'any_of', optionIds: ['categoria.ventas', 'compras'] },
            { fieldId: 'conciliado', op: 'is', value: false },
          ],
        },
        groupBy: { by: 'field', fieldId: 'categoria' },
        measure: 'out',
        chart: 'donut',
      },
      keyMap,
    );
    expect(recipe).toEqual({
      v: 1,
      kind: 'summary',
      filter: {
        period: { preset: 'this_month' },
        accountIds: [ID.caja],
        fields: [
          { fieldId: ID.cat, op: 'any_of', optionIds: [ID.ventas, ID.compras] },
          { fieldId: ID.conc, op: 'is', value: false },
        ],
      },
      groupBy: { by: 'field', fieldId: ID.cat },
      measure: 'out',
      chart: 'donut',
    });
  });

  it('traduce columnas y groupByFieldIds de informes, conservando columnas fijas', () => {
    const recipe = resolveTemplateRecipe(
      {
        v: 1,
        kind: 'report',
        form: 'detailed',
        filter: {},
        sections: ['header', 'movements'],
        groupByFieldIds: ['categoria'],
        columns: ['date', 'referencia'],
        includeVoided: false,
        signature: false,
      },
      keyMap,
    );
    expect(recipe.kind === 'report' && recipe.groupByFieldIds).toEqual([ID.cat]);
    expect(recipe.kind === 'report' && recipe.columns).toEqual(['date', ID.ref]);
  });

  it('una clave desconocida o una forma inválida lanzan DomainError', () => {
    let caught: unknown;
    try {
      resolveTemplateRecipe({ v: 1, kind: 'filter', filter: { accountIds: ['tarjeta'] } }, keyMap);
    } catch (e) {
      caught = e;
    }
    expect(isDomainError(caught, 'not_found')).toBe(true);
    expect(() => resolveTemplateRecipe({ v: 2, kind: 'filter', filter: {} }, keyMap)).toThrow('invalid_recipe');
  });
});

describe('parseViewRecipe', () => {
  it('acepta recetas válidas y rechaza formas inválidas con la ruta del fallo', () => {
    expect(parseViewRecipe({ v: 1, kind: 'filter', filter: {} }).ok).toBe(true);
    expect(
      parseViewRecipe({ v: 1, kind: 'filter', filter: { kinds: ['income'], amount: { min: 0 }, status: 'all' } }).ok,
    ).toBe(true);
    expect(parseViewRecipe(null)).toEqual({ ok: false, error: '$' });
    expect(parseViewRecipe({ v: 1, kind: 'filter', filter: { kinds: ['gift'] } })).toEqual({
      ok: false,
      error: '$.filter.kinds',
    });
    expect(parseViewRecipe({ v: 1, kind: 'filter', filter: { amount: { min: 1.5 } } })).toEqual({
      ok: false,
      error: '$.filter.amount.min',
    });
    expect(parseViewRecipe({ v: 1, kind: 'filter', filter: { period: { preset: 'ayer' } } })).toEqual({
      ok: false,
      error: '$.filter.period',
    });
    expect(
      parseViewRecipe({ v: 1, kind: 'summary', filter: {}, groupBy: { by: 'kind' }, measure: 'net', chart: 'pie' }),
    ).toEqual({ ok: false, error: '$.chart' });
    expect(parseViewRecipe({ v: 1, kind: 'filter', filter: { fields: [{ fieldId: 'x', op: 'like' }] } })).toEqual({
      ok: false,
      error: '$.filter.fields[0]',
    });
  });
});

describe('describeFilter e isFiltered', () => {
  it('describe cada criterio en español', () => {
    const lines = describeFilter(
      {
        period: { preset: 'this_month' },
        accountIds: [ID.caja, ID.banco],
        kinds: ['expense'],
        amount: { min: 100000, max: 500050 },
        text: 'café',
        status: 'voided',
        fields: [
          { fieldId: ID.cat, op: 'any_of', optionIds: [ID.ventas, ID.compras] },
          { fieldId: ID.conc, op: 'is', value: false },
          { fieldId: ID.ref, op: 'empty' },
        ],
      },
      { fields: FIELDS, accounts: ACCOUNTS, currency: { code: 'DOP', minorDigits: 2, symbol: 'RD$' }, locale: 'es-DO' },
    );
    expect(lines).toEqual([
      'Periodo: Este mes',
      'Cuenta: Caja, Banco',
      'Tipo: Salida',
      'Monto: de RD$1,000.00 a RD$5,000.50',
      'Texto: «café»',
      'Estado: Anulados',
      'Categoría: Ventas, Compras',
      'Conciliado: No',
      'Referencia: sin valor',
    ]);
  });

  it('isFiltered ignora periodo y estado por defecto', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ period: { preset: 'this_month' }, status: 'active', accountIds: [], text: '  ' })).toBe(false);
    expect(isFiltered({ kinds: ['income'] })).toBe(true);
    expect(isFiltered({ status: 'all' })).toBe(true);
    expect(isFiltered({ fields: [{ fieldId: ID.ref, op: 'not_empty' }] })).toBe(true);
  });
});
