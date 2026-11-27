import { useUiStore } from './state/uiStore';

/** Registra el service worker (solo en producción) y avisa al shell cuando hay una versión nueva. */
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  const update = registerSW({
    onNeedRefresh: () => useUiStore.getState().setUpdateReady(() => void update(true)),
  });
}
