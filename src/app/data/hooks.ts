// Hooks de lectura y escritura compartidos por varias features (ARCHITECTURE.md 5.1). Todos programan contra la
// fachada `Cuadra`, que invalida la caché por ChangeEvent (CuadraProvider): nadie refresca a mano.
// Los hooks de espacio toman el id de la ruta `/e/:wsId`; los globales (`useWorkspaces`, `useSetting`) sirven en cualquier ruta.
import {
  keepPreviousData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams } from 'react-router';
import {
  Money,
  type Currency,
  type Field,
  type FieldOption,
  type Id,
  type Minor,
  type MoneyParseError,
  type Result,
  type SettingsMap,
  type Workspace,
  type WorkspaceSettingsMap,
} from '../../core';
import type { DashboardOptions, DomainError, Page, Totals, TransactionRow, TxFilter, TxSort, ViewRecipe } from '../../core';
import { getLocale } from '../../i18n/format';
import { useCuadra } from './CuadraProvider';
import { queryDefs, TX_TABLES } from './queryDefs';
import { useCuadraQuery } from './useCuadraQuery';
import { useUiStore, type UiState } from '../state/uiStore';

export { useBootInfo } from './bootInfo';
export { useAuth, type UseAuth, type AuthStatus } from './auth';
export type { TxPage } from './queryDefs';

/** Encola un aviso (toast) del shell: `{ message: clave i18n, params?, tone?, undo? }`. Devuelve su id. */
export function usePushToast(): UiState['pushToast'] {
  return useUiStore((s) => s.pushToast);
}

type Q<T> = UseQueryResult<T, DomainError>;

// ── Espacio de la ruta ─────────────────────────────────────────────────────────────────

/** Id del espacio de la ruta `/e/:wsId`. Lanza si se usa fuera de esa ruta. */
export function useWorkspaceId(): Id {
  const { wsId } = useParams();
  if (wsId === undefined) throw new Error('useWorkspaceId se usó fuera de /e/:wsId');
  return wsId;
}

/** Id del espacio si la ruta es `/e/:wsId`; `undefined` fuera de ella. */
export function useOptionalWorkspaceId(): Id | undefined {
  return useParams().wsId;
}

// ── Espacios ────────────────────────────────────────────────────────────────────────────

export function useWorkspaces(opts?: { includeArchived?: boolean }) {
  const d = queryDefs.workspaces(opts);
  return useCuadraQuery(d);
}

/** El espacio de la ruta, o el `id` indicado. */
export function useWorkspace(id?: Id): Q<Workspace> {
  const routeId = useOptionalWorkspaceId();
  const wsId = id ?? routeId;
  const d = queryDefs.workspace(wsId ?? '');
  return useCuadraQuery({ ...d, enabled: wsId !== undefined });
}

// ── Cuentas, saldos y campos ────────────────────────────────────────────────────────────

export function useAccounts(opts?: { includeArchived?: boolean; asOf?: string }) {
  return useCuadraQuery(queryDefs.accounts(useWorkspaceId(), opts));
}

export function useBalances(opts?: { asOf?: string }) {
  return useCuadraQuery(queryDefs.balances(useWorkspaceId(), opts));
}

export function useBalanceSeries(input: { accountIds?: Id[]; period: Parameters<typeof queryDefs.balanceSeries>[1]['period']; unit: 'day' | 'month' }) {
  return useCuadraQuery(queryDefs.balanceSeries(useWorkspaceId(), input));
}

export function useFields(opts?: { includeInactive?: boolean }): Q<Field[]> {
  return useCuadraQuery(queryDefs.fields(useWorkspaceId(), opts));
}

/** Campos con lo que permiten en Resumen y filtros (`groupable`, `filterable`). */
export function useFieldDimensions(): Q<Array<Field & { groupable: boolean; filterable: boolean }>> {
  return useCuadraQuery(queryDefs.fieldDimensions(useWorkspaceId()));
}

/** Las opciones de un campo de lista (activas, o todas con `includeInactive`). Comparte caché con `useFields`. */
export function useFieldOptions(fieldId: Id | null | undefined, opts?: { includeInactive?: boolean }): Q<FieldOption[]> {
  const includeInactive = opts?.includeInactive ?? false;
  const d = queryDefs.fields(useWorkspaceId(), { includeInactive: true });
  return useCuadraQuery({
    ...d,
    enabled: fieldId !== null && fieldId !== undefined,
    select: (fields: Field[]) => {
      const options = fields.find((f) => f.id === fieldId)?.options ?? [];
      return includeInactive ? options : options.filter((o) => o.active);
    },
  });
}

export function useFormSchema(kind: 'income' | 'expense' | 'transfer') {
  return useCuadraQuery(queryDefs.formSchema(useWorkspaceId(), kind));
}

// ── Movimientos ─────────────────────────────────────────────────────────────────────────

/** Una página de movimientos con los totales del conjunto filtrado. Mantiene la anterior mientras llega la nueva. */
export function useTransactions(filter: TxFilter, page: { limit?: number; cursor?: string; sort?: TxSort } = {}) {
  return useCuadraQuery({ ...queryDefs.transactions(useWorkspaceId(), filter, page), keepPrevious: true });
}

/** Listado con «cargar más» (cursor). */
export function useInfiniteTransactions(
  filter: TxFilter,
  opts: { limit?: number; sort?: TxSort } = {},
): UseInfiniteQueryResult<InfiniteData<Page<TransactionRow> & { totals: Totals }, string | undefined>, DomainError> {
  const cuadra = useCuadra();
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: ['transactions.infinite', ws, filter, opts],
    queryFn: ({ pageParam }) =>
      cuadra.queries.listTransactions(ws, {
        filter,
        ...(opts.sort === undefined ? {} : { sort: opts.sort }),
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    meta: { tables: TX_TABLES },
  });
}

export function useTransactionsByDay(filter: TxFilter, page: { limit?: number; cursor?: string } = {}) {
  return useCuadraQuery({ ...queryDefs.transactionsByDay(useWorkspaceId(), filter, page), keepPrevious: true });
}

export function useTransaction(id: Id | null | undefined) {
  const d = queryDefs.transaction(useWorkspaceId(), id ?? '');
  return useCuadraQuery({ ...d, enabled: id !== null && id !== undefined });
}

export function useTransactionHistory(id: Id | null | undefined) {
  const d = queryDefs.transactionHistory(useWorkspaceId(), id ?? '');
  return useCuadraQuery({ ...d, enabled: id !== null && id !== undefined });
}

export function useTotals(filter: TxFilter) {
  return useCuadraQuery({ ...queryDefs.totals(useWorkspaceId(), filter), keepPrevious: true });
}

export function useSummary(input: Parameters<typeof queryDefs.summary>[1]) {
  return useCuadraQuery({ ...queryDefs.summary(useWorkspaceId(), input), keepPrevious: true });
}

/** P-03 en una llamada. `month` = `YYYY-MM`. */
export function useHome(month?: string) {
  return useCuadraQuery(queryDefs.home(useWorkspaceId(), month === undefined ? undefined : { month }));
}

/** Datos del panel de escritorio (`queries.dashboard`). Conserva el resultado anterior al cambiar de periodo. */
export function useDashboard(opts?: DashboardOptions) {
  return useCuadraQuery({ ...queryDefs.dashboard(useWorkspaceId(), opts), keepPrevious: true });
}

// ── Vistas guardadas e historial ────────────────────────────────────────────────────────

export function useViews<K extends ViewRecipe['kind']>(kind: K) {
  return useCuadraQuery(queryDefs.views(useWorkspaceId(), kind));
}
/** Alias con el nombre de ARCHITECTURE.md 5.1. */
export const useSavedViews = useViews;

export function useAudit(input: Parameters<typeof queryDefs.audit>[1] = {}) {
  return useCuadraQuery({ ...queryDefs.audit(useWorkspaceId(), input), keepPrevious: true });
}

// ── Ajustes ─────────────────────────────────────────────────────────────────────────────

/** Ajuste de instalación: `[valor, guardar]`. El valor es `undefined` hasta que carga. */
export function useSetting<K extends keyof SettingsMap>(key: K): [SettingsMap[K] | undefined, (value: SettingsMap[K]) => Promise<void>] {
  const cuadra = useCuadra();
  const { data } = useCuadraQuery(queryDefs.setting(key));
  const save = useCallback((value: SettingsMap[K]) => cuadra.settings.set(key, value), [cuadra, key]);
  return [data as SettingsMap[K] | undefined, save];
}

/** Ajuste del espacio de la ruta: `[valor, guardar]`. */
export function useWorkspaceSetting<K extends keyof WorkspaceSettingsMap>(
  key: K,
): [WorkspaceSettingsMap[K] | undefined, (value: WorkspaceSettingsMap[K]) => Promise<void>] {
  const cuadra = useCuadra();
  const ws = useWorkspaceId();
  const { data } = useCuadraQuery(queryDefs.workspaceSetting(ws, key));
  const save = useCallback((value: WorkspaceSettingsMap[K]) => cuadra.settings.setWs(ws, key, value), [cuadra, ws, key]);
  return [data as WorkspaceSettingsMap[K] | undefined, save];
}

// ── Dinero con la moneda del espacio ────────────────────────────────────────────────────

const FALLBACK_CURRENCY: Currency = { code: 'DOP', minorDigits: 2, symbol: 'RD$' };

function useCurrency(): Currency {
  const { data } = useWorkspace();
  return data?.currency ?? FALLBACK_CURRENCY;
}

export function useMoneyFormat(): (minor: Minor, o?: { sign?: 'auto' | 'always'; compact?: boolean }) => string {
  const currency = useCurrency();
  return useCallback(
    (minor, o) =>
      Money.format(minor, {
        locale: getLocale(),
        currency,
        ...(o?.sign === undefined ? {} : { sign: o.sign }),
        ...(o?.compact === undefined ? {} : { compact: o.compact }),
      }),
    [currency],
  );
}

export function useMoneyParse(): (s: string, o?: { allowNegative?: boolean }) => Result<Minor, MoneyParseError> {
  const currency = useCurrency();
  return useCallback(
    (s, o) => Money.parse(s, { locale: getLocale(), currency, ...(o?.allowNegative === undefined ? {} : { allowNegative: o.allowNegative }) }),
    [currency],
  );
}
