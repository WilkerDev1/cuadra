// Reglas puras de la pantalla de campos: qué se ofrece y cuándo, sin tocar datos.
import { normalizeSearch } from '../../../core';
import type { AppliesTo, Field, FieldOption, FieldRole, FieldType } from '../../../core';

export const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'date', 'list', 'bool'];
export const APPLIES_OPTIONS: readonly AppliesTo[] = ['both', 'in', 'out'];
/** `reconciled` queda fuera: lo maneja la conciliación, no el usuario. */
export const FIELD_ROLES: readonly FieldRole[] = ['category', 'contact', 'fund', 'cost_center', 'payment_method', 'reference'];

export interface Split<T> {
  active: T[];
  inactive: T[];
}

/** Activos primero (en su orden) y los inactivos aparte, también en su orden. */
export function splitActive<T extends { active: boolean }>(items: readonly T[]): Split<T> {
  return { active: items.filter((i) => i.active), inactive: items.filter((i) => !i.active) };
}

export interface FieldUsage {
  total: number;
  active: number;
  voided: number;
}

/** Solo se borra lo que nunca se usó (ni siquiera en un anulado). */
export function canDeleteField(usage: FieldUsage | undefined): boolean {
  return usage !== undefined && usage.total === 0;
}

/** Una opción se borra solo si nunca se usó y no es resto de una fusión. */
export function canDeleteOption(option: Pick<FieldOption, 'mergedIntoId'>, uses: number | undefined): boolean {
  return uses === 0 && option.mergedIntoId === null;
}

/** Etiqueta comparable: sin tildes ni mayúsculas, igual que el núcleo. */
export const labelKey = (label: string): string => normalizeSearch(label);

/** ¿Hay otro campo activo (distinto de `exceptId`) con el mismo nombre? El núcleo lo rechaza igual; esto avisa antes. */
export function findDuplicateLabel(label: string, others: readonly Pick<Field, 'id' | 'label' | 'active'>[], exceptId?: string): boolean {
  const wanted = labelKey(label);
  if (wanted === '') return false;
  return others.some((o) => o.active && o.id !== exceptId && labelKey(o.label) === wanted);
}

/** Texto libre (una opción por línea o separadas por coma) → opciones sin vacíos ni repetidas. */
export function parseOptionLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]/)) {
    const label = raw.trim().replace(/\s+/g, ' ');
    const key = labelKey(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** El campo se muestra en el formulario de transferencia solo si aplica a ambos sentidos. */
export function appearsInTransfers(appliesTo: AppliesTo): boolean {
  return appliesTo === 'both';
}
