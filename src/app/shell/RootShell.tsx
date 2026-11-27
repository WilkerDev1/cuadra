import { useRef } from 'react';
import { Outlet, useMatches } from 'react-router';
import type { RouteHandle } from '../router';
import { ShellBanners } from './ShellBanners';
import { ShellChrome } from './ShellChrome';
import { SkipLink } from './SkipLink';
import { useRouteEffects } from './useRouteEffects';
import './shell.css';

/**
 * Marco de las rutas de la raíz (`scope: 'root'`: espacios, bienvenida, respaldo…): sin navegación de espacio, con
 * avisos, atajos, paleta y toasts. Las features pintan dentro de este `<main>`; no deben añadir otro.
 */
export function RootShell() {
  const main = useRef<HTMLElement>(null);
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  useRouteEffects(main, { enabled: true, titleKey: handle?.titleKey });
  return (
    <div className="shell shell--root">
      <SkipLink target={main} />
      <main id="main" ref={main} className="shell-main shell-main--root">
        <ShellBanners />
        <Outlet />
      </main>
      <ShellChrome />
    </div>
  );
}
