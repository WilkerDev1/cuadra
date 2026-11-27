// Tinta de un espacio (el «lomo» del libro): su color si es un color CSS válido; si no, una de las 8 tintas del
// sistema elegida de forma estable por su id (el mismo espacio siempre tiene la misma tinta).
const CSS_COLOR = /^(#[0-9a-f]{3,8}|(?:oklch|oklab|hsl|rgb|color-mix|var)\(.+\))$/i;
const TINT_TOKEN = /^(?:tint-)?([1-8])$/;

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function workspaceTint(color: string | null | undefined, id: string): string {
  const c = color?.trim() ?? '';
  const token = TINT_TOKEN.exec(c);
  if (token !== null) return `var(--tint-${token[1]})`;
  if (CSS_COLOR.test(c)) return c;
  return `var(--tint-${(hashString(id) % 8) + 1})`;
}

/** Inicial para el lomo: primera letra o dígito del nombre, en mayúscula. */
export function workspaceInitial(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name.trim());
  return (match?.[0] ?? '·').toLocaleUpperCase('es');
}
