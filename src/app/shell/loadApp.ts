// Un único import() del bloque de la app: lo comparten main.tsx (que lo adelanta mientras abre la base) y BootView.
let pending: Promise<typeof import('../App')> | null = null;

export function loadApp(): Promise<typeof import('../App')> {
  pending ??= import('../App').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Descarga el bloque de la app y, en paralelo, el de la ruta con la que se abre (sin esperar a que la base esté lista). */
export function preloadApp(): void {
  void loadApp()
    .then((m) => m.prefetchInitialRoute(window.location.hash))
    .catch(() => {
      /* si falla, BootView lo vuelve a pedir y muestra el error */
    });
}
