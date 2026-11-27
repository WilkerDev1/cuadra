// Errores de dominio (ARCHITECTURE.md 3.2). Un DomainError lleva un código estable que la UI traduce
// con t('errors.' + code) (src/i18n/es/errors.ts). Los RAISE(ABORT, '<codigo>') de los triggers llegan
// como DomainError gracias a los adaptadores de src/data.

/** Lista cerrada de códigos. Es un array para poder comprobar en ejecución si un texto es un código. */
export const ERROR_CODES = [
  'not_found',
  'workspace_archived',
  'account_archived',
  'workspace_mismatch',
  'invalid_amount',
  'invalid_date',
  'description_required',
  'opening_exists',
  'transfer_same_account',
  'transfer_requires_both_sides',
  'kind_change_forbidden',
  'account_change_forbidden',
  'already_voided',
  'not_voided',
  'field_inactive',
  'option_inactive',
  'field_in_use',
  'option_in_use',
  'field_type_immutable',
  'field_value_type_mismatch',
  'duplicate_label',
  'merge_same_option',
  'control_total_mismatch',
  'batch_empty',
  'backup_invalid',
  'backup_checksum',
  'backup_from_newer_version',
  'db_from_newer_version',
  'migration_failed',
  'migration_checksum',
  'currency_locked',
  'confirmation_mismatch',
  'sqlite_too_old',
  'seq_not_reserved',
  'immutable_column',
  'delete_forbidden',
  'audit_append_only',
  // Añadidos al contrato de 3.2: los lanzan los triggers de 001_init.sql o el propio núcleo.
  'seq_decrease', // trigger accounts_next_seq_monotonic
  'options_require_list_field', // trigger options_only_on_list
  'invalid_recipe', // receta de vista guardada o de plantilla con forma inválida
  // Añadidos en la Oleada 2 (estructura, vistas y plantillas).
  'name_required', // nombre o etiqueta vacíos (espacio, cuenta, campo, opción, vista)
  'template_invalid', // archivo de plantilla con forma inválida (details.issues)
  'invalid_currency', // código ISO o decimales de moneda inválidos
  'invalid_setting', // ajuste desconocido o con un valor que no corresponde
  'merge_different_field', // fusionar opciones de campos distintos
  // Respaldo cifrado e inicio de sesión local (services/backup, services/auth, crypto).
  'password_required', // respaldo cifrado sin contraseña
  'wrong_password', // contraseña incorrecta o sobre cifrado manipulado (AES-GCM no distingue)
  'wrong_recovery_key',
  'too_many_attempts', // demasiados intentos: details.retryAt
  'auth_not_enabled',
  'auth_already_enabled',
  'auth_locked', // la operación exige la sesión abierta
  'password_too_short',
  'password_too_long',
  'profile_name_required',
  'invalid_auto_lock',
  'crypto_unavailable', // sin crypto.subtle (contexto no seguro: http://ip-de-la-red)
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

export class DomainError extends Error {
  override readonly name = 'DomainError';
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

/** ¿Es un DomainError (opcionalmente, con este código)? Funciona aunque el error cruce un worker. */
export function isDomainError(error: unknown, code?: ErrorCode): error is DomainError {
  if (error instanceof DomainError) return code === undefined || error.code === code;
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; code?: unknown };
  return e.name === 'DomainError' && isErrorCode(e.code) && (code === undefined || e.code === code);
}

/**
 * Busca un código conocido en un mensaje de SQLite. Acepta el código solo ('delete_forbidden') o al final
 * tras un prefijo del motor ('SQLITE_CONSTRAINT_TRIGGER: delete_forbidden'). Devuelve null si no hay.
 */
export function errorCodeFromMessage(message: string): ErrorCode | null {
  const trimmed = message.trim();
  if (isErrorCode(trimmed)) return trimmed;
  const last = /([a-z][a-z0-9_]*)\s*$/.exec(trimmed);
  const candidate = last?.[1];
  return candidate !== undefined && isErrorCode(candidate) ? candidate : null;
}
