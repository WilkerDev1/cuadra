import { lazy, Suspense } from 'react';
import { isDomainError } from '../../core';
import { useT } from '../../i18n';
import { Button } from '../../ui';
import type { BootState } from '../boot';
import { useUiStore } from '../state/uiStore';
import { LoadingScreen } from './LoadingScreen';
import { loadApp } from './loadApp';
import './shell.css';

// La app (router, features, pantallas) va en su propio bloque: main.tsx lo pide a la vez que abre la base, así el
// worker de SQLite arranca sin esperar a que se descargue y ejecute todo lo demás.
const App = lazy(async () => ({ default: (await loadApp()).App }));

/** Pantalla de arranque: carga, «abierta en otra pestaña», cedida, error o la app. */
export function BootView({ state }: { state: BootState }) {
  switch (state.status) {
    case 'loading':
      return <LoadingScreen />;
    case 'blocked':
      return <LockScreen kind="tabLock" onAction={state.takeOver} />;
    case 'released':
      return <LockScreen kind="released" onAction={state.reopen} />;
    case 'error':
      return <BootError error={state.error} />;
    case 'ready':
      return (
        <Suspense fallback={<LoadingScreen />}>
          <App cuadra={state.cuadra} info={state.info} />
        </Suspense>
      );
  }
}

function LockScreen({ kind, onAction }: { kind: 'tabLock' | 'released'; onAction: () => void }) {
  const t = useT('common');
  return (
    <main className="shell-center">
      <h1 className="shell-title">{t(`${kind}.title`)}</h1>
      <p className="shell-lede">{t(`${kind}.body`)}</p>
      <Button variant="primary" onClick={onAction}>
        {t(`${kind}.action`)}
      </Button>
      <UpdateOffer />
    </main>
  );
}

function BootError({ error }: { error: unknown }) {
  const t = useT();
  const updateReady = useUiStore((s) => s.updateReady);
  const detail = isDomainError(error) ? t(`errors.${error.code}`) : error instanceof Error ? error.message : String(error);
  return (
    <main className="shell-center">
      <h1 className="shell-title">{t('common.bootError.title')}</h1>
      <p className="shell-lede">{t('common.bootError.body')}</p>
      <details className="shell-details">
        <summary>{t('common.bootError.details')}</summary>
        <p>{detail}</p>
      </details>
      <UpdateOffer />
      <Button variant={updateReady ? 'secondary' : 'primary'} onClick={() => location.reload()}>
        {t('common.bootError.retry')}
      </Button>
    </main>
  );
}

/** Fuera de la app (error, otra pestaña) también se ofrece la versión nueva del service worker si ya está esperando. */
function UpdateOffer() {
  const t = useT('common');
  const apply = useUiStore((s) => s.applyUpdate);
  if (apply === null) return null;
  return (
    <div className="shell-update" role="status">
      <p className="shell-lede">{t('update.available')}</p>
      <Button variant="primary" onClick={apply}>
        {t('update.action')}
      </Button>
    </div>
  );
}
