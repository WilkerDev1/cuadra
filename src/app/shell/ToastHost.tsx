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
        const message = t(toast.message, toast.params);
        if (toast.undo !== undefined) {
          return { id: toast.id, message, tone: 'undo', action: { label: t('common.undo'), onAction: toast.undo } };
        }
        return { id: toast.id, message, tone: toast.tone ?? 'info' };
      }),
    [toasts, t],
  );
  return <ToastRegion toasts={items} onDismiss={dismiss} />;
}
