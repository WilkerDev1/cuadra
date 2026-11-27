// Reordenar listas con ↑ ↓ (alternativa visible al arrastre). Funciones puras: devuelven el orden nuevo de ids.

/** Orden nuevo tras mover `id` una posición (`-1` sube, `1` baja). `null` si ya está en el borde o no existe. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = from + delta;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Posición de `id` (1 = primero) y total, para decir «ahora es el 2.º de 5». */
export function positionOf(ids: readonly string[], id: string): { position: number; total: number } | null {
  const index = ids.indexOf(id);
  return index < 0 ? null : { position: index + 1, total: ids.length };
}

/**
 * El servicio solo reordena los ids que recibe (`sort_order = índice`). Para no pisar el orden de lo inactivo
 * se manda siempre el orden completo: primero lo visible reordenado y después el resto, en su orden actual.
 */
export function fullOrder(visible: readonly string[], rest: readonly string[]): string[] {
  return [...visible, ...rest.filter((id) => !visible.includes(id))];
}
