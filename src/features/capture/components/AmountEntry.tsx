// Monto + acciones de guardar, en sus dos formas (DESIGN §10.6): teclado propio en móvil (AmountKeypad, con el
// resto del formulario entre el visor y las teclas) y, en escritorio, un campo de texto con el MISMO parser.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Minor } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AmountKeypad, AmountText, Button, Field, Input, formatExpression, type AmountKeypadHandle } from '../../../ui';
import { useCurrency } from '../hooks';
import { parseAmountText } from '../logic/amount';

export type AmountKind = 'income' | 'expense' | 'transfer' | 'opening';

export interface AmountEntryProps {
  keypad: boolean;
  kind: AmountKind;
  expr: string;
  onExprChange: (expr: string, minor: Minor | null) => void;
  onSubmit: (minor: Minor) => void;
  /** «Guardar y otro» / «+ otro». Sin él no aparece. */
  onAnother?: (minor: Minor) => void;
  submitLabel: string;
  anotherLabel?: string;
  busy?: boolean;
  /** Teclado: quita las teclas para poner un panel en su sitio (lista de cuentas, fecha, más campos). */
  hideKeys?: boolean;
  /**
   * Teclado: oculta las teclas sin quitarles el sitio mientras se escribe el concepto con el teclado del sistema.
   * No cambia el layout al salir del campo: el toque que sigue (p. ej. «+ otro») cae donde se ve.
   */
  dimKeys?: boolean;
  /** Error de guardado en línea (no en un toast). */
  error?: ReactNode;
  /** Texto bajo los botones (avisos suaves). */
  children?: ReactNode;
  /** Monto por encima del formulario en escritorio: se enfoca al abrir (el teclado físico va directo aquí). */
  autoFocus?: boolean;
  /** Pide enfocar el monto (tras «Guardar y otro»). Cambia el número para volver a enfocar. */
  focusSignal?: number;
}

export function AmountEntry(props: AmountEntryProps) {
  return props.keypad ? <KeypadEntry {...props} /> : <FieldEntry {...props} />;
}

function KeypadEntry({ kind, expr, onExprChange, onSubmit, onAnother, submitLabel, busy, hideKeys, dimKeys, error, children, focusSignal }: AmountEntryProps) {
  const currency = useCurrency();
  const ref = useRef<AmountKeypadHandle>(null);
  useEffect(() => {
    if (focusSignal !== undefined && focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);
  return (
    <div className="cap-amount">
      <AmountKeypad
        ref={ref}
        kind={kind}
        currency={currency}
        expression={expr}
        onExpressionChange={onExprChange}
        onSubmit={onSubmit}
        {...(onAnother === undefined ? {} : { onAnother })}
        submitLabel={submitLabel}
        busy={busy === true}
        {...(hideKeys === true ? { hideKeys: 'collapse' as const } : dimKeys === true ? { hideKeys: 'reserve' as const } : {})}
      >
        {children}
        {error === undefined || error === null ? null : (
          <p className="cap-error" role="alert">
            {error}
          </p>
        )}
      </AmountKeypad>
    </div>
  );
}

function FieldEntry({ kind, expr, onExprChange, onSubmit, onAnother, submitLabel, anotherLabel, busy, error, children, autoFocus, focusSignal }: AmountEntryProps) {
  const t = useT('capture');
  const currency = useCurrency();
  const locale = getLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultId = useId();
  const inputId = useId();
  // El texto se guarda tal cual se escribe; la expresión canónica la decide el parser.
  const [text, setText] = useState(() => (expr === '' ? '' : formatExpression(expr, locale)));
  const [touched, setTouched] = useState(false);
  const [zero, setZero] = useState(false);
  const parsed = parseAmountText(text, locale, currency.minorDigits);
  const minor = parsed.status === 'ok' ? parsed.minor : null;

  // Si el formulario vacía o fija el monto desde fuera (Guardar y otro, duplicar), el campo lo refleja.
  const lastExpr = useRef(expr);
  useEffect(() => {
    if (expr !== lastExpr.current && expr !== parsed.expr) {
      setText(expr === '' ? '' : formatExpression(expr, locale));
      setTouched(false);
    }
    lastExpr.current = expr;
  }, [expr, locale, parsed.expr]);
  useEffect(() => {
    if (autoFocus === true) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (focusSignal !== undefined && focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const submit = (another: boolean) => {
    if (busy === true) return;
    if (minor === null || minor <= 0) {
      setTouched(true);
      setZero(true);
      inputRef.current?.focus();
      return;
    }
    if (another) onAnother?.(minor);
    else onSubmit(minor);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    submit(e.shiftKey && onAnother !== undefined);
  };

  const invalid = touched && (parsed.status === 'invalid' || zero);
  const message = parsed.status === 'invalid' ? t('amount.invalid') : t('amount.zero');
  const typed = kind === 'income' || kind === 'expense' ? kind : null;
  const shown = minor ?? 0;
  return (
    <div className="cap-form" onKeyDown={onKey}>
      <output id={resultId} className="cap-form__result" aria-live="polite" htmlFor={inputId}>
        <span className="cap-form__expr num" aria-hidden={!(parsed.status === 'ok' && parsed.hasOps)}>
          {parsed.status === 'ok' && parsed.hasOps ? formatExpression(parsed.expr, locale) : ' '}
        </span>
        <AmountText minor={shown} size="hero" {...(typed !== null && shown > 0 ? { kind: typed } : { neutral: true })} currency={currency} />
      </output>
      <Field id={inputId} label={t('amount.label')} {...(invalid ? { error: message } : {})}>
        <Input
          ref={inputRef}
          className="cap-form__amount num"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          placeholder={t('amount.placeholder')}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setText(v);
            setZero(false);
            const p = parseAmountText(v, locale, currency.minorDigits);
            onExprChange(p.expr, p.status === 'ok' ? p.minor : null);
          }}
          onBlur={() => setTouched(text.trim() !== '')}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
            // Enter en el monto guarda, salvo mientras un IME compone (ime-safe-enter-submit).
            e.preventDefault();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            submit(false);
          }}
        />
      </Field>
      {children}
      {error === undefined || error === null ? null : (
        <p className="cap-error" role="alert">
          {error}
        </p>
      )}
      <div className="cap-form__actions">
        <Button variant="primary" onClick={() => submit(false)} loading={busy === true} aria-keyshortcuts="Control+Enter">
          {submitLabel}
        </Button>
        {onAnother === undefined ? null : (
          <Button variant="secondary" onClick={() => submit(true)} disabled={busy === true} aria-keyshortcuts="Control+Shift+Enter">
            {anotherLabel ?? t('saveAnother')}
          </Button>
        )}
      </div>
      <p className="cap-form__keys">{onAnother === undefined ? t('keys.save') : t('keys.saveAnother')}</p>
    </div>
  );
}

