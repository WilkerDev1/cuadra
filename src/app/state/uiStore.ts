import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Id } from '../../core';
import { applyTheme } from './theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Toast {
  id: number;
  /** Clave i18n del mensaje. */
  message: string;
  /** Parámetros de interpolación del mensaje. */
  params?: Record<string, string | number>;
  /** `warn`: aviso que no exige acción (errores traducidos de una mutación). */
  tone?: 'info' | 'warn';
  undo?: () => void;
}

/** Superficies que se abren desde atajos o botones de distintas partes del shell. */
export type Overlay = 'palette' | 'help' | 'fab';

export interface UiState {
  theme: ThemeChoice;
  lastWorkspaceId: Id | null;
  toasts: Toast[];
  overlay: Overlay | null;
  /** Hay una versión nueva del service worker lista para activarse. */
  updateReady: boolean;
  applyUpdate: (() => void) | null;
  /** Atajos de una sola tecla (n, e, s, t, /, ?, g + letra). Se pueden apagar (WCAG 2.1.4). */
  singleKeyShortcuts: boolean;
  setSingleKeyShortcuts(on: boolean): void;
  setTheme(theme: ThemeChoice): void;
  setLastWorkspaceId(id: Id | null): void;
  pushToast(toast: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
  setUpdateReady(apply: (() => void) | null): void;
  openOverlay(overlay: Overlay): void;
  closeOverlay(overlay?: Overlay): void;
}

let toastSeq = 0;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      lastWorkspaceId: null,
      toasts: [],
      overlay: null,
      updateReady: false,
      applyUpdate: null,
      singleKeyShortcuts: true,
      setSingleKeyShortcuts: (singleKeyShortcuts) => set({ singleKeyShortcuts }),
      setTheme: (theme) => set({ theme }),
      setLastWorkspaceId: (lastWorkspaceId) => set({ lastWorkspaceId }),
      pushToast: (toast) => {
        toastSeq += 1;
        const id = toastSeq;
        set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
        return id;
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
      setUpdateReady: (applyUpdate) => set({ updateReady: applyUpdate !== null, applyUpdate }),
      openOverlay: (overlay) => set({ overlay }),
      closeOverlay: (overlay) => set((s) => (overlay === undefined || s.overlay === overlay ? { overlay: null } : s)),
    }),
    {
      name: 'cuadra.ui',
      version: 1,
      partialize: (s) => ({ theme: s.theme, lastWorkspaceId: s.lastWorkspaceId, singleKeyShortcuts: s.singleKeyShortcuts }),
      storage: {
        getItem: (name) => {
          try {
            const raw = safeStorage()?.getItem(name);
            return raw === null || raw === undefined ? null : JSON.parse(raw);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            safeStorage()?.setItem(name, JSON.stringify(value));
          } catch {
            /* almacenamiento no disponible: la preferencia solo vive en esta sesión */
          }
        },
        removeItem: (name) => {
          try {
            safeStorage()?.removeItem(name);
          } catch {
            /* nada que hacer */
          }
        },
      },
    },
  ),
);

// El tema se aplica nada más cargar el módulo (antes de que la base abra) y con cada cambio: sin parpadeo de claro a oscuro.
if (typeof document !== 'undefined') {
  applyTheme(useUiStore.getState().theme);
  useUiStore.subscribe((state, prev) => {
    if (state.theme !== prev.theme) applyTheme(state.theme);
  });
}
