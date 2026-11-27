// Elegir cuenta: chips (escritorio) o lista con saldo en el sitio del teclado (móvil, DESIGN §10.6 punto 4).
import { Check } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { AccountWithBalance, Id } from '../../../core';
import { ACCOUNT_ICON, AmountText, Chip, cx } from '../../../ui';
import { useCurrency } from '../hooks';

export interface AccountPickerProps {
  accounts: readonly AccountWithBalance[];
  value: Id | null;
  onChange: (id: Id) => void;
  label: string;
  variant?: 'chips' | 'list';
  /** Cuentas que no se pueden elegir (la del otro lado de una transferencia no se oculta: se intercambia). */
  disabledIds?: ReadonlySet<Id>;
}

/** Grupo de botones conmutables (uno elegido, `aria-pressed`), con flechas para recorrerlo. */
export function AccountPicker({ accounts, value, onChange, label, variant = 'chips', disabledIds }: AccountPickerProps) {
  const currency = useCurrency();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = accounts.filter((a) => a.archivedAt === null);
  const onKey = (e: KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + active.length) % active.length;
    const a = active[next];
    if (a === undefined) return;
    onChange(a.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="group" aria-label={label} className={cx('cap-accounts', `cap-accounts--${variant}`)}>
      {active.map((a, i) => {
        const Icon = ACCOUNT_ICON[a.type];
        const selected = a.id === value;
        const common = {
          ref: (el: HTMLButtonElement | null) => {
            refs.current[i] = el;
          },
          disabled: disabledIds?.has(a.id) === true,
          onClick: () => onChange(a.id),
          onKeyDown: (e: KeyboardEvent) => onKey(e, i),
        } as const;
        if (variant === 'chips') {
          return (
            <Chip key={a.id} {...common} selected={selected} icon={Icon}>
              {a.name}
            </Chip>
          );
        }
        return (
          <button key={a.id} type="button" className="cap-accounts__row" aria-pressed={selected} {...common}>
            <Icon aria-hidden="true" className="cap-accounts__icon" />
            <span className="cap-accounts__name truncate">{a.name}</span>
            <AmountText minor={a.balanceMinor} size="row" currency={currency} />
            <Check aria-hidden="true" className="cap-accounts__check" />
          </button>
        );
      })}
    </div>
  );
}
