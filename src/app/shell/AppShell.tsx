import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import { useT } from '../../i18n';
import { Banner, Button } from '../../ui';
import { useUiStore } from '../state/uiStore';
import { useBootInfo } from './bootInfo';
import { BottomTabs } from './BottomTabs';
import { Fab } from './Fab';
import { Sidebar } from './Sidebar';
import { ToastHost } from './ToastHost';
import './shell.css';

/** Marco de las rutas de un espacio (`/e/:wsId`): barra lateral o inferior, contenido y botón «Anotar». */
export function AppShell() {
  const t = useT();
  const { wsId } = useParams();
  const { storage } = useBootInfo();
  const setLast = useUiStore((s) => s.setLastWorkspaceId);
  const updateReady = useUiStore((s) => s.updateReady);
  const applyUpdate = useUiStore((s) => s.applyUpdate);
  useEffect(() => {
    if (wsId !== undefined) setLast(wsId);
  }, [wsId, setLast]);
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('common.skipToContent')}
      </a>
      <Sidebar />
      <main id="main" className="shell-main">
        {storage.persistent ? null : (
          <Banner tone="warn" title={t('common.storage.memoryOnly.title')}>
            {t('common.storage.memoryOnly.body')}
          </Banner>
        )}
        {updateReady ? (
          <Banner
            title={t('common.update.available')}
            action={<Button onClick={() => applyUpdate?.()}>{t('common.update.action')}</Button>}
          />
        ) : null}
        <Outlet />
      </main>
      <BottomTabs />
      <Fab />
      <ToastHost />
    </div>
  );
}
