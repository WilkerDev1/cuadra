import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../core';
import {
  attemptsLeft,
  autoLockOptions,
  classifyUnlockError,
  formatCountdown,
  laterRetryAt,
  remainingMs,
} from './lock';
import {
  firstErrorField,
  hasErrors,
  measurePassword,
  newPasswordError,
  passwordLength,
  validateNewPassword,
  validateSetup,
} from './password';
import { buildRecoveryFile, formatRecoveryKey, localIsoDate, recoveryKeyGroups } from './recoveryFile';

describe('medidor de longitud', () => {
  it('cuenta puntos de código en NFC, como el núcleo', () => {
    expect(passwordLength('año')).toBe(3);
    expect(passwordLength('año')).toBe(3); // ñ descompuesta
    expect(passwordLength('🔑🔑')).toBe(2);
  });
  it('tramos honestos por longitud', () => {
    expect(measurePassword('')).toMatchObject({ level: 'empty', filled: 0, missing: 8 });
    expect(measurePassword('abc')).toMatchObject({ level: 'short', filled: 1, missing: 5 });
    expect(measurePassword('abcdefgh')).toMatchObject({ level: 'min', filled: 2, missing: 0 });
    expect(measurePassword('abcdefghijkl')).toMatchObject({ level: 'good', filled: 3 });
    expect(measurePassword('a'.repeat(16))).toMatchObject({ level: 'long', filled: 4 });
  });
});

describe('validación de contraseña nueva', () => {
  it('rechaza cortas, solo espacios y demasiado largas', () => {
    expect(newPasswordError('1234567')).toBe('auth.form.tooShort');
    expect(newPasswordError('         ')).toBe('auth.form.tooShort');
    expect(newPasswordError('a'.repeat(1025))).toBe('auth.form.tooLong');
    expect(newPasswordError('ocho car')).toBeNull();
  });
  it('compara la repetición solo cuando la nueva vale', () => {
    expect(validateNewPassword({ password: 'corta', confirm: 'otra' })).toEqual({ password: 'auth.form.tooShort' });
    expect(validateNewPassword({ password: 'larga frase', confirm: '' })).toEqual({ confirm: 'auth.form.confirmRequired' });
    expect(validateNewPassword({ password: 'larga frase', confirm: 'larga fras' })).toEqual({ confirm: 'auth.setup.mismatch' });
    expect(validateNewPassword({ password: 'mañana sí', confirm: 'mañana sí' })).toEqual({});
  });
  it('alta: nombre obligatorio de hasta 60 caracteres', () => {
    const ok = { password: 'larga frase', confirm: 'larga frase' };
    expect(validateSetup({ ...ok, profileName: '   ' })).toEqual({ profileName: 'auth.form.nameRequired' });
    expect(validateSetup({ ...ok, profileName: 'x'.repeat(61) })).toEqual({ profileName: 'auth.form.nameRequired' });
    const valid = validateSetup({ ...ok, profileName: '  Colmado   La Esquina ' });
    expect(hasErrors(valid)).toBe(false);
  });
  it('primer campo con error en orden de formulario', () => {
    expect(firstErrorField<'a' | 'b' | 'c'>({ c: 'x', b: 'y' }, ['a', 'b', 'c'])).toBe('b');
    expect(firstErrorField<'a'>({}, ['a'])).toBeNull();
  });
});

describe('errores del desbloqueo', () => {
  it('clasifica los códigos del servicio', () => {
    expect(classifyUnlockError(new DomainError('wrong_password', { failedAttempts: 2, retryAt: null }))).toEqual({
      kind: 'wrong',
      failedAttempts: 2,
      retryAt: null,
    });
    expect(classifyUnlockError(new DomainError('wrong_recovery_key', { reason: 'checksum' }))).toEqual({ kind: 'checksum' });
    expect(classifyUnlockError(new DomainError('wrong_recovery_key', { failedAttempts: 1, retryAt: null }))).toMatchObject({ kind: 'wrongKey' });
    expect(
      classifyUnlockError(new DomainError('too_many_attempts', { retryAt: '2026-11-27T12:00:30.000Z', failedAttempts: 5 })),
    ).toEqual({ kind: 'wait', retryAt: '2026-11-27T12:00:30.000Z', failedAttempts: 5 });
    expect(classifyUnlockError(new Error('x')).kind).toBe('other');
    // Un DomainError que cruzó el worker llega como objeto plano.
    expect(classifyUnlockError({ name: 'DomainError', code: 'wrong_password', details: { failedAttempts: 1 } })).toEqual({
      kind: 'wrong',
      failedAttempts: 1,
      retryAt: null,
    });
  });
  it('intentos y espera', () => {
    expect(attemptsLeft(0)).toBe(5);
    expect(attemptsLeft(4)).toBe(1);
    expect(attemptsLeft(9)).toBe(0);
    const now = Date.parse('2026-11-27T12:00:00.000Z');
    expect(remainingMs('2026-11-27T12:00:30.000Z', now)).toBe(30_000);
    expect(remainingMs('2026-11-27T11:59:00.000Z', now)).toBe(0);
    expect(remainingMs(null, now)).toBe(0);
    expect(remainingMs('basura', now)).toBe(0);
  });
  it('toma la espera más tardía', () => {
    expect(laterRetryAt(null, null)).toBeNull();
    expect(laterRetryAt('2026-11-27T12:00:30.000Z', null)).toBe('2026-11-27T12:00:30.000Z');
    expect(laterRetryAt(null, '2026-11-27T12:00:30.000Z')).toBe('2026-11-27T12:00:30.000Z');
    expect(laterRetryAt('2026-11-27T12:00:30.000Z', '2026-11-27T12:01:00.000Z')).toBe('2026-11-27T12:01:00.000Z');
  });
  it('cuenta atrás m:ss redondeando hacia arriba', () => {
    expect(formatCountdown(30_000)).toBe('0:30');
    expect(formatCountdown(29_001)).toBe('0:30');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(15 * 60_000)).toBe('15:00');
    expect(formatCountdown(0)).toBe('0:00');
  });
  it('opciones de bloqueo automático', () => {
    expect(autoLockOptions(5)).toEqual([0, 1, 5, 15, 30]);
    expect(autoLockOptions(60)).toEqual([0, 1, 5, 15, 30, 60]);
    expect(autoLockOptions(null)).toEqual([0, 1, 5, 15, 30]);
  });
});

describe('archivo de la clave de recuperación', () => {
  const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`;
  it('formatea la clave en grupos de cuatro', () => {
    expect(formatRecoveryKey('abcd efgh-1234 5678 9abc defg')).toBe('ABCD-EFGH-1234-5678-9ABC-DEFG');
    expect(recoveryKeyGroups('ABCD-EFGH-1234-5678-9ABC-DEFG')).toHaveLength(6);
  });
  it('construye nombre y texto con CRLF', () => {
    const file = buildRecoveryFile({
      recoveryKey: 'ABCD-EFGH-1234-5678-9ABC-DEFG',
      profileName: 'Colmado',
      dateLabel: '27 nov 2026',
      isoDate: '2026-11-27',
      t,
    });
    expect(file.name).toBe('cuadra-clave-de-recuperacion-2026-11-27.txt');
    expect(file.text).toContain('ABCD-EFGH-1234-5678-9ABC-DEFG\r\n');
    expect(file.text).toContain('auth.file.profile{"name":"Colmado"}');
    expect(file.text.endsWith('\r\n')).toBe(true);
    const anon = buildRecoveryFile({ recoveryKey: 'X', profileName: null, dateLabel: 'd', isoDate: 'i', t });
    expect(anon.text).not.toContain('auth.file.profile');
  });
  it('fecha local, no UTC', () => {
    expect(localIsoDate(new Date(2026, 10, 27, 23, 30))).toBe('2026-11-27');
  });
});
