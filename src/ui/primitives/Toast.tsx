import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { useT } from '../../i18n';
import { cx, htmlAttrs } from '../lib';

export interface ToastItem {
  id: number;
  /** Texto ya traducido: «Anotado · −RD$350.00 en Caja». */
  message: ReactNode;
  /** Texto plano para el anuncio (si `message` no es texto). */
  announce?: string;
  /** `info` normal, `undo` con [Deshacer], `warn` aviso que no exige acción. */
  tone?: 'info' | 'undo' | 'warn';
  /** Acción del toast; en `undo` su etiqueta por defecto es «Deshacer». */
  action?: { label?: string; onAction: () => void };
  /** Milisegundos visibles; 6000 por defecto (12000 con acción). Se pausa con el puntero o el foco dentro. */
  duration?: number;
}

export interface ToastRegionProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
  /** Máximo visible a la vez; el resto espera en cola. */
  max?: number;
}

const DEFAULT_MS = 6000;
/** Un aviso con acción (Deshacer) dura más: con teclado llegar a él cuesta muchas pulsaciones. */
const ACTION_MS = 12000;

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(el.type));
}

function announce(text: string, region: HTMLElement | null) {
  const doc = document as Document & { ariaNotify?: (s: string) => void };
  if (typeof doc.ariaNotify === 'function') doc.ariaNotify(text);
  else if (region !== null) {
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = text;
    });
  }
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLLIElement>(null);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration ?? (toast.action === undefined ? DEFAULT_MS : ACTION_MS));
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const id = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDismiss, toast.id]);
  const dismiss = () => {
    // Si el foco estaba en el toast, pásalo al siguiente o devuélvelo al documento.
    const next = ref.current?.nextElementSibling ?? ref.current?.previousElementSibling;
    if (ref.current?.contains(document.activeElement) === true) {
      (next?.querySelector('button') as HTMLButtonElement | null)?.focus();
    }
    onDismiss(toast.id);
  };
  const tone = toast.tone ?? (toast.action === undefined ? 'info' : 'undo');
  const actionLabel = toast.action?.label ?? t('ui.undo');
  return (
    <li
      ref={ref}
      className={cx('ui-toast', `ui-toast--${tone}`)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {tone === 'warn' ? <CircleAlert aria-hidden="true" className="ui-toast__icon" /> : null}
      <span className="ui-toast__msg">{toast.message}</span>
      {toast.action === undefined ? null : (
        <button
          type="button"
          className="ui-toast__action"
          aria-keyshortcuts={tone === 'undo' ? 'Control+Z Meta+Z' : undefined}
          onClick={() => {
            toast.action?.onAction();
            dismiss();
          }}
        >
          {actionLabel}
        </button>
      )}
      <button type="button" className="ui-toast__close" aria-label={t('ui.close')} onClick={dismiss}>
        <X aria-hidden="true" />
      </button>
    </li>
  );
}

/** Región de avisos: popover `manual` abajo y centrado, cola, pausa al enfocar y anuncio accesible. */
export function ToastRegion({ toasts, onDismiss, max = 3 }: ToastRegionProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const announced = useRef(new Set<number>());
  const visible = toasts.slice(-max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const shouldShow = visible.length > 0;
    try {
      if (shouldShow && !el.matches(':popover-open')) el.showPopover();
      if (!shouldShow && el.matches(':popover-open')) el.hidePopover();
    } catch {
      /* sin popover: queda en el flujo como región fija */
    }
  }, [visible.length]);
  // Ctrl/Cmd+Z ejecuta la acción del aviso más reciente (salvo al escribir en un campo, donde es deshacer de texto).
  const latest = useRef<ToastItem | undefined>(undefined);
  latest.current = [...visible].reverse().find((x) => x.action !== undefined && (x.tone ?? 'undo') === 'undo');
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.defaultPrevented) return;
      const toast = latest.current;
      if (toast?.action === undefined || isEditable(document.activeElement)) return;
      e.preventDefault();
      toast.action.onAction();
      dismissRef.current(toast.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    for (const toast of visible) {
      if (announced.current.has(toast.id)) continue;
      announced.current.add(toast.id);
      const text = toast.announce ?? (typeof toast.message === 'string' ? toast.message : '');
      if (text !== '') announce(toast.action === undefined ? text : `${text}. ${t('ui.actionsAvailable')}`, liveRef.current);
    }
  }, [visible, t]);
  return (
    <div ref={ref} role="region" aria-label={t('ui.notifications')} className="ui-toasts" {...htmlAttrs({ popover: 'manual' })}>
      <p ref={liveRef} className="visually-hidden" aria-live="polite" />
      <ul role="list" className="ui-toasts__list">
        {visible.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ul>
    </div>
  );
}

interface ToastApi {
  /** Encola un aviso y devuelve su id. */
  show: (toast: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
}
const ToastContext = createContext<ToastApi | null>(null);

/** Proveedor con cola propia; el shell puede usar `ToastRegion` con su propio almacén en su lugar. */
export function ToastProvider({ children, max }: { children: ReactNode; max?: number }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const show = useCallback((toast: Omit<ToastItem, 'id'>) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((list) => [...list, { ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} {...(max === undefined ? {} : { max })} />
    </ToastContext.Provider>
  );
}

/** Acceso a la cola del `ToastProvider` más cercano. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast necesita un <ToastProvider>');
  return api;
}
