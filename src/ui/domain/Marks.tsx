import { useEffect, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  CircleDashed,
  CreditCard,
  Landmark,
  PiggyBank,
  Scale,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AccountType, Currency, Minor, TxKind } from '../../core/types';
import { useT } from '../../i18n';
import { cx, vibrate } from '../lib';
import { AmountText } from './AmountText';

// ── Sello de cuadre / ANULADO (§11.1, §11.5) ───────────────────────────────────────────

export interface StampProps {
  /** `cuadra` cuadrado de cuatro trazos con relleno lima; `anulado` recuadro rotado en --void. */
  variant?: 'cuadra' | 'anulado';
  /** Dibuja el sello (lado a lado y luego el relleno) y vibra. Sin animación con movimiento reducido. */
  animate?: boolean;
  /** Lado del sello `cuadra` (CSS), por defecto 3rem. */
  size?: string;
  /** Texto accesible; por defecto «Cuadra» / «Anulado». */
  label?: string;
  className?: string;
}

/** La firma de la marca: se dibuja cuando algo cuadra. También es el logotipo. */
export function Stamp({ variant = 'cuadra', animate = false, size = '3rem', label, className }: StampProps) {
  const t = useT();
  useEffect(() => {
    if (animate && variant === 'cuadra') vibrate([6, 40, 10]);
  }, [animate, variant]);
  if (variant === 'anulado') {
    return (
      <span className={cx('ui-stamp-void', className)} role="img" aria-label={label ?? t('ui.stamp.voided')}>
        <span aria-hidden="true">{t('ui.stamp.voided')}</span>
      </span>
    );
  }
  return (
    <svg
      className={cx('ui-stamp', animate && 'ui-stamp--animate', className)}
      style={{ inlineSize: size, blockSize: size } as CSSProperties}
      viewBox="0 0 40 40"
      role="img"
      aria-label={label ?? t('ui.stamp.squared')}
    >
      <rect className="ui-stamp__fill" x="4" y="4" width="32" height="32" />
      <path className="ui-stamp__side" style={{ '--i': 0 } as CSSProperties} d="M4 4 H36" pathLength={1} />
      <path className="ui-stamp__side" style={{ '--i': 1 } as CSSProperties} d="M36 4 V36" pathLength={1} />
      <path className="ui-stamp__side" style={{ '--i': 2 } as CSSProperties} d="M36 36 H4" pathLength={1} />
      <path className="ui-stamp__side" style={{ '--i': 3 } as CSSProperties} d="M4 36 V4" pathLength={1} />
    </svg>
  );
}

// ── Doble raya (§5.6, §11.3) ────────────────────────────────────────────────────────────

export interface DoubleRuleProps {
  /** `single` subtotal, `double` total. */
  variant?: 'single' | 'double';
  /** Redibuja desde la derecha al cambiar `animateKey` (p. ej. el total). */
  animate?: boolean;
  /** Cambia para volver a dibujar. */
  animateKey?: string | number;
  /** Ancho: por defecto el de la cifra (100% del contenedor en línea). */
  width?: string;
  className?: string;
}

/** Raya simple o doble bajo un total. */
export function DoubleRule({ variant = 'double', animate = false, animateKey, width, className }: DoubleRuleProps) {
  return (
    <span
      key={animate ? animateKey : undefined}
      className={cx('ui-rule', `ui-rule--${variant}`, animate && 'ui-rule--animate', className)}
      style={width === undefined ? undefined : { inlineSize: width }}
      aria-hidden="true"
    />
  );
}

export interface TotalProps {
  /** Etiqueta del total: «Total general». */
  label: ReactNode;
  minor: Minor;
  currency?: Currency;
  /** `double` total de grupo (por defecto), `single` subtotal. */
  variant?: 'single' | 'double';
  notation?: 'sign' | 'parens';
  animate?: boolean;
}

/** Fila de total: etiqueta a la izquierda y cifra con su raya a la derecha. */
export function Total({ label, minor, currency, variant = 'double', notation = 'sign', animate }: TotalProps) {
  return (
    <div className={cx('ui-total', `ui-total--${variant}`)}>
      <span className="ui-total__label">{label}</span>
      <span className="ui-total__value">
        <AmountText minor={minor} size="m" notation={notation} rule={variant} animate={animate === true} {...(currency === undefined ? {} : { currency })} />
      </span>
    </div>
  );
}

// ── Tipo de movimiento ──────────────────────────────────────────────────────────────────

export const KIND_ICON: Record<TxKind, LucideIcon> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  opening: Scale,
};
export const KIND_TONE: Record<TxKind, string> = {
  income: 'var(--in)',
  expense: 'var(--out)',
  transfer: 'var(--xfer)',
  opening: 'var(--ink-2)',
};

export interface KindBadgeProps {
  kind: TxKind;
  /** Solo icono (con nombre accesible). */
  iconOnly?: boolean;
  /** Variante grande con ancho expresivo (la palabra del tipo en Nuevo movimiento). */
  size?: 'sm' | 'lg';
  className?: string;
}

/** Glifo + palabra del tipo, en su color: el color nunca va solo. */
export function KindBadge({ kind, iconOnly = false, size = 'sm', className }: KindBadgeProps) {
  const t = useT();
  const Icon = KIND_ICON[kind];
  const text = t(`ui.kind.${kind}`);
  return (
    <span className={cx('ui-kind', `ui-kind--${kind}`, `ui-kind--${size}`, className)} aria-label={iconOnly ? text : undefined} role={iconOnly ? 'img' : undefined}>
      <Icon aria-hidden="true" />
      {iconOnly ? null : <span>{text}</span>}
    </span>
  );
}

// ── Cuenta ──────────────────────────────────────────────────────────────────────────────

export const ACCOUNT_ICON: Record<AccountType, LucideIcon> = {
  cash: Wallet,
  bank: Landmark,
  card: CreditCard,
  savings: PiggyBank,
  wallet: Smartphone,
  other: CircleDashed,
};

export interface AccountChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  name: string;
  /** Tipo de cuenta: decide el icono. */
  accountType: AccountType;
  /** Saldo actual; se muestra si existe. */
  balanceMinor?: Minor;
  currency?: Currency;
  /** `chip` en línea con ▾ (chips de contexto); `card` ficha de 148px (tira de cuentas, Desde/Hacia). */
  variant?: 'chip' | 'card';
  /** Rótulo encima en la ficha: «Desde», «Hacia». */
  caption?: string;
  /** Contenido extra en la ficha (sparkline). */
  extra?: ReactNode;
  /** Cuenta archivada: gris. */
  archived?: boolean;
}

/** Chip o ficha de cuenta con icono del tipo, nombre y saldo. */
export function AccountChip({ name, accountType: type, balanceMinor, currency, variant = 'chip', caption, extra, archived, className, ...rest }: AccountChipProps) {
  const t = useT();
  const Icon = ACCOUNT_ICON[type];
  const cur = currency === undefined ? {} : { currency };
  if (variant === 'card') {
    return (
      <button type="button" className={cx('ui-acct', 'ui-acct--card', archived === true && 'is-archived', className)} {...rest}>
        {caption === undefined ? null : <span className="ui-acct__caption">{caption}</span>}
        <span className="ui-acct__head">
          <Icon aria-hidden="true" />
          <span className="ui-acct__name truncate">{name}</span>
        </span>
        <span className="visually-hidden">{t(`ui.account.${type}`)}</span>
        {balanceMinor === undefined ? null : <AmountText minor={balanceMinor} size="m" {...cur} />}
        {extra}
      </button>
    );
  }
  return (
    <button type="button" className={cx('ui-chip', 'ui-chip--choice', 'ui-acct', archived === true && 'is-archived', className)} {...rest}>
      <Icon aria-hidden="true" className="ui-chip__icon" />
      <span className="ui-chip__label">{name}</span>
      {balanceMinor === undefined ? null : <AmountText minor={balanceMinor} size="row" {...cur} />}
      <ChevronDown aria-hidden="true" className="ui-chip__icon" />
    </button>
  );
}
