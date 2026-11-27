import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot, type BootState } from './app/boot';
import { registerServiceWorker } from './app/pwa';
import { BootView } from './app/shell/BootView';
import { preloadApp } from './app/shell/loadApp';
import { useUiStore } from './app/state/uiStore';

const container = document.getElementById('root');
if (container === null) throw new Error('Falta #root en index.html');
const root = createRoot(container);

function render(state: BootState): void {
  root.render(
    <StrictMode>
      <BootView state={state} />
    </StrictMode>,
  );
  if (state.status === 'error') console.error('[cuadra] no se pudo abrir el libro', state.error);
}

// El service worker se registra pase lo que pase con la base: si una versión publicada no logra abrirla (error,
// otra pestaña), el aviso de versión nueva debe poder llegar igualmente para salir de la versión rota.
void registerServiceWorker();

// boot() vive fuera de React: el candado entre pestañas no debe pedirse dos veces (StrictMode).
void boot({
  onState: render,
  onPersistError: () => useUiStore.getState().pushToast({ message: 'common.storage.persistError' }),
});

// El bloque de la app y el de la ruta inicial se piden ya, en paralelo con la apertura de la base.
preloadApp();
