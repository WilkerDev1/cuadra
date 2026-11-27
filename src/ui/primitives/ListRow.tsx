import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { cx } from '../lib';

export interface RowAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** `danger` para Anular. */
  tone?: 'default' | 'danger';
  onSelect: () => void;
}

export interface ListRowProps {
  /** Concepto, en una línea con elipsis (el monto nunca se trunca). */
  title: ReactNode;
  /** Meta en --ink-3: «Materiales · Caja · n.º 0142». */
  meta?: ReactNode;
  /** Columna derecha: normalmente un AmountText row. */
  trailing?: ReactNode;
  /** Bajo el monto: saldo corrido en --ink-3. */
  trailingMeta?: ReactNode;
  /** Icono a la izquierda (tipo de cuenta, tipo de campo). */
  icon?: LucideIcon;
  /** Concepto tachado y mini-etiqueta «Anulado». */
  voided?: boolean;
  /** Inactivo (campo desactivado, cuenta archivada): en --ink-3. */
  muted?: boolean;
  /** Fila seleccionada (borde izquierdo 2px tinta). */
  selected?: boolean;
  /** Tocar la fila abre el detalle. */
  onOpen?: () => void;
  /** Acciones al deslizar a la izquierda; también accesibles con el botón ⋯. */
  actions?: readonly RowAction[];
  /** Nombre corto para «Más acciones de …» (por defecto el título si es texto). */
  name?: string;
  className?: string;
}

/** Fila de libro de alto `--fila` con acciones al deslizar (scroll-snap) y alternativa ⋯ visible. */
export function ListRow({ title, meta, trailing, trailingMeta, icon: Icon, voided, muted, selected, onOpen, actions, name, className }: ListRowProps) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const hasActions = actions !== undefined && actions.length > 0;
  const label = name ?? (typeof title === 'string' ? title : '');

  useEffect(() => {
    const el = scroller.current;
    if (el === null || !hasActions) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = panel.current?.offsetWidth ?? 0;
        setRevealed(w > 0 && Math.abs(el.scrollLeft) > w / 2);
      });
    };
    el.addEventListener('scroll', sync, { passive: true });
    return () => {
      el.removeEventListener('scroll', sync);
      cancelAnimationFrame(frame);
    };
  }, [hasActions]);

  const toggle = () => {
    const el = scroller.current;
    if (el === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: revealed ? 0 : el.scrollWidth, behavior: reduce ? 'auto' : 'smooth' });
    setRevealed(!revealed);
    if (!revealed) requestAnimationFrame(() => panel.current?.querySelector('button')?.focus());
  };

  const content = (
    <>
      {Icon === undefined ? null : <Icon aria-hidden="true" className="ui-row__icon" />}
      <span className="ui-row__text">
        <span className="ui-row__title truncate">
          {title}
          {voided === true ? <span className="ui-row__void">{t('ui.kind.voided')}</span> : null}
        </span>
        {meta === undefined ? null : <span className="ui-row__meta truncate">{meta}</span>}
      </span>
      {trailing === undefined && trailingMeta === undefined ? null : (
        <span className="ui-row__trail">
          {trailing}
          {trailingMeta === undefined ? null : <span className="ui-row__trail-meta num">{trailingMeta}</span>}
        </span>
      )}
    </>
  );

  return (
    <div
      ref={scroller}
      className={cx('ui-row-swipe', hasActions && 'ui-row-swipe--actions', className)}
      data-voided={voided === true || undefined}
      data-muted={muted === true || undefined}
      data-selected={selected === true || undefined}
    >
      <div
        className="ui-row"
        onFocus={(e) => {
          if (revealed && e.target.matches(':focus-visible') && !panel.current?.contains(e.target)) {
            scroller.current?.scrollTo({ left: 0 });
            setRevealed(false);
          }
        }}
      >
        {onOpen === undefined ? (
          <div className="ui-row__main">{content}</div>
        ) : (
          <button type="button" className="ui-row__main" onClick={onOpen}>
            {content}
          </button>
        )}
        {hasActions ? (
          <button
            type="button"
            className="ui-row__more ui-iconbtn ui-iconbtn--ghost"
            aria-label={t('ui.moreActions', { name: label })}
            aria-expanded={revealed}
            onClick={toggle}
          >
            <Ellipsis aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {hasActions ? (
        <div ref={panel} className="ui-row-swipe__panel" role="group" aria-label={t('ui.actions')}>
          {actions.map((a) => {
            const AIcon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                tabIndex={revealed ? 0 : -1}
                className={cx('ui-row-swipe__action', a.tone === 'danger' && 'ui-row-swipe__action--danger')}
                aria-label={`${a.label}: ${label}`}
                onClick={() => {
                  a.onSelect();
                  scroller.current?.scrollTo({ left: 0 });
                  setRevealed(false);
                }}
              >
                {AIcon === undefined ? null : <AIcon aria-hidden="true" />}
                <span aria-hidden="true">{a.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface LedgerListProps {
  children: ReactNode;
  /** Nombre accesible de la lista. */
  label?: string;
  className?: string;
}

/** Contenedor con renglones de fondo atados a `--fila`. */
export function LedgerList({ children, label, className }: LedgerListProps) {
  return (
    <div role="list" aria-label={label} className={cx('ui-ledger', 'ruled', className)}>
      {children}
    </div>
  );
}

export interface LedgerDayProps {
  /** «Martes 24 nov». */
  label: ReactNode;
  /** «neto +RD$3,200.00» (normalmente un AmountText row). */
  total?: ReactNode;
  children: ReactNode;
}

/** Grupo de día con cabecera sticky de alto `--fila`. */
export function LedgerDay({ label, total, children }: LedgerDayProps) {
  return (
    <div role="listitem" className="ui-ledger__day">
      <div className="ui-ledger__head">
        <span className="ui-ledger__date">{label}</span>
        {total === undefined ? null : <span className="ui-ledger__total">{total}</span>}
      </div>
      <div role="list">{children}</div>
    </div>
  );
}
