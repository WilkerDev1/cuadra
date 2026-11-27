import { describe, expect, it } from 'vitest';
import { ladderSeries, linePath, niceCeil, sparkPoints, stepPath } from './chartMath';

describe('niceCeil', () => {
  it('redondea a un tope legible', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(87)).toBe(100);
    expect(niceCeil(120)).toBe(200);
    expect(niceCeil(4_100_000)).toBe(5_000_000);
    expect(niceCeil(250)).toBe(250);
  });
});

describe('ladderSeries', () => {
  it('acumula el saldo día a día a partir del inicial', () => {
    const s = ladderSeries(
      [
        { date: '2026-11-01', inMinor: 1000, outMinor: 300 },
        { date: '2026-11-02', inMinor: 0, outMinor: 200 },
      ],
      5000,
    );
    expect(s.map((d) => d.balance)).toEqual([5700, 5500]);
    expect(s[0]?.net).toBe(700);
  });
});

describe('paths', () => {
  it('stepPath dibuja escalones (step-after)', () => {
    expect(stepPath([{ x: 0, y: 10 }, { x: 5, y: 20 }], 10)).toBe('M0 10H5V20H10');
  });
  it('linePath une puntos', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }])).toBe('M0 1L2 3');
  });
  it('sparkPoints ajusta a la caja', () => {
    expect(sparkPoints([0, 10], 64, 20, 2)).toEqual([
      { x: 0, y: 18 },
      { x: 64, y: 2 },
    ]);
  });
});
