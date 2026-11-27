// Criterios activos de un filtro como chips («Tipo: Salida», «Categoría: Materiales +1»), cada uno con su
// filtro sin ese criterio. El periodo no sale aquí: tiene su propio selector.
import type { Account, Field, FieldCondition, Minor, TxFilter } from '../../../core';

export interface FilterChip {
  id: string;
  label: string;
  value: string;
  without: TxFilter;
}

export interface ChipsCtx {
  accounts: readonly Account[];
  fields: readonly Field[];
  money: (minor: Minor) => string;
  date: (iso: string) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Cuenta fija de la pantalla: no se muestra ni se puede quitar. */
  fixedAccountId?: string;
}

function many(names: string[], t: ChipsCtx['t']): string {
  if (names.length <= 1) return names[0] ?? '';
  return t('ledger.filter.many', { first: names[0] ?? '', n: names.length - 1 });
}

function conditionValue(cond: FieldCondition, field: Field | undefined, ctx: ChipsCtx): string {
  switch (cond.op) {
    case 'any_of':
      return many(
        cond.optionIds.map((id) => field?.options.find((o) => o.id === id)?.label ?? ctx.t('ledger.value.unknownOption')),
        ctx.t,
      );
    case 'empty':
      return ctx.t('ledger.filter.empty');
    case 'not_empty':
      return ctx.t('ledger.filter.notEmpty');
    case 'is':
      return ctx.t(cond.value ? 'ledger.value.yes' : 'ledger.value.no');
    case 'contains':
      return `«${cond.value}»`;
    case 'between':
      return range(cond.min === undefined ? undefined : String(cond.min), cond.max === undefined ? undefined : String(cond.max), ctx.t);
    case 'date_between':
      return range(cond.from === undefined ? undefined : ctx.date(cond.from), cond.to === undefined ? undefined : ctx.date(cond.to), ctx.t);
  }
}

function range(min: string | undefined, max: string | undefined, t: ChipsCtx['t']): string {
  if (min !== undefined && max !== undefined) return t('ledger.filter.between', { min, max });
  if (min !== undefined) return t('ledger.filter.atLeast', { min });
  return t('ledger.filter.atMost', { max: max ?? '' });
}

export function filterChips(filter: TxFilter, ctx: ChipsCtx): FilterChip[] {
  const chips: FilterChip[] = [];
  const accounts = (filter.accountIds ?? []).filter((id) => id !== ctx.fixedAccountId);
  if (accounts.length > 0) {
    const names = accounts.map((id) => ctx.accounts.find((a) => a.id === id)?.name ?? ctx.t('ledger.value.unknownAccount'));
    const rest: TxFilter = { ...filter };
    if (ctx.fixedAccountId === undefined) delete rest.accountIds;
    else rest.accountIds = [ctx.fixedAccountId];
    chips.push({ id: 'account', label: ctx.t('ledger.filter.account'), value: many(names, ctx.t), without: rest });
  }
  if (filter.kinds !== undefined && filter.kinds.length > 0) {
    const { kinds: _k, ...rest } = filter;
    chips.push({ id: 'kind', label: ctx.t('ledger.filter.kind'), value: many(filter.kinds.map((k) => ctx.t(`ledger.kind.${k}`)), ctx.t), without: rest });
  }
  if (filter.status !== undefined && filter.status !== 'active') {
    const { status: _s, ...rest } = filter;
    chips.push({ id: 'status', label: ctx.t('ledger.filter.status'), value: ctx.t(`ledger.filter.status.${filter.status}`), without: rest });
  }
  if (filter.amount !== undefined && (filter.amount.min !== undefined || filter.amount.max !== undefined)) {
    const { amount, ...rest } = filter;
    chips.push({
      id: 'amount',
      label: ctx.t('ledger.filter.amount'),
      value: range(amount.min === undefined ? undefined : ctx.money(amount.min), amount.max === undefined ? undefined : ctx.money(amount.max), ctx.t),
      without: rest,
    });
  }
  if (filter.text !== undefined && filter.text.trim() !== '') {
    const { text, ...rest } = filter;
    chips.push({ id: 'text', label: ctx.t('ledger.filter.text'), value: `«${text.trim()}»`, without: rest });
  }
  if (filter.batchId !== undefined) {
    const { batchId: _b, ...rest } = filter;
    chips.push({ id: 'batch', label: ctx.t('ledger.filter.batch'), value: ctx.t('ledger.filter.batchOne'), without: rest });
  }
  for (const cond of filter.fields ?? []) {
    const field = ctx.fields.find((f) => f.id === cond.fieldId);
    const others = (filter.fields ?? []).filter((c) => c !== cond);
    const rest: TxFilter = { ...filter };
    if (others.length > 0) rest.fields = others;
    else delete rest.fields;
    chips.push({
      id: `field:${cond.fieldId}`,
      label: field?.label ?? ctx.t('ledger.value.unknownField'),
      value: conditionValue(cond, field, ctx),
      without: rest,
    });
  }
  return chips;
}

/** Cambia (o quita, con `null`) la condición de un campo. */
export function setFieldCondition(filter: TxFilter, fieldId: string, cond: FieldCondition | null): TxFilter {
  const others = (filter.fields ?? []).filter((c) => c.fieldId !== fieldId);
  const fields = cond === null ? others : [...others, cond];
  const out: TxFilter = { ...filter };
  if (fields.length > 0) out.fields = fields;
  else delete out.fields;
  return out;
}

/** Alterna un valor en una lista (tipos, cuentas, opciones). */
export function toggle<T>(list: readonly T[] | undefined, value: T): T[] {
  const current = list ?? [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}
