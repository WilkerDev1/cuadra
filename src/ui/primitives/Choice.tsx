import { forwardRef, useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { cx, htmlAttrs } from '../lib';

// ── Chip ────────────────────────────────────────────────────────────────────────────────

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** `choice` pastilla seleccionable; `filter` con valor y ×; `info` estático. */
  variant?: 'choice' | 'filter' | 'info';
  /** Solo `choice`: seleccionado (fondo tinta, texto papel; nunca lima). */
  selected?: boolean;
  icon?: LucideIcon;
  /** Solo `filter`: valor del filtro tras la etiqueta («Periodo: Este mes»). */
  value?: ReactNode;
  /** Solo `filter`: quitar el filtro. Muestra el botón ×. */
  onRemove?: () => void;
  /** Punto de tinta (lomo) delante: `var(--tint-3)`. */
  tint?: string;
}

/** Chip de 36px con objetivo táctil de 48px. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { variant = 'choice', selected = false, icon: Icon, value, onRemove, tint, className, children, type = 'button', ...rest },
  ref,
) {
  const t = useT();
  const content = (
    <>
      {tint === undefined ? null : <span className="ui-chip__dot" style={{ background: tint }} aria-hidden="true" />}
      {Icon === undefined ? null : <Icon aria-hidden="true" className="ui-chip__icon" />}
      <span className="ui-chip__label">{children}</span>
      {value === undefined ? null : <span className="ui-chip__value">{value}</span>}
    </>
  );
  if (variant === 'info') {
    return <span className={cx('ui-chip', 'ui-chip--info', className)}>{content}</span>;
  }
  if (variant === 'filter') {
    return (
      <span className={cx('ui-chip', 'ui-chip--filter', className)}>
        <button ref={ref} type={type} className="ui-chip__main" {...rest}>
          {content}
        </button>
        {onRemove === undefined ? null : (
          <button type="button" className="ui-chip__remove" aria-label={t('ui.remove', { name: typeof children === 'string' ? children : '' })} onClick={onRemove}>
            <X aria-hidden="true" />
          </button>
        )}
      </span>
    );
  }
  return (
    <button ref={ref} type={type} aria-pressed={selected} className={cx('ui-chip', 'ui-chip--choice', className)} {...rest}>
      {content}
    </button>
  );
});

// ── Segmented ───────────────────────────────────────────────────────────────────────────

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: LucideIcon;
  /** Color del subrayado del activo (p. ej. `var(--out)` para salida). */
  tone?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  /** Nombre accesible del grupo. */
  label: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Ocupa todo el ancho, segmentos iguales. */
  fullWidth?: boolean;
  className?: string;
}

/** Control segmentado de 2 a 4 opciones; `role="radiogroup"` con flechas. */
export function Segmented<V extends string>({ label, options, value, onChange, fullWidth, className }: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    for (let step = 1; step <= options.length; step += 1) {
      const next = (index + dir * step + options.length) % options.length;
      const opt = options[next];
      if (opt !== undefined && opt.disabled !== true) {
        onChange(opt.value);
        refs.current[next]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('ui-seg', fullWidth === true && 'ui-seg--full', className)}>
      {options.map((opt, i) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={opt.disabled}
            className="ui-seg__opt"
            style={opt.tone === undefined ? undefined : ({ '--seg-tone': opt.tone } as CSSProperties)}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {Icon === undefined ? null : <Icon aria-hidden="true" />}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────────────────

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: ReactNode;
  /** Texto de ayuda bajo la etiqueta. */
  description?: ReactNode;
  onChange?: (checked: boolean) => void;
  /** La etiqueta va a la izquierda y el interruptor a la derecha (filas de ajustes). */
  layout?: 'inline' | 'row';
}

/** Interruptor sí/no: `<input type="checkbox" switch>` con `role="switch"` para los navegadores sin él. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, onChange, layout = 'row', className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const descId = `${inputId}-d`;
  return (
    <div className={cx('ui-switch', `ui-switch--${layout}`, className)}>
      <span className="ui-switch__text">
        <label htmlFor={inputId} className="ui-switch__label">
          {label}
        </label>
        {description === undefined ? null : (
          <span id={descId} className="ui-switch__desc">
            {description}
          </span>
        )}
      </span>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        className="ui-switch__input"
        aria-describedby={description === undefined ? undefined : descId}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
        {...htmlAttrs({ switch: true })}
        {...rest}
      />
    </div>
  );
});
