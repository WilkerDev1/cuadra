// Generador pseudoaleatorio determinista para los datos de ejemplo (ARCHITECTURE.md 6). Misma semilla →
// misma secuencia en cualquier motor. Los montos que salen de aquí son SIEMPRE enteros en unidad menor: la
// tirada aleatoria es un número de coma flotante, pero se convierte a entero antes de tocar dinero.
import type { Minor } from '../types';

/** mulberry32: 32 bits de estado, periodo 2^32. Devuelve números en [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Redondea un entero al múltiplo de `unit` más cercano (mitades hacia arriba), sin divisiones en coma flotante. */
export function roundToUnit(minor: Minor, unit: Minor): Minor {
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(unit) || unit <= 0) {
    throw new RangeError(`roundToUnit necesita enteros: ${minor}, ${unit}`);
  }
  const r = ((minor % unit) + unit) % unit;
  const base = minor - r;
  return 2 * r >= unit ? base + unit : base;
}

/** `percent` % (0–1000) de un monto entero, redondeado a la unidad menor (reparto exacto de Money.allocate). */
export function percentOf(minor: Minor, percent: number): Minor {
  if (!Number.isSafeInteger(minor) || !Number.isInteger(percent) || percent < 0 || percent > 1000) {
    throw new RangeError(`percentOf necesita enteros: ${minor}, ${percent}`);
  }
  // Entero exacto: (minor × percent) / 100 con redondeo a la mitad, en BigInt para no perder precisión.
  const num = BigInt(minor) * BigInt(percent);
  const q = num / 100n;
  const rem = num % 100n;
  const adj = rem * 2n >= 100n ? 1n : rem * 2n <= -100n ? -1n : 0n;
  return Number(q + adj);
}

export interface Rng {
  next(): number;
  /** Entero uniforme en [min, max] (ambos incluidos). */
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  /** Entero ~N(mean, sd) redondeado a `roundTo` y nunca menor que `roundTo`. */
  normalMinor(meanMinor: Minor, sdMinor: Minor, roundTo: Minor): Minor;
  /** Entero uniforme en [min, max] redondeado a `roundTo`. */
  rangeMinor(minMinor: Minor, maxMinor: Minor, roundTo: Minor): Minor;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick<T>(xs: readonly T[]): T {
      if (xs.length === 0) throw new RangeError('pick de una lista vacía');
      return xs[int(0, xs.length - 1)] as T;
    },
    chance: (p) => next() < p,
    normalMinor(meanMinor, sdMinor, roundTo) {
      // Box-Muller; u1 en (0, 1] para no tomar log(0).
      const u1 = 1 - next();
      const u2 = next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const raw = Math.round(meanMinor + sdMinor * z);
      return Math.max(roundTo, roundToUnit(raw, roundTo));
    },
    rangeMinor(minMinor, maxMinor, roundTo) {
      return Math.max(roundTo, roundToUnit(int(minMinor, maxMinor), roundTo));
    },
  };
}

/** Hash FNV-1a de 32 bits en hex (para la prueba de determinismo; no es criptográfico). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
