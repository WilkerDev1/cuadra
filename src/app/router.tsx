import { createHashRouter, Navigate, useParams, type RouteObject } from 'react-router';
import { features as collected } from './registry/collect';
import type { FeatureModule, FeatureRoute } from './registry/types';
import { AppShell } from './shell/AppShell';
import { LoadingScreen } from './shell/LoadingScreen';
import { MorePage } from './shell/MorePage';
import { NotFound } from './shell/NotFound';
import { RootShell } from './shell/RootShell';
import { WorkspaceStatus } from './shell/WorkspaceStatus';
import { useUiStore } from './state/uiStore';

/** PROVISIONAL: hasta que la feature `workspaces` exista y reclame la ruta `/`, el shell abre este espacio. */
export const PROVISIONAL_WORKSPACE_ID = 'demo';

export interface RouteHandle {
  presentation: 'page' | 'sheet';
  titleKey?: string;
}

function toRoute(route: FeatureRoute): RouteObject {
  const handle: RouteHandle = {
    presentation: route.presentation ?? 'page',
    ...(route.titleKey === undefined ? {} : { titleKey: route.titleKey }),
  };
  const lazy = async () => ({ Component: (await route.lazy()).Component });
  if (route.path === '') return { index: true, lazy, handle };
  return { path: route.path, lazy, handle };
}

function RootRedirect() {
  const last = useUiStore((s) => s.lastWorkspaceId);
  return <Navigate to={`/e/${last ?? PROVISIONAL_WORKSPACE_ID}`} replace />;
}

/** Destino de los atajos de la PWA (`#/atajo/entrada`): abre «Nuevo» en el último espacio usado. */
function ShortcutRedirect() {
  const { tipo } = useParams();
  const last = useUiStore((s) => s.lastWorkspaceId);
  if (last === null) return <Navigate to="/" replace />;
  return <Navigate to={`/e/${last}/nuevo?tipo=${encodeURIComponent(tipo ?? 'entrada')}`} replace />;
}

export function buildRoutes(features: readonly FeatureModule[]): RouteObject[] {
  const all = features.flatMap((f) => f.routes ?? []);
  const rootRoutes = all.filter((r) => r.scope === 'root').map(toRoute);
  const workspaceRoutes = all.filter((r) => r.scope === 'workspace').map(toRoute);
  const claimsRoot = all.some((r) => r.scope === 'root' && r.path === '');
  const claimsWorkspaceIndex = all.some((r) => r.scope === 'workspace' && r.path === '');
  // «Más» es del shell (la página móvil con lo que no cabe en la barra inferior): ninguna feature la define.
  const more: RouteObject = { path: 'mas', element: <MorePage />, handle: { presentation: 'page', titleKey: 'common.more.title' } satisfies RouteHandle };
  const workspaceChildren: RouteObject[] = claimsWorkspaceIndex
    ? [more, ...workspaceRoutes]
    : [{ index: true, element: <WorkspaceStatus /> }, more, ...workspaceRoutes];
  return [
    {
      path: '/',
      errorElement: <NotFound />,
      // Las rutas de las features son lazy: mientras carga la primera, el arranque se ve igual que boot.
      hydrateFallbackElement: <LoadingScreen />,
      children: [
        // Las rutas de la raíz comparten el marco sin navegación de espacio (avisos, atajos, paleta, toasts).
        {
          element: <RootShell />,
          children: [...(claimsRoot ? [] : [{ index: true, element: <RootRedirect /> } satisfies RouteObject]), ...rootRoutes],
        },
        { path: 'atajo/:tipo', element: <ShortcutRedirect /> },
        { path: 'e/:wsId', element: <AppShell />, children: workspaceChildren },
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}

export function createRouter(features: readonly FeatureModule[] = collected) {
  return createHashRouter(buildRoutes(features));
}
