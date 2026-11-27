// Inicio de sesión local (PLAN.md: "Inicio de sesión"). Perfil local con contraseña opcional, clave de
// recuperación, bloqueo automático por inactividad y límite de intentos con espera creciente.
//
// Qué protege y qué no (la UI lo dice con auth.notice.*): la contraseña controla el acceso a la app y
// CIFRA LOS RESPALDOS (encrypt/decrypt con la sesión abierta, ver crypto.ts). La base local NO se cifra.
//
// Persistencia: tabla settings, scope_id = '' y claves 'auth.*'. Se guardan hashes PBKDF2 con su sal, nunca
// la contraseña ni la clave de recuperación. El estado de sesión (desbloqueado, última actividad, contraseña
// para cifrar respaldos) vive solo en memoria: un reinicio arranca bloqueado.
//
// Auto-bloqueo: el núcleo no tiene temporizadores. La UI llama a touch() en cada interacción y a checkIdle()
// periódicamente (p. ej. cada 15 s y en visibilitychange); status() también lo comprueba.
import {
  decryptText,
  encryptText,
  hashPassword,
  isPasswordHash,
  normalizeRecoveryKey,
  verifyPassword,
  generateRecoveryKey,
  DEFAULT_PBKDF2_ITERATIONS,
  type EncryptedEnvelope,
  type PasswordHash,
} from '../crypto';
import { DomainError, type ErrorCode } from '../errors';
import type { SqlExecutor } from '../ports';
import type { Timestamp } from '../types';
import { mutate, type CoreDeps } from '../uow';

// ── Contrato ─────────────────────────────────────────────────────────────────────────

/** Códigos de error que lanza este servicio (todos en ERROR_CODES; textos en i18n/es/errors.ts). */
export type AuthErrorCode = Extract<
  ErrorCode,
  | 'wrong_password'
  | 'wrong_recovery_key'
  | 'too_many_attempts'
  | 'auth_not_enabled'
  | 'auth_already_enabled'
  | 'auth_locked'
  | 'password_too_short'
  | 'password_too_long'
  | 'profile_name_required'
  | 'invalid_auto_lock'
  | 'crypto_unavailable'
>;

export interface AuthStatus {
  /** ¿Hay contraseña activada? */
  enabled: boolean;
  /** ¿Hay que pedir la contraseña antes de mostrar nada? Siempre false si !enabled. */
  locked: boolean;
  hasRecoveryKey: boolean;
  /** Minutos de inactividad hasta bloquear; 0 = nunca. */
  autoLockMinutes: number;
  profileName: string | null;
  /** Fallos seguidos (contraseña o clave de recuperación). Se pone a 0 al entrar. */
  failedAttempts: number;
  /** Hasta cuándo no se admite otro intento; null si no hay espera. */
  retryAt: Timestamp | null;
  passwordChangedAt: Timestamp | null;
}

export interface AuthService {
  /** Estado actual (relee la base y aplica el auto-bloqueo). */
  status(): Promise<AuthStatus>;
  /** Último estado conocido, síncrono (para useSyncExternalStore). null antes de la primera lectura. */
  snapshot(): AuthStatus | null;
  /** Activa la contraseña. Devuelve la clave de recuperación: se muestra UNA vez y no se guarda en claro. */
  setup(input: { profileName: string; password: string }): Promise<{ recoveryKey: string }>;
  unlock(password: string): Promise<void>;
  /** Olvidé la contraseña: la clave de recuperación pone una nueva y abre la sesión. La clave sigue valiendo. */
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<void>;
  lock(): void;
  changePassword(currentPassword: string, nextPassword: string): Promise<void>;
  /** Nueva clave de recuperación (la anterior deja de valer). Pide la contraseña actual. */
  regenerateRecoveryKey(password: string): Promise<{ recoveryKey: string }>;
  /** Quita la contraseña. Pide la actual. */
  disable(password: string): Promise<void>;
  /** 0 = nunca; entero de 1 a 1440. Con contraseña activada exige sesión abierta. */
  setAutoLock(minutes: number): Promise<void>;
  /** Hubo actividad del usuario: aplaza el auto-bloqueo (si no venció ya). */
  touch(): void;
  /** Bloquea si venció la inactividad. Devuelve true si acaba de bloquear. */
  checkIdle(): boolean;
  /** Cifra con la contraseña de la sesión abierta (respaldos). */
  encrypt(plaintext: string): Promise<EncryptedEnvelope>;
  /** Descifra con la contraseña de la sesión; wrong_password si el sobre se hizo con otra. */
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
  subscribe(listener: (status: AuthStatus) => void): () => void;
}

export interface AuthServiceOptions {
  /** Iteraciones PBKDF2 de los hashes guardados (por defecto 600 000; bajas en pruebas). */
  hashIterations?: number;
  /** Iteraciones PBKDF2 de los sobres cifrados (por defecto 600 000; bajas en pruebas). */
  encryptionIterations?: number;
}

// ── Parámetros ───────────────────────────────────────────────────────────────────────

export const AUTH_DEFAULT_AUTO_LOCK_MINUTES = 5;
export const AUTH_MAX_AUTO_LOCK_MINUTES = 24 * 60;
export const AUTH_MIN_PASSWORD_LENGTH = 8;
export const AUTH_MAX_PASSWORD_LENGTH = 1024;
export const AUTH_MAX_PROFILE_NAME_LENGTH = 60;
/** Intentos fallidos sin espera. */
export const AUTH_FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Espera tras `failures` fallos seguidos: 0 los primeros, luego 30 s, 1 min, 2 min… hasta 15 min. */
export function attemptDelayMs(failures: number): number {
  if (failures < AUTH_FREE_ATTEMPTS) return 0;
  const exp = Math.min(failures - AUTH_FREE_ATTEMPTS, 20);
  return Math.min(BASE_DELAY_MS * 2 ** exp, MAX_DELAY_MS);
}

/** Claves de settings (scope_id = ''). Todas empiezan por 'auth.'. */
export const AUTH_KEYS = {
  enabled: 'auth.enabled',
  profileName: 'auth.profileName',
  passwordHash: 'auth.passwordHash',
  recoveryHash: 'auth.recoveryHash',
  autoLockMinutes: 'auth.autoLockMinutes',
  failedAttempts: 'auth.failedAttempts',
  retryAt: 'auth.retryAt',
  passwordChangedAt: 'auth.passwordChangedAt',
  recoveryKeyCreatedAt: 'auth.recoveryKeyCreatedAt',
} as const;

interface Persisted {
  enabled: boolean;
  profileName: string | null;
  passwordHash: PasswordHash | null;
  recoveryHash: PasswordHash | null;
  autoLockMinutes: number;
  failedAttempts: number;
  retryAt: Timestamp | null;
  passwordChangedAt: Timestamp | null;
  recoveryKeyCreatedAt: Timestamp | null;
}

type PersistedPatch = Partial<Persisted>;

const AUDIT_MESSAGES = {
  enabled: 'auth.audit.enabled',
  disabled: 'auth.audit.disabled',
  passwordChanged: 'auth.audit.passwordChanged',
  recovered: 'auth.audit.recovered',
  recoveryKeyRegenerated: 'auth.audit.recoveryKeyRegenerated',
  autoLockChanged: 'auth.audit.autoLockChanged',
} as const;

interface AuditNote {
  message: (typeof AUDIT_MESSAGES)[keyof typeof AUDIT_MESSAGES];
  params?: Record<string, unknown>;
  changes: Array<{ path: string; old: unknown; new: unknown }>;
}

// ── Lectura y escritura de settings ──────────────────────────────────────────────────

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}
function asMinutes(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= AUTH_MAX_AUTO_LOCK_MINUTES
    ? v
    : AUTH_DEFAULT_AUTO_LOCK_MINUTES;
}
function asHash(v: unknown): PasswordHash | null {
  return isPasswordHash(v) ? v : null;
}

async function readPersisted(ex: SqlExecutor): Promise<Persisted> {
  const rows = await ex.all<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE scope_id = '' AND key LIKE 'auth.%'",
  );
  const map = new Map<string, unknown>();
  for (const r of rows) {
    try {
      map.set(r.key, JSON.parse(r.value));
    } catch {
      // json_valid lo impide en el esquema; si aun así llega algo raro, se ignora la clave.
    }
  }
  const passwordHash = asHash(map.get(AUTH_KEYS.passwordHash));
  return {
    // Sin hash válido no hay contraseña que pedir: nunca dejamos a alguien fuera por un ajuste roto.
    enabled: asBool(map.get(AUTH_KEYS.enabled), false) && passwordHash !== null,
    profileName: asString(map.get(AUTH_KEYS.profileName)),
    passwordHash,
    recoveryHash: asHash(map.get(AUTH_KEYS.recoveryHash)),
    autoLockMinutes: asMinutes(map.get(AUTH_KEYS.autoLockMinutes)),
    failedAttempts: asCount(map.get(AUTH_KEYS.failedAttempts)),
    retryAt: asString(map.get(AUTH_KEYS.retryAt)),
    passwordChangedAt: asString(map.get(AUTH_KEYS.passwordChangedAt)),
    recoveryKeyCreatedAt: asString(map.get(AUTH_KEYS.recoveryKeyCreatedAt)),
  };
}

const UPSERT_SQL =
  "INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', ?, ?, ?) " +
  'ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

// ── Validación ───────────────────────────────────────────────────────────────────────

function checkPassword(password: string): void {
  const length = [...password.normalize('NFC')].length;
  if (password.trim().length === 0 || length < AUTH_MIN_PASSWORD_LENGTH) {
    throw new DomainError('password_too_short', { min: AUTH_MIN_PASSWORD_LENGTH });
  }
  if (length > AUTH_MAX_PASSWORD_LENGTH) throw new DomainError('password_too_long', { max: AUTH_MAX_PASSWORD_LENGTH });
}

function cleanProfileName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || [...trimmed].length > AUTH_MAX_PROFILE_NAME_LENGTH) {
    throw new DomainError('profile_name_required', { max: AUTH_MAX_PROFILE_NAME_LENGTH });
  }
  return trimmed;
}

function checkMinutes(minutes: number): void {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > AUTH_MAX_AUTO_LOCK_MINUTES) {
    throw new DomainError('invalid_auto_lock', { max: AUTH_MAX_AUTO_LOCK_MINUTES });
  }
}

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createAuthService(deps: CoreDeps, opts: AuthServiceOptions = {}): AuthService {
  const hashIterations = opts.hashIterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const encryptionIterations = opts.encryptionIterations ?? DEFAULT_PBKDF2_ITERATIONS;

  let persisted: Persisted | null = null;
  /** Sesión en memoria. `password` solo mientras está desbloqueado con contraseña activada. */
  const session: { password: string | null; hashSalt: string | null; lastActivityMs: number } = {
    password: null,
    hashSalt: null,
    lastActivityMs: 0,
  };
  /** Sube con cada lock(): un unlock que empezó antes de bloquear no reabre la sesión. */
  let lockGeneration = 0;
  let last: AuthStatus | null = null;
  let lastJson = '';
  const listeners = new Set<(s: AuthStatus) => void>();

  // Cola: las operaciones de auth se ejecutan de una en una (intentos simultáneos se cuentan todos).
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  const nowMs = () => deps.clock.now().getTime();
  const nowIso = () => deps.clock.now().toISOString();

  function clearSession(): void {
    session.password = null;
    session.hashSalt = null;
  }

  function openSession(password: string, hash: PasswordHash): void {
    session.password = password;
    session.hashSalt = hash.salt;
    session.lastActivityMs = nowMs();
  }

  /** Encaja la sesión en memoria con lo guardado (p. ej. tras restaurar un respaldo con otra contraseña). */
  function reconcile(p: Persisted): void {
    if (!p.enabled || p.passwordHash === null || p.passwordHash.salt !== session.hashSalt) clearSession();
  }

  function compute(p: Persisted): AuthStatus {
    return {
      enabled: p.enabled,
      locked: p.enabled && session.password === null,
      hasRecoveryKey: p.enabled && p.recoveryHash !== null,
      autoLockMinutes: p.autoLockMinutes,
      profileName: p.profileName,
      failedAttempts: p.failedAttempts,
      retryAt: p.retryAt,
      passwordChangedAt: p.passwordChangedAt,
    };
  }

  function publish(): AuthStatus | null {
    if (persisted === null) return null;
    const s = compute(persisted);
    const json = JSON.stringify(s);
    if (json !== lastJson) {
      last = s;
      lastJson = json;
      for (const l of [...listeners]) {
        try {
          l(s);
        } catch {
          // Un suscriptor roto no rompe a los demás.
        }
      }
    }
    return last;
  }

  async function load(): Promise<Persisted> {
    const p = await readPersisted(deps.driver);
    persisted = p;
    reconcile(p);
    return p;
  }

  /** Escribe claves 'auth.*' (y como mucho una acción de historial) en una sola unidad de trabajo. */
  async function write(reason: string, patch: PersistedPatch, audit?: AuditNote): Promise<void> {
    const at = nowIso();
    await mutate(deps, null, reason, async (ctx) => {
      const rows: Array<[string, string, string]> = [];
      for (const [field, value] of Object.entries(patch) as Array<[keyof Persisted, unknown]>) {
        rows.push([AUTH_KEYS[field], JSON.stringify(value ?? null), at]);
      }
      if (rows.length > 0) {
        await ctx.tx.runMany(UPSERT_SQL, rows);
        ctx.touch('settings');
      }
      if (audit !== undefined) {
        await ctx.audit.record(ctx.tx, {
          workspaceId: null,
          action: 'config',
          entityType: 'settings',
          entityId: null,
          accountId: null,
          batchId: null,
          message: audit.message,
          params: audit.params ?? null,
          changes: audit.changes,
        });
      }
    });
    if (persisted !== null) persisted = { ...persisted, ...patch };
  }

  function requireEnabled(p: Persisted): PasswordHash {
    if (!p.enabled || p.passwordHash === null) throw new DomainError('auth_not_enabled');
    return p.passwordHash;
  }

  function throttle(p: Persisted): void {
    if (p.retryAt === null) return;
    const until = Date.parse(p.retryAt);
    const now = nowMs();
    if (Number.isFinite(until) && now < until) {
      throw new DomainError('too_many_attempts', {
        retryAt: p.retryAt,
        waitSeconds: Math.ceil((until - now) / 1000),
        failedAttempts: p.failedAttempts,
      });
    }
  }

  async function recordFailure(p: Persisted): Promise<{ failedAttempts: number; retryAt: Timestamp | null }> {
    const failedAttempts = p.failedAttempts + 1;
    const delay = attemptDelayMs(failedAttempts);
    const retryAt = delay > 0 ? new Date(nowMs() + delay).toISOString() : null;
    await write('auth.attempt', { failedAttempts, retryAt });
    return { failedAttempts, retryAt };
  }

  /**
   * Comprueba un secreto contra su hash con límite de intentos. Si falla, cuenta el fallo (COMMIT) y lanza
   * `code`. Si acierta, devuelve el parche que pone el contador a cero (lo escribe el llamador junto con su
   * propio cambio, en la misma unidad de trabajo).
   */
  async function verifyThrottled(
    p: Persisted,
    secret: string,
    hash: PasswordHash | null,
    code: 'wrong_password' | 'wrong_recovery_key',
  ): Promise<PersistedPatch> {
    throttle(p);
    const ok = hash !== null && (await verifyPassword(secret, hash));
    if (!ok) {
      const details = await recordFailure(p);
      throw new DomainError(code, details);
    }
    return p.failedAttempts > 0 || p.retryAt !== null ? { failedAttempts: 0, retryAt: null } : {};
  }

  function changedAtChange(path: string, old: Timestamp | null, next: Timestamp) {
    return [{ path, old, new: next }];
  }

  function idleExpired(): boolean {
    const p = persisted;
    if (p === null || !p.enabled || session.password === null || p.autoLockMinutes === 0) return false;
    return nowMs() - session.lastActivityMs >= p.autoLockMinutes * 60_000;
  }

  function checkIdle(): boolean {
    if (!idleExpired()) return false;
    clearSession();
    lockGeneration++;
    publish();
    return true;
  }

  function requireUnlockedPassword(p: Persisted): string {
    requireEnabled(p);
    checkIdle();
    if (session.password === null) throw new DomainError('auth_locked');
    return session.password;
  }

  // Cambios hechos por otra vía (restaurar respaldo, otro servicio): releer y avisar.
  deps.events.subscribe((e) => {
    if (!e.tables.includes('settings') || e.reason.startsWith('auth.')) return;
    void serial(async () => {
      await load();
      publish();
    }).catch(() => undefined);
  });

  return {
    status: () =>
      serial(async () => {
        await load();
        checkIdle();
        return publish() as AuthStatus;
      }),

    snapshot: () => last,

    setup: ({ profileName, password }) =>
      serial(async () => {
        const name = cleanProfileName(profileName);
        checkPassword(password);
        const p = await load();
        if (p.enabled) throw new DomainError('auth_already_enabled');
        const recoveryKey = generateRecoveryKey();
        const passwordHash = await hashPassword(password, { iterations: hashIterations });
        const recoveryHash = await hashPassword(recoveryKey.replace(/-/g, ''), { iterations: hashIterations });
        const at = nowIso();
        await write(
          'auth.setup',
          {
            enabled: true,
            profileName: name,
            passwordHash,
            recoveryHash,
            failedAttempts: 0,
            retryAt: null,
            passwordChangedAt: at,
            recoveryKeyCreatedAt: at,
          },
          {
            message: AUDIT_MESSAGES.enabled,
            params: { profileName: name },
            changes: [
              { path: AUTH_KEYS.enabled, old: false, new: true },
              ...(p.profileName === name ? [] : [{ path: AUTH_KEYS.profileName, old: p.profileName, new: name }]),
            ],
          },
        );
        openSession(password, passwordHash);
        publish();
        return { recoveryKey };
      }),

    unlock: (password) => {
      const generation = lockGeneration;
      return serial(async () => {
        const p = await load();
        const hash = requireEnabled(p);
        const reset = await verifyThrottled(p, password, hash, 'wrong_password');
        let current = hash;
        if (hash.iterations < hashIterations) {
          // Hash con menos iteraciones que las actuales: se rehace ahora que tenemos la contraseña.
          current = await hashPassword(password, { iterations: hashIterations });
          reset.passwordHash = current;
        }
        if (Object.keys(reset).length > 0) await write('auth.unlock', reset);
        if (generation === lockGeneration) openSession(password, current);
        publish();
      });
    },

    unlockWithRecoveryKey: (recoveryKey, newPassword) => {
      const generation = lockGeneration;
      return serial(async () => {
        checkPassword(newPassword);
        const p = await load();
        requireEnabled(p);
        throttle(p);
        const normalized = normalizeRecoveryKey(recoveryKey);
        // Mal copiada (dígito de control): no se gasta un intento; es un error de tecleo, no un ataque.
        if (normalized === null) throw new DomainError('wrong_recovery_key', { reason: 'checksum' });
        const reset = await verifyThrottled(p, normalized.replace(/-/g, ''), p.recoveryHash, 'wrong_recovery_key');
        const passwordHash = await hashPassword(newPassword, { iterations: hashIterations });
        const at = nowIso();
        await write(
          'auth.recover',
          { ...reset, passwordHash, passwordChangedAt: at },
          {
            message: AUDIT_MESSAGES.recovered,
            changes: changedAtChange(AUTH_KEYS.passwordChangedAt, p.passwordChangedAt, at),
          },
        );
        if (generation === lockGeneration) openSession(newPassword, passwordHash);
        else clearSession();
        publish();
      });
    },

    lock: () => {
      lockGeneration++;
      if (session.password === null) return;
      clearSession();
      publish();
    },

    changePassword: (currentPassword, nextPassword) =>
      serial(async () => {
        const p = await load();
        const hash = requireEnabled(p);
        checkPassword(nextPassword);
        const reset = await verifyThrottled(p, currentPassword, hash, 'wrong_password');
        const passwordHash = await hashPassword(nextPassword, { iterations: hashIterations });
        const at = nowIso();
        await write(
          'auth.changePassword',
          { ...reset, passwordHash, passwordChangedAt: at },
          {
            message: AUDIT_MESSAGES.passwordChanged,
            changes: changedAtChange(AUTH_KEYS.passwordChangedAt, p.passwordChangedAt, at),
          },
        );
        // Quien conoce la contraseña actual queda con la sesión abierta con la nueva.
        openSession(nextPassword, passwordHash);
        publish();
      }),

    regenerateRecoveryKey: (password) =>
      serial(async () => {
        const p = await load();
        const hash = requireEnabled(p);
        const reset = await verifyThrottled(p, password, hash, 'wrong_password');
        const recoveryKey = generateRecoveryKey();
        const recoveryHash = await hashPassword(recoveryKey.replace(/-/g, ''), { iterations: hashIterations });
        const at = nowIso();
        await write(
          'auth.regenerateRecoveryKey',
          { ...reset, recoveryHash, recoveryKeyCreatedAt: at },
          {
            message: AUDIT_MESSAGES.recoveryKeyRegenerated,
            changes: changedAtChange(AUTH_KEYS.recoveryKeyCreatedAt, p.recoveryKeyCreatedAt, at),
          },
        );
        publish();
        return { recoveryKey };
      }),

    disable: (password) =>
      serial(async () => {
        const p = await load();
        const hash = requireEnabled(p);
        const reset = await verifyThrottled(p, password, hash, 'wrong_password');
        await write(
          'auth.disable',
          { ...reset, enabled: false, passwordHash: null, recoveryHash: null, recoveryKeyCreatedAt: null },
          {
            message: AUDIT_MESSAGES.disabled,
            changes: [{ path: AUTH_KEYS.enabled, old: true, new: false }],
          },
        );
        clearSession();
        publish();
      }),

    setAutoLock: (minutes) =>
      serial(async () => {
        checkMinutes(minutes);
        const p = await load();
        if (p.enabled) requireUnlockedPassword(p);
        if (p.autoLockMinutes === minutes) {
          publish(); // sin cambio: ni escritura ni acción de historial
          return;
        }
        await write(
          'auth.autoLock',
          { autoLockMinutes: minutes },
          {
            message: AUDIT_MESSAGES.autoLockChanged,
            params: { minutes },
            changes: [{ path: AUTH_KEYS.autoLockMinutes, old: p.autoLockMinutes, new: minutes }],
          },
        );
        session.lastActivityMs = nowMs();
        publish();
      }),

    touch: () => {
      if (checkIdle()) return;
      session.lastActivityMs = nowMs();
    },

    checkIdle,

    encrypt: (plaintext) =>
      serial(async () => {
        const password = requireUnlockedPassword(await load());
        return encryptText(password, plaintext, { iterations: encryptionIterations });
      }),

    decrypt: (envelope) =>
      serial(async () => {
        const password = requireUnlockedPassword(await load());
        return decryptText(password, envelope);
      }),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
