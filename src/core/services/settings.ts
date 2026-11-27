// Ajustes de instalación y por espacio (ARCHITECTURE.md 3.5). Stub de la Oleada 1 (lo implementa 2B).
import { notImplemented } from '../errors';
import type { Id, Timestamp } from '../types';
import type { CoreDeps } from '../uow';

export interface SettingsMap {
  // claves conocidas y su tipo
  locale: string; // 'es-DO'
  theme: 'system' | 'light' | 'dark';
  'disclaimer.acceptedAt': Timestamp | null;
  'backup.lastVerifiedAt': Timestamp | null;
  'backup.reminderDays': number; // 30
  'workspace.lastOpened': Id | null;
  'demo.offered': boolean;
}
export interface WorkspaceSettingsMap {
  'capture.lastKind': 'income' | 'expense';
  'capture.lastAccountId': Id | null;
  'home.cards': string[]; // ids de HomeCardDef visibles y su orden
  'ledger.columns': Id[];
}

export interface SettingsService {
  get<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]>;
  set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void>;
  getWs<K extends keyof WorkspaceSettingsMap>(workspaceId: Id, key: K): Promise<WorkspaceSettingsMap[K]>;
  setWs<K extends keyof WorkspaceSettingsMap>(workspaceId: Id, key: K, value: WorkspaceSettingsMap[K]): Promise<void>;
}

export function createSettingsService(_deps: CoreDeps): SettingsService {
  return {
    get: async () => notImplemented('settings.get'),
    set: async () => notImplemented('settings.set'),
    getWs: async () => notImplemented('settings.getWs'),
    setWs: async () => notImplemented('settings.setWs'),
  };
}
