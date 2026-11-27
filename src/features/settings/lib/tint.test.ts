import { describe, expect, it } from 'vitest';
import { TINTS, tintCss, tintNumber } from './tint';

describe('tint', () => {
  it('resuelve tintas del sistema y hexadecimales', () => {
    expect(tintCss('tint-3')).toBe('var(--tint-3)');
    expect(tintCss('#A1b2C3')).toBe('#A1b2C3');
  });
  it('devuelve null para vacío o ilegible', () => {
    expect(tintCss(null)).toBeNull();
    expect(tintCss('tint-9')).toBeNull();
    expect(tintCss('red')).toBeNull();
  });
  it('numera las tintas', () => {
    expect(TINTS).toHaveLength(8);
    expect(tintNumber('tint-8')).toBe(8);
    expect(tintNumber('#112233')).toBeNull();
  });
});
