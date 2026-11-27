import { isDomainError } from '../../core';
import { useT } from '../../i18n';
import { Button } from '../../ui';
import { App } from '../App';
import type { BootState } from '../boot';
import { LoadingScreen } from './LoadingScreen';
import './shell.css';

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
      return <App cuadra={state.cuadra} info={state.info} />;
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
    </main>
  );
}

function BootError({ error }: { error: unknown }) {
  const t = useT();
  const detail = isDomainError(error) ? t(`errors.${error.code}`) : error instanceof Error ? error.message : String(error);
  return (
    <main className="shell-center">
      <h1 className="shell-title">{t('common.bootError.title')}</h1>
      <p className="shell-lede">{t('common.bootError.body')}</p>
      <details className="shell-details">
        <summary>{t('common.bootError.details')}</summary>
        <p>{detail}</p>
      </details>
      <Button variant="primary" onClick={() => location.reload()}>
        {t('common.bootError.retry')}
      </Button>
    </main>
  );
}
