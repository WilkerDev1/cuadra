// Datos y estado compartidos por las pantallas del libro.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Account, Batch, Currency, DateRange, Field, Id, TransactionRow, TxFilter } from '../../core';
import { useCuadra } from '../../app/data/CuadraProvider';
import { useAccounts, useFields, useWorkspace, useWorkspaceId } from '../../app/data/hooks';
import { TX_TABLES } from '../../app/data/queryDefs';
import { useCuadraQuery } from '../../app/data/useCuadraQuery';
import { getLocale } from '../../i18n/format';
import { DEFAULT_CURRENCY } from '../../ui';
import { readLedgerSearch, writeLedgerSearch } from '../../app/data/txFilterUrl';

export function useCurrency(): Currency {
  return useWorkspace().data?.currency ?? DEFAULT_CURRENCY;
}

/** Cuentas (incluidas archivadas) y campos (incluidos inactivos): lo histórico se sigue leyendo. */
export function useLookups(): { accounts: Account[]; fields: Field[]; ready: boolean } {
  const accounts = useAccounts({ includeArchived: true });
  const fields = useFields({ includeInactive: true });
  return { accounts: accounts.data ?? [], fields: fields.data ?? [], ready: accounts.data !== undefined && fields.data !== undefined };
}

/** Filtro de la pantalla leído de la URL y su escritor (`replace` para no llenar el historial al teclear). */
export function useUrlFilter(opts: { defaultPeriod: DateRange; fixedAccountId?: Id }) {
  const [search, setSearch] = useSearchParams();
  const state = useMemo(() => readLedgerSearch(search, { period: opts.defaultPeriod }), [search, opts.defaultPeriod]);
  const filter = useMemo<TxFilter>(
    () => (opts.fixedAccountId === undefined ? state.filter : { ...state.filter, accountIds: [opts.fixedAccountId] }),
    [state.filter, opts.fixedAccountId],
  );
  const setFilter = useCallback(
    (next: TxFilter, how: { replace?: boolean } = {}) => {
      const qs = writeLedgerSearch(next, {
        defaultPeriod: opts.defaultPeriod,
        keep: search,
        ...(opts.fixedAccountId === undefined ? {} : { fixedAccountId: opts.fixedAccountId }),
      });
      setSearch(qs, { replace: how.replace === true });
    },
    [opts.defaultPeriod, opts.fixedAccountId, search, setSearch],
  );
  return { filter, setFilter, viewId: state.viewId, invalid: state.invalid };
}

/** Todas las filas del filtro (para exportar): páginas de 500 hasta el final. */
export function useFetchAll() {
  const cuadra = useCuadra();
  const ws = useWorkspaceId();
  return useCallback(
    async (filter: TxFilter): Promise<TransactionRow[]> => {
      const rows: TransactionRow[] = [];
      let cursor: string | undefined;
      do {
        const page = await cuadra.queries.listTransactions(ws, { filter, limit: 500, ...(cursor === undefined ? {} : { cursor }) });
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return rows;
    },
    [cuadra, ws],
  );
}

export function useBatches() {
  const ws = useWorkspaceId();
  return useCuadraQuery<Batch[]>({ key: ['ledger.batches', ws], tables: ['batches', 'transactions'], fn: (c) => c.batches.list(ws, { limit: 1000 }) });
}

export function useBatch(id: Id | undefined) {
  const ws = useWorkspaceId();
  return useCuadraQuery<Batch>({
    key: ['ledger.batch', ws, id ?? ''],
    tables: [...TX_TABLES],
    fn: (c) => c.batches.get(id ?? ''),
    enabled: id !== undefined,
  });
}

export function useLocale(): string {
  return getLocale();
}
