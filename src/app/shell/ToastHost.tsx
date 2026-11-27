import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { ToastRegion, type ToastItem } from '../../ui';
import { useUiStore } from '../state/uiStore';

/** El `<dialog>` modal de más arriba, o `null`. Fuera de él todo es inerte, así que los avisos deben vivir dentro. */
function topModalDialog(): HTMLDialogElement | null {
  const open = [...document.querySelectorAll('dialog[open]')].filter((d): d is HTMLDialogElement => d instanceof HTMLDialogElement && d.matches(':modal'));
  return open.at(-1) ?? null;
}

/** Sigue el diálogo modal abierto mientras haya avisos (si no, el [Deshacer] quedaba inerte bajo una hoja). */
function useModalHost(active: boolean): HTMLDialogElement | null {
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (!active) {
      setHost(null);
      return;
    }
    const update = () => setHost(topModalDialog());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
    return () => observer.disconnect();
  }, [active]);
  return host;
}

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
  const host = useModalHost(items.length > 0);
  const region = <ToastRegion toasts={items} onDismiss={dismiss} />;
  return host === null ? region : createPortal(region, host, 'toasts-in-dialog');
}
