import { createElement, useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, Info, type LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { cx } from '../lib';

type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
const space = (n: Space) => (n === 0 ? '0' : `var(--s-${n})`);

export interface StackProps extends HTMLAttributes<HTMLElement> {
  /** Separación en pasos de la escala (--s-N). */
  gap?: Space;
  direction?: 'column' | 'row';
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
  as?: 'div' | 'section' | 'ul' | 'ol' | 'header' | 'footer' | 'nav' | 'form';
}

/** Pila flex con separación de la escala de tokens. */
export function Stack({ gap = 4, direction = 'column', align, justify, wrap, as = 'div', className, style, ...rest }: StackProps) {
  return createElement(as, {
    className: cx('ui-stack', className),
    style: {
      ...style,
      flexDirection: direction,
      gap: space(gap),
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap === true ? 'wrap' : undefined,
    },
    ...rest,
  });
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `plain` hoja con sombra, `forest` tarjeta de saldo, `sunken` hundida. Nunca anidar Card en Card. */
  variant?: 'plain' | 'forest' | 'sunken';
  as?: 'div' | 'section' | 'article';
}

/** Tarjeta: superficie con radio --r-2. */
export function Card({ variant = 'plain', as = 'div', className, ...rest }: CardProps) {
  return createElement(as, { className: cx('ui-card', `ui-card--${variant}`, className), ...rest });
}

export interface BannerProps {
  /** `info` neutro; `warn` aviso (respaldo atrasado, error bloqueante con texto). */
  tone?: 'info' | 'warn';
  title?: ReactNode;
  children?: ReactNode;
  /** Acción a la derecha (normalmente un Button). */
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/** Aviso en línea, persistente. Para errores que exigen acción (nunca un toast). */
export function Banner({ tone = 'info', title, children, action, icon, className }: BannerProps) {
  const Icon = icon ?? (tone === 'warn' ? CircleAlert : Info);
  return (
    <div className={cx('ui-banner', `ui-banner--${tone}`, className)} role={tone === 'warn' ? 'alert' : 'note'}>
      <Icon aria-hidden="true" className="ui-banner__icon" />
      <div className="ui-banner__body">
        {title === undefined ? null : <p className="ui-banner__title">{title}</p>}
        {children === undefined ? null : <div className="ui-banner__text">{children}</div>}
      </div>
      {action === undefined ? null : <div className="ui-banner__action">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  /** `first-use` primer uso; `no-results` filtros sin resultados. */
  variant?: 'first-use' | 'no-results';
  /** Una sola frase, sobre el segundo renglón. */
  message: ReactNode;
  action?: ReactNode;
  /** Renglones de fondo (por defecto 5). */
  rows?: number;
}

/** Estado vacío: renglones vacíos, una frase y una acción. Sin ilustraciones. */
export function EmptyState({ variant = 'first-use', message, action, rows = 5 }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', 'ruled', `ui-empty--${variant}`)} style={{ '--rows': rows } as CSSProperties}>
      <p className="ui-empty__msg">{message}</p>
      {action === undefined ? null : <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export interface SkeletonProps {
  /** Milisegundos antes de mostrar el texto (DESIGN §15: solo si tarda más de 300ms). */
  delay?: number;
  /** Texto a mostrar; por defecto «Abriendo el libro…». */
  label?: string;
  /** Renglones vacíos que reservan el espacio del contenido. */
  rows?: number;
}

/** Marcador de carga sin shimmer: renglones quietos y un texto tras 300ms. */
export function Skeleton({ delay = 300, label, rows = 3 }: SkeletonProps) {
  const t = useT();
  const [show, setShow] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const id = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(id);
  }, [delay]);
  return (
    <div className="ui-skeleton ruled" style={{ '--rows': rows } as CSSProperties} aria-busy="true">
      <p className="ui-skeleton__label" role="status" data-visible={show || undefined}>
        {show ? (label ?? t('ui.openingBook')) : ''}
      </p>
    </div>
  );
}
