// Respaldo JSON versionado (ARCHITECTURE.md 3.5, 3.7, ADR-8).
//
// - El archivo es un volcado fiel de tablas (incluye seq, next_seq e historial), con checksum sha-256 de las
//   tablas en orden fijo y conteos por tabla. Al exportar se vuelve a leer lo escrito y se compara antes de
//   devolverlo (F-81/83/84).
// - Cifrado opcional (PLAN.md, "Inicio de sesión"): con contraseña, el texto del archivo es un sobre
//   AES-GCM de src/core/crypto.ts que envuelve el JSON del respaldo.
// - Restaurar todo (F-87): copia automática previa → modo mantenimiento → DELETE en orden inverso de FK →
//   INSERT en orden de FK → PRAGMA foreign_key_check vacío o ROLLBACK → acción backup_restore.
// - Importar un espacio (F-88): entra como espacio NUEVO con todos sus ids reasignados (también los que
//   viven dentro de JSON: recetas, parámetros del historial, ajustes) y conservando seq.
// - Versiones: un respaldo de un esquema anterior se lleva al actual en memoria (backup-upgrades/).
import { decryptText, encryptText, isEncryptedEnvelope, type CryptoOptions } from '../crypto';
import { DomainError, isDomainError, type ErrorCode } from '../errors';
import { MAX_MINOR } from '../money';
import { TABLE_NAMES } from '../events';
import type { SqlExecutor, SqlValue } from '../ports';
import { COLUMNS, toWorkspace, type WorkspaceRecord } from '../sql/rows';
import { normalizeSearch } from '../text';
import type { Id, Mutation, Timestamp, Workspace } from '../types';
import { mutate, readTx, type CoreDeps } from '../uow';
import { CURRENT_FORMAT_VERSION, SCHEMA_UPGRADERS, upgradeBackup, upgradeFormat, type BackupUpgrader } from './backup-upgrades';

export type BackupTable =
  | 'workspaces'
  | 'accounts'
  | 'batches'
  | 'fields'
  | 'field_options'
  | 'transactions'
  | 'transaction_field_values'
  | 'saved_views'
  | 'audit_log'
  | 'audit_log_changes'
  | 'settings';

/** Tablas respaldadas en orden de claves foráneas (se insertan así y se borran al revés). */
export const BACKUP_TABLES: readonly BackupTable[] = [
  'workspaces',
  'accounts',
  'batches',
  'fields',
  'field_options',
  'transactions',
  'transaction_field_values',
  'saved_views',
  'audit_log',
  'audit_log_changes',
  'settings',
];

export interface BackupFile {
  format: 'cuadra-backup';
  formatVersion: 1; // forma del sobre
  schemaVersion: number; // migración de la BD que lo produjo (001 → 1)
  appVersion: string; // package.json version
  createdAt: Timestamp;
  scope: 'all' | 'workspace';
  workspaceIds: Id[];
  /** sha-256 hex de JSON.stringify(tables) con claves en orden fijo (crypto.subtle). */
  checksum: string;
  counts: Record<BackupTable, number>;
  tables: Record<BackupTable, { columns: string[]; rows: SqlValue[][] }>;
}

export interface BackupInspection {
  ok: boolean;
  error?: ErrorCode;
  /** El archivo es un sobre cifrado (haga falta o no la contraseña para leer el resto). */
  encrypted: boolean;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: Timestamp;
  scope: 'all' | 'workspace';
  workspaces: Array<{ id: Id; name: string; transactions: number; accounts: number }>;
  /** Conteos por tabla (vacío si no se pudo leer). */
  counts: Partial<Record<BackupTable, number>>;
  needsUpgrade: boolean;
}

/** Copia automática previa a una restauración: archivo SQLite completo + respaldo JSON del mismo estado. */
export interface AutoCopy {
  name: string; // cuadra-antes-de-restaurar-2026-06-15T12-00-00.cuadra.json
  createdAt: Timestamp;
  bytes: Uint8Array;
  json: string;
}
/** Dónde guarda la cáscara la copia automática (IDB en web, app data en Tauri). Si lanza, no se restaura. */
export type AutoCopySink = (copy: AutoCopy) => Promise<void>;

export type BackupScope = { scope: 'all' } | { scope: 'workspace'; workspaceId: Id };

export interface BackupExport {
  file: BackupFile;
  /** JSON del respaldo en claro. */
  json: string;
  /** Contenido del archivo a guardar: `json`, o el sobre cifrado si hubo contraseña. */
  text: string;
  /** Bytes UTF-8 de `text`. */
  bytes: number;
  encrypted: boolean;
  verified: true;
  suggestedName: string; // cuadra-2026-11-26.cuadra.json
}

export interface BackupService {
  /** F-81/83/84: arma el archivo, lo vuelve a leer y compara checksum y conteos antes de devolverlo. */
  export(opts: BackupScope & { password?: string }): Promise<BackupExport>;
  /** La UI llama esto cuando el archivo ya se guardó/descargó. */
  markVerified(at?: Timestamp): Promise<void>;
  /** Sin escribir nada. Un respaldo cifrado sin contraseña da ok:false, encrypted:true, password_required. */
  inspect(text: string, opts?: { password?: string }): Promise<BackupInspection>;
  /** F-87: reemplaza TODO. Antes guarda copia automática (destino externo o, si no hay, dentro de la BD). */
  restoreAll(
    text: string,
    opts: { confirm: true; password?: string },
  ): Promise<{ workspaces: number; transactions: number; autoCopy: { name: string; storedIn: 'external' | 'database' } }>;
  /** F-88: un espacio del respaldo entra como espacio NUEVO, con ids nuevos. */
  importWorkspace(
    text: string,
    sourceWorkspaceId: Id,
    opts?: { rename?: string; password?: string },
  ): Promise<Mutation<Workspace>>;
  /** La última copia automática guardada dentro de la BD (cuando no hay destino externo). */
  lastAutoCopy(): Promise<{ name: string; createdAt: Timestamp; json: string } | null>;
}

export interface BackupServiceOptions {
  /** Destino de la copia automática previa a restaurar. Sin él, la copia se guarda en `sys.backup.autoCopy`. */
  autoCopy?: AutoCopySink;
  /** Versión de la app que se escribe en el respaldo. */
  appVersion?: string;
  /** Versión de esquema actual; por defecto PRAGMA user_version. */
  schemaVersion?: number;
  /** Cadena de upgraders (pruebas). */
  upgraders?: readonly BackupUpgrader[];
  /** Parámetros del cifrado (pruebas: pocas iteraciones). */
  encryption?: CryptoOptions;
}

/** Versión de package.json. El núcleo no puede importar package.json: el integrador la inyecta. */
export const APP_VERSION = '0.1.0';
const AUTO_COPY_KEY = 'sys.backup.autoCopy';
const MAINTENANCE_KEY = 'sys.maintenance';
/**
 * Ajustes que pertenecen al equipo y nunca viajan en un respaldo: `sys.*` (estado interno) y `auth.*`
 * (hashes de la contraseña local). Restaurar conserva los del equipo: un respaldo no cambia la contraseña.
 */
// Ajustes que son de este equipo y no viajan en el respaldo: los del sistema, los de la sesión y la marca del
// último respaldo comprobado (restaurar un archivo viejo no debe hacer creer que el último respaldo es ese).
const LOCAL_ONLY_SQL = "key NOT LIKE 'sys.%' AND key NOT LIKE 'auth.%' AND key <> 'backup.lastVerifiedAt'";
export const isLocalOnlySetting = (key: string): boolean =>
  key.startsWith('sys.') || key.startsWith('auth.') || key === 'backup.lastVerifiedAt';

// ── Checksum ─────────────────────────────────────────────────────────────────────────

function canonicalTables(tables: BackupFile['tables']): BackupFile['tables'] {
  const out = {} as BackupFile['tables'];
  for (const table of BACKUP_TABLES) {
    const t = tables[table];
    out[table] = { columns: t.columns, rows: t.rows };
  }
  return out;
}

/** sha-256 hex de las tablas con claves en orden fijo (BACKUP_TABLES; columns antes que rows). */
export async function computeChecksum(tables: BackupFile['tables']): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(canonicalTables(tables)));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Validación del archivo ───────────────────────────────────────────────────────────

const invalid = (reason: string, extra: Record<string, unknown> = {}) => new DomainError('backup_invalid', { reason, ...extra });

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Información que se va sabiendo del archivo mientras se lee (para inspect cuando algo falla). */
interface PartialInfo {
  encrypted: boolean;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: Timestamp;
  scope: 'all' | 'workspace';
}

function validateShape(raw: unknown, info: PartialInfo): BackupFile {
  if (!isRecord(raw) || raw['format'] !== 'cuadra-backup') throw invalid('format');
  const env = upgradeFormat(raw);
  info.formatVersion = env['formatVersion'] as number;
  const { schemaVersion, appVersion, createdAt, scope, workspaceIds, checksum, counts, tables } = env;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) throw invalid('schema_version');
  info.schemaVersion = schemaVersion;
  if (typeof appVersion !== 'string') throw invalid('app_version');
  info.appVersion = appVersion;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) throw invalid('created_at');
  info.createdAt = createdAt;
  if (scope !== 'all' && scope !== 'workspace') throw invalid('scope');
  info.scope = scope;
  if (!Array.isArray(workspaceIds) || !workspaceIds.every((w) => typeof w === 'string')) throw invalid('workspace_ids');
  if (typeof checksum !== 'string' || !/^[0-9a-f]{64}$/.test(checksum)) throw invalid('checksum_shape');
  if (!isRecord(counts) || !isRecord(tables)) throw invalid('tables');
  for (const key of Object.keys(tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(key)) throw invalid('unknown_table', { table: key });
  }
  for (const table of BACKUP_TABLES) {
    const t = tables[table];
    if (!isRecord(t) || !Array.isArray(t['columns']) || !Array.isArray(t['rows'])) throw invalid('table_shape', { table });
    const columns = t['columns'] as unknown[];
    if (columns.length === 0 || !columns.every((c) => typeof c === 'string' && /^[a-z_]+$/.test(c))) {
      throw invalid('columns', { table });
    }
    if (new Set(columns).size !== columns.length) throw invalid('columns', { table });
    for (const row of t['rows'] as unknown[]) {
      if (!Array.isArray(row) || row.length !== columns.length) throw invalid('row_shape', { table });
      for (const v of row) {
        if (v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) {
          throw invalid('value', { table });
        }
      }
    }
    if (counts[table] !== (t['rows'] as unknown[]).length) throw invalid('counts', { table });
  }
  return env as unknown as BackupFile;
}

// ── Lectura de tablas ────────────────────────────────────────────────────────────────

const ORDER_BY: Record<BackupTable, string> = {
  workspaces: 'id',
  accounts: 'id',
  batches: 'id',
  fields: 'id',
  field_options: 'id',
  transactions: 'id',
  transaction_field_values: 'transaction_id, field_id',
  saved_views: 'id',
  audit_log: 'id',
  audit_log_changes: 'action_id, ord',
  settings: 'scope_id, key',
};

function scopeFilter(table: BackupTable, scope: BackupScope): { where: string; params: SqlValue[] } {
  if (scope.scope === 'all') {
    return table === 'settings' ? { where: `WHERE ${LOCAL_ONLY_SQL}`, params: [] } : { where: '', params: [] };
  }
  const ws = scope.workspaceId;
  switch (table) {
    case 'workspaces':
      return { where: 'WHERE id = ?', params: [ws] };
    case 'field_options':
      return { where: 'WHERE field_id IN (SELECT id FROM fields WHERE workspace_id = ?)', params: [ws] };
    case 'transaction_field_values':
      return { where: 'WHERE transaction_id IN (SELECT id FROM transactions WHERE workspace_id = ?)', params: [ws] };
    case 'audit_log_changes':
      return { where: 'WHERE action_id IN (SELECT id FROM audit_log WHERE workspace_id = ?)', params: [ws] };
    case 'settings':
      return { where: `WHERE scope_id = ? AND ${LOCAL_ONLY_SQL}`, params: [ws] };
    default:
      return { where: 'WHERE workspace_id = ?', params: [ws] };
  }
}

async function readTables(tx: SqlExecutor, scope: BackupScope): Promise<BackupFile['tables']> {
  const tables = {} as BackupFile['tables'];
  for (const table of BACKUP_TABLES) {
    const columns = [...COLUMNS[table]];
    const { where, params } = scopeFilter(table, scope);
    const rows = await tx.all(`SELECT ${columns.join(', ')} FROM ${table} ${where} ORDER BY ${ORDER_BY[table]}`, params);
    tables[table] = {
      columns,
      rows: rows.map((r) =>
        columns.map((c) => {
          const v = r[c] ?? null;
          if (v instanceof Uint8Array) throw invalid('blob', { table, column: c });
          return v;
        }),
      ),
    };
  }
  return tables;
}

function col(t: { columns: string[] }, name: string): number {
  return t.columns.indexOf(name);
}

function cell(row: SqlValue[], at: number): SqlValue {
  return at < 0 ? null : (row[at] ?? null);
}

function slug(text: string): string {
  return normalizeSearch(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function stamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/:/g, '-');
}

// ── Modo mantenimiento ───────────────────────────────────────────────────────────────

async function enterMaintenance(tx: SqlExecutor, now: string): Promise<void> {
  await tx.run(
    `INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', ?, 'true', ?)
     ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [MAINTENANCE_KEY, now],
  );
  // Las filas que se referencian entre sí (field_options.merged_into_id) entran en cualquier orden.
  await tx.run('PRAGMA defer_foreign_keys = ON');
}

/**
 * Coherencia del libro tras insertar en modo mantenimiento (que salta el trigger de seq). El checksum no es
 * una firma: un archivo editado a mano con el checksum recalculado llega hasta aquí. Se comprueba, con SQL y
 * solo sobre los espacios restaurados, lo que el esquema no garantiza por sí mismo:
 * - I-7: seq de cada cuenta es 1..n y next_seq = n + 1 (si no, el siguiente alta chocaría con UNIQUE);
 * - I-9: cada transferencia son dos filas out/in, misma cuenta no, mismo espacio, monto, fecha y estado;
 * - fechas reales (el GLOB del esquema deja pasar '2026-02-31');
 * - techo de volumen: la suma de montos de cada espacio cabe en un entero seguro.
 */
async function assertLedgerIntegrity(tx: SqlExecutor, workspaceIds: readonly Id[] | null): Promise<void> {
  const scope = (column: string) =>
    workspaceIds === null ? { sql: '1 = 1', params: [] as SqlValue[] } : {
      sql: `${column} IN (${workspaceIds.map(() => '?').join(', ')})`,
      params: [...workspaceIds] as SqlValue[],
    };
  const acc = scope('a.workspace_id');
  const seq = await tx.get<{ id: string }>(
    `SELECT a.id FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE ${acc.sql}
     GROUP BY a.id HAVING COUNT(t.id) <> COALESCE(MAX(t.seq), 0) OR a.next_seq <> COALESCE(MAX(t.seq), 0) + 1 LIMIT 1`,
    acc.params,
  );
  if (seq !== undefined) throw invalid('integrity', { problem: 'seq', accountId: seq.id });

  const t = scope('workspace_id');
  const transfer = await tx.get<{ g: string }>(
    `SELECT transfer_group_id AS g FROM transactions WHERE transfer_group_id IS NOT NULL AND ${t.sql}
     GROUP BY transfer_group_id
     HAVING COUNT(*) <> 2 OR COUNT(DISTINCT direction) <> 2 OR COUNT(DISTINCT account_id) <> 2
         OR COUNT(DISTINCT workspace_id) <> 1 OR COUNT(DISTINCT amount_minor) <> 1 OR COUNT(DISTINCT date) <> 1
         OR COUNT(DISTINCT status) <> 1 OR SUM(kind <> 'transfer') > 0
     LIMIT 1`,
    t.params,
  );
  if (transfer !== undefined) throw invalid('integrity', { problem: 'transfer', transferGroupId: transfer.g });
  // Un grupo de transferencia compartido con otro espacio (fuera del alcance) también es incoherente.
  const crossed = await tx.get<{ g: string }>(
    `SELECT a.transfer_group_id AS g FROM transactions a JOIN transactions b
       ON b.transfer_group_id = a.transfer_group_id AND b.workspace_id <> a.workspace_id
     WHERE a.transfer_group_id IS NOT NULL AND ${scope('a.workspace_id').sql} LIMIT 1`,
    scope('a.workspace_id').params,
  );
  if (crossed !== undefined) throw invalid('integrity', { problem: 'transfer', transferGroupId: crossed.g });

  const badDate = await tx.get<{ id: string }>(
    `SELECT id FROM transactions WHERE date(date) IS NOT date AND ${t.sql} LIMIT 1`,
    t.params,
  );
  if (badDate !== undefined) throw invalid('integrity', { problem: 'date', transactionId: badDate.id });
  const tv = scope('t.workspace_id');
  const badValueDate = await tx.get<{ id: string }>(
    `SELECT v.transaction_id AS id FROM transaction_field_values v JOIN transactions t ON t.id = v.transaction_id
     WHERE v.value_date IS NOT NULL AND date(v.value_date) IS NOT v.value_date AND ${tv.sql} LIMIT 1`,
    tv.params,
  );
  if (badValueDate !== undefined) throw invalid('integrity', { problem: 'date', transactionId: badValueDate.id });

  // total() es flotante y no desborda: sirve de criba; la suma exacta se hace con BigInt solo si hace falta
  // (SUM() de un archivo manipulado podría desbordar los 64 bits y salir como SqlError).
  const suspects = await tx.all<{ w: string }>(
    `SELECT workspace_id AS w FROM transactions WHERE ${t.sql} GROUP BY workspace_id HAVING total(amount_minor) > ?`,
    [...t.params, MAX_MINOR * 0.99],
  );
  for (const { w } of suspects) {
    const rows = await tx.all<{ a: number }>('SELECT amount_minor AS a FROM transactions WHERE workspace_id = ?', [w]);
    let sum = 0n;
    for (const r of rows) sum += BigInt(r.a);
    if (sum > BigInt(MAX_MINOR)) throw invalid('integrity', { problem: 'volume', workspaceId: w });
  }
}

async function leaveMaintenance(tx: SqlExecutor, workspaceIds: readonly Id[] | null): Promise<void> {
  const fk = await tx.all('PRAGMA foreign_key_check');
  if (fk.length > 0) throw invalid('foreign_keys', { violations: fk.slice(0, 5) });
  await assertLedgerIntegrity(tx, workspaceIds);
  await tx.run("DELETE FROM settings WHERE scope_id = '' AND key = ?", [MAINTENANCE_KEY]);
}

async function insertRows(tx: SqlExecutor, table: BackupTable, t: { columns: string[]; rows: SqlValue[][] }): Promise<void> {
  if (t.rows.length === 0) return;
  const known = COLUMNS[table] as readonly string[];
  for (const c of t.columns) if (!known.includes(c)) throw invalid('unknown_column', { table, column: c });
  const sql = `INSERT INTO ${table} (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`;
  try {
    await tx.runMany(sql, t.rows);
  } catch (e) {
    // Un trigger o una restricción rechaza una fila: el archivo no es coherente. Se informa como respaldo
    // inválido (con la causa) y la transacción entera hace ROLLBACK.
    const cause = isDomainError(e) ? e.code : e instanceof Error ? e.message : String(e);
    throw invalid('insert', { table, cause });
  }
}

/** Quita filas de ajustes sys.* y auth.* que un archivo manipulado pudiera traer (nunca se exportan). */
function withoutSys(t: { columns: string[]; rows: SqlValue[][] }): { columns: string[]; rows: SqlValue[][] } {
  const at = col(t, 'key');
  return { columns: t.columns, rows: t.rows.filter((r) => !isLocalOnlySetting(String(cell(r, at)))) };
}

// ── Reasignación de ids (importar un espacio) ─────────────────────────────────────────

const ID_COLUMNS: Record<BackupTable, readonly string[]> = {
  workspaces: ['id'],
  accounts: ['id', 'workspace_id'],
  batches: ['id', 'workspace_id', 'account_id'],
  fields: ['id', 'workspace_id'],
  field_options: ['id', 'field_id', 'merged_into_id'],
  transactions: ['id', 'workspace_id', 'account_id', 'batch_id', 'transfer_group_id'],
  transaction_field_values: ['transaction_id', 'field_id', 'value_option_id'],
  saved_views: ['id', 'workspace_id'],
  audit_log: ['id', 'workspace_id', 'entity_id', 'account_id', 'batch_id'],
  audit_log_changes: ['action_id', 'entity_id', 'path'],
  settings: ['scope_id'],
};
const JSON_COLUMNS: Record<BackupTable, readonly string[]> = {
  workspaces: [],
  accounts: [],
  batches: ['meta'],
  fields: [],
  field_options: [],
  transactions: [],
  transaction_field_values: [],
  saved_views: ['recipe'],
  audit_log: ['params', 'meta'],
  audit_log_changes: ['old_value', 'new_value'],
  settings: ['value'],
};

function createRemapper(map: ReadonlyMap<string, string>) {
  const str = (s: string): string => {
    const direct = map.get(s);
    if (direct !== undefined) return direct;
    if (s.startsWith('field:')) {
      const id = map.get(s.slice(6));
      if (id !== undefined) return `field:${id}`;
    }
    return s;
  };
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return str(v);
    if (Array.isArray(v)) return v.map(deep);
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[str(k)] = deep(val);
      return out;
    }
    return v;
  };
  const json = (v: SqlValue): SqlValue => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.stringify(deep(JSON.parse(v)));
    } catch {
      return v;
    }
  };
  return { str, json };
}

/** Filas del espacio `ws` dentro de un respaldo (sea de todo o de un espacio). */
function rowsOfWorkspace(file: BackupFile, ws: Id): Record<BackupTable, { columns: string[]; rows: SqlValue[][] }> {
  const t = file.tables;
  const pick = (table: BackupTable, keep: (row: SqlValue[]) => boolean) => ({
    columns: [...t[table].columns],
    rows: t[table].rows.filter(keep).map((r) => [...r]),
  });
  const byWs = (table: BackupTable) => {
    const at = col(t[table], 'workspace_id');
    return pick(table, (r) => cell(r, at) === ws);
  };
  const idsOf = (x: { columns: string[]; rows: SqlValue[][] }, name = 'id') => {
    const at = col(x, name);
    return new Set(x.rows.map((r) => cell(r, at)));
  };
  const wsAt = col(t.workspaces, 'id');
  const workspaces = pick('workspaces', (r) => cell(r, wsAt) === ws);
  const fields = byWs('fields');
  const transactions = byWs('transactions');
  const audit = byWs('audit_log');
  const fieldIds = idsOf(fields);
  const txIds = idsOf(transactions);
  const actionIds = idsOf(audit);
  const optField = col(t.field_options, 'field_id');
  const tfvTx = col(t.transaction_field_values, 'transaction_id');
  const chAction = col(t.audit_log_changes, 'action_id');
  const setScope = col(t.settings, 'scope_id');
  const setKey = col(t.settings, 'key');
  return {
    workspaces,
    accounts: byWs('accounts'),
    batches: byWs('batches'),
    fields,
    field_options: pick('field_options', (r) => fieldIds.has(cell(r, optField))),
    transactions,
    transaction_field_values: pick('transaction_field_values', (r) => txIds.has(cell(r, tfvTx))),
    saved_views: byWs('saved_views'),
    audit_log: audit,
    audit_log_changes: pick('audit_log_changes', (r) => actionIds.has(cell(r, chAction))),
    settings: pick('settings', (r) => cell(r, setScope) === ws && !isLocalOnlySetting(String(cell(r, setKey)))),
  };
}

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createBackupService(deps: CoreDeps, options: BackupServiceOptions = {}): BackupService {
  const appVersion = options.appVersion ?? APP_VERSION;
  const upgraders = options.upgraders ?? SCHEMA_UPGRADERS;

  async function currentSchema(): Promise<number> {
    if (options.schemaVersion !== undefined) return options.schemaVersion;
    const row = await deps.driver.get<{ user_version: number }>('PRAGMA user_version');
    return Number(row?.user_version ?? 0);
  }

  /** Lee el texto de un archivo: descifra si hace falta, valida forma, checksum y versión; sube de versión. */
  async function load(text: string, password: string | undefined, info: PartialInfo): Promise<{ file: BackupFile; needsUpgrade: boolean }> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw invalid('json');
    }
    if (isRecord(raw) && raw['format'] === 'cuadra-encrypted') {
      info.encrypted = true;
      if (!isEncryptedEnvelope(raw)) throw invalid('envelope_shape');
      if (password === undefined || password === '') throw new DomainError('password_required');
      const plain = await decryptText(password, raw);
      try {
        raw = JSON.parse(plain);
      } catch {
        throw invalid('json');
      }
    }
    const file = validateShape(raw, info);
    if ((await computeChecksum(file.tables)) !== file.checksum) throw new DomainError('backup_checksum');
    const current = await currentSchema();
    if (file.schemaVersion > current) {
      throw new DomainError('backup_from_newer_version', { schemaVersion: file.schemaVersion, current });
    }
    const needsUpgrade = file.schemaVersion < current || info.formatVersion < CURRENT_FORMAT_VERSION;
    return { file: upgradeBackup(file, current, upgraders), needsUpgrade };
  }

  const freshInfo = (): PartialInfo => ({
    encrypted: false,
    formatVersion: 0,
    schemaVersion: 0,
    appVersion: '',
    createdAt: '',
    scope: 'all',
  });

  async function buildFile(scope: BackupScope): Promise<BackupFile> {
    const tables = await readTx(deps, async (tx) => {
      if (scope.scope === 'workspace') {
        const ws = await tx.get('SELECT id FROM workspaces WHERE id = ?', [scope.workspaceId]);
        if (ws === undefined) throw new DomainError('not_found', { entity: 'workspace', id: scope.workspaceId });
      }
      return readTables(tx, scope);
    });
    const counts = {} as Record<BackupTable, number>;
    for (const table of BACKUP_TABLES) counts[table] = tables[table].rows.length;
    const idAt = col(tables.workspaces, 'id');
    return {
      format: 'cuadra-backup',
      formatVersion: CURRENT_FORMAT_VERSION,
      schemaVersion: await currentSchema(),
      appVersion,
      createdAt: deps.clock.now().toISOString(),
      scope: scope.scope,
      workspaceIds: tables.workspaces.rows.map((r) => String(cell(r, idAt))),
      checksum: await computeChecksum(tables),
      counts,
      tables,
    };
  }

  async function exportBackup(opts: BackupScope & { password?: string }): Promise<BackupExport> {
    const scope: BackupScope = opts.scope === 'all' ? { scope: 'all' } : { scope: 'workspace', workspaceId: opts.workspaceId };
    const file = await buildFile(scope);
    const json = JSON.stringify(file);
    const password = opts.password !== undefined && opts.password !== '' ? opts.password : undefined;
    const text = password === undefined ? json : JSON.stringify(await encryptText(password, json, options.encryption ?? {}));

    // Verificación de lectura: lo que se va a guardar se vuelve a abrir y debe dar lo mismo.
    const back = await load(text, password, freshInfo());
    const sameCounts = BACKUP_TABLES.every((t) => back.file.counts[t] === file.counts[t]);
    if (back.file.checksum !== file.checksum || !sameCounts) throw invalid('verify');

    // Un respaldo cifrado no deja el nombre del cliente a la vista en el nombre del archivo.
    let base = 'cuadra';
    if (scope.scope === 'workspace' && password === undefined) {
      const nameAt = col(file.tables.workspaces, 'name');
      const name = slug(String(cell(file.tables.workspaces.rows[0] ?? [], nameAt) ?? ''));
      if (name !== '') base = `cuadra-${name}`;
    }
    return {
      file,
      json,
      text,
      bytes: new TextEncoder().encode(text).length,
      encrypted: password !== undefined,
      verified: true,
      suggestedName: `${base}-${deps.clock.today()}.cuadra.json`,
    };
  }

  return {
    export: exportBackup,

    async markVerified(at) {
      const value = at ?? deps.clock.now().toISOString();
      await mutate(deps, null, 'backup.markVerified', async (ctx) => {
        await ctx.tx.run(
          `INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'backup.lastVerifiedAt', ?, ?)
           ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [JSON.stringify(value), ctx.clock.now().toISOString()],
        );
        ctx.touch('settings');
      });
    },

    async inspect(text, opts = {}) {
      const info = freshInfo();
      try {
        const { file, needsUpgrade } = await load(text, opts.password, info);
        const t = file.tables;
        const txWs = col(t.transactions, 'workspace_id');
        const accWs = col(t.accounts, 'workspace_id');
        const idAt = col(t.workspaces, 'id');
        const nameAt = col(t.workspaces, 'name');
        const countBy = (rows: SqlValue[][], at: number) => {
          const m = new Map<SqlValue, number>();
          for (const r of rows) m.set(cell(r, at), (m.get(cell(r, at)) ?? 0) + 1);
          return m;
        };
        const txCount = countBy(t.transactions.rows, txWs);
        const accCount = countBy(t.accounts.rows, accWs);
        return {
          ok: true,
          encrypted: info.encrypted,
          formatVersion: info.formatVersion,
          schemaVersion: info.schemaVersion,
          appVersion: file.appVersion,
          createdAt: file.createdAt,
          scope: file.scope,
          workspaces: t.workspaces.rows.map((r) => {
            const id = String(cell(r, idAt));
            return { id, name: String(cell(r, nameAt)), transactions: txCount.get(id) ?? 0, accounts: accCount.get(id) ?? 0 };
          }),
          counts: { ...file.counts },
          needsUpgrade,
        };
      } catch (e) {
        if (!(e instanceof DomainError) && !isDomainError(e)) throw e;
        return {
          ok: false,
          error: (e as DomainError).code,
          ...info,
          workspaces: [],
          counts: {},
          needsUpgrade: false,
        };
      }
    },

    async restoreAll(text, opts) {
      if (opts?.confirm !== true) throw new DomainError('confirmation_mismatch');
      const { file } = await load(text, opts.password, freshInfo());
      if (file.scope !== 'all') throw invalid('scope_workspace');

      // Copia automática del estado actual ANTES de tocar nada.
      const at = deps.clock.now();
      const copy: AutoCopy = {
        name: `cuadra-antes-de-restaurar-${stamp(at)}.cuadra.json`,
        createdAt: at.toISOString(),
        bytes: await deps.driver.exportBytes(),
        json: (await exportBackup({ scope: 'all' })).json,
      };
      if (options.autoCopy) await options.autoCopy(copy);

      const counts = { workspaces: file.counts.workspaces, transactions: file.counts.transactions };
      await mutate(deps, null, 'backup.restore', async (ctx) => {
        const now = ctx.clock.now().toISOString();
        await enterMaintenance(ctx.tx, now);
        if (!options.autoCopy) {
          await ctx.tx.run(
            `INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', ?, ?, ?)
             ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [AUTO_COPY_KEY, JSON.stringify({ name: copy.name, createdAt: copy.createdAt, backup: JSON.parse(copy.json) }), now],
          );
        }
        for (const table of [...BACKUP_TABLES].reverse()) {
          await ctx.tx.run(table === 'settings' ? `DELETE FROM settings WHERE ${LOCAL_ONLY_SQL}` : `DELETE FROM ${table}`);
        }
        for (const table of BACKUP_TABLES) {
          await insertRows(ctx.tx, table, table === 'settings' ? withoutSys(file.tables.settings) : file.tables[table]);
        }
        await leaveMaintenance(ctx.tx, null);
        await ctx.audit.record(ctx.tx, {
          workspaceId: null,
          action: 'backup_restore',
          entityType: 'installation',
          entityId: null,
          accountId: null,
          batchId: null,
          message: 'audit.backup.restore',
          params: { ...counts, backupCreatedAt: file.createdAt, appVersion: file.appVersion, autoCopy: copy.name },
          changes: [],
        });
        ctx.touch(...TABLE_NAMES);
      });
      return { ...counts, autoCopy: { name: copy.name, storedIn: options.autoCopy ? 'external' : 'database' } };
    },

    async importWorkspace(text, sourceWorkspaceId, opts = {}) {
      const { file } = await load(text, opts.password, freshInfo());
      const rows = rowsOfWorkspace(file, sourceWorkspaceId);
      const source = rows.workspaces.rows[0];
      if (source === undefined) throw new DomainError('not_found', { entity: 'workspace', id: sourceWorkspaceId });

      // Mapa idViejo → idNuevo. Se generan en el orden de los ids viejos para conservar el orden temporal
      // de los uuidv7 (el historial se ordena por id).
      const old = new Set<string>();
      for (const table of BACKUP_TABLES) {
        const t = rows[table];
        for (const name of ['id', 'transfer_group_id']) {
          const at = col(t, name);
          if (at < 0 || (table === 'settings' && name === 'id')) continue;
          for (const r of t.rows) {
            const v = cell(r, at);
            if (typeof v === 'string') old.add(v);
          }
        }
      }
      const map = new Map<string, string>();
      for (const id of [...old].sort()) map.set(id, deps.ids.next());
      const remap = createRemapper(map);
      for (const table of BACKUP_TABLES) {
        const t = rows[table];
        const idCols = ID_COLUMNS[table].map((c) => col(t, c)).filter((i) => i >= 0);
        const jsonCols = JSON_COLUMNS[table].map((c) => col(t, c)).filter((i) => i >= 0);
        for (const r of t.rows) {
          for (const i of idCols) {
            const v = r[i];
            if (typeof v === 'string') r[i] = remap.str(v);
          }
          for (const i of jsonCols) r[i] = remap.json(r[i] ?? null);
        }
      }
      const newId = map.get(sourceWorkspaceId) as string;
      const ws = rows.workspaces;
      const nameAt = col(ws, 'name');
      const sourceName = String(cell(source, nameAt));

      const m = await mutate(deps, newId, 'backup.importWorkspace', async (ctx) => {
        const now = ctx.clock.now().toISOString();
        const existing = await ctx.tx.all<{ name: string }>('SELECT name FROM workspaces');
        const taken = new Set(existing.map((e) => normalizeSearch(e.name)));
        let name = opts.rename?.trim() ?? '';
        if (name === '') {
          name = sourceName;
          for (let n = 2; taken.has(normalizeSearch(name)); n++) name = `${sourceName} (${n})`;
        }
        const maxOrder = await ctx.tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM workspaces');
        const row = ws.rows[0] as SqlValue[];
        row[nameAt] = name;
        const orderAt = col(ws, 'sort_order');
        if (orderAt >= 0) row[orderAt] = Number(maxOrder?.m ?? -1) + 1;
        const updatedAt = col(ws, 'updated_at');
        if (updatedAt >= 0) row[updatedAt] = now;

        await enterMaintenance(ctx.tx, now);
        for (const table of BACKUP_TABLES) await insertRows(ctx.tx, table, rows[table]);
        await leaveMaintenance(ctx.tx, [newId]);
        await ctx.audit.record(ctx.tx, {
          workspaceId: newId,
          action: 'workspace_import',
          entityType: 'workspace',
          entityId: newId,
          accountId: null,
          batchId: null,
          message: 'audit.workspace.import',
          params: {
            name,
            sourceName,
            accounts: rows.accounts.rows.length,
            transactions: rows.transactions.rows.length,
            backupCreatedAt: file.createdAt,
          },
          changes: [],
        });
        ctx.touch(...TABLE_NAMES);
        const created = await ctx.tx.get<WorkspaceRecord>('SELECT * FROM workspaces WHERE id = ?', [newId]);
        return toWorkspace(created as WorkspaceRecord);
      });
      return m;
    },

    async lastAutoCopy() {
      const row = await deps.driver.get<{ value: string }>("SELECT value FROM settings WHERE scope_id = '' AND key = ?", [
        AUTO_COPY_KEY,
      ]);
      if (row === undefined) return null;
      const v = JSON.parse(row.value) as { name: string; createdAt: Timestamp; backup: unknown };
      return { name: v.name, createdAt: v.createdAt, json: JSON.stringify(v.backup) };
    },
  };
}
