// Result<T, E> (ARCHITECTURE.md 3.3): para errores esperados que no son excepciones (parseo de montos,
// validación de recetas). Los errores de dominio que abortan una operación usan DomainError.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Valor o lanza. `onError` decide qué lanzar (por defecto un Error con el código). */
export function unwrap<T, E>(result: Result<T, E>, onError?: (error: E) => unknown): T {
  if (result.ok) return result.value;
  throw onError ? onError(result.error) : new Error(String(result.error));
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
