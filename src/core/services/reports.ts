// Informes (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2C).
import { notImplemented } from '../errors';
import type {
  Account,
  AuditEntry,
  Currency,
  DateRange,
  Field,
  Id,
  IsoDate,
  Minor,
  StatementLine,
  SummaryGroup,
  Timestamp,
  TransactionRow,
  ViewRecipe,
  Warning,
} from '../types';
import type { CoreDeps } from '../uow';

export type { StatementLine } from '../types';

export type ReportRecipe = Extract<ViewRecipe, { kind: 'report' }>;

export interface ReportDocument {
  meta: {
    workspaceName: string;
    ownerName: string;
    logoDataUrl: string | null;
    currency: Currency;
    period: { from: IsoDate | null; to: IsoDate | null; label: string };
    generatedAt: Timestamp;
    form: 'summary' | 'detailed' | 'custom';
    filtered: boolean;
    filterDescription: string[];
    warnings: Warning[];
    includeVoided: boolean;
  };
  statement: StatementLine;
  byAccount: Array<{ account: Account } & StatementLine>;
  byField: Array<{ field: Field; groups: SummaryGroup[] }>;
  transfers: Array<{ date: IsoDate; fromAccountId: Id; toAccountId: Id; amountMinor: Minor; description: string }>;
  movements: TransactionRow[] | null; // detallado
  voided: TransactionRow[] | null; // si includeVoided
  audit: AuditEntry[] | null;
  signature: boolean;
}

export interface ReportsService {
  build(workspaceId: Id, recipe: ReportRecipe): Promise<ReportDocument>;
  /** Recetas listas: resumido y detallado (10.1). */
  preset(form: 'summary' | 'detailed', period: DateRange): ReportRecipe;
}

export function createReportsService(_deps: CoreDeps): ReportsService {
  return {
    build: async () => notImplemented('reports.build'),
    preset: () => notImplemented('reports.preset'),
  };
}
