// Derivados del panel que comparten escritorio y móvil: enlaces, lo que pide atención y la categoría para las filas.
import { useMemo } from 'react';
import { useFields, useTransactions, useWorkspaceId } from '../../app/data/hooks';
import { groupFilter, monthRange, type DashboardData, type DateRange, type Field, type GroupBy, type Id, type TxFilter } from '../../core';
import { useT } from '../../i18n';
import { findPossibleDuplicates } from './logic/duplicates';
import { movementsHref } from './logic/links';
import type { AttentionItem } from './components/Side';

const DUP_FILTER: TxFilter = { period: { preset: 'last_30_days' }, kinds: ['income', 'expense'] };

export interface HomeLinks {
  movements: (filter?: TxFilter) => string;
  account: (id: Id) => string;
  tx: (id: Id) => string;
  month: (key: string) => string;
  /** `kind`: solo entradas o solo salidas (lo que mide el reparto), así la suma de la lista es la de la barra. */
  group: (groupBy: GroupBy, key: string | null, period: DateRange, kind?: 'income' | 'expense') => string;
  record: string;
}

export function useHomeLinks(): HomeLinks {
  const ws = useWorkspaceId();
  const fields = useFields({ includeInactive: true });
  return useMemo(() => {
    const fieldType = (id: Id) => fields.data?.find((f) => f.id === id)?.type;
    return {
      movements: (filter = {}) => movementsHref(ws, filter),
      account: (id) => movementsHref(ws, { accountIds: [id] }),
      tx: (id) => `/e/${ws}/movimientos/${id}`,
      month: (key) => movementsHref(ws, { period: monthRange(key), kinds: ['income', 'expense'] }),
      group: (groupBy, key, period, kind) => {
        const ft = groupBy.by === 'field' ? fieldType(groupBy.fieldId) : undefined;
        const base: TxFilter = kind === undefined ? { period } : { period, kinds: [kind] };
        return movementsHref(ws, groupFilter(base, groupBy, key, ft === undefined ? {} : { fieldType: ft }));
      },
      record: `/e/${ws}/nuevo?tipo=entrada`,
    };
  }, [ws, fields.data]);
}

/** El campo de categoría (rol), o la primera lista activa: da la meta de las filas recientes. */
export function useCategoryField(): Field | null {
  const fields = useFields({ includeInactive: true });
  return useMemo(() => {
    const lists = (fields.data ?? []).filter((f) => f.type === 'list');
    return lists.find((f) => f.role === 'category') ?? lists.find((f) => f.active) ?? null;
  }, [fields.data]);
}

/** Lista de «Pide atención»: cuentas en negativo, lotes descuadrados, respaldo vencido y posibles duplicados. */
export function useAttention(data: DashboardData | undefined, links: HomeLinks): AttentionItem[] {
  const t = useT();
  const ws = useWorkspaceId();
  const recent = useTransactions(DUP_FILTER, { limit: 500 });
  return useMemo(() => {
    if (data === undefined || data.isEmpty) return [];
    const items: AttentionItem[] = [];
    const neg = data.attention.negativeAccounts;
    if (neg.length > 2) {
      items.push({ id: 'neg', text: t('home.attention.negativeMany', { n: neg.length }), href: links.movements() });
    } else {
      for (const a of neg) {
        items.push({ id: `neg-${a.id}`, text: t('home.attention.negative', { name: a.name }), href: links.account(a.id), detail: { minor: a.balanceMinor } });
      }
    }
    const unb = data.attention.unbalancedBatches;
    const one = unb.length === 1 ? unb[0] : undefined;
    if (one !== undefined) {
      items.push({
        id: `batch-${one.batch.id}`,
        text: t('home.attention.unbalanced', { label: one.batch.label }),
        href: `/e/${ws}/lotes/${one.batch.id}`,
        detail: { minor: Math.abs(one.differenceMinor), kind: one.differenceMinor >= 0 ? 'income' : 'expense' },
      });
    } else if (unb.length > 1) {
      items.push({ id: 'batches', text: t('home.attention.unbalancedMany', { n: unb.length }), href: `/e/${ws}/lotes` });
    }
    const pairs = findPossibleDuplicates(recent.data?.items ?? []);
    const first = pairs[0];
    if (first !== undefined && pairs.length === 1) {
      items.push({
        id: `dup-${first.latest.id}`,
        text: t('home.attention.duplicate', { desc: first.latest.description }),
        href: links.movements({
          accountIds: [first.accountId],
          kinds: [first.latest.kind],
          amount: { min: first.amountMinor, max: first.amountMinor },
          period: { from: first.from, to: first.to },
        }),
        detail: { minor: first.amountMinor, kind: first.latest.kind === 'income' ? 'income' : 'expense' },
      });
    } else if (pairs.length > 1) {
      items.push({ id: 'dups', text: t('home.attention.duplicates', { n: pairs.length }), href: links.movements(DUP_FILTER) });
    }
    const bk = data.attention.backup;
    if (bk.overdue) {
      items.push({
        id: 'backup',
        text: bk.daysSince === null ? t('home.attention.backupNever') : t('home.attention.backup', { n: bk.daysSince }),
        href: '/respaldo',
      });
    }
    return items;
  }, [data, recent.data, links, t, ws]);
}
