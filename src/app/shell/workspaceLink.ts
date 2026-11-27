import type { Scope } from '../registry/types';

/** Resuelve un destino del registro (relativo a su scope) a una ruta absoluta del router. */
export function resolveTo(scope: Scope, to: string, wsId: string | undefined): string {
  const base = scope === 'workspace' ? `/e/${wsId ?? ''}` : '';
  if (to === '') return base === '' ? '/' : base;
  return `${base}/${to}`;
}
