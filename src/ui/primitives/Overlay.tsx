import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ellipsis, Info, X, type LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { closeTopLayer, cx, htmlAttrs, lightDismissFallback } from '../lib';
import { Button } from './Button';

/** Abre o cierra un `<dialog>` modal según `open`, con salida animada y clic fuera de respaldo. */
function useModal(open: boolean, onRequestClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  /** Quién tenía el foco al abrir: si el diálogo se desmonta sin `close()`, el navegador no restaura el foco solo. */
  const opener = useRef<HTMLElement | null>(open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (open && !el.open) {
      if (opener.current === null && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
      el.showModal();
    } else if (!open) {
      opener.current = null;
      if (el.open) void closeTopLayer(el);
    }
  }, [open]);
  useEffect(
    () => () => {
      const back = opener.current;
      if (back === null || !back.isConnected) return;
      const active = document.activeElement;
      if (active === null || active === document.body) back.focus({ preventScroll: true });
    },
    [],
  );
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // Esc cierra solo este diálogo: que el atajo de cerrar de la pantalla de debajo no lo reciba también.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    el.addEventListener('keydown', onKey);
    const off = lightDismissFallback(el, () => closeRef.current());
    return () => {
      el.removeEventListener('keydown', onKey);
      off();
    };
  }, []);
  return ref;
}

// ── Sheet ───────────────────────────────────────────────────────────────────────────────

export interface SheetProps {
  open: boolean;
  /** Se llama al pedir cierre (×, Esc, Atrás, tocar fuera). El padre pone `open=false`. */
  onClose: () => void;
  title: ReactNode;
  /** `bottom` hoja inferior (compacta), `side` hoja lateral derecha, `full` pantalla completa, `auto` bottom < 600px y side encima. */
  variant?: 'bottom' | 'side' | 'full' | 'auto';
  /** Altura de la hoja inferior: 50 / 85 / 100dvh. */
  height?: 'half' | 'tall' | 'full';
  /** Hay cambios sin guardar: Esc/Atrás/fuera piden confirmación antes de cerrar. */
  dirty?: boolean;
  /** Acción a la derecha de la barra superior. */
  headerAction?: ReactNode;
  /** Pie fijo (acciones). */
  footer?: ReactNode;
  /** Fondo teñido (p. ej. `var(--out-wash)` en Nuevo movimiento). */
  tint?: string;
  /** Oculta el título visualmente (sigue siendo el nombre accesible). */
  hideTitle?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Hoja sobre `<dialog>` + `showModal()`; entra con muelle, sale con fundido, guarda cambios sin guardar. */
export function Sheet({ open, onClose, title, variant = 'auto', height = 'tall', dirty = false, headerAction, footer, tint, hideTitle, children, className }: SheetProps) {
  const t = useT();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  const request = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  const ref = useModal(open, request);
  useEffect(() => {
    if (open) {
      setConfirming(false);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cx('ui-sheet', `ui-sheet--${variant}`, `ui-sheet--h-${height}`, className)}
      style={tint === undefined ? undefined : ({ '--sheet-tint': tint } as CSSProperties)}
      onCancel={(e) => {
        e.preventDefault();
        request();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      {...htmlAttrs({ closedby: 'any' })}
    >
      <div className="ui-sheet__handle" aria-hidden="true" />
      <header className="ui-sheet__bar">
        <button type="button" className="ui-iconbtn ui-iconbtn--ghost" aria-label={t('ui.close')} onClick={request}>
          <X aria-hidden="true" />
        </button>
        <h1 id={titleId} ref={titleRef} tabIndex={-1} className={cx('ui-sheet__title', hideTitle === true && 'visually-hidden')}>
          {title}
        </h1>
        <div className="ui-sheet__action">{headerAction}</div>
      </header>
      <div className="ui-sheet__body">{children}</div>
      {footer === undefined ? null : <footer className="ui-sheet__footer">{footer}</footer>}
      {confirming ? (
        <div className="ui-sheet__guard" role="alertdialog" aria-labelledby={`${titleId}-g`} aria-describedby={`${titleId}-gd`}>
          <p id={`${titleId}-g`} className="ui-sheet__guard-title">
            {t('ui.unsaved.title')}
          </p>
          <p id={`${titleId}-gd`} className="ui-sheet__guard-body">
            {t('ui.unsaved.body')}
          </p>
          <div className="ui-sheet__guard-actions">
            <Button variant="danger" onClick={onClose}>
              {t('ui.unsaved.discard')}
            </Button>
            <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>
              {t('ui.unsaved.keep')}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** `confirm` normal, `destructive` (el botón peligroso nunca enfocado por defecto), `info` solo cerrar. */
  variant?: 'confirm' | 'destructive' | 'info';
  /** Nombra la consecuencia: «¿Anular este movimiento?». */
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  /** Contenido extra (p. ej. un Field «Motivo (opcional)»). */
  children?: ReactNode;
  confirmLoading?: boolean;
}

/** Diálogo centrado de confirmación, máx. 28rem. */
export function Dialog({ open, onClose, variant = 'confirm', title, description, confirmLabel, cancelLabel, onConfirm, children, confirmLoading }: DialogProps) {
  const t = useT();
  const titleId = useId();
  const ref = useModal(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : `${titleId}-d`}
      className={cx('ui-dialog', `ui-dialog--${variant}`)}
      onClose={() => {
        if (open) onClose();
      }}
      {...htmlAttrs({ closedby: 'any' })}
    >
      <h1 id={titleId} className="ui-dialog__title">
        {title}
      </h1>
      {description === undefined ? null : (
        <p id={`${titleId}-d`} className="ui-dialog__desc">
          {description}
        </p>
      )}
      {children === undefined ? null : <div className="ui-dialog__body">{children}</div>}
      <div className="ui-dialog__actions">
        {variant === 'info' ? (
          <Button variant="secondary" autoFocus onClick={onClose}>
            {cancelLabel ?? t('ui.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" autoFocus={variant === 'destructive'} onClick={onClose}>
              {cancelLabel ?? t('ui.cancel')}
            </Button>
            <Button
              variant={variant === 'destructive' ? 'danger' : 'primary'}
              autoFocus={variant === 'confirm'}
              loading={confirmLoading === true}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        )}
      </div>
    </dialog>
  );
}

// ── Popovers anclados ───────────────────────────────────────────────────────────────────

function useAnchorName(): string {
  return `--a${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

export interface InfoTipProps {
  /** Explicación breve. Las explicaciones van aquí, no en cajas de colores. */
  children: ReactNode;
  /** Nombre accesible del botón (por defecto «Más información»). */
  label?: string;
  /** `warn` usa --warn-ink en el icono (avisos suaves que no bloquean). */
  tone?: 'info' | 'warn';
  className?: string;
}

/** Icono Info de 16px que abre un popover anclado con la explicación. */
export function InfoTip({ children, label, tone = 'info', className }: InfoTipProps) {
  const t = useT();
  const id = useId();
  const anchor = useAnchorName();
  return (
    <span className={cx('ui-infotip', `ui-infotip--${tone}`, className)}>
      <button
        type="button"
        className="ui-infotip__btn"
        aria-label={label ?? t('ui.info')}
        style={{ anchorName: anchor } as CSSProperties}
        popoverTarget={id}
      >
        <Info aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="ui-pop ui-infotip__pop" style={{ positionAnchor: anchor } as CSSProperties} {...htmlAttrs({ popover: 'auto' })}>
        {children}
      </span>
    </span>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** `danger` en tinta de salida (Anular). */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** Nombre accesible del disparador: «Más acciones de Compra de cemento». */
  label: string;
  items: readonly MenuItem[];
  /** Icono del disparador (por defecto ⋯). */
  icon?: LucideIcon;
  /** Disparador propio en lugar del IconButton (recibe los atributos a esparcir). */
  trigger?: (props: { [attr: string]: string | CSSProperties; style: CSSProperties }) => ReactNode;
  className?: string;
}

/** Menú de acciones en popover anclado; flechas para moverse, Esc para cerrar. */
export function Menu({ label, items, icon: Icon = Ellipsis, trigger, className }: MenuProps) {
  const id = useId();
  const anchor = useAnchorName();
  const popRef = useRef<HTMLDivElement>(null);
  const triggerProps: Record<string, string> = { popoverTarget: id, 'aria-haspopup': 'menu' };
  const move = (dir: number) => {
    const buttons = Array.from(popRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + dir + buttons.length) % buttons.length]?.focus();
  };
  return (
    <span className={cx('ui-menu', className)}>
      {trigger === undefined ? (
        <button type="button" className="ui-iconbtn ui-iconbtn--ghost" aria-label={label} title={label} style={{ anchorName: anchor } as CSSProperties} {...triggerProps}>
          <Icon aria-hidden="true" />
        </button>
      ) : (
        trigger({ ...triggerProps, 'aria-label': label, style: { anchorName: anchor } as CSSProperties })
      )}
      <div
        ref={popRef}
        id={id}
        role="menu"
        aria-label={label}
        className="ui-pop ui-menu__pop"
        style={{ positionAnchor: anchor } as CSSProperties}
        {...htmlAttrs({ popover: 'auto' })}
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') requestAnimationFrame(() => move(1));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {items.map((item) => {
          const ItemIcon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cx('ui-menu__item', item.tone === 'danger' && 'ui-menu__item--danger')}
              onClick={() => {
                popRef.current?.hidePopover();
                item.onSelect();
              }}
            >
              {ItemIcon === undefined ? null : <ItemIcon aria-hidden="true" />}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </span>
  );
}
