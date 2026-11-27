// Fachada del núcleo (ARCHITECTURE.md 3.1): la única entrada que usa la UI. Une los servicios sobre un
// SqlDriver inyectado; no sabe qué adaptador hay debajo.
import { systemClock } from './dates';
import { createEventBus, type ChangeEvent } from './events';
import { defaultIdGen } from './ids';
import type { Clock, IdGen, SqlDriver, SqlDriverInfo } from './ports';
import { createAccountsService, type AccountsService } from './services/accounts';
import { createAuditService, createAuditWriter, type AuditService } from './services/audit';
import { createAuthService, type AuthService } from './services/auth';
import { createBackupService, type AutoCopySink, type BackupService } from './services/backup';
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
  /** Versión de la app que se escribe en los respaldos (la cáscara pasa la de package.json). */
  appVersion?: string;
  /**
   * Destino de la copia automática previa a restaurar un respaldo (IndexedDB en web, datos de la app en
   * Tauri). Sin él, la copia se guarda dentro de la propia base (`sys.backup.autoCopy`).
   */
  backupAutoCopy?: AutoCopySink;
  /**
   * Iteraciones PBKDF2 de la contraseña local y de los respaldos cifrados. Por defecto 600 000 (OWASP);
   * el arnés de pruebas usa 1 000. Nunca bajarlo en producción.
   */
  pbkdf2Iterations?: number;
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
  /** Inicio de sesión local: contraseña opcional, clave de recuperación, bloqueo automático. */
  readonly auth: AuthService;
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
  const iterations = deps.pbkdf2Iterations;
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
    auth: createAuthService(core, iterations === undefined ? {} : { hashIterations: iterations, encryptionIterations: iterations }),
    settings: createSettingsService(core),
    templates: createTemplatesService(core),
    backup: createBackupService(core, {
      ...(deps.appVersion === undefined ? {} : { appVersion: deps.appVersion }),
      ...(deps.backupAutoCopy === undefined ? {} : { autoCopy: deps.backupAutoCopy }),
      ...(deps.schemaVersion === undefined || deps.schemaVersion === 0 ? {} : { schemaVersion: deps.schemaVersion }),
      ...(iterations === undefined ? {} : { encryption: { iterations } }),
    }),
    importCsv: createImportCsvService(core),
    demo: createDemoService(core),
    subscribe: (listener) => events.subscribe(listener),
    info: Object.freeze({ driver: deps.driver.info, schemaVersion: deps.schemaVersion ?? 0 }),
  };
}

// ── Tipos y módulos puros públicos ───────────────────────────────────────────────────

export type * from './types';
export type { Clock, IdGen, Row, SqlDriver, SqlDriverInfo, SqlExecutor, SqlParams, SqlStep, SqlValue } from './ports';
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

export {
  isCryptoAvailable,
  isEncryptedEnvelope,
  isValidRecoveryKey,
  normalizeRecoveryKey,
  type EncryptedEnvelope,
} from './crypto';
export {
  auditToSheet,
  csvSafeText,
  reportToSheets,
  sheetToRows,
  summaryToSheet,
  transactionsToSheet,
  type Cell as SheetCell,
  type ColumnType,
  type Sheet,
  type SheetColumn,
  type Translate,
} from './export/tabular';
export { groupFilter, previousRange } from './services/queries';
export { serializeTemplate, templateFileName } from '../templates/schema';
export {
  DEMO_MONTHS,
  DEMO_PROFILES,
  DEMO_SEED,
  hashPlan,
  type DemoExtraAccount,
  type DemoExtraField,
  type DemoItem,
  type DemoOpening,
  type DemoPlan,
  type DemoRow,
  type DemoStep,
  type DemoTemplateId,
  type DemoValue,
  type DemoValues,
  type DemoView,
} from './demo';
export { MAX_DESCRIPTION_LENGTH, MAX_LABEL_LENGTH, MAX_NOTES_LENGTH } from './services/validation';
export {
  AUTH_AUTO_LOCK_CHOICES,
  AUTH_DEFAULT_AUTO_LOCK_MINUTES,
  AUTH_FREE_ATTEMPTS,
  AUTH_MAX_AUTO_LOCK_MINUTES,
  AUTH_MAX_PASSWORD_LENGTH,
  AUTH_MAX_PROFILE_NAME_LENGTH,
  AUTH_MIN_PASSWORD_LENGTH,
} from './services/auth';

export type { AccountsService, OpeningInput } from './services/accounts';
export type { AuditService } from './services/audit';
export type { AuthErrorCode, AuthService, AuthStatus } from './services/auth';
export type {
  AutoCopy,
  AutoCopySink,
  BackupExport,
  BackupFile,
  BackupInspection,
  BackupScope,
  BackupService,
  BackupServiceOptions,
  BackupTable,
} from './services/backup';
export type { BatchesService, CaptureInput, CaptureResult, CaptureRow, CaptureRowError } from './services/batches';
export type { DemoPhase, DemoProfile, DemoProfileId, DemoProgress, DemoSeedOptions, DemoSeedResult, DemoService } from './services/demo';
export type { FieldsService, FormSchema } from './services/fields';
export type {
  Cell,
  ColumnGuess,
  ColumnKind,
  ColumnMapping,
  DateFormat,
  ImportCsvService,
  ImportIssue,
  ImportOpening,
  ImportPreview,
  ImportPreviewResult,
  ImportPreviewRow,
  ImportRowStatus,
  ImportTotals,
  RawTable,
  ResolvedDateFormat,
} from './services/importCsv';
export type {
  DashboardBreakdownGroup,
  DashboardData,
  DashboardOptions,
  DashboardRange,
  DashboardTopItem,
  HomeData,
  QueriesService,
} from './services/queries';
export type { ReportDocument, ReportRecipe, ReportsService } from './services/reports';
export type { SettingsMap, SettingsService, WorkspaceSettingsMap } from './services/settings';
export type {
  AppliedTemplate,
  ApplyTemplateInput,
  ExportTemplateOptions,
  TemplateAccount,
  TemplateField,
  TemplateFile,
  TemplateIssue,
  TemplateOption,
  TemplatePreview,
  TemplateSource,
  TemplatesService,
  TemplateValidation,
  TemplateView,
} from './services/templates';
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
