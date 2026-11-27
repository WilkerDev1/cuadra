// Edición de filtros combinables (todo con AND entre criterios; OR dentro de un campo de lista). Puro.
import type { FieldCondition, Id, TxKind } from '../../../core';
import { cleanFilters, type Filters } from './state';

const toggle = <T,>(list: readonly T[] | undefined, v: T): T[] => {
  const cur = list ?? [];
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
};

export function toggleAccount(f: Filters, id: Id): Filters {
  return cleanFilters({ ...f, accountIds: toggle(f.accountIds, id) });
}

export function toggleKind(f: Filters, kind: TxKind): Filters {
  return cleanFilters({ ...f, kinds: toggle(f.kinds, kind) });
}

const others = (f: Filters, fieldId: Id): FieldCondition[] => (f.fields ?? []).filter((c) => c.fieldId !== fieldId);

export function selectedOptions(f: Filters, fieldId: Id): Id[] {
  const c = (f.fields ?? []).find((x) => x.fieldId === fieldId);
  return c?.op === 'any_of' ? c.optionIds : [];
}

export function toggleOption(f: Filters, fieldId: Id, optionId: Id): Filters {
  const next = toggle(selectedOptions(f, fieldId), optionId);
  const fields = next.length === 0 ? others(f, fieldId) : [...others(f, fieldId), { fieldId, op: 'any_of' as const, optionIds: next }];
  return cleanFilters({ ...f, fields });
}

export function boolValue(f: Filters, fieldId: Id): boolean | null {
  const c = (f.fields ?? []).find((x) => x.fieldId === fieldId);
  return c?.op === 'is' ? c.value : null;
}

export function setBool(f: Filters, fieldId: Id, value: boolean | null): Filters {
  const fields = value === null ? others(f, fieldId) : [...others(f, fieldId), { fieldId, op: 'is' as const, value }];
  return cleanFilters({ ...f, fields });
}

export function removeField(f: Filters, fieldId: Id): Filters {
  return cleanFilters({ ...f, fields: others(f, fieldId) });
}

export function setText(f: Filters, text: string): Filters {
  return cleanFilters({ ...f, text });
}
