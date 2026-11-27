import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n';
import { Field, IconButton, Input } from '../../../ui';
import { measurePassword } from '../logic/password';

export interface PasswordFieldProps {
  /** Estable entre cargas: los gestores de contraseñas lo usan para recordar el campo. */
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string | undefined;
  help?: ReactNode;
  /** Medidor honesto de longitud bajo el campo (solo contraseñas nuevas). */
  meter?: boolean;
  autoFocus?: boolean;
  enterKeyHint?: 'next' | 'done' | 'go';
  disabled?: boolean;
}

/** Campo de contraseña con «Mostrar/Ocultar» dentro del campo y, si se pide, el medidor de longitud. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { id, label, value, onChange, autoComplete, error, help, meter = false, autoFocus, enterKeyHint, disabled },
  ref,
) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? t('auth.lock.hidePassword') : t('auth.lock.showPassword');
  return (
    <Field
      id={id}
      label={label}
      error={error}
      help={meter ? <PasswordMeter password={value} /> : help}
      className="auth-pw"
    >
      <Input
        ref={ref}
        name={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        autoFocus={autoFocus}
        enterKeyHint={enterKeyHint}
        disabled={disabled}
        suffix={
          <IconButton
            className="auth-pw__toggle"
            icon={visible ? EyeOff : Eye}
            label={toggleLabel}
            aria-pressed={visible}
            aria-controls={id}
            tooltip={false}
            disabled={disabled}
            onClick={() => setVisible((v) => !v)}
          />
        }
      />
    </Field>
  );
});

/** Cuatro tramos por longitud y una frase. No promete «fuerza»: solo cuenta caracteres. */
export function PasswordMeter({ password }: { password: string }) {
  const t = useT();
  const m = measurePassword(password);
  const text =
    m.level === 'empty'
      ? t('auth.meter.empty')
      : m.level === 'short'
        ? t('auth.meter.short', { count: m.missing })
        : t(`auth.meter.${m.level}`, { count: m.length });
  return (
    <span className="auth-meter" data-level={m.level}>
      <span className="auth-meter__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="auth-meter__seg" data-on={i <= m.filled || undefined} />
        ))}
      </span>
      <span className="auth-meter__text">
        {text} <span className="auth-meter__note">{t('auth.meter.note')}</span>
      </span>
      {/* Solo cambia 4 veces (por tramo): anunciar cada tecla sería ruido. */}
      <span className="visually-hidden" aria-live="polite">
        {m.level === 'empty' ? '' : t(`auth.meter.level.${m.level}`)}
      </span>
    </span>
  );
}
