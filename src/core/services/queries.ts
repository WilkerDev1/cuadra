// Consultas (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2C).
import { notImplemented } from '../errors';
import type {
  AccountWithBalance,
  DateRange,
  GroupBy,
  Id,
  IsoDate,
  Minor,
  Page,
  SummaryResult,
  Timestamp,
  Totals,
  TransactionRow,
  TxFilter,
  TxSort,
} from '../types';
import type { CoreDeps } from '../uow';

export type { Page, SummaryGroup, SummaryResult, Totals } from '../types';

export interface HomeData {
  totalBalanceMinor: Minor;
  month: Totals;
  previousMonth: Totals;
  monthly: Array<{ key: string; inMinor: Minor; outMinor: Minor }>; // últimos 12 meses
  negativeAccounts: AccountWithBalance[];
  isEmpty: boolean;
  backup: { lastVerifiedAt: Timestamp | null; reminderDays: number; overdue: boolean };
}

export interface QueriesService {
  listTransactions(
    workspaceId: Id,
    input: { filter: TxFilter; sort?: TxSort; limit?: number; cursor?: string },
  ): Promise<Page<TransactionRow> & { totals: Totals }>; // totales del conjunto filtrado completo
  /** Agrupado por día con subtotal diario, para la lista móvil. */
  listByDay(
    workspaceId: Id,
    input: { filter: TxFilter; limit?: number; cursor?: string },
  ): Promise<Page<{ date: IsoDate; inMinor: Minor; outMinor: Minor; items: TransactionRow[] }>>;
  totals(workspaceId: Id, filter: TxFilter): Promise<Totals>;
  balances(workspaceId: Id, opts?: { asOf?: IsoDate }): Promise<{ byAccount: Record<Id, Minor>; totalMinor: Minor }>;
  /** Serie de saldo diario/mensual (gráfica de línea). */
  balanceSeries(
    workspaceId: Id,
    input: { accountIds?: Id[]; period: DateRange; unit: 'day' | 'month' },
  ): Promise<Array<{ key: string; balanceMinor: Minor }>>;
  summarize(workspaceId: Id, input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy }): Promise<SummaryResult>;
  /** P-03 en una llamada. */
  home(workspaceId: Id, input?: { month?: string /* 'YYYY-MM' */ }): Promise<HomeData>;
}

export function createQueriesService(_deps: CoreDeps): QueriesService {
  return {
    listTransactions: async () => notImplemented('queries.listTransactions'),
    listByDay: async () => notImplemented('queries.listByDay'),
    totals: async () => notImplemented('queries.totals'),
    balances: async () => notImplemented('queries.balances'),
    balanceSeries: async () => notImplemented('queries.balanceSeries'),
    summarize: async () => notImplemented('queries.summarize'),
    home: async () => notImplemented('queries.home'),
  };
}
