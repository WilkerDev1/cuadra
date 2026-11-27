import { describe, expect, it } from 'vitest';
import {
  appearsInTransfers,
  canDeleteField,
  canDeleteOption,
  findDuplicateLabel,
  parseOptionLines,
  splitActive,
} from './fieldRules';

describe('splitActive', () => {
  it('separa activos e inactivos conservando el orden', () => {
    const items = [
      { id: 'a', active: true },
      { id: 'b', active: false },
      { id: 'c', active: true },
    ];
    const { active, inactive } = splitActive(items);
    expect(active.map((i) => i.id)).toEqual(['a', 'c']);
    expect(inactive.map((i) => i.id)).toEqual(['b']);
  });
});

describe('borrado', () => {
  it('un campo se borra solo sin ningún uso, anulados incluidos', () => {
    expect(canDeleteField({ total: 0, active: 0, voided: 0 })).toBe(true);
    expect(canDeleteField({ total: 1, active: 0, voided: 1 })).toBe(false);
    expect(canDeleteField(undefined)).toBe(false);
  });
  it('una opción fusionada o usada no se borra', () => {
    expect(canDeleteOption({ mergedIntoId: null }, 0)).toBe(true);
    expect(canDeleteOption({ mergedIntoId: null }, 3)).toBe(false);
    expect(canDeleteOption({ mergedIntoId: 'x' }, 0)).toBe(false);
    expect(canDeleteOption({ mergedIntoId: null }, undefined)).toBe(false);
  });
});

describe('findDuplicateLabel', () => {
  const fields = [
    { id: '1', label: 'Categoría', active: true },
    { id: '2', label: 'Fondo', active: false },
  ];
  it('compara sin tildes ni mayúsculas', () => {
    expect(findDuplicateLabel('categoria', fields)).toBe(true);
    expect(findDuplicateLabel('CATEGORÍA', fields, '1')).toBe(false);
  });
  it('los inactivos no cuentan', () => {
    expect(findDuplicateLabel('Fondo', fields)).toBe(false);
  });
  it('vacío no es duplicado', () => {
    expect(findDuplicateLabel('  ', fields)).toBe(false);
  });
});

describe('parseOptionLines', () => {
  it('parte por línea, coma o punto y coma y limpia', () => {
    expect(parseOptionLines('Luz\n  Agua ,Internet;;')).toEqual(['Luz', 'Agua', 'Internet']);
  });
  it('quita repetidas aunque cambien tildes o mayúsculas', () => {
    expect(parseOptionLines('Café\ncafe\nCAFÉ\nTé')).toEqual(['Café', 'Té']);
  });
  it('colapsa espacios internos', () => {
    expect(parseOptionLines('Gastos   varios')).toEqual(['Gastos varios']);
  });
});

describe('appearsInTransfers', () => {
  it('solo los campos de ambos sentidos salen en transferencias', () => {
    expect(appearsInTransfers('both')).toBe(true);
    expect(appearsInTransfers('in')).toBe(false);
  });
});
