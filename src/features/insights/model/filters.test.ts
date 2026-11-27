import { describe, expect, it } from 'vitest';
import { boolValue, removeField, selectedOptions, setBool, setText, toggleAccount, toggleKind, toggleOption } from './filters';

describe('filtros', () => {
  it('cuentas y tipos se alternan y lo vacío desaparece', () => {
    const a = toggleAccount({}, 'c1');
    expect(a).toEqual({ accountIds: ['c1'] });
    expect(toggleAccount(a, 'c1')).toEqual({});
    expect(toggleKind(toggleKind({}, 'income'), 'expense')).toEqual({ kinds: ['income', 'expense'] });
  });

  it('opciones de lista: OR dentro del campo, una condición por campo', () => {
    let f = toggleOption({}, 'cat', 'o1');
    f = toggleOption(f, 'cat', 'o2');
    f = toggleOption(f, 'met', 'm1');
    expect(selectedOptions(f, 'cat')).toEqual(['o1', 'o2']);
    expect(f.fields).toHaveLength(2);
    f = toggleOption(toggleOption(f, 'cat', 'o1'), 'cat', 'o2');
    expect(f.fields).toEqual([{ fieldId: 'met', op: 'any_of', optionIds: ['m1'] }]);
    expect(removeField(f, 'met')).toEqual({});
  });

  it('sí/no y texto', () => {
    const f = setBool({}, 'fiscal', true);
    expect(boolValue(f, 'fiscal')).toBe(true);
    expect(setBool(f, 'fiscal', null)).toEqual({});
    expect(setText({}, '  ')).toEqual({});
    expect(setText({}, 'luz')).toEqual({ text: 'luz' });
  });
});
