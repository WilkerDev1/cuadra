// Clases de ancho del shell (DESIGN §8.1). El CSS usa container queries sobre `page` (el cuerpo); aquí está su espejo
// en JS para lo que cambia la ESTRUCTURA (hoja o inspector, menú o hoja): mide el mismo contenedor, no el viewport.
import { useSyncExternalStore } from 'react';

export type Breakpoint = 'compact' | 'medium' | 'expanded' | 'wide';

export const BREAKPOINT_MIN = { medium: 600, expanded: 1024, wide: 1280 } as const;

export function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINT_MIN.wide) return 'wide';
  if (width >= BREAKPOINT_MIN.expanded) return 'expanded';
  if (width >= BREAKPOINT_MIN.medium) return 'medium';
  return 'compact';
}

const ORDER: readonly Breakpoint[] = ['compact', 'medium', 'expanded', 'wide'];
/** ¿`current` es al menos `min`? */
export function atLeast(current: Breakpoint, min: Breakpoint): boolean {
  return ORDER.indexOf(current) >= ORDER.indexOf(min);
}

let observer: ResizeObserver | null = null;
let current: Breakpoint = 'compact';
const listeners = new Set<() => void>();

function measure(width: number): void {
  const next = breakpointFor(width);
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof ResizeObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) measure(width);
    });
    observer.observe(document.body);
    measure(document.body.clientWidth);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/**
 * Sin observador todavía (primer render de la app), se mide en el acto: si no, un enlace directo a una hoja en
 * escritorio se pintaba primero como hoja modal (`compact`) y luego saltaba al inspector, cerrándose por el camino.
 */
function snapshot(): Breakpoint {
  if (observer === null && typeof document !== 'undefined' && document.body !== null) current = breakpointFor(document.body.clientWidth);
  return current;
}

/** Ancho actual del shell como clase. En pruebas de nodo (sin DOM) es siempre `compact`. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, snapshot, () => 'compact');
}
