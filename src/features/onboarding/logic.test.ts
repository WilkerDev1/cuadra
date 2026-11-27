import { describe, expect, it } from 'vitest';
import type { TemplatePreview } from '../../core';
import {
  advanceProgress,
  buildApplyInput,
  categoryOptions,
  currencyByCode,
  currencyLabel,
  defaultDirection,
  demoPercent,
  describeIssues,
  guardStep,
  hasOpenings,
  minorToExpression,
  nameProblem,
  nextStep,
  openingTotal,
  previousStep,
  resolveStep,
  splitChips,
  stepPosition,
  stepsFor,
  summarizeTemplate,
  templateFileProblem,
  withOpening,
} from './logic';

const preview: TemplatePreview = {
  templateId: 'negocio',
  name: 'Negocio pequeño',
  description: '',
  color: 'tint-1',
  currency: { code: 'DOP', minorDigits: 2, symbol: 'RD$' },
  accounts: [
    { key: 'caja', name: 'Caja', type: 'cash' },
    { key: 'banco', name: 'Banco', type: 'bank' },
    { key: 'tarjeta', name: 'Tarjeta', type: 'card' },
  ],
  fields: [
    { key: 'categoria', label: 'Categoría', type: 'list', role: 'category', options: ['Ventas', 'Alquiler'] },
    { key: 'metodo', label: 'Método de pago', type: 'list', role: 'payment_method', options: ['Efectivo'] },
    { key: 'ncf', label: 'NCF', type: 'text', role: 'reference', options: [] },
  ],
  views: [{ key: 'v1', name: 'Ventas', kind: 'filter' }],
};

describe('pasos', () => {
  it('primera vez: tres pasos; con espacios, sin bienvenida', () => {
    expect(stepsFor(false)).toEqual(['inicio', 'plantilla', 'saldos']);
    expect(stepsFor(true)).toEqual(['plantilla', 'saldos']);
  });
  it('resuelve el paso de la URL y cae en el primero si no es válido', () => {
    expect(resolveStep(null, false)).toBe('inicio');
    expect(resolveStep('saldos', false)).toBe('saldos');
    expect(resolveStep('inicio', true)).toBe('plantilla');
    expect(resolveStep('otro', true)).toBe('plantilla');
  });
  it('sin plantilla no se llega a los saldos', () => {
    expect(guardStep('saldos', false)).toBe('plantilla');
    expect(guardStep('saldos', true)).toBe('saldos');
    expect(guardStep('inicio', false)).toBe('inicio');
  });
  it('posición, siguiente y anterior', () => {
    expect(stepPosition('plantilla', false)).toEqual({ n: 2, total: 3 });
    expect(stepPosition('plantilla', true)).toEqual({ n: 1, total: 2 });
    expect(nextStep('inicio', false)).toBe('plantilla');
    expect(nextStep('saldos', false)).toBeNull();
    expect(previousStep('plantilla', true)).toBeNull();
    expect(previousStep('plantilla', false)).toBe('inicio');
  });
});

describe('nombre y moneda', () => {
  it('valida el nombre', () => {
    expect(nameProblem('   ')).toBe('empty');
    expect(nameProblem('Ferretería La Esquina')).toBeNull();
    expect(nameProblem('x'.repeat(81))).toBe('too_long');
    expect(nameProblem(` ${'x'.repeat(80)} `)).toBeNull();
  });
  it('DOP por defecto y respaldo ante un código desconocido', () => {
    expect(currencyByCode('USD').symbol).toBe('US$');
    expect(currencyByCode('ZZZ').code).toBe('DOP');
    expect(currencyLabel(currencyByCode('DOP'))).toBe('RD$ · Peso dominicano (DOP)');
  });
});

describe('resumen de plantilla', () => {
  it('cuenta cuentas, categorías y el resto de campos', () => {
    expect(summarizeTemplate(preview)).toEqual({ accounts: 3, categories: 2, otherFields: 2, views: 1 });
    expect(categoryOptions(preview)).toEqual(['Ventas', 'Alquiler']);
  });
  it('plantilla en blanco sin categoría', () => {
    const blank: TemplatePreview = { ...preview, fields: [], views: [], accounts: [preview.accounts[0]!] };
    expect(summarizeTemplate(blank)).toEqual({ accounts: 1, categories: 0, otherFields: 0, views: 0 });
  });
  it('recorta listas largas', () => {
    expect(splitChips([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], more: 2 });
    expect(splitChips([1, 2], 2)).toEqual({ shown: [1, 2], more: 0 });
  });
});

describe('archivo de plantilla', () => {
  it('rechaza lo muy grande y lo que no es .json', () => {
    expect(templateFileProblem({ name: 'a.json', size: 2_000_000 })).toBe('too_big');
    expect(templateFileProblem({ name: 'a.txt', size: 10 })).toBe('not_json');
    expect(templateFileProblem({ name: 'mi.cuadra-plantilla.JSON', size: 10 })).toBeNull();
  });
  it('resume las incidencias', () => {
    const issues = [
      { path: 'accounts[0].key', message: 'Falta la clave.' },
      { path: '', message: 'Formato desconocido.' },
      { path: 'fields[1]', message: 'Tipo inválido.' },
      { path: 'views[0]', message: 'Receta inválida.' },
    ];
    expect(describeIssues(issues, 3)).toEqual({
      lines: ['accounts[0].key: Falta la clave.', 'Formato desconocido.', 'fields[1]: Tipo inválido.'],
      more: 1,
    });
  });
});

describe('saldos iniciales', () => {
  it('las tarjetas empiezan en deuda', () => {
    expect(defaultDirection('card')).toBe('out');
    expect(defaultDirection('cash')).toBe('in');
    expect(defaultDirection('savings')).toBe('in');
  });
  it('pone y quita saldos sin mutar', () => {
    const a = withOpening({}, 'caja', { amountMinor: 150_000, direction: 'in' });
    expect(a).toEqual({ caja: { amountMinor: 150_000, direction: 'in' } });
    const b = withOpening(a, 'tarjeta', { amountMinor: 20_000, direction: 'out' });
    expect(a).toEqual({ caja: { amountMinor: 150_000, direction: 'in' } });
    expect(openingTotal(b)).toBe(130_000);
    expect(hasOpenings(withOpening(b, 'caja', null))).toBe(true);
    expect(withOpening(b, 'caja', { amountMinor: 0, direction: 'in' })).toEqual({ tarjeta: { amountMinor: 20_000, direction: 'out' } });
    expect(hasOpenings({})).toBe(false);
  });
  it('arma la entrada de templates.apply: moneda, nombre recortado y solo saldos válidos', () => {
    const input = buildApplyInput(
      {
        name: '  Ferretería La Esquina ',
        currencyCode: 'USD',
        openings: {
          caja: { amountMinor: 100_050, direction: 'in' },
          tarjeta: { amountMinor: 25_000, direction: 'out' },
          fantasma: { amountMinor: 5_000, direction: 'in' },
        },
      },
      ['caja', 'banco', 'tarjeta'],
      '2026-11-27',
    );
    expect(input).toEqual({
      name: 'Ferretería La Esquina',
      currency: { code: 'USD', minorDigits: 2, symbol: 'US$' },
      openingBalances: {
        caja: { amountMinor: 100_050, direction: 'in', date: '2026-11-27' },
        tarjeta: { amountMinor: 25_000, direction: 'out', date: '2026-11-27' },
      },
    });
  });
});

describe('minorToExpression', () => {
  it('vuelve a la forma que escribe el teclado', () => {
    expect(minorToExpression(100_050, 2)).toBe('1000.5');
    expect(minorToExpression(100_000, 2)).toBe('1000');
    expect(minorToExpression(5, 2)).toBe('0.05');
    expect(minorToExpression(123, 0)).toBe('123');
    expect(minorToExpression(0, 2)).toBe('');
  });
});

describe('progreso de los ejemplos', () => {
  it('porcentaje entero acotado', () => {
    expect(demoPercent(0)).toBe(0);
    expect(demoPercent(0.426)).toBe(42);
    expect(demoPercent(0.999)).toBe(99);
    expect(demoPercent(1)).toBe(100);
    expect(demoPercent(1.4)).toBe(100);
    expect(demoPercent(-1)).toBe(0);
    expect(demoPercent(Number.NaN)).toBe(0);
  });
  it('nunca retrocede', () => {
    expect(advanceProgress(40, 0.3)).toBe(40);
    expect(advanceProgress(40, 0.55)).toBe(55);
  });
});
