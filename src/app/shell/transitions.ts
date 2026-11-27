// Transiciones entre vistas (DESIGN §13/§14): React Router envuelve la navegación en `document.startViewTransition`
// + flushSync cuando se le pasa `viewTransition`. Donde el navegador no la tiene, la navegación es instantánea.
import { useCallback } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router';

/** Opciones de navegación con transición. Para `<NavLink viewTransition>` / `<Link viewTransition>` basta el booleano. */
export const VIEW_TRANSITION: Pick<NavigateOptions, 'viewTransition'> = { viewTransition: true };

/** `navigate` con transición entre vistas por defecto. */
export function useNavigateWithTransition(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback((to, options) => void navigate(to, { ...VIEW_TRANSITION, ...options }), [navigate]);
}
