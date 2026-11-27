import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot, type BootState } from './app/boot';
import { registerServiceWorker } from './app/pwa';
import { BootView } from './app/shell/BootView';
import { useUiStore } from './app/state/uiStore';

const container = document.getElementById('root');
if (container === null) throw new Error('Falta #root en index.html');
const root = createRoot(container);

let swRegistered = false;
function render(state: BootState): void {
  root.render(
    <StrictMode>
      <BootView state={state} />
    </StrictMode>,
  );
  if (state.status === 'error') console.error('[cuadra] no se pudo abrir el libro', state.error);
  if (state.status === 'ready' && !swRegistered) {
    swRegistered = true;
    void registerServiceWorker();
  }
}

// boot() vive fuera de React: el candado entre pestañas no debe pedirse dos veces (StrictMode).
void boot({
  onState: render,
  onPersistError: () => useUiStore.getState().pushToast({ message: 'common.storage.persistError' }),
});
