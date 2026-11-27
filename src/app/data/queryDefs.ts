// Definiciones puras de las consultas compartidas: clave, tablas de las que dependen y llamada al núcleo.
// Los hooks (hooks.ts) las pasan a useCuadraQuery; las pruebas las ejecutan contra una fachada falsa.
// Convención de clave: [nombre, workspaceId | undefined, ...parámetros]. El segundo elemento lo lee la invalidación
// por eventos (CuadraProvider.isAffected): `undefined` = consulta global, la afecta cualquier espacio.
import type {
  Cuadra,
  DateRange,
  GroupBy,
  Id,
  IsoDate,
  TableName,
  TxFilter,
  TxSort,
  ViewRecipe,
  AuditAction,
  DashboardOptions,
} from '../../core';
import type { QueryDef } from './useCuadraQuery';

export type { QueryDef } from './useCuadraQuery';

const def = <T>(key: readonly unknown[], tables: TableName[], fn: (c: Cuadra) => Promise<T>): QueryDef<T> => ({ key, tables, fn });

/** Todo lo que cambia el contenido de un listado o total de movimientos. */
export const TX_TABLES: TableName[] = [
  'transactions',
  'transaction_field_values',
  'accounts',
  'fields',
  'field_options',
  'batches',
];

export interface TxPage {
  limit?: number;
  cursor?: string;
  sort?: TxSort;
}

export const queryDefs = {
  workspaces: (opts?: { includeArchived?: boolean }) =>
    def(['workspaces.list', undefined, opts?.includeArchived ?? false], ['workspaces', 'accounts', 'transactions'], (c) =>
      c.workspaces.list(opts),
    ),
  workspace: (id: Id) => def(['workspaces.get', id], ['workspaces'], (c) => c.workspaces.get(id)),
  accounts: (ws: Id, opts?: { includeArchived?: boolean; asOf?: IsoDate }) =>
    def(['accounts.list', ws, opts?.includeArchived ?? false, opts?.asOf ?? null], ['accounts', 'transactions'], (c) =>
      c.accounts.list(ws, opts),
    ),
  balances: (ws: Id, opts?: { asOf?: IsoDate }) =>
    def(['queries.balances', ws, opts?.asOf ?? null], ['accounts', 'transactions'], (c) => c.queries.balances(ws, opts)),
  balanceSeries: (ws: Id, input: { accountIds?: Id[]; period: DateRange; unit: 'day' | 'month' }) =>
    def(['queries.balanceSeries', ws, input], ['accounts', 'transactions'], (c) => c.queries.balanceSeries(ws, input)),
  fields: (ws: Id, opts?: { includeInactive?: boolean }) =>
    def(['fields.list', ws, opts?.includeInactive ?? false], ['fields', 'field_options'], (c) => c.fields.list(ws, opts)),
  formSchema: (ws: Id, kind: 'income' | 'expense' | 'transfer') =>
    def(['fields.formSchema', ws, kind], ['fields', 'field_options'], (c) => c.fields.formSchema(ws, kind)),
  transactions: (ws: Id, filter: TxFilter, page: TxPage = {}) =>
    def(['transactions.list', ws, filter, page], TX_TABLES, (c) =>
      c.queries.listTransactions(ws, {
        filter,
        ...(page.sort === undefined ? {} : { sort: page.sort }),
        ...(page.limit === undefined ? {} : { limit: page.limit }),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      }),
    ),
  transactionsByDay: (ws: Id, filter: TxFilter, page: Pick<TxPage, 'limit' | 'cursor'> = {}) =>
    def(['transactions.byDay', ws, filter, page], TX_TABLES, (c) =>
      c.queries.listByDay(ws, {
        filter,
        ...(page.limit === undefined ? {} : { limit: page.limit }),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      }),
    ),
  transaction: (ws: Id, id: Id) =>
    def(['transactions.get', ws, id], ['transactions', 'transaction_field_values'], (c) => c.transactions.get(id)),
  transactionHistory: (ws: Id, id: Id) =>
    def(['transactions.history', ws, id], ['transactions', 'transaction_field_values', 'audit_log'], (c) =>
      c.transactions.history(id),
    ),
  totals: (ws: Id, filter: TxFilter) =>
    def(['queries.totals', ws, filter], TX_TABLES, (c) => c.queries.totals(ws, filter)),
  summary: (ws: Id, input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy }) =>
    def(['queries.summary', ws, input], TX_TABLES, (c) => c.queries.summarize(ws, input)),
  home: (ws: Id, input?: { month?: string }) =>
    def(['queries.home', ws, input?.month ?? null], [...TX_TABLES, 'settings'], (c) => c.queries.home(ws, input)),
  /** Panel de escritorio completo en una llamada (queries.dashboard). */
  dashboard: (ws: Id, opts?: DashboardOptions) =>
    def(['queries.dashboard', ws, opts ?? null], [...TX_TABLES, 'settings'], (c) => c.queries.dashboard(ws, opts)),
  views: <K extends ViewRecipe['kind']>(ws: Id, kind: K) =>
    def(['views.list', ws, kind], ['saved_views'], (c) => c.views.list(ws, kind)),
  audit: (
    ws: Id,
    input: { from?: IsoDate; to?: IsoDate; accountId?: Id; actions?: AuditAction[]; entityType?: string; limit?: number; cursor?: string },
  ) => def(['audit.list', ws, input], ['audit_log'], (c) => c.audit.list(ws, input)),
  setting: <K extends Parameters<Cuadra['settings']['get']>[0]>(key: K) =>
    def(['settings.get', undefined, key], ['settings'], (c) => c.settings.get(key)),
  workspaceSetting: <K extends Parameters<Cuadra['settings']['getWs']>[1]>(ws: Id, key: K) =>
    def(['settings.getWs', ws, key], ['settings'], (c) => c.settings.getWs(ws, key)),
};
