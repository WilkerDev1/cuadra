// Arranque (ARCHITECTURE.md 3.1 y ADR-9): único sitio que conoce los adaptadores. Abre la base (candado
// entre pestañas → OPFS → respaldo :memory:+IndexedDB → migrar) y crea la fachada del núcleo.
import { createCuadra, type Cuadra } from '../core';
import { setLocale } from '../i18n/format';
import { createRestoreCopySink, DataError, nativeFileSaver, openDatabase, type OpenDatabaseOptions, type OpenedDatabase, type StorageStatus } from '../data';
import { setNativeSaver } from './data/download';

export interface BootInfo {
  storage: StorageStatus;
  /** Versión de esquema tras migrar y migraciones aplicadas en este arranque. */
  schema: OpenedDatabase['schema'];
  sqliteVersion: string;
}

export type BootState =
  | { status: 'loading' }
  /** Otra pestaña tiene el libro. `takeOver` le pide que lo suelte («Usar aquí»). */
  | { status: 'blocked'; takeOver: () => void }
  | { status: 'ready'; cuadra: Cuadra; info: BootInfo }
  /** Otra pestaña pidió el libro y esta ya lo cerró. `reopen` lo vuelve a pedir. */
  | { status: 'released'; reopen: () => void }
  | { status: 'error'; error: unknown };

export interface BootHooks {
  onState(state: BootState): void;
  /** Falló un volcado a IndexedDB (modo memoria + IndexedDB). */
  onPersistError?: (message: string) => void;
  /** Para pruebas: sustituye a openDatabase. */
  open?: (options: OpenDatabaseOptions) => Promise<OpenedDatabase>;
  /** Pedir el libro sin preguntar si otra pestaña lo tiene (tras pulsar «Usar aquí» en esta). */
  takeOverImmediately?: boolean;
}

export async function boot(hooks: BootHooks): Promise<void> {
  const open = hooks.open ?? openDatabase;
  let released = false;
  const reopen = (): void => void boot({ ...hooks, takeOverImmediately: true });
  hooks.onState({ status: 'loading' });
  try {
    const db = await open({
      onBlocked: (takeOver) => {
        if (hooks.takeOverImmediately === true) {
          takeOver();
          return;
        }
        hooks.onState({
          status: 'blocked',
          takeOver: () => {
            hooks.onState({ status: 'loading' });
            takeOver();
          },
        });
      },
      onReleaseRequested: () => {
        released = true;
        hooks.onState({ status: 'released', reopen });
      },
      ...(hooks.onPersistError === undefined ? {} : { onPersistError: hooks.onPersistError }),
    });
    const autoCopy = createRestoreCopySink();
    const cuadra = createCuadra({
      driver: db,
      locale: 'es-DO',
      schemaVersion: db.schema.to,
      // Versión de package.json (define de vite.config). En Vitest no existe y el núcleo usa la suya.
      ...(typeof import.meta.env.VITE_APP_VERSION === 'string' ? { appVersion: import.meta.env.VITE_APP_VERSION } : {}),
      ...(autoCopy === undefined ? {} : { backupAutoCopy: autoCopy }),
    });
    // En Tauri, las descargas van por el diálogo nativo «Guardar como».
    if (db.info.kind === 'tauri') {
      try {
        setNativeSaver(await nativeFileSaver());
      } catch {
        // sin diálogo nativo: queda la descarga del webview
      }
    }
    // El formato regional guardado (Ajustes de instalación) vale desde el primer pintado.
    try {
      setLocale(await cuadra.settings.get('locale'));
    } catch {
      // sin ajuste legible: se queda el de por defecto (es-DO)
    }
    hooks.onState({
      status: 'ready',
      cuadra,
      info: { storage: db.storage, schema: db.schema, sqliteVersion: db.info.sqliteVersion },
    });
  } catch (error) {
    // Si otra pestaña pidió el libro mientras abríamos, no es un fallo: es la pantalla de «cedido».
    if (released) return; // onReleaseRequested ya pintó la pantalla
    if (error instanceof DataError && error.code === 'database_released') {
      hooks.onState({ status: 'released', reopen });
      return;
    }
    hooks.onState({ status: 'error', error });
  }
}
