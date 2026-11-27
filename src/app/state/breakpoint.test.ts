import { describe, expect, it } from 'vitest';
import { atLeast, breakpointFor } from './breakpoint';

describe('breakpointFor (DESIGN §8.1)', () => {
  it.each([
    [0, 'compact'],
    [390, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [820, 'medium'],
    [1023, 'medium'],
    [1024, 'expanded'],
    [1279, 'expanded'],
    [1280, 'wide'],
    [1920, 'wide'],
  ] as const)('%ipx → %s', (width, expected) => {
    expect(breakpointFor(width)).toBe(expected);
  });
  it('atLeast compara por orden de ancho', () => {
    expect(atLeast('wide', 'expanded')).toBe(true);
    expect(atLeast('medium', 'expanded')).toBe(false);
    expect(atLeast('compact', 'compact')).toBe(true);
  });
});
