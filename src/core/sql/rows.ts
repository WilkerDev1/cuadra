// Mapeo fila SQL ↔ tipo de dominio (ARCHITECTURE.md 2.2, 3.2). Las formas `*Record` reflejan las columnas
// de 001_init.sql tal cual (snake_case, 0/1, JSON en texto); los servicios leen con ellas y convierten aquí.
// Son `type` (no `interface`) para que cumplan `Row` y se puedan usar en `tx.all<WorkspaceRecord>(…)`.
import { DomainError } from '../errors';
import type { SqlValue } from '../ports';
import { parseViewRecipe } from '../recipes';
import type { SavedView } from '../services/views';
import type {
  Account,
  AccountType,
  AppliesTo,
  AuditAction,
  AuditEntry,
  Batch,
  Currency,
  Direction,
  Field,
  FieldOption,
  FieldRole,
  FieldType,
  FieldValue,
  FieldValues,
  Id,
  Transaction,
  TxKind,
  TxStatus,
  ViewRecipe,
  Warning,
  Workspace,
} from '../types';

// ── Ayudas ───────────────────────────────────────────────────────────────────────────

export const toBool = (v: SqlValue | undefined): boolean => v === 1 || v === '1';
export const fromBool = (b: boolean): 0 | 1 => (b ? 1 : 0);

/** Valor para una columna JSON (`undefined` → NULL). */
export function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/** Lee una columna JSON; NULL → `fallback`. */
export function fromJson<T = unknown>(text: SqlValue | undefined, fallback: T | null = null): T | null {
  if (text === null || text === undefined) return fallback;
  if (typeof text !== 'string') throw new TypeError('columna JSON con tipo inesperado');
  return JSON.parse(text) as T;
}

function str(v: SqlValue | undefined): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function num(v: SqlValue | undefined): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}

// ── Registros ────────────────────────────────────────────────────────────────────────

export type WorkspaceRecord = {
  id: string;
  name: string;
  owner_name: string;
  template_id: string | null;
  currency_code: string;
  currency_symbol: string | null;
  minor_digits: number;
  logo_data_url: string | null;
  color: string | null;
  sort_order: number;
  is_demo: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountRecord = {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  next_seq: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionRecord = {
  id: string;
  workspace_id: string;
  account_id: string;
  seq: number;
  kind: string;
  direction: string;
  amount_minor: number;
  date: string;
  description: string;
  notes: string;
  search_text: string;
  status: string;
  void_reason: string | null;
  voided_at: string | null;
  voided_with_batch: number;
  batch_id: string | null;
  transfer_group_id: string | null;
  recorded_at: string;
  updated_at: string;
};

export type FieldValueRecord = {
  transaction_id: string;
  field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_option_id: string | null;
  value_bool: number | null;
};

export type FieldRecord = {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  type: string;
  role: string | null;
  applies_to: string;
  sort_order: number;
  show_in_list: number;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FieldOptionRecord = {
  id: string;
  field_id: string;
  key: string | null;
  label: string;
  color: string | null;
  applies_to: string;
  sort_order: number;
  deactivated_at: string | null;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BatchRecord = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  source: string;
  label: string;
  control_total_minor: number | null;
  control_mismatch_accepted: number;
  meta: string | null;
  created_at: string;
};

export type SavedViewRecord = {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  recipe: string;
  recipe_version: number;
  pinned: number;
  sort_order: number;
  source: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLogRecord = {
  id: string;
  workspace_id: string | null;
  at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  account_id: string | null;
  batch_id: string | null;
  message: string;
  params: string | null;
  meta: string | null;
};

export type AuditChangeRecord = {
  action_id: string;
  ord: number;
  entity_id: string | null;
  path: string;
  old_value: string | null;
  new_value: string | null;
};

export type SettingRecord = { scope_id: string; key: string; value: string; updated_at: string };

/** Columnas en orden de DDL, para SELECT e INSERT. */
export const COLUMNS = {
  workspaces: [
    'id', 'name', 'owner_name', 'template_id', 'currency_code', 'currency_symbol', 'minor_digits',
    'logo_data_url', 'color', 'sort_order', 'is_demo', 'archived_at', 'created_at', 'updated_at',
  ],
  accounts: [
    'id', 'workspace_id', 'name', 'type', 'color', 'icon', 'sort_order', 'next_seq', 'archived_at',
    'created_at', 'updated_at',
  ],
  transactions: [
    'id', 'workspace_id', 'account_id', 'seq', 'kind', 'direction', 'amount_minor', 'date', 'description',
    'notes', 'search_text', 'status', 'void_reason', 'voided_at', 'voided_with_batch', 'batch_id',
    'transfer_group_id', 'recorded_at', 'updated_at',
  ],
  transaction_field_values: [
    'transaction_id', 'field_id', 'value_text', 'value_number', 'value_date', 'value_option_id', 'value_bool',
  ],
  fields: [
    'id', 'workspace_id', 'key', 'label', 'type', 'role', 'applies_to', 'sort_order', 'show_in_list',
    'deactivated_at', 'created_at', 'updated_at',
  ],
  field_options: [
    'id', 'field_id', 'key', 'label', 'color', 'applies_to', 'sort_order', 'deactivated_at', 'merged_into_id',
    'created_at', 'updated_at',
  ],
  batches: [
    'id', 'workspace_id', 'account_id', 'source', 'label', 'control_total_minor', 'control_mismatch_accepted',
    'meta', 'created_at',
  ],
  saved_views: [
    'id', 'workspace_id', 'kind', 'name', 'recipe', 'recipe_version', 'pinned', 'sort_order', 'source',
    'deleted_at', 'created_at', 'updated_at',
  ],
  audit_log: [
    'id', 'workspace_id', 'at', 'action', 'entity_type', 'entity_id', 'account_id', 'batch_id', 'message',
    'params', 'meta',
  ],
  audit_log_changes: ['action_id', 'ord', 'entity_id', 'path', 'old_value', 'new_value'],
  settings: ['scope_id', 'key', 'value', 'updated_at'],
} as const;

/** "t.id, t.workspace_id, …" para SELECT con alias. */
export function selectColumns(table: keyof typeof COLUMNS, alias?: string): string {
  return COLUMNS[table].map((c) => (alias ? `${alias}.${c}` : c)).join(', ');
}

/** json_object('col', alias.col, …) con las columnas de la tabla: para leer varias tablas en una consulta. */
export function jsonObjectSql(table: keyof typeof COLUMNS, alias: string): string {
  return `json_object(${COLUMNS[table].map((c) => `'${c}', ${alias}.${c}`).join(', ')})`;
}

/** "INSERT INTO <tabla> (<cols>) VALUES (?, ?, …)" en orden de COLUMNS. */
export function insertSql(table: keyof typeof COLUMNS): string {
  const cols = COLUMNS[table];
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

/** Valores posicionales de un registro en el orden de COLUMNS (para insertSql/runMany). */
export function recordValues<T extends keyof typeof COLUMNS>(table: T, record: Record<string, SqlValue>): SqlValue[] {
  return COLUMNS[table].map((c) => {
    const v = record[c];
    return v === undefined ? null : v;
  });
}

// ── Fila → dominio ───────────────────────────────────────────────────────────────────

export function toCurrency(r: Pick<WorkspaceRecord, 'currency_code' | 'currency_symbol' | 'minor_digits'>): Currency {
  const digits = num(r.minor_digits);
  const currency: Currency = { code: r.currency_code, minorDigits: digits === 0 || digits === 3 ? digits : 2 };
  if (r.currency_symbol !== null && r.currency_symbol !== '') currency.symbol = r.currency_symbol;
  return currency;
}

export function toWorkspace(r: WorkspaceRecord): Workspace {
  return {
    id: r.id,
    name: r.name,
    ownerName: r.owner_name,
    templateId: r.template_id,
    currency: toCurrency(r),
    logoDataUrl: r.logo_data_url,
    color: r.color,
    sortOrder: num(r.sort_order),
    isDemo: toBool(r.is_demo),
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function workspaceToRecord(w: Workspace): WorkspaceRecord {
  return {
    id: w.id,
    name: w.name,
    owner_name: w.ownerName,
    template_id: w.templateId,
    currency_code: w.currency.code,
    currency_symbol: w.currency.symbol ?? null,
    minor_digits: w.currency.minorDigits,
    logo_data_url: w.logoDataUrl,
    color: w.color,
    sort_order: w.sortOrder,
    is_demo: fromBool(w.isDemo),
    archived_at: w.archivedAt,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

export function toAccount(r: AccountRecord): Account {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    type: r.type as AccountType,
    color: r.color,
    icon: r.icon,
    sortOrder: num(r.sort_order),
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Un valor de campo desde su fila EAV. */
export function toFieldValue(r: FieldValueRecord): FieldValue {
  if (r.value_option_id !== null) return { type: 'list', optionId: r.value_option_id };
  if (r.value_bool !== null) return { type: 'bool', value: toBool(r.value_bool) };
  if (r.value_number !== null) return { type: 'number', value: num(r.value_number) };
  if (r.value_date !== null) return { type: 'date', value: r.value_date };
  return { type: 'text', value: str(r.value_text) };
}

/** Agrupa filas EAV por movimiento: Map<transactionId, FieldValues>. */
export function groupFieldValues(records: readonly FieldValueRecord[]): Map<Id, FieldValues> {
  const out = new Map<Id, FieldValues>();
  for (const r of records) {
    let values = out.get(r.transaction_id);
    if (values === undefined) {
      values = {};
      out.set(r.transaction_id, values);
    }
    values[r.field_id] = toFieldValue(r);
  }
  return out;
}

/** Dominio → fila EAV (exactamente una columna de valor no nula). */
export function fieldValueToRecord(transactionId: Id, fieldId: Id, v: FieldValue): FieldValueRecord {
  const base: FieldValueRecord = {
    transaction_id: transactionId,
    field_id: fieldId,
    value_text: null,
    value_number: null,
    value_date: null,
    value_option_id: null,
    value_bool: null,
  };
  switch (v.type) {
    case 'text':
      return { ...base, value_text: v.value };
    case 'number':
      return { ...base, value_number: v.value };
    case 'date':
      return { ...base, value_date: v.value };
    case 'list':
      return { ...base, value_option_id: v.optionId };
    case 'bool':
      return { ...base, value_bool: fromBool(v.value) };
  }
}

export function toTransaction(
  r: TransactionRecord,
  values: FieldValues = {},
  counterpart: Transaction['counterpart'] = null,
): Transaction {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    seq: num(r.seq),
    kind: r.kind as TxKind,
    direction: r.direction as Direction,
    amountMinor: num(r.amount_minor),
    date: r.date,
    description: r.description,
    notes: r.notes,
    status: r.status as TxStatus,
    voidReason: r.void_reason,
    voidedAt: r.voided_at,
    batchId: r.batch_id,
    transferGroupId: r.transfer_group_id,
    counterpart,
    recordedAt: r.recorded_at,
    updatedAt: r.updated_at,
    values,
  };
}

export function toFieldOption(r: FieldOptionRecord): FieldOption {
  return {
    id: r.id,
    fieldId: r.field_id,
    key: r.key,
    label: r.label,
    color: r.color,
    appliesTo: r.applies_to as AppliesTo,
    sortOrder: num(r.sort_order),
    active: r.deactivated_at === null,
    mergedIntoId: r.merged_into_id,
  };
}

/** Campo con sus opciones (se filtran las de este campo y se ordenan por sort_order, luego etiqueta). */
export function toField(r: FieldRecord, options: readonly FieldOptionRecord[] = []): Field {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    key: r.key,
    label: r.label,
    type: r.type as FieldType,
    role: r.role as FieldRole | null,
    appliesTo: r.applies_to as AppliesTo,
    sortOrder: num(r.sort_order),
    showInList: toBool(r.show_in_list),
    active: r.deactivated_at === null,
    deactivatedAt: r.deactivated_at,
    options: options
      .filter((o) => o.field_id === r.id)
      .map(toFieldOption)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es')),
  };
}

export function toBatch(r: BatchRecord & { active_count?: SqlValue; voided_count?: SqlValue; restorable_count?: SqlValue }): Batch {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    source: r.source as Batch['source'],
    label: r.label,
    controlTotalMinor: r.control_total_minor === null ? null : num(r.control_total_minor),
    controlMismatchAccepted: toBool(r.control_mismatch_accepted),
    createdAt: r.created_at,
    activeCount: num(r.active_count ?? 0),
    voidedCount: num(r.voided_count ?? 0),
    restorableCount: num(r.restorable_count ?? 0),
  };
}

export function toAuditEntry(r: AuditLogRecord, changes: readonly AuditChangeRecord[] = []): AuditEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    at: r.at,
    action: r.action as AuditAction,
    entityType: r.entity_type,
    entityId: r.entity_id,
    accountId: r.account_id,
    batchId: r.batch_id,
    message: r.message,
    params: fromJson<Record<string, unknown>>(r.params),
    changes: changes
      .filter((c) => c.action_id === r.id)
      .sort((a, b) => num(a.ord) - num(b.ord))
      .map((c) => ({
        entityId: c.entity_id,
        path: c.path,
        old: c.old_value === null ? undefined : fromJson(c.old_value),
        new: c.new_value === null ? undefined : fromJson(c.new_value),
      })),
  };
}

export function toSavedView(r: SavedViewRecord, warnings: Warning[] = []): SavedView {
  const parsed = parseViewRecipe(fromJson(r.recipe));
  if (!parsed.ok) throw new DomainError('invalid_recipe', { viewId: r.id, path: parsed.error });
  if (parsed.value.kind !== r.kind) throw new DomainError('invalid_recipe', { viewId: r.id, path: '$.kind' });
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind as ViewRecipe['kind'],
    name: r.name,
    recipe: parsed.value,
    pinned: toBool(r.pinned),
    sortOrder: num(r.sort_order),
    source: r.source as SavedView['source'],
    warnings,
  };
}

export function toSetting<T = unknown>(r: Pick<SettingRecord, 'value'>): T {
  return JSON.parse(r.value) as T;
}
