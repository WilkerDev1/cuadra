// Mensaje legible de un error para avisos: los DomainError se traducen con `errors.<code>`; cualquier otro fallo
// (adaptador, red, bug) cae en un texto genérico que no enseña detalles técnicos.
import { isDomainError } from '../../core';
import { hasKey, type TFunction, type TranslateParams } from '../../i18n';

export const UNKNOWN_ERROR_KEY = 'common.error.unknown';

function isMissing(key: string, translated: string): boolean {
  return translated === key || translated.startsWith('⟦');
}

function paramsOf(details: Record<string, unknown> | undefined): TranslateParams {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(details ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

export function errorMessage(error: unknown, t: TFunction): string {
  if (isDomainError(error)) {
    // Un motivo concreto (`details.reason`) puede tener su propio texto: `errors.<code>.<reason>`.
    const reason = error.details?.['reason'];
    if (typeof reason === 'string' && hasKey(`errors.${error.code}.${reason}`)) {
      return t(`errors.${error.code}.${reason}`, paramsOf(error.details));
    }
    const key = `errors.${error.code}`;
    const translated = t(key, paramsOf(error.details));
    if (!isMissing(key, translated)) return translated;
  }
  return t(UNKNOWN_ERROR_KEY);
}
