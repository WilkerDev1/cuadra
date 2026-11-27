// Fusión de opciones de una lista: a qué opciones se puede fusionar y cuál se propone.
import type { FieldOption } from '../../../core';

/** Destinos válidos: las demás opciones activas del mismo campo. */
export function mergeCandidates(options: readonly FieldOption[], sourceId: string): FieldOption[] {
  return options.filter((o) => o.active && o.id !== sourceId);
}

/**
 * Destino propuesto: la parecida más cercana si es candidata (el núcleo ya las ordena de más a menos parecida);
 * si no, la primera candidata. `null` si no hay a dónde fusionar.
 */
export function defaultMergeTarget(candidates: readonly FieldOption[], similar: readonly FieldOption[]): string | null {
  const ids = new Set(candidates.map((c) => c.id));
  const near = similar.find((s) => ids.has(s.id));
  return near?.id ?? candidates[0]?.id ?? null;
}
