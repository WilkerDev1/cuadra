// Estado de la sesión local para la interfaz, sobre `cuadra.auth` (src/core/services/auth.ts).
// El núcleo no tiene temporizadores: attachIdleLock aporta el pulso del auto-bloqueo (touch en cada interacción,
// checkIdle cada 15 s y al volver a la pestaña). Lo engancha una sola vez el shell (LockGate) mientras haya
// contraseña activada y la sesión esté abierta.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { AuthService, AuthStatus, Cuadra } from '../../core';
import { useCuadra } from './CuadraProvider';

export type { AuthStatus } from '../../core';

export interface UseAuth {
  /** Ya se leyó el estado al menos una vez. */
  ready: boolean;
  enabled: boolean;
  locked: boolean;
  /** `enabled && locked`: el shell debe tapar la app con la pantalla de bloqueo. */
  mustLock: boolean;
  /** Último estado completo (null antes de la primera lectura). */
  status: AuthStatus | null;
  /** Lanza el DomainError del servicio si la contraseña no vale (wrong_password, too_many_attempts…). */
  unlock(password: string): Promise<void>;
  lock(): void;
  refresh(): Promise<void>;
}

/** Cada cuánto se comprueba la inactividad (el plazo lo fija el usuario en minutos). */
export const IDLE_CHECK_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Lee el estado una vez por servicio, aunque haya varias instancias del hook. */
const firstRead = new WeakMap<AuthService, Promise<unknown>>();
function ensureRead(auth: AuthService): void {
  if (firstRead.has(auth)) return;
  // Un fallo al leer no bloquea ni desbloquea por sorpresa: el siguiente evento vuelve a intentarlo.
  firstRead.set(auth, auth.status().catch(() => undefined));
}

export function getAuthService(cuadra: Cuadra): AuthService {
  return cuadra.auth;
}

/**
 * Engancha el auto-bloqueo a la página: cualquier interacción aplaza el bloqueo; un temporizador y el regreso a
 * la pestaña lo comprueban. Devuelve la función que lo desengancha. Sin `window` (pruebas de Node) no hace nada.
 */
export function attachIdleLock(auth: AuthService, opts: { intervalMs?: number; target?: Window } = {}): () => void {
  const target = opts.target ?? (typeof window === 'undefined' ? undefined : window);
  if (target === undefined) return () => undefined;
  const touch = () => auth.touch();
  const check = () => {
    auth.checkIdle();
  };
  const onVisible = () => {
    if (target.document.visibilityState === 'visible') check();
  };
  for (const name of ACTIVITY_EVENTS) target.addEventListener(name, touch, { passive: true, capture: true });
  target.document.addEventListener('visibilitychange', onVisible);
  const timer = target.setInterval(check, opts.intervalMs ?? IDLE_CHECK_MS);
  return () => {
    for (const name of ACTIVITY_EVENTS) target.removeEventListener(name, touch, { capture: true });
    target.document.removeEventListener('visibilitychange', onVisible);
    target.clearInterval(timer);
  };
}

/** Estado de la sesión local, compartido por todas las instancias (useSyncExternalStore sobre auth.subscribe). */
export function useAuth(): UseAuth {
  const cuadra = useCuadra();
  const auth = cuadra.auth;
  const subscribe = useCallback(
    (listener: () => void) => {
      const off = auth.subscribe(() => listener());
      // Un respaldo restaurado o un cambio desde otra vía reescribe los ajustes: se relee.
      const offCore = cuadra.subscribe((e) => {
        if (e.tables.includes('settings')) void auth.status().catch(() => undefined);
      });
      return () => {
        off();
        offCore();
      };
    },
    [auth, cuadra],
  );
  const status = useSyncExternalStore(subscribe, () => auth.snapshot(), () => null);

  useEffect(() => {
    ensureRead(auth);
  }, [auth]);

  const unlock = useCallback((password: string) => auth.unlock(password), [auth]);
  const lock = useCallback(() => auth.lock(), [auth]);
  const refresh = useCallback(async () => {
    await auth.status();
  }, [auth]);

  return {
    ready: status !== null,
    enabled: status?.enabled ?? false,
    locked: status?.locked ?? false,
    mustLock: status !== null && status.enabled && status.locked,
    status,
    unlock,
    lock,
    refresh,
  };
}
