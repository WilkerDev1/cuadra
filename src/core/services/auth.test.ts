import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { isEncryptedEnvelope, isValidRecoveryKey, MIN_PBKDF2_ITERATIONS } from '../crypto';
import { DomainError } from '../errors';
import { createEventBus } from '../events';
import type { CoreDeps } from '../uow';
import { createAuditWriter } from './audit';
import {
  attemptDelayMs,
  AUTH_DEFAULT_AUTO_LOCK_MINUTES,
  AUTH_FREE_ATTEMPTS,
  createAuthService,
  type AuthService,
  type AuthStatus,
} from './auth';

const FAST = { hashIterations: MIN_PBKDF2_ITERATIONS, encryptionIterations: MIN_PBKDF2_ITERATIONS };
const PASSWORD = 'contraseña-larga';

interface Ctx extends TestCuadra {
  core: CoreDeps;
  auth: AuthService;
  /** Simula cerrar y volver a abrir la app: servicio nuevo sobre la misma base. */
  restart(): AuthService;
}

const open: TestCuadra[] = [];

async function setup(): Promise<Ctx> {
  const t = await createTestCuadra();
  open.push(t);
  const makeCore = (): CoreDeps => ({
    driver: t.driver,
    clock: t.clock,
    ids: t.ids,
    events: createEventBus(),
    audit: createAuditWriter({ clock: t.clock, ids: t.ids }),
    locale: 'es-DO',
  });
  const core = makeCore();
  return { ...t, core, auth: createAuthService(core, FAST), restart: () => createAuthService(makeCore(), FAST) };
}

afterEach(async () => {
  while (open.length > 0) await open.pop()?.driver.close();
});

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return (e as DomainError).code;
  }
}

async function auditRows(t: TestCuadra) {
  return t.driver.all<{ action: string; entity_type: string; message: string; params: string | null; workspace_id: string | null }>(
    'SELECT action, entity_type, message, params, workspace_id FROM audit_log ORDER BY id',
  );
}

async function allPersisted(t: TestCuadra): Promise<string> {
  const settings = await t.driver.all('SELECT key, value FROM settings');
  const changes = await t.driver.all('SELECT path, old_value, new_value FROM audit_log_changes');
  const audit = await t.driver.all('SELECT message, params FROM audit_log');
  return JSON.stringify({ settings, changes, audit });
}

describe('auth: estado inicial', () => {
  it('sin contraseña: desactivado y desbloqueado', async () => {
    const { auth } = await setup();
    const s = await auth.status();
    expect(s).toMatchObject<Partial<AuthStatus>>({
      enabled: false,
      locked: false,
      hasRecoveryKey: false,
      autoLockMinutes: AUTH_DEFAULT_AUTO_LOCK_MINUTES,
      profileName: null,
      failedAttempts: 0,
      retryAt: null,
    });
    expect(auth.snapshot()).toEqual(s);
  });

  it('operaciones que exigen contraseña fallan con auth_not_enabled', async () => {
    const { auth } = await setup();
    expect(await codeOf(auth.unlock(PASSWORD))).toBe('auth_not_enabled');
    expect(await codeOf(auth.changePassword(PASSWORD, 'otra-clave-1'))).toBe('auth_not_enabled');
    expect(await codeOf(auth.disable(PASSWORD))).toBe('auth_not_enabled');
    expect(await codeOf(auth.encrypt('x'))).toBe('auth_not_enabled');
  });
});

describe('auth: alta', () => {
  it('setup activa, deja la sesión abierta y devuelve la clave de recuperación una vez', async () => {
    const { auth } = await setup();
    const { recoveryKey } = await auth.setup({ profileName: '  Colmado La Esquina ', password: PASSWORD });
    expect(isValidRecoveryKey(recoveryKey)).toBe(true);
    const s = await auth.status();
    expect(s).toMatchObject({ enabled: true, locked: false, hasRecoveryKey: true, profileName: 'Colmado La Esquina' });
    expect(JSON.stringify(s)).not.toContain(recoveryKey);
  });

  it('valida nombre y contraseña', async () => {
    const { auth } = await setup();
    expect(await codeOf(auth.setup({ profileName: '   ', password: PASSWORD }))).toBe('profile_name_required');
    expect(await codeOf(auth.setup({ profileName: 'x'.repeat(61), password: PASSWORD }))).toBe('profile_name_required');
    expect(await codeOf(auth.setup({ profileName: 'Ana', password: 'corta' }))).toBe('password_too_short');
    expect(await codeOf(auth.setup({ profileName: 'Ana', password: '        ' }))).toBe('password_too_short');
    expect(await codeOf(auth.setup({ profileName: 'Ana', password: 'x'.repeat(1025) }))).toBe('password_too_long');
    expect((await auth.status()).enabled).toBe(false);
  });

  it('no se activa dos veces', async () => {
    const { auth } = await setup();
    await auth.setup({ profileName: 'Ana', password: PASSWORD });
    expect(await codeOf(auth.setup({ profileName: 'Ana', password: PASSWORD }))).toBe('auth_already_enabled');
  });

  it('nunca guarda la contraseña ni la clave de recuperación en claro', async () => {
    const t = await setup();
    const { recoveryKey } = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    await t.auth.changePassword(PASSWORD, 'segunda-clave-9');
    const dump = await allPersisted(t);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('segunda-clave-9');
    expect(dump).not.toContain(recoveryKey);
    expect(dump).not.toContain(recoveryKey.replace(/-/g, ''));
    const keys = (await t.driver.all<{ key: string }>('SELECT key FROM settings WHERE key LIKE ?', ['auth.%'])).map(
      (r) => r.key,
    );
    expect(keys).toContain('auth.enabled');
    expect(keys).toContain('auth.passwordHash');
  });
});

describe('auth: bloqueo y desbloqueo', () => {
  it('lock bloquea; unlock con la correcta desbloquea; con la incorrecta → wrong_password', async () => {
    const { auth } = await setup();
    await auth.setup({ profileName: 'Ana', password: PASSWORD });
    auth.lock();
    expect((await auth.status()).locked).toBe(true);
    expect(await codeOf(auth.unlock('equivocada'))).toBe('wrong_password');
    expect((await auth.status()).locked).toBe(true);
    await auth.unlock(PASSWORD);
    expect((await auth.status()).locked).toBe(false);
  });

  it('acepta la contraseña con otra normalización unicode (NFC)', async () => {
    const { auth } = await setup();
    await auth.setup({ profileName: 'Ana', password: 'canción-de-cuna' });
    auth.lock();
    await auth.unlock('canción-de-cuna');
    expect((await auth.status()).locked).toBe(false);
  });

  it('lock sin contraseña activada no hace nada', async () => {
    const { auth } = await setup();
    auth.lock();
    expect((await auth.status()).locked).toBe(false);
  });

  it('persistencia tras reinicio: arranca bloqueado y abre con la misma contraseña', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    await t.auth.setAutoLock(15);
    const after = t.restart();
    const s = await after.status();
    expect(s).toMatchObject({ enabled: true, locked: true, hasRecoveryKey: true, autoLockMinutes: 15, profileName: 'Ana' });
    expect(await codeOf(after.unlock('equivocada'))).toBe('wrong_password');
    await after.unlock(PASSWORD);
    expect((await after.status()).locked).toBe(false);
  });

  it('notifica a los suscriptores al bloquear y desbloquear', async () => {
    const { auth } = await setup();
    const seen: Array<Pick<AuthStatus, 'enabled' | 'locked'>> = [];
    const off = auth.subscribe((s) => seen.push({ enabled: s.enabled, locked: s.locked }));
    await auth.setup({ profileName: 'Ana', password: PASSWORD });
    auth.lock();
    await auth.unlock(PASSWORD);
    off();
    auth.lock();
    expect(seen).toEqual([
      { enabled: true, locked: false },
      { enabled: true, locked: true },
      { enabled: true, locked: false },
    ]);
  });
});

describe('auth: límite de intentos con espera creciente', () => {
  it('tabla de esperas: libres los primeros, luego se dobla hasta un tope', () => {
    for (let n = 0; n < AUTH_FREE_ATTEMPTS; n++) expect(attemptDelayMs(n)).toBe(0);
    expect(attemptDelayMs(AUTH_FREE_ATTEMPTS)).toBe(30_000);
    expect(attemptDelayMs(AUTH_FREE_ATTEMPTS + 1)).toBe(60_000);
    expect(attemptDelayMs(AUTH_FREE_ATTEMPTS + 2)).toBe(120_000);
    expect(attemptDelayMs(100)).toBe(15 * 60_000);
  });

  it('tras los intentos libres exige esperar; ni la correcta entra antes de tiempo', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    for (let i = 0; i < AUTH_FREE_ATTEMPTS - 1; i++) expect(await codeOf(t.auth.unlock('mal'))).toBe('wrong_password');
    expect((await t.auth.status()).retryAt).toBeNull();
    expect(await codeOf(t.auth.unlock('mal'))).toBe('wrong_password');
    const s = await t.auth.status();
    expect(s.failedAttempts).toBe(AUTH_FREE_ATTEMPTS);
    expect(s.retryAt).toBe(new Date(t.clock.now().getTime() + 30_000).toISOString());

    // Durante la espera ni siquiera se comprueba la contraseña.
    expect(await codeOf(t.auth.unlock(PASSWORD))).toBe('too_many_attempts');
    t.clock.advance(29_999);
    expect(await codeOf(t.auth.unlock(PASSWORD))).toBe('too_many_attempts');

    // Pasada la espera, otro fallo dobla la espera.
    t.clock.advance(1);
    expect(await codeOf(t.auth.unlock('mal'))).toBe('wrong_password');
    expect((await t.auth.status()).retryAt).toBe(new Date(t.clock.now().getTime() + 60_000).toISOString());
    t.clock.advance(60_000);
    await t.auth.unlock(PASSWORD);
    const ok = await t.auth.status();
    expect(ok).toMatchObject({ locked: false, failedAttempts: 0, retryAt: null });
  });

  it('el detalle de too_many_attempts dice cuándo reintentar', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    for (let i = 0; i < AUTH_FREE_ATTEMPTS; i++) await codeOf(t.auth.unlock('mal'));
    const error = await t.auth.unlock(PASSWORD).catch((e: unknown) => e);
    expect((error as DomainError).details).toMatchObject({ retryAt: (await t.auth.status()).retryAt, waitSeconds: 30 });
  });

  it('el contador sobrevive a un reinicio (recargar no regala intentos)', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    for (let i = 0; i < AUTH_FREE_ATTEMPTS; i++) await codeOf(t.auth.unlock('mal'));
    const after = t.restart();
    expect(await codeOf(after.unlock(PASSWORD))).toBe('too_many_attempts');
    expect((await after.status()).failedAttempts).toBe(AUTH_FREE_ATTEMPTS);
  });

  it('intentos simultáneos se cuentan todos', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    const codes = await Promise.all([1, 2, 3].map(() => codeOf(t.auth.unlock('mal'))));
    expect(codes).toEqual(['wrong_password', 'wrong_password', 'wrong_password']);
    expect((await t.auth.status()).failedAttempts).toBe(3);
  });

  it('la clave de recuperación equivocada también cuenta', async () => {
    const t = await setup();
    const { recoveryKey } = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    // Bien formada pero de otra instalación.
    const other = await (await setup()).auth.setup({ profileName: 'Otro', password: PASSWORD });
    expect(other.recoveryKey).not.toBe(recoveryKey);
    expect(await codeOf(t.auth.unlockWithRecoveryKey(other.recoveryKey, 'nueva-clave-1'))).toBe('wrong_recovery_key');
    expect((await t.auth.status()).failedAttempts).toBe(1);
  });
});

describe('auth: bloqueo automático por inactividad (reloj fijo)', () => {
  it('se bloquea al pasar los minutos sin actividad; touch() lo aplaza', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    await t.auth.setAutoLock(5);
    t.clock.advance(4 * 60_000);
    t.auth.touch();
    t.clock.advance(4 * 60_000);
    expect(t.auth.checkIdle()).toBe(false);
    expect((await t.auth.status()).locked).toBe(false);
    t.clock.advance(60_000);
    expect((await t.auth.status()).locked).toBe(true);
  });

  it('checkIdle bloquea y notifica; touch() después de vencer no reabre', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    const seen: boolean[] = [];
    t.auth.subscribe((s) => seen.push(s.locked));
    t.clock.advance(AUTH_DEFAULT_AUTO_LOCK_MINUTES * 60_000);
    t.auth.touch();
    expect(t.auth.snapshot()?.locked).toBe(true);
    expect(seen).toEqual([true]);
    expect(t.auth.checkIdle()).toBe(false); // ya estaba bloqueado
  });

  it('0 minutos = nunca', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    await t.auth.setAutoLock(0);
    t.clock.advance(30 * 24 * 3_600_000);
    expect(t.auth.checkIdle()).toBe(false);
    expect((await t.auth.status()).locked).toBe(false);
  });

  it('setAutoLock valida el rango y exige sesión abierta', async () => {
    const t = await setup();
    expect(await codeOf(t.auth.setAutoLock(-1))).toBe('invalid_auto_lock');
    expect(await codeOf(t.auth.setAutoLock(1.5))).toBe('invalid_auto_lock');
    expect(await codeOf(t.auth.setAutoLock(24 * 60 + 1))).toBe('invalid_auto_lock');
    await t.auth.setAutoLock(10); // sin contraseña también se guarda (preferencia)
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    expect((await t.auth.status()).autoLockMinutes).toBe(10);
    t.auth.lock();
    expect(await codeOf(t.auth.setAutoLock(20))).toBe('auth_locked');
  });
});

describe('auth: recuperación, cambio y desactivación', () => {
  it('la clave de recuperación pone una contraseña nueva y abre la sesión', async () => {
    const t = await setup();
    const { recoveryKey } = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    const typed = recoveryKey.toLowerCase().replace(/-/g, ' ');
    expect(await codeOf(t.auth.unlockWithRecoveryKey(typed, 'corta'))).toBe('password_too_short');
    await t.auth.unlockWithRecoveryKey(typed, 'nueva-clave-1');
    expect((await t.auth.status()).locked).toBe(false);
    t.auth.lock();
    expect(await codeOf(t.auth.unlock(PASSWORD))).toBe('wrong_password');
    await t.auth.unlock('nueva-clave-1');
    // La clave de recuperación sigue sirviendo.
    t.auth.lock();
    await t.auth.unlockWithRecoveryKey(recoveryKey, 'tercera-clave');
    expect((await t.auth.status()).locked).toBe(false);
  });

  it('clave con dígito de control mal → wrong_recovery_key sin gastar intento', async () => {
    const t = await setup();
    const { recoveryKey } = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    const last = recoveryKey.at(-1) === '0' ? '1' : '0';
    expect(await codeOf(t.auth.unlockWithRecoveryKey(recoveryKey.slice(0, -1) + last, 'nueva-clave-1'))).toBe(
      'wrong_recovery_key',
    );
    expect((await t.auth.status()).failedAttempts).toBe(0);
  });

  it('regenerar la clave de recuperación invalida la anterior', async () => {
    const t = await setup();
    const first = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    expect(await codeOf(t.auth.regenerateRecoveryKey('mal'))).toBe('wrong_password');
    const second = await t.auth.regenerateRecoveryKey(PASSWORD);
    expect(second.recoveryKey).not.toBe(first.recoveryKey);
    t.auth.lock();
    expect(await codeOf(t.auth.unlockWithRecoveryKey(first.recoveryKey, 'nueva-clave-1'))).toBe('wrong_recovery_key');
    await t.auth.unlockWithRecoveryKey(second.recoveryKey, 'nueva-clave-1');
  });

  it('changePassword exige la actual y valida la nueva', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    expect(await codeOf(t.auth.changePassword('mal', 'otra-clave-1'))).toBe('wrong_password');
    expect(await codeOf(t.auth.changePassword(PASSWORD, 'corta'))).toBe('password_too_short');
    await t.auth.changePassword(PASSWORD, 'otra-clave-1');
    const s = await t.auth.status();
    expect(s.locked).toBe(false);
    expect(s.passwordChangedAt).toBe(t.clock.now().toISOString());
    t.auth.lock();
    await t.auth.unlock('otra-clave-1');
  });

  it('disable exige la contraseña y deja todo abierto', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    t.auth.lock();
    expect(await codeOf(t.auth.disable('mal'))).toBe('wrong_password');
    await t.auth.disable(PASSWORD);
    const s = await t.auth.status();
    expect(s).toMatchObject({ enabled: false, locked: false, hasRecoveryKey: false });
    expect((await t.restart().status()).enabled).toBe(false);
    const hashes = await t.driver.all<{ value: string }>(
      "SELECT value FROM settings WHERE key IN ('auth.passwordHash', 'auth.recoveryHash')",
    );
    expect(hashes.every((r) => r.value === 'null')).toBe(true);
    // Se puede volver a activar con otra contraseña.
    await t.auth.setup({ profileName: 'Ana', password: 'otra-clave-1' });
    expect((await t.auth.status()).enabled).toBe(true);
  });
});

describe('auth: historial de configuración', () => {
  it('registra activar, cambiar, recuperar, auto-bloqueo y desactivar, sin secretos', async () => {
    const t = await setup();
    const { recoveryKey } = await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    await t.auth.changePassword(PASSWORD, 'otra-clave-1');
    await t.auth.setAutoLock(10);
    await t.auth.setAutoLock(10); // sin cambio: sin acción
    t.auth.lock();
    await codeOf(t.auth.unlock('mal')); // los fallos no van al historial
    await t.auth.unlockWithRecoveryKey(recoveryKey, 'tercera-clave');
    await t.auth.regenerateRecoveryKey('tercera-clave');
    await t.auth.disable('tercera-clave');
    const rows = await auditRows(t);
    expect(rows.map((r) => r.message)).toEqual([
      'auth.audit.enabled',
      'auth.audit.passwordChanged',
      'auth.audit.autoLockChanged',
      'auth.audit.recovered',
      'auth.audit.recoveryKeyRegenerated',
      'auth.audit.disabled',
    ]);
    expect(rows.every((r) => r.action === 'config' && r.entity_type === 'settings' && r.workspace_id === null)).toBe(true);
    const dump = await allPersisted(t);
    for (const secret of [PASSWORD, 'otra-clave-1', 'tercera-clave', recoveryKey]) expect(dump).not.toContain(secret);
  });

  it('emite ChangeEvent de settings en cada guardado', async () => {
    const t = await setup();
    const reasons: string[] = [];
    t.core.events.subscribe((e) => {
      expect(e.tables).toContain('settings');
      reasons.push(e.reason);
    });
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    expect(reasons).toEqual(['auth.setup']);
  });
});

describe('auth: cifrado con la sesión', () => {
  it('encrypt/decrypt usan la contraseña de la sesión abierta', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    const env = await t.auth.encrypt('{"respaldo":true}');
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env.iterations).toBe(FAST.encryptionIterations);
    await expect(t.auth.decrypt(env)).resolves.toBe('{"respaldo":true}');
    t.auth.lock();
    expect(await codeOf(t.auth.encrypt('x'))).toBe('auth_locked');
    expect(await codeOf(t.auth.decrypt(env))).toBe('auth_locked');
  });

  it('un respaldo hecho con la contraseña anterior no abre con la nueva', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    const env = await t.auth.encrypt('viejo');
    await t.auth.changePassword(PASSWORD, 'otra-clave-1');
    expect(await codeOf(t.auth.decrypt(env))).toBe('wrong_password');
  });

  it('si otra vía cambia los ajustes (restaurar respaldo), la sesión se recalcula', async () => {
    const t = await setup();
    await t.auth.setup({ profileName: 'Ana', password: PASSWORD });
    // Simula una restauración que trae otra contraseña: otro servicio reescribe los ajustes.
    const other = t.restart();
    await other.disable(PASSWORD).catch(() => undefined); // está bloqueado pero disable solo pide la contraseña
    await other.setup({ profileName: 'Otra', password: 'otra-clave-1' });
    t.core.events.emit({ workspaceId: null, tables: ['settings'], reason: 'backup.restore' });
    const s = await t.auth.status();
    expect(s).toMatchObject({ enabled: true, locked: true, profileName: 'Otra' });
  });
});
