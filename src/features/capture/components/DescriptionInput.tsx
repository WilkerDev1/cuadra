// Concepto con sugerencias de conceptos recientes (`transactions.suggestDescriptions`) como chips debajo.
import { forwardRef, useState } from 'react';
import { useT } from '../../../i18n';
import { Chip, Field, Input } from '../../../ui';
import { useSuggestions, type DescriptionSuggestion } from '../hooks';
import { visibleSuggestions } from '../logic/entry';

export interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  onPick: (s: DescriptionSuggestion) => void;
  kind: 'income' | 'expense';
  label?: string;
  placeholder?: string;
  error?: string | null;
  /** Enter: en móvil devuelve el teclado propio. */
  onDone?: () => void;
  onFocusChange?: (focused: boolean) => void;
  /**
   * Mostrar sugerencias también sin foco ni texto (escritorio). En móvil salen al enfocar y se quedan mientras haya
   * texto: así salir del campo no mueve lo de abajo (el toque siguiente cae donde se ve).
   */
  suggestWhenIdle?: boolean;
}

export const DescriptionInput = forwardRef<HTMLInputElement, DescriptionInputProps>(function DescriptionInput(
  { value, onChange, onPick, kind, label, placeholder, error, onDone, onFocusChange, suggestWhenIdle = true },
  ref,
) {
  const t = useT('capture');
  const [focused, setFocused] = useState(false);
  const all = useSuggestions(value, kind);
  const chips = suggestWhenIdle || focused || value.trim() !== '' ? visibleSuggestions(all, value, 3) : [];
  return (
    <div className="cap-desc">
      <Field label={label ?? t('description.label')} {...(error === null || error === undefined ? {} : { error })}>
        <Input
          ref={ref}
          value={value}
          placeholder={placeholder ?? t('description.placeholder')}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => onChange(e.currentTarget.value)}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || onDone === undefined) return;
            e.preventDefault();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            onDone();
          }}
        />
      </Field>
      {chips.length === 0 ? null : (
        <div className="cap-chips cap-chips--scroll" role="group" aria-label={t('description.suggestions')} data-focused={focused || undefined}>
          {chips.map((s) => (
            <Chip
              key={s.description}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              className="cap-chip--suggest"
            >
              {s.description}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
});
