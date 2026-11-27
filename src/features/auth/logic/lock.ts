// Lógica pura de la pantalla de bloqueo: traducir los errores del servicio a un estado de interfaz, cuenta atrás
// de la espera y opciones de bloqueo automático.
import { AUTH_FREE_ATTEMPTS, isDomainError } from '../../../core';

/** Intentos libres antes de la primera espera. */
export const FREE_ATTEMPTS = AUTH_FREE_ATTEMPTS;

export type UnlockFailure =
  | { kind: 'wrong'; failedAttempts: number; retryAt: string | null }
  | { kind: 'wrongKey'; failedAttempts: number; retryAt: string | null }
  | { kind: 'checksum' }
  | { kind: 'wait'; retryAt: string | null; failedAttempts: number }
  | { kind: 'other'; error: unknown };

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Clasifica lo que lanzó unlock / unlockWithRecoveryKey / changePassword… */
export function classifyUnlockError(error: unknown): UnlockFailure {
  if (!isDomainError(error)) return { kind: 'other', error };
  const d = error.details ?? {};
  switch (error.code) {
    case 'wrong_password':
      return { kind: 'wrong', failedAttempts: num(d['failedAttempts']), retryAt: str(d['retryAt']) };
    case 'wrong_recovery_key':
      if (d['reason'] === 'checksum') return { kind: 'checksum' };
      return { kind: 'wrongKey', failedAttempts: num(d['failedAttempts']), retryAt: str(d['retryAt']) };
    case 'too_many_attempts':
      return { kind: 'wait', retryAt: str(d['retryAt']), failedAttempts: num(d['failedAttempts']) };
    default:
      return { kind: 'other', error };
  }
}

/** Intentos que quedan antes de tener que esperar (0 si ya hay espera). */
export function attemptsLeft(failedAttempts: number, free: number = FREE_ATTEMPTS): number {
  return Math.max(0, free - failedAttempts);
}

/** Milisegundos que faltan hasta `retryAt` (0 si no hay espera o ya pasó). */
export function remainingMs(retryAt: string | null | undefined, nowMs: number): number {
  if (retryAt === null || retryAt === undefined) return 0;
  const until = Date.parse(retryAt);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - nowMs);
}

/** La espera más tardía de dos fuentes (el error recién recibido y el estado del servicio). */
export function laterRetryAt(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a == null ? NaN : Date.parse(a);
  const tb = b == null ? NaN : Date.parse(b);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? (b as string) : null;
  if (!Number.isFinite(tb)) return a as string;
  return ta >= tb ? (a as string) : (b as string);
}

/** Cuenta atrás «m:ss», redondeando hacia arriba (nunca enseña 0:00 mientras aún hay que esperar). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Valores de bloqueo automático que se ofrecen (minutos; 0 = nunca). */
export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 30] as const;

/** Las opciones a mostrar: las fijas más el valor actual si vino de otra vía (p. ej. 60). */
export function autoLockOptions(current: number | null | undefined): number[] {
  const set = new Set<number>(AUTO_LOCK_CHOICES);
  if (typeof current === 'number' && Number.isSafeInteger(current) && current >= 0) set.add(current);
  return [...set].sort((a, b) => a - b);
}
