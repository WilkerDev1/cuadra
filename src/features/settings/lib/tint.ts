// Tintas de lomo (DESIGN §6): 8 tintas del sistema, guardadas como `tint-N`.
export const TINTS = ['tint-1', 'tint-2', 'tint-3', 'tint-4', 'tint-5', 'tint-6', 'tint-7', 'tint-8'] as const;
export type Tint = (typeof TINTS)[number];

const TINT = /^tint-([1-8])$/;
const HEX = /^#[0-9a-f]{6}$/i;

/** Color CSS de lo guardado: la tinta del sistema, un hexadecimal, o `null` si no hay (ninguno o ilegible). */
export function tintCss(color: string | null | undefined): string | null {
  const c = color?.trim() ?? '';
  const m = TINT.exec(c);
  if (m !== null) return `var(--tint-${m[1]})`;
  return HEX.test(c) ? c : null;
}

/** Número 1–8 de una tinta del sistema, para el nombre accesible. */
export function tintNumber(color: string | null | undefined): number | null {
  const m = TINT.exec(color?.trim() ?? '');
  return m === null ? null : Number(m[1]);
}
