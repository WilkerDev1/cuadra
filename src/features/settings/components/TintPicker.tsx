// Selector de tinta (DESIGN §6): ocho muestras como grupo de opciones, con flechas; la tinta nunca va sola
// (la elegida lleva marca y nombre accesible).
import { Check } from 'lucide-react';
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useT } from '../../../i18n';
import { TINTS, tintNumber } from '../lib/tint';

export interface TintPickerProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Ofrece «Automática» (sin tinta fija). */
  allowNone?: boolean;
}

export function TintPicker({ label, value, onChange, allowNone = false }: TintPickerProps) {
  const t = useT('settings');
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const choices: Array<string | null> = allowNone ? [null, ...TINTS] : [...TINTS];
  const current = tintNumber(value) === null ? null : (value as string);
  const selectedIndex = Math.max(0, choices.indexOf(current));

  const onKey = (e: KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + choices.length) % choices.length;
    onChange(choices[next] ?? null);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="set-tints">
      {choices.map((choice, i) => {
        const checked = i === selectedIndex && (choice === current);
        const n = tintNumber(choice);
        return (
          <button
            key={choice ?? 'none'}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={n === null ? t('space.colorAuto') : t('space.colorN', { n })}
            tabIndex={i === selectedIndex ? 0 : -1}
            className={choice === null ? 'set-tint set-tint--auto' : 'set-tint'}
            style={n === null ? undefined : ({ '--set-tint': `var(--tint-${n})` } as CSSProperties)}
            onClick={() => onChange(choice)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {choice === null ? <span aria-hidden="true">{t('space.colorAuto')}</span> : checked ? <Check aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
