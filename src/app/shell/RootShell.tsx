import { useRef } from 'react';
import { Outlet, useMatches } from 'react-router';
import { useT } from '../../i18n';
import type { RouteHandle } from '../router';
import { ShellBanners } from './ShellBanners';
import { ShellChrome } from './ShellChrome';
import { useRouteEffects } from './useRouteEffects';
import './shell.css';

/**
 * Marco de las rutas de la raíz (`scope: 'root'`: espacios, bienvenida, respaldo…): sin navegación de espacio, con
 * avisos, atajos, paleta y toasts. Las features pintan dentro de este `<main>`; no deben añadir otro.
 */
export function RootShell() {
  const t = useT();
  const main = useRef<HTMLElement>(null);
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  useRouteEffects(main, { enabled: true, titleKey: handle?.titleKey });
  return (
    <div className="shell shell--root">
      <a className="skip-link" href="#main">
        {t('common.skipToContent')}
      </a>
      <main id="main" ref={main} className="shell-main shell-main--root">
        <ShellBanners />
        <Outlet />
      </main>
      <ShellChrome />
    </div>
  );
}
