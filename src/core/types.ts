// Tipos de dominio (ARCHITECTURE.md 3.2). Solo tipos: este módulo no tiene código en tiempo de ejecución.
//
// Además de 3.2 viven aquí las formas de datos "puras" de 3.4 (recetas) y de 3.5 (historial, totales,
// resúmenes) que la UI necesita pintar: `src/ui/**` solo puede importar core/types, core/money y
// core/dates (regla 1.3). Sus módulos de origen (recipes.ts, services/*.ts) las reexportan, así que
// `import type { TxFilter } from './recipes'` y `from './types'` son equivalentes.

export type Id = string; // uuidv7
export type IsoDate = string; // 'YYYY-MM-DD'
export type Timestamp = string; // ISO-8601 UTC
export type Minor = number; // entero seguro en unidad menor (puede ser negativo en saldos)

export type TxKind = 'income' | 'expense' | 'transfer' | 'opening'; // entrada | salida | transferencia | saldo inicial
export type Direction = 'in' | 'out';
export type TxStatus = 'active' | 'voided';
export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'wallet' | 'other';
export type FieldType = 'text' | 'number' | 'date' | 'list' | 'bool';
export type FieldRole = 'category' | 'contact' | 'fund' | 'cost_center' | 'payment_method' | 'reference' | 'reconciled';
export type AppliesTo = 'both' | 'in' | 'out';

export interface Currency {
  code: string;
  minorDigits: 0 | 2 | 3;
  symbol?: string;
}

export interface Workspace {
  id: Id;
  name: string;
  ownerName: string;
  templateId: string | null;
  currency: Currency;
  logoDataUrl: string | null;
  color: string | null;
  sortOrder: number;
  isDemo: boolean;
  archivedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface WorkspaceSummary extends Workspace {
  balanceMinor: Minor;
  accountCount: number;
  lastMovementDate: IsoDate | null;
}

export interface Account {
  id: Id;
  workspaceId: Id;
  name: string;
  type: AccountType;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  archivedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface AccountWithBalance extends Account {
  balanceMinor: Minor;
  lastMovementDate: IsoDate | null;
  isNegative: boolean;
  openingTransactionId: Id | null;
}

export type FieldValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'date'; value: IsoDate }
  | { type: 'list'; optionId: Id }
  | { type: 'bool'; value: boolean };
export type FieldValues = Record<Id /* fieldId */, FieldValue>;

export interface Transaction {
  id: Id;
  workspaceId: Id;
  accountId: Id;
  seq: number;
  kind: TxKind;
  direction: Direction;
  amountMinor: Minor;
  date: IsoDate;
  description: string;
  notes: string;
  status: TxStatus;
  voidReason: string | null;
  voidedAt: Timestamp | null;
  batchId: Id | null;
  transferGroupId: Id | null;
  /** Solo en transferencias: la cuenta del otro lado y el id del otro movimiento. */
  counterpart: { accountId: Id; transactionId: Id; seq: number } | null;
  recordedAt: Timestamp;
  updatedAt: Timestamp;
  values: FieldValues;
}
/** Fila de listado: añade saldo corrido cuando el listado es de una sola cuenta. */
export interface TransactionRow extends Transaction {
  runningMinor: Minor | null;
}

export interface Field {
  id: Id;
  workspaceId: Id;
  key: string;
  label: string;
  type: FieldType;
  role: FieldRole | null;
  appliesTo: AppliesTo;
  sortOrder: number;
  showInList: boolean;
  active: boolean;
  deactivatedAt: Timestamp | null;
  options: FieldOption[]; // solo type 'list'; ordenadas; incluye inactivas
}
export interface FieldOption {
  id: Id;
  fieldId: Id;
  key: string | null;
  label: string;
  color: string | null;
  appliesTo: AppliesTo;
  sortOrder: number;
  active: boolean;
  mergedIntoId: Id | null;
}

export interface Batch {
  id: Id;
  workspaceId: Id;
  accountId: Id | null;
  source: 'capture' | 'import' | 'template' | 'demo';
  label: string;
  controlTotalMinor: Minor | null;
  controlMismatchAccepted: boolean;
  createdAt: Timestamp;
  activeCount: number;
  voidedCount: number;
  /** Anulados por el propio lote (voided_with_batch): los que `batches.restore` reviviría. 0 → no hay nada que restaurar. */
  restorableCount: number;
}

export type Warning =
  | { code: 'zero_amount' }
  | { code: 'far_date'; days: number }
  | { code: 'possible_duplicate'; transactionId: Id; seq: number }
  | { code: 'before_opening'; openingDate: IsoDate }
  | { code: 'negative_balance'; accountId: Id; balanceAfterMinor: Minor }
  | { code: 'field_inactive'; fieldId: Id }
  | { code: 'field_missing'; fieldKeyOrId: string }
  | { code: 'option_inactive'; fieldId: Id; optionId: Id }
  | { code: 'option_missing'; fieldId: Id; optionId: Id };

/** Resultado de toda mutación: lo creado/cambiado + avisos que no bloquearon. */
export interface Mutation<T> {
  value: T;
  warnings: Warning[];
  auditActionId: Id | null;
}

// ── Recetas (3.4): solo las formas de datos; la lógica vive en recipes.ts ─────────────

export type PeriodPreset =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'last_30_days'
  | 'last_12_months'
  | 'all';
export type DateRange = { preset: PeriodPreset } | { from?: IsoDate; to?: IsoDate }; // to inclusive

export type FieldCondition =
  | { fieldId: Id; op: 'any_of'; optionIds: Id[] } // lista (OR dentro del campo)
  | { fieldId: Id; op: 'empty' }
  | { fieldId: Id; op: 'not_empty' }
  | { fieldId: Id; op: 'is'; value: boolean } // sí/no: sin valor = No (F-65)
  | { fieldId: Id; op: 'contains'; value: string } // texto
  | { fieldId: Id; op: 'between'; min?: number; max?: number } // número
  | { fieldId: Id; op: 'date_between'; from?: IsoDate; to?: IsoDate };

/** Todos los criterios se combinan con AND (F-62, 8.3). */
export interface TxFilter {
  period?: DateRange;
  accountIds?: Id[];
  kinds?: TxKind[];
  amount?: { min?: Minor; max?: Minor };
  text?: string; // descripción + notas, normalizado
  status?: 'active' | 'voided' | 'all'; // por defecto 'active'
  batchId?: Id;
  fields?: FieldCondition[];
}

export type GroupBy =
  | { by: 'period'; unit: 'day' | 'week' | 'month' | 'quarter' | 'year' }
  | { by: 'account' }
  | { by: 'kind' }
  | { by: 'field'; fieldId: Id }; // cualquier campo: lista, sí/no, texto, fecha (por mes)

export type ReportSection =
  | 'header'
  | 'statement'
  | 'by_account'
  | 'by_field'
  | 'transfers'
  | 'movements'
  | 'voided'
  | 'audit'
  | 'signature';

export type TxSort = { by: 'date' | 'amount' | 'recorded_at' | 'seq'; dir: 'asc' | 'desc' };

export type ViewRecipe =
  | { v: 1; kind: 'filter'; filter: TxFilter; columns?: Id[]; sort?: TxSort }
  | {
      v: 1;
      kind: 'summary';
      filter: TxFilter;
      groupBy: GroupBy;
      split?: GroupBy;
      measure: 'in' | 'out' | 'both' | 'net';
      chart: 'bars' | 'donut' | 'line' | 'table';
    }
  | {
      v: 1;
      kind: 'report';
      form: 'summary' | 'detailed' | 'custom';
      filter: TxFilter;
      sections: ReportSection[];
      groupByFieldIds: Id[];
      columns: Id[];
      includeVoided: boolean;
      signature: boolean;
    };

// ── Historial (3.5) ──────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'create'
  | 'edit'
  | 'void'
  | 'restore'
  | 'batch_create'
  | 'batch_void'
  | 'batch_restore'
  | 'import'
  | 'merge'
  | 'config'
  | 'archive'
  | 'unarchive'
  | 'template_apply'
  | 'demo_seed'
  | 'backup_restore'
  | 'workspace_import';

export interface AuditEntry {
  id: Id;
  workspaceId: Id | null;
  at: Timestamp;
  action: AuditAction;
  entityType: string;
  entityId: Id | null;
  accountId: Id | null;
  batchId: Id | null;
  message: string;
  params: Record<string, unknown> | null;
  changes: Array<{ entityId: Id | null; path: string; old: unknown; new: unknown }>;
}

// ── Consultas e informes (3.5): formas de resultado ──────────────────────────────────

export interface Totals {
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor; // solo income/expense
  transfersInMinor: Minor;
  transfersOutMinor: Minor; // aparte (F-20)
  openingsMinor: Minor; // aparte (F-18)
  count: number;
  voidedCount: number;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SummaryGroup {
  key: string | null; // id de opción/cuenta, 'YYYY-MM', 'true'/'false', null = "Sin valor"
  label: string;
  color: string | null;
  inactive: boolean;
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  count: number;
  split?: SummaryGroup[]; // segunda agrupación
}
export interface SummaryResult {
  groups: SummaryGroup[]; // periodos sin datos se rellenan con 0 dentro del rango
  totals: Totals; // suma de grupos == totales (prueba)
  period: { from: IsoDate | null; to: IsoDate | null; label: string };
  filtered: boolean;
  filterDescription: string[];
  warnings: Warning[];
}

export interface StatementLine {
  periodOpeningMinor: Minor; // saldo al día anterior a `from` (todo lo activo antes)
  openingsInPeriodMinor: Minor; // saldos iniciales fechados dentro del periodo (línea propia)
  inMinor: Minor;
  outMinor: Minor;
  transfersInMinor: Minor;
  transfersOutMinor: Minor;
  closingMinor: Minor; // = suma de todo lo anterior con signo (identidad 10.3)
}
