// Utilidades internas del sistema de diseño: clases, detección de funciones y top layer.
import { useCallback, useRef, useState } from 'react';

/** Une clases ignorando falsos. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Atributos HTML recientes que los tipos de React aún no conocen (closedby, interestfor, switch…). */
export function htmlAttrs(attrs: Record<string, string | boolean | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    out[k] = v === true ? '' : v;
  }
  return out;
}

const hasWindow = typeof window !== 'undefined';

export const supports = {
  closedBy: () => hasWindow && 'closedBy' in HTMLDialogElement.prototype,
  anchor: () => hasWindow && typeof CSS !== 'undefined' && CSS.supports('anchor-name: --a'),
  interestFor: () => hasWindow && 'interestForElement' in HTMLButtonElement.prototype,
  popover: () => hasWindow && Object.hasOwn(HTMLElement.prototype, 'popover'),
  viewTransition: () => hasWindow && 'startViewTransition' in document,
};

/** Respuesta táctil si existe (DESIGN.md §13). */
export function vibrate(pattern: number | number[]): void {
  try {
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (hasWindow && activated && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* sin vibración: solo respuesta visual */
  }
}

export function prefersReducedMotion(): boolean {
  return hasWindow && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let displayTransition: boolean | undefined;
/** ¿El navegador anima la salida de `display` (necesario para animar la salida del top layer)? */
function canTransitionDisplay(): boolean {
  if (displayTransition !== undefined) return displayTransition;
  if (!hasWindow || !CSS.supports('transition-behavior', 'allow-discrete') || document.body === null) return false;
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = 'none';
  displayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return displayTransition;
}

/** Cierra un dialog/popover dejando terminar la animación de salida donde no hay `overlay`. */
export async function closeTopLayer(el: HTMLDialogElement | HTMLElement): Promise<void> {
  const native = CSS.supports('overlay', 'auto') && canTransitionDisplay();
  if (!native && !prefersReducedMotion()) {
    el.setAttribute('data-closing', '');
    const animations = el.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 600)),
      ]);
    }
    if (!el.hasAttribute('data-closing')) return;
    el.removeAttribute('data-closing');
  }
  if (el instanceof HTMLDialogElement) {
    if (el.open) el.close();
  } else if (el.matches(':popover-open')) el.hidePopover();
}

/** Clic fuera para `<dialog closedby="any">` donde no hay `closedby` (Safari). */
export function lightDismissFallback(dialog: HTMLDialogElement, onDismiss: () => void): () => void {
  if (supports.closedBy()) return () => {};
  const outside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  const down = (e: PointerEvent) => {
    pressedOutside = outside(e);
  };
  const up = (e: PointerEvent) => {
    if (pressedOutside && outside(e)) onDismiss();
  };
  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('pointerup', up);
  return () => {
    dialog.removeEventListener('pointerdown', down);
    dialog.removeEventListener('pointerup', up);
  };
}

/** Estado controlado o no controlado. */
export function useControllable<T>(value: T | undefined, initial: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState<T>(initial);
  const controlled = value !== undefined;
  const ref = useRef(onChange);
  ref.current = onChange;
  const set = useCallback(
    (v: T) => {
      if (!controlled) setInner(v);
      ref.current?.(v);
    },
    [controlled],
  );
  return [controlled ? value : inner, set];
}
