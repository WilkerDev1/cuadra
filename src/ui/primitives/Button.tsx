import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { cx, htmlAttrs, supports } from '../lib';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-forest';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` (lima) solo una vez por vista. */
  variant?: ButtonVariant;
  /** `pill`: radio de pastilla (solo el botón Anotar). `key`: alto de tecla (64px). */
  shape?: 'default' | 'pill' | 'key';
  /** Icono a la izquierda del texto. */
  icon?: LucideIcon;
  /** Mantiene el texto y añade un spinner; bloquea el botón. */
  loading?: boolean;
  /** Motivo visible de por qué está deshabilitado (DESIGN §9: nunca deshabilitar sin explicación). */
  disabledReason?: string;
  fullWidth?: boolean;
}

/** Botón base con variantes, estados de carga y deshabilitado explicado. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', shape = 'default', icon: Icon, loading = false, disabledReason, fullWidth, className, children, disabled, type = 'button', 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const t = useT();
  const reasonId = useId();
  const isDisabled = disabled === true || loading;
  const showReason = disabled === true && disabledReason !== undefined;
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, shape !== 'default' && `ui-btn--${shape}`, fullWidth === true && 'ui-btn--full', className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
      aria-describedby={showReason ? reasonId : describedBy}
    >
      {loading ? <Spinner label={t('ui.loading')} /> : Icon === undefined ? null : <Icon aria-hidden="true" className="ui-btn__icon" />}
      <span className="ui-btn__label">{children}</span>
    </button>
  );
  if (!showReason) return button;
  return (
    <span className={cx('ui-btn-wrap', fullWidth === true && 'ui-btn-wrap--full')}>
      {button}
      <span id={reasonId} className="ui-btn__reason">
        {disabledReason}
      </span>
    </span>
  );
});

export interface SpinnerProps {
  /** Texto para lectores de pantalla. */
  label: string;
}

/** Indicador de carga de 16px; sin bucle con movimiento reducido. */
export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="ui-spinner" role="status">
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Nombre accesible obligatorio; también es el texto del tooltip. */
  label: string;
  icon: LucideIcon;
  variant?: 'ghost' | 'secondary' | 'on-forest';
  /** Mostrar tooltip con el nombre (por defecto sí). */
  tooltip?: boolean;
  children?: ReactNode;
}

/** Botón de solo icono, 48×48 táctil y 40×40 con ratón, con tooltip `interestfor` o `title`. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = 'ghost', tooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const tipId = useId();
  const hint = tooltip && supports.interestFor();
  return (
    <>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={tooltip && !hint ? label : undefined}
        className={cx('ui-iconbtn', `ui-iconbtn--${variant}`, className)}
        {...htmlAttrs({ interestfor: hint ? tipId : undefined })}
        {...rest}
      >
        <Icon aria-hidden="true" />
      </button>
      {hint ? (
        <span id={tipId} className="ui-tooltip" {...htmlAttrs({ popover: 'hint' })}>
          {label}
        </span>
      ) : null}
    </>
  );
});
