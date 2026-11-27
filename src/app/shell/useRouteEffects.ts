import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';
import { t } from '../../i18n';

/**
 * Tras cada cambio de ruta de página (no de hoja): sube al inicio, pasa el foco al título de la vista nueva
 * (DESIGN §12) y pone el título del documento. La primera carga no roba el foco.
 */
export function useRouteEffects(main: RefObject<HTMLElement | null>, opts: { enabled: boolean; titleKey?: string | undefined }): void {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);
  const { enabled, titleKey } = opts;

  useEffect(() => {
    if (!enabled) return;
    document.title = titleKey === undefined ? t('common.appName') : `${t(titleKey)} · ${t('common.appName')}`;
  }, [enabled, titleKey, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const first = previous.current === null;
    const changed = previous.current !== pathname;
    previous.current = pathname;
    if (first || !changed) return;
    window.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() => {
      const el = main.current;
      if (el === null) return;
      const target = el.querySelector<HTMLElement>('h1') ?? el;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, pathname, main]);
}
