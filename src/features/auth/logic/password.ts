// Lógica pura de los formularios de contraseña (sin React): medidor de longitud y validación de altas y cambios.
// Las reglas duras (8 a 1 024 caracteres, NFC) son del núcleo (core/services/auth.ts); aquí solo se adelantan para
// avisar antes de enviar. El servicio sigue siendo la autoridad y su error se muestra si llega.

import { AUTH_MAX_PASSWORD_LENGTH, AUTH_MAX_PROFILE_NAME_LENGTH, AUTH_MIN_PASSWORD_LENGTH } from '../../../core';

export const MIN_PASSWORD_LENGTH = AUTH_MIN_PASSWORD_LENGTH;
export const MAX_PASSWORD_LENGTH = AUTH_MAX_PASSWORD_LENGTH;
export const MAX_PROFILE_NAME_LENGTH = AUTH_MAX_PROFILE_NAME_LENGTH;

/** Longitud tal como la cuenta el núcleo: puntos de código tras normalizar a NFC. */
export function passwordLength(password: string): number {
  return [...password.normalize('NFC')].length;
}

export type StrengthLevel = 'empty' | 'short' | 'min' | 'good' | 'long';

export interface PasswordMeasure {
  length: number;
  level: StrengthLevel;
  /** Caracteres que faltan para el mínimo (0 si ya llega). */
  missing: number;
  /** Tramos llenos del medidor, de 0 a 4. */
  filled: 0 | 1 | 2 | 3 | 4;
}

/**
 * Medidor honesto: solo mide la longitud, que es lo único que sabemos medir sin mentir.
 * <8 corta · 8–11 el mínimo · 12–15 buena · ≥16 larga.
 */
export function measurePassword(password: string): PasswordMeasure {
  const length = passwordLength(password);
  const missing = Math.max(0, MIN_PASSWORD_LENGTH - length);
  if (length === 0) return { length, level: 'empty', missing, filled: 0 };
  if (length < MIN_PASSWORD_LENGTH) return { length, level: 'short', missing, filled: 1 };
  if (length < 12) return { length, level: 'min', missing: 0, filled: 2 };
  if (length < 16) return { length, level: 'good', missing: 0, filled: 3 };
  return { length, level: 'long', missing: 0, filled: 4 };
}

/** Clave i18n del error de una contraseña nueva, o null si vale. */
export function newPasswordError(password: string): string | null {
  const length = passwordLength(password);
  if (password.trim().length === 0 || length < MIN_PASSWORD_LENGTH) return 'auth.form.tooShort';
  if (length > MAX_PASSWORD_LENGTH) return 'auth.form.tooLong';
  return null;
}

export interface NewPasswordInput {
  password: string;
  confirm: string;
}

export interface NewPasswordErrors {
  password?: string;
  confirm?: string;
}

/** Errores de «contraseña nueva + repetir». La repetición solo se compara si la nueva ya vale. */
export function validateNewPassword({ password, confirm }: NewPasswordInput): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  const pw = newPasswordError(password);
  if (pw !== null) errors.password = pw;
  else if (confirm.length === 0) errors.confirm = 'auth.form.confirmRequired';
  else if (password.normalize('NFC') !== confirm.normalize('NFC')) errors.confirm = 'auth.setup.mismatch';
  return errors;
}

export interface SetupInput extends NewPasswordInput {
  profileName: string;
}

export interface SetupErrors extends NewPasswordErrors {
  profileName?: string;
}

/** Nombre de perfil como lo guardará el núcleo (recortado y con espacios simples). */
export function cleanProfileName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function validateSetup(input: SetupInput): SetupErrors {
  const errors: SetupErrors = { ...validateNewPassword(input) };
  const name = cleanProfileName(input.profileName);
  if (name.length === 0 || [...name].length > MAX_PROFILE_NAME_LENGTH) errors.profileName = 'auth.form.nameRequired';
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}

/** Primer campo con error, en el orden del formulario (para llevarle el foco). */
export function firstErrorField<K extends string>(errors: Partial<Record<K, string>>, order: readonly K[]): K | null {
  return order.find((k) => errors[k] !== undefined) ?? null;
}
