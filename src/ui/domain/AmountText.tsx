import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { Currency, Minor, TxKind } from '../../core/types';
import { useT } from '../../i18n';
import { getLocale } from '../../i18n/format';
import { cx, prefersReducedMotion } from '../lib';
import { amountParts, type AmountNotation } from './amountLogic';
import { spokenMoney } from './spoken';

export const DEFAULT_CURRENCY: Currency = { code: 'DOP', minorDigits: 2, symbol: 'RD$' };

export type AmountSize = 'hero' | 'l' | 'm' | 'row' | 'table';

export interface AmountTextProps {
  /** Entero en unidad menor. Con `kind` llega positivo; sin `kind` es un saldo con signo. */
  minor: Minor;
  currency?: Currency;
  locale?: string;
  /** Tamaño: `hero` cifra protagonista elástica, `l` saldo de cuenta, `m`, `row` filas, `table` tablas. */
  size?: AmountSize;
  /** `sign` (móvil y listas), `parens` (tablas e informes: negativos entre paréntesis), `columns` (Entra/Sale sin signo). */
  notation?: 'sign' | 'parens' | 'columns';
  /** Tipo del movimiento: decide signo, glifo y color. */
  kind?: TxKind;
  /** Tachado en --ink-3; sigue visible y no suma. */
  voided?: boolean;
  /** Trazo de resaltador bajo la cifra. Solo una instancia por pantalla. */
  highlight?: boolean;
  /** Cuenta del valor anterior al nuevo en --d-count. */
  animate?: boolean;
  /** Sobre el bosque: símbolo en --on-forest-2 y cifra en --on-forest. */
  onForest?: boolean;
  /** Sin color de tipo (p. ej. totales neutros). */
  neutral?: boolean;
  /** Mostrar el símbolo de moneda (por defecto sí; tablas con la moneda en la cabecera: no). */
  symbol?: boolean;
  /** Lectura completa para lectores de pantalla; por defecto se genera en palabras. */
  label?: string;
  className?: string;
  /** Raya bajo la cifra: `single` subtotal, `double` total (§5.6). */
  rule?: 'none' | 'single' | 'double';
}

let highlightCount = 0;

function useCountUp(target: Minor, enabled: boolean): Minor {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!enabled || prefersReducedMotion() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--d-count')) || 600;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      setShown(p >= 1 ? target : Math.round(a + (target - a) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, enabled]);
  return shown;
}

/** Toda cifra de dinero de la app: signo antes que color, tabular, nunca truncada, leída en palabras. */
export function AmountText({
  minor,
  currency = DEFAULT_CURRENCY,
  locale,
  size = 'row',
  notation = 'sign',
  kind,
  voided = false,
  highlight = false,
  animate = false,
  onForest = false,
  neutral = false,
  symbol = true,
  label,
  className,
  rule = 'none',
}: AmountTextProps) {
  const t = useT();
  const loc = locale ?? getLocale();
  const shown = useCountUp(minor, animate);
  const mode: AmountNotation = notation === 'columns' ? 'plain' : notation;
  const parts = amountParts(shown, { locale: loc, currency, kind, notation: mode, symbol });
  const finalParts = shown === minor ? parts : amountParts(minor, { locale: loc, currency, kind, notation: mode, symbol });

  useEffect(() => {
    if (!highlight) return;
    highlightCount += 1;
    if (import.meta.env.DEV && highlightCount > 1) {
      console.warn('[ui] Más de un AmountText con highlight en pantalla: el resaltador va una sola vez (DESIGN §6).');
    }
    return () => {
      highlightCount -= 1;
    };
  }, [highlight]);

  const tone = neutral
    ? 'neutral'
    : kind === 'income'
      ? 'in'
      : kind === 'expense'
        ? 'out'
        : kind === 'transfer'
          ? 'xfer'
          : kind === 'opening'
            ? 'opening'
            : minor < 0
              ? 'out'
              : 'neutral';

  const spoken = spokenMoney(kind === undefined ? minor : Math.abs(minor), currency);
  const aria =
    label ??
    (() => {
      const base = kind === undefined ? spoken : t(`ui.spoken.${kind}`, { amount: spoken });
      return voided ? t('ui.spoken.voided', { amount: base }) : base;
    })();

  const anatomy = size === 'hero' || size === 'l';
  return (
    <span
      className={cx(
        'ui-amount',
        `ui-amount--${size}`,
        `ui-amount--${tone}`,
        voided && 'ui-amount--voided',
        highlight && 'ui-amount--hl',
        onForest && 'ui-amount--forest',
        rule !== 'none' && `ui-amount--rule-${rule}`,
        className,
      )}
      style={{ '--chars': finalParts.chars } as CSSProperties}
      role="img"
      aria-label={aria}
      data-amount=""
    >
      <span className="ui-amount__figure" aria-hidden="true" key={highlight ? minor : undefined}>
        {kind === 'transfer' && notation === 'sign' ? <ArrowLeftRight className="ui-amount__glyph" /> : null}
        {parts.parens ? <span className="ui-amount__paren">(</span> : null}
        {parts.sign === '' ? null : <span className="ui-amount__sign">{parts.sign}</span>}
        {parts.symbol === '' ? null : <span className="ui-amount__symbol">{parts.symbol}</span>}
        <span className="ui-amount__int">{parts.integer}</span>
        {parts.fraction === '' ? null : (
          <span className={cx('ui-amount__frac', anatomy && 'ui-amount__frac--sup')}>
            {parts.decimal}
            {parts.fraction}
          </span>
        )}
        {parts.parens ? <span className="ui-amount__paren">)</span> : null}
      </span>
    </span>
  );
}

/** Alias de `AmountText` (nombre del contrato de ARCHITECTURE.md). */
export const MoneyText = AmountText;
export type MoneyTextProps = AmountTextProps;
