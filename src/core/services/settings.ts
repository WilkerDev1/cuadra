// Ajustes de instalación y por espacio (ARCHITECTURE.md 3.5). Viven en `settings` como JSON; las claves
// `sys.*` son internas (modo mantenimiento) y este servicio no las expone. Cada clave tiene valor por
// defecto y validación de tipo, para que un valor raro no llegue nunca a la interfaz.
import { DomainError } from '../errors';
import type { Id, Timestamp } from '../types';
import { mutate, type CoreDeps } from '../uow';

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

interface Spec<T> {
  fallback: T;
  valid(value: unknown): value is T;
}

const isNullableString = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v !== '');
const isTimestamp = (v: unknown): v is Timestamp | null =>
  v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 200 && v.every((s) => typeof s === 'string' && s !== '');

export const SETTINGS_SPEC: { [K in keyof SettingsMap]: Spec<SettingsMap[K]> } = {
  locale: { fallback: 'es-DO', valid: (v): v is string => typeof v === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(v) },
  theme: { fallback: 'system', valid: (v): v is SettingsMap['theme'] => v === 'system' || v === 'light' || v === 'dark' },
  'disclaimer.acceptedAt': { fallback: null, valid: isTimestamp },
  'backup.lastVerifiedAt': { fallback: null, valid: isTimestamp },
  'backup.reminderDays': {
    fallback: 30,
    valid: (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365,
  },
  'workspace.lastOpened': { fallback: null, valid: isNullableString },
  'demo.offered': { fallback: false, valid: (v): v is boolean => typeof v === 'boolean' },
};

export const WORKSPACE_SETTINGS_SPEC: { [K in keyof WorkspaceSettingsMap]: Spec<WorkspaceSettingsMap[K]> } = {
  'capture.lastKind': {
    fallback: 'expense',
    valid: (v): v is WorkspaceSettingsMap['capture.lastKind'] => v === 'income' || v === 'expense',
  },
  'capture.lastAccountId': { fallback: null, valid: isNullableString },
  'home.cards': { fallback: [], valid: isStringArray },
  'ledger.columns': { fallback: [], valid: isStringArray },
};

function specOf(table: Record<string, Spec<unknown>>, key: string): Spec<unknown> {
  const spec = Object.hasOwn(table, key) ? table[key] : undefined;
  if (spec === undefined) throw new DomainError('invalid_setting', { key, reason: 'unknown' });
  return spec;
}

/** Valor por defecto, copiado para que nadie mute el compartido. */
const fallbackOf = (spec: Spec<unknown>): unknown => structuredClone(spec.fallback);

export function createSettingsService(deps: CoreDeps): SettingsService {
  async function read(scope: string, key: string, table: Record<string, Spec<unknown>>): Promise<unknown> {
    const spec = specOf(table, key);
    const row = await deps.driver.get<{ value: string }>('SELECT value FROM settings WHERE scope_id = ? AND key = ?', [
      scope,
      key,
    ]);
    if (row === undefined) return fallbackOf(spec);
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      return fallbackOf(spec);
    }
    // Un valor guardado que ya no cumple (versión vieja, edición a mano) vuelve al de por defecto.
    return spec.valid(value) ? value : fallbackOf(spec);
  }

  async function write(scope: string, key: string, value: unknown, table: Record<string, Spec<unknown>>): Promise<void> {
    const spec = specOf(table, key);
    if (!spec.valid(value)) throw new DomainError('invalid_setting', { key, reason: 'invalid_value' });
    const workspaceId = scope === '' ? null : scope;
    await mutate(deps, workspaceId, `settings.${key}`, async (ctx) => {
      if (workspaceId !== null) {
        const ws = await ctx.tx.get('SELECT id FROM workspaces WHERE id = ?', [workspaceId]);
        if (ws === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
      }
      const json = JSON.stringify(value);
      const current = await ctx.tx.get<{ value: string }>('SELECT value FROM settings WHERE scope_id = ? AND key = ?', [
        scope,
        key,
      ]);
      if (current?.value === json) return;
      await ctx.tx.run(
        `INSERT INTO settings (scope_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [scope, key, json, ctx.clock.now().toISOString()],
      );
      ctx.touch('settings');
    });
  }

  return {
    get: async (key) => (await read('', key, SETTINGS_SPEC)) as never,
    set: (key, value) => write('', key, value, SETTINGS_SPEC),
    getWs: async (workspaceId, key) => (await read(workspaceId, key, WORKSPACE_SETTINGS_SPEC)) as never,
    setWs: (workspaceId, key, value) => write(workspaceId, key, value, WORKSPACE_SETTINGS_SPEC),
  };
}
