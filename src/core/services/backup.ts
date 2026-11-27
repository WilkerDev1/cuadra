// Respaldo JSON versionado (ARCHITECTURE.md 3.5, 3.7). Stub de la Oleada 1: lo implementa la Oleada 2 (2D).
import { notImplemented, type ErrorCode } from '../errors';
import type { SqlValue } from '../ports';
import type { Id, Mutation, Timestamp, Workspace } from '../types';
import type { CoreDeps } from '../uow';

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
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: Timestamp;
  scope: 'all' | 'workspace';
  workspaces: Array<{ id: Id; name: string; transactions: number; accounts: number }>;
  needsUpgrade: boolean;
}

export interface BackupService {
  /** F-81/83/84: arma el archivo, lo vuelve a leer y compara checksum y conteos antes de devolverlo. */
  export(opts: { scope: 'all' } | { scope: 'workspace'; workspaceId: Id }): Promise<{
    file: BackupFile;
    json: string;
    bytes: number;
    verified: true;
    suggestedName: string; // cuadra-2026-11-26.cuadra.json
  }>;
  /** La UI llama esto cuando el archivo ya se guardó/descargó. */
  markVerified(at?: Timestamp): Promise<void>;
  inspect(json: string): Promise<BackupInspection>; // sin escribir nada
  /** F-87: reemplaza TODO. Antes guarda copia automática (exportBytes → IDB / app data). */
  restoreAll(json: string, opts: { confirm: true }): Promise<{ workspaces: number; transactions: number }>;
  /** F-88: un espacio del respaldo entra como espacio NUEVO, con ids nuevos. */
  importWorkspace(json: string, sourceWorkspaceId: Id, opts?: { rename?: string }): Promise<Mutation<Workspace>>;
}

export function createBackupService(_deps: CoreDeps): BackupService {
  return {
    export: async () => notImplemented('backup.export'),
    markVerified: async () => notImplemented('backup.markVerified'),
    inspect: async () => notImplemented('backup.inspect'),
    restoreAll: async () => notImplemented('backup.restoreAll'),
    importWorkspace: async () => notImplemented('backup.importWorkspace'),
  };
}
