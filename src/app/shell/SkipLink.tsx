import type { RefObject } from 'react';
import { useT } from '../../i18n';

/**
 * «Saltar al contenido». Con `createHashRouter` un `href="#main"` cambia de ruta (y pinta la 404), así que el enlace
 * no navega: pasa el foco al `<main>` del shell (o a su título) y lo trae a la vista.
 */
export function SkipLink({ target }: { target: RefObject<HTMLElement | null> }) {
  const t = useT();
  return (
    <a
      className="skip-link"
      href="#"
      onClick={(event) => {
        event.preventDefault();
        const main = target.current;
        if (main === null) return;
        const heading = main.querySelector<HTMLElement>('h1');
        const el = heading ?? main;
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'start' });
      }}
    >
      {t('common.skipToContent')}
    </a>
  );
}
