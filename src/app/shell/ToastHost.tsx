import { useMemo } from 'react';
import { useT } from '../../i18n';
import { ToastRegion, type ToastItem } from '../../ui';
import { useUiStore } from '../state/uiStore';

/** Pinta la cola de avisos del almacén de interfaz con la región de toasts del sistema de diseño. */
export function ToastHost() {
  const t = useT();
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  const items = useMemo(
    () =>
      toasts.map((toast): ToastItem => {
        const undo = toast.undo;
        return undo === undefined
          ? { id: toast.id, message: t(toast.message), tone: 'info' }
          : { id: toast.id, message: t(toast.message), tone: 'undo', action: { label: t('common.undo'), onAction: undo } };
      }),
    [toasts, t],
  );
  return <ToastRegion toasts={items} onDismiss={dismiss} />;
}
