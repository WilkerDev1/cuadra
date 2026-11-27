// Fachada del núcleo (ARCHITECTURE.md 3.1): la única entrada que usa la UI. Une los servicios sobre un
// SqlDriver inyectado; no sabe qué adaptador hay debajo.
import { systemClock } from './dates';
import { createEventBus, type ChangeEvent } from './events';
import { defaultIdGen } from './ids';
import type { Clock, IdGen, SqlDriver, SqlDriverInfo } from './ports';
import { createAccountsService, type AccountsService } from './services/accounts';
import { createAuditService, createAuditWriter, type AuditService } from './services/audit';
import { createBackupService, type BackupService } from './services/backup';
import { createBatchesService, type BatchesService } from './services/batches';
import { createDemoService, type DemoService } from './services/demo';
import { createFieldsService, type FieldsService } from './services/fields';
import { createImportCsvService, type ImportCsvService } from './services/importCsv';
import { createQueriesService, type QueriesService } from './services/queries';
import { createReportsService, type ReportsService } from './services/reports';
import { createSettingsService, type SettingsService } from './services/settings';
import { createTemplatesService, type TemplatesService } from './services/templates';
import { createTransactionsService, type TransactionsService } from './services/transactions';
import { createViewsService, type ViewsService } from './services/views';
import { createWorkspacesService, type WorkspacesService } from './services/workspaces';
import type { CoreDeps } from './uow';

export interface CuadraDeps {
  driver: SqlDriver;
  clock?: Clock; // por defecto: reloj del sistema
  ids?: IdGen; // por defecto: uuidv7 con crypto.getRandomValues
  locale?: string; // 'es-DO'
  /** Versión de esquema tras migrar (la da migrate() en boot/harness). Por defecto 0 = desconocida. */
  schemaVersion?: number;
}

export interface Cuadra {
  readonly workspaces: WorkspacesService;
  readonly accounts: AccountsService;
  readonly transactions: TransactionsService;
  readonly batches: BatchesService;
  readonly fields: FieldsService;
  readonly queries: QueriesService;
  readonly reports: ReportsService;
  readonly views: ViewsService;
  readonly audit: AuditService;
  readonly settings: SettingsService;
  readonly templates: TemplatesService;
  readonly backup: BackupService;
  readonly importCsv: ImportCsvService;
  readonly demo: DemoService;
  /** Se emite tras cada COMMIT con las tablas tocadas. La UI invalida consultas con esto. */
  subscribe(listener: (e: ChangeEvent) => void): () => void;
  readonly info: { driver: SqlDriverInfo; schemaVersion: number };
}

export function createCuadra(deps: CuadraDeps): Cuadra {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? defaultIdGen;
  const events = createEventBus();
  const core: CoreDeps = {
    driver: deps.driver,
    clock,
    ids,
    events,
    audit: createAuditWriter({ clock, ids }),
    locale: deps.locale ?? 'es-DO',
  };
  return {
    workspaces: createWorkspacesService(core),
    accounts: createAccountsService(core),
    transactions: createTransactionsService(core),
    batches: createBatchesService(core),
    fields: createFieldsService(core),
    queries: createQueriesService(core),
    reports: createReportsService(core),
    views: createViewsService(core),
    audit: createAuditService(core),
    settings: createSettingsService(core),
    templates: createTemplatesService(core),
    backup: createBackupService(core),
    importCsv: createImportCsvService(core),
    demo: createDemoService(core),
    subscribe: (listener) => events.subscribe(listener),
    info: Object.freeze({ driver: deps.driver.info, schemaVersion: deps.schemaVersion ?? 0 }),
  };
}

// ── Tipos y módulos puros públicos ───────────────────────────────────────────────────

export type * from './types';
export type { Clock, IdGen, Row, SqlDriver, SqlDriverInfo, SqlExecutor, SqlParams, SqlValue } from './ports';
export { DomainError, ERROR_CODES, isDomainError, isErrorCode, type ErrorCode } from './errors';
export { err, ok, type Result } from './result';
export { MAX_MINOR, Money, type MoneyFormatOptions, type MoneyParseError, type MoneyParseOptions } from './money';
export {
  addDays,
  addMonths,
  dayLabel,
  diffDays,
  enumeratePeriodKeys,
  FixedClock,
  fromIsoDate,
  isIsoDate,
  monthKey,
  monthLabel,
  monthRange,
  periodKey,
  periodLabel,
  presetRange,
  systemClock,
  toIsoDate,
  type PeriodUnit,
} from './dates';
export { isUuidV7, SeqIdGen, uuidv7 } from './ids';
export { normalizeSearch } from './text';
export { TABLE_NAMES, type ChangeEvent, type TableName } from './events';
export {
  describeFilter,
  isFiltered,
  parseViewRecipe,
  PERIOD_PRESETS,
  REPORT_SECTIONS,
  resolvePeriod,
  validateRecipe,
  type TemplateKeyMap,
} from './recipes';

export type { AccountsService, OpeningInput } from './services/accounts';
export type { AuditService } from './services/audit';
export type { BackupFile, BackupInspection, BackupService, BackupTable } from './services/backup';
export type { BatchesService, CaptureInput, CaptureResult, CaptureRow, CaptureRowError } from './services/batches';
export type { DemoProfileId, DemoService } from './services/demo';
export type { FieldsService, FormSchema } from './services/fields';
export type {
  ColumnMapping,
  DateFormat,
  ImportCsvService,
  ImportPreview,
  ImportPreviewRow,
  ImportRowStatus,
  RawTable,
} from './services/importCsv';
export type { HomeData, QueriesService } from './services/queries';
export type { ReportDocument, ReportRecipe, ReportsService } from './services/reports';
export type { SettingsMap, SettingsService, WorkspaceSettingsMap } from './services/settings';
export type { TemplateFile, TemplatePreview, TemplatesService } from './services/templates';
export type {
  CreateManyDraft,
  CreateManyInput,
  TransactionsService,
  TransferDraft,
  TxDraft,
  TxPatch,
} from './services/transactions';
export type { SavedView, ViewsService } from './services/views';
export type { WorkspacesService } from './services/workspaces';
