import { lazy, Suspense, useEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { attachIdleLock, useAuth } from '../data/auth';
import { useCuadra } from '../data/CuadraProvider';
import { useLockScreenDef } from '../registry/hooks';
import type { LockScreenProps } from '../registry/types';
import { useUiStore } from '../state/uiStore';
import { LoadingScreen } from './LoadingScreen';

/**
 * Ranura de bloqueo. Si la feature de autenticación registró `lockScreen` y el servicio dice `enabled && locked`,
 * la pantalla de bloqueo ocupa todo y la app queda oculta (`hidden`: sin pintar, sin foco, fuera del árbol de
 * accesibilidad y sin hojas del top layer), pero montada, así no se pierde lo que había a medias.
 * Sin `lockScreen` registrada, nunca se bloquea nada.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const def = useLockScreenDef();
  const auth = useAuth();
  const cuadra = useCuadra();
  const LockScreen = useMemo<ComponentType<LockScreenProps> | null>(() => (def === null ? null : lazy(async () => ({ default: (await def.lazy()).Component }))), [def]);
  const locked = LockScreen !== null && auth.mustLock;
  // Hasta saber si hay bloqueo no se enseña nada de la app: un fogonazo de datos antes de pedir la contraseña sería una fuga.
  const waiting = LockScreen !== null && !auth.ready;
  // Auto-bloqueo por inactividad: solo con contraseña activada, sesión abierta y una pantalla que lo resuelva.
  const unlocked = LockScreen !== null && auth.enabled && !auth.locked;
  useEffect(() => (unlocked ? attachIdleLock(cuadra.auth) : undefined), [cuadra, unlocked]);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  useEffect(() => {
    document.documentElement.dataset['locked'] = locked ? 'true' : 'false';
    if (locked) closeOverlay();
    return () => {
      document.documentElement.dataset['locked'] = 'false';
    };
  }, [locked, closeOverlay]);

  if (waiting) return <LoadingScreen />;
  return (
    <>
      <div className="lock-app" hidden={locked}>
        {children}
      </div>
      {locked && LockScreen !== null ? (
        <div className="lock-layer">
          <Suspense fallback={<LoadingScreen />}>
            <LockScreen busy={!auth.ready} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
