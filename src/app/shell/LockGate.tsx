import { lazy, Suspense, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import { htmlAttrs } from '../../ui/lib';
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
        <LockLayer>
          <Suspense fallback={<LoadingScreen />}>
            <LockScreen busy={!auth.ready} />
          </Suspense>
        </LockLayer>
      ) : null}
    </>
  );
}

/**
 * La pantalla de bloqueo va en un `<dialog>` modal: si al bloquear había una hoja o un diálogo modal abierto (ocultos
 * con la app, pero aún `:modal`), todo lo que no esté en el último modal es inerte y el campo de contraseña no
 * recibiría toques. Siendo el último modal, la pantalla de bloqueo es lo único activo. Si algo de la app de detrás
 * abre otro modal mientras tanto (un enlace directo a una hoja, p. ej.), el bloqueo vuelve a ponerse encima.
 * Esc no la cierra; si el navegador la cierra igualmente, se vuelve a abrir.
 */
function LockLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let alive = true;
    const raise = () => {
      if (!alive || !el.isConnected) return;
      if (el.open) el.close();
      el.showModal();
    };
    el.showModal();
    const observer = new MutationObserver((records) => {
      const otherOpened = records.some((r) => r.target !== el && r.target instanceof HTMLDialogElement && r.target.open);
      if (otherOpened) raise();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    const onClose = () => requestAnimationFrame(() => {
      if (alive && !el.open) el.showModal();
    });
    el.addEventListener('close', onClose);
    return () => {
      alive = false;
      observer.disconnect();
      el.removeEventListener('close', onClose);
      if (el.open) el.close();
    };
  }, []);
  return (
    <dialog ref={ref} className="lock-layer" onCancel={(e) => e.preventDefault()} {...htmlAttrs({ closedby: 'none' })}>
      {/* La app (con su <main>) queda oculta: la pantalla de bloqueo es el contenido principal. */}
      <main className="lock-layer__main">{children}</main>
    </dialog>
  );
}
