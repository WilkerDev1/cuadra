import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useMatches, useNavigate, useOutlet, useParams } from 'react-router';
import { useT } from '../../i18n';
import { InspectorContext, InspectorPanel } from '../registry/inspector';
import { SheetContext, type SheetApi } from '../registry/sheet';
import type { RouteHandle } from '../router';
import { useBreakpoint } from '../state/breakpoint';
import { useUiStore } from '../state/uiStore';
import { BottomTabs } from './BottomTabs';
import { ShellBanners } from './ShellBanners';
import { ShellChrome } from './ShellChrome';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useRouteEffects } from './useRouteEffects';
import './shell.css';

interface Background {
  wsId: string;
  element: ReactNode;
  to: string;
}

/**
 * Marco de las rutas de un espacio (`/e/:wsId`): encabezado y barra inferior en móvil, riel en tableta, barra lateral
 * en escritorio y, desde 1280 px, inspector fijo. Las rutas con `presentation: 'sheet'` salen como hoja o inspector
 * y la página anterior queda detrás.
 */
export function AppShell() {
  const t = useT();
  const { wsId = '' } = useParams();
  const location = useLocation();
  const matches = useMatches();
  const outlet = useOutlet();
  const setLast = useUiStore((s) => s.setLastWorkspaceId);
  const breakpoint = useBreakpoint();
  const main = useRef<HTMLElement>(null);

  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  const isSheet = handle?.presentation === 'sheet';

  // Panel fijo: el aside existe siempre en ancho amplio; la columna solo se abre mientras alguien lo ocupa.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const mode = breakpoint === 'wide' ? 'inspector' : 'sheet';
  const inspector = useMemo(() => ({ mode, target, claim }) as const, [mode, target, claim]);

  // La última página (no hoja) se conserva para pintarla detrás de la hoja o del inspector.
  const background = useRef<Background | null>(null);
  if (!isSheet) background.current = { wsId, element: outlet, to: location.pathname + location.search };
  const behind = isSheet && background.current?.wsId === wsId ? background.current.element : null;

  useEffect(() => {
    if (wsId !== '') setLast(wsId);
  }, [wsId, setLast]);

  useRouteEffects(main, { enabled: !isSheet, titleKey: handle?.titleKey });

  return (
    <InspectorContext.Provider value={inspector}>
      <div className="shell" data-inspector={claims > 0 ? '' : undefined}>
        <a className="skip-link" href="#main">
          {t('common.skipToContent')}
        </a>
        <TopBar />
        <Sidebar />
        <main id="main" ref={main} className="shell-main">
          <ShellBanners />
          {isSheet ? behind : outlet}
        </main>
        <aside
          ref={setTarget}
          className="inspector"
          aria-label={t('common.inspector.label')}
          hidden={claims === 0}
        />
        <BottomTabs />
        {isSheet ? (
          <RouteSheet key={location.pathname} titleKey={handle?.titleKey} to={background.current?.to ?? null} wsId={wsId}>
            {outlet}
          </RouteSheet>
        ) : null}
        <ShellChrome />
      </div>
    </InspectorContext.Provider>
  );
}

/** Hoja o inspector de una ruta `presentation: 'sheet'`: el shell pone el marco, el título y el cierre. */
function RouteSheet({ titleKey, to, wsId, children }: { titleKey: string | undefined; to: string | null; wsId: string; children: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const { mode } = useContext(InspectorContext);

  const close = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (to !== null && idx > 0) void navigate(-1);
    else void navigate(to ?? `/e/${wsId}`, { replace: true });
  }, [navigate, to, wsId]);
  const api = useMemo<SheetApi>(() => ({ mode, close, setDirty }), [mode, close]);

  // Al cerrar una hoja el foco vuelve a lo que la abrió (el unmount no lo hace solo).
  const opener = useRef<Element | null>(document.activeElement);
  useEffect(
    () => () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    },
    [],
  );

  return (
    <SheetContext.Provider value={api}>
      <InspectorPanel title={t(titleKey ?? 'common.sheet.default')} onClose={close} dirty={dirty}>
        {children}
      </InspectorPanel>
    </SheetContext.Provider>
  );
}
