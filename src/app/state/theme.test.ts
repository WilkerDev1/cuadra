import { describe, expect, it } from 'vitest';
import { nextTheme, themeAttribute } from './theme';

describe('tema', () => {
  it('sistema no fuerza ningún atributo', () => {
    expect(themeAttribute('system')).toBeNull();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
  it('el ciclo recorre los tres y vuelve al sistema', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
