import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Id } from '../../core';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Toast {
  id: number;
  /** Clave i18n del mensaje. */
  message: string;
  undo?: () => void;
}

interface UiState {
  theme: ThemeChoice;
  lastWorkspaceId: Id | null;
  toasts: Toast[];
  /** Hay una versión nueva del service worker lista para activarse. */
  updateReady: boolean;
  applyUpdate: (() => void) | null;
  setTheme(theme: ThemeChoice): void;
  setLastWorkspaceId(id: Id | null): void;
  pushToast(toast: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
  setUpdateReady(apply: (() => void) | null): void;
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
      updateReady: false,
      applyUpdate: null,
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
    }),
    {
      name: 'cuadra.ui',
      version: 1,
      partialize: (s) => ({ theme: s.theme, lastWorkspaceId: s.lastWorkspaceId }),
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
