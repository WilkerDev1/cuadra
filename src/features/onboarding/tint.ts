// Tinta del lomo de una plantilla: su `tint-N` o, si no trae una válida, una estable por su id.
const TINT_TOKEN = /^(?:tint-)?([1-8])$/;

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function workspaceTint(color: string | null | undefined, id: string): string {
  const token = TINT_TOKEN.exec(color?.trim() ?? '');
  if (token !== null) return `var(--tint-${token[1]})`;
  return `var(--tint-${(hashString(id) % 8) + 1})`;
}
