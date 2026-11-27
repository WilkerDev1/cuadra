import { useState } from 'react';
import { useT } from '../../i18n';
import { Banner, Button } from '../../ui';
import { useBootInfo } from '../data/bootInfo';
import { useUiStore } from '../state/uiStore';

/** Avisos persistentes del shell: modo solo-memoria (datos que no se guardan) y versión nueva de la PWA. */
export function ShellBanners() {
  const t = useT();
  const { storage } = useBootInfo();
  const updateReady = useUiStore((s) => s.updateReady);
  const applyUpdate = useUiStore((s) => s.applyUpdate);
  const [dismissed, setDismissed] = useState(false);
  const showUpdate = updateReady && !dismissed;
  if (storage.persistent && !showUpdate) return null;
  return (
    <div className="shell-banners">
      {storage.persistent ? null : (
        <Banner tone="warn" title={t('common.storage.memoryOnly.title')}>
          {t('common.storage.memoryOnly.body')}
        </Banner>
      )}
      {showUpdate ? (
        <Banner
          title={t('common.update.available')}
          action={
            <>
              <Button variant="ghost" onClick={() => setDismissed(true)}>
                {t('common.update.later')}
              </Button>
              <Button variant="primary" onClick={() => applyUpdate?.()}>
                {t('common.update.action')}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
