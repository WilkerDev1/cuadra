import { describe, expect, it } from 'vitest';
import { workspaceInitial, workspaceTint } from './workspaceTint';

describe('workspaceTint', () => {
  it('respeta colores CSS y fichas de tinta', () => {
    expect(workspaceTint('#3a7d44', 'x')).toBe('#3a7d44');
    expect(workspaceTint('oklch(0.62 0.09 155)', 'x')).toBe('oklch(0.62 0.09 155)');
    expect(workspaceTint('tint-3', 'x')).toBe('var(--tint-3)');
    expect(workspaceTint('5', 'x')).toBe('var(--tint-5)');
  });
  it('sin color usa una tinta estable por id', () => {
    const a = workspaceTint(null, 'espacio-a');
    expect(a).toMatch(/^var\(--tint-[1-8]\)$/);
    expect(workspaceTint(null, 'espacio-a')).toBe(a);
    expect(workspaceTint('no es un color; } body{', 'espacio-a')).toBe(a);
  });
  it('reparte los ids entre las ocho tintas', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, n) => workspaceTint(null, `id-${n}`)));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});

describe('workspaceInitial', () => {
  it('toma la primera letra en mayúscula, con acentos', () => {
    expect(workspaceInitial('colmado La Esquina')).toBe('C');
    expect(workspaceInitial('  ñandú')).toBe('Ñ');
    expect(workspaceInitial('3 Hermanos')).toBe('3');
    expect(workspaceInitial('   ')).toBe('·');
  });
});
