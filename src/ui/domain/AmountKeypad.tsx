import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Delete, Plus } from 'lucide-react';
import type { Currency, Minor, TxKind } from '../../core/types';
import { useT } from '../../i18n';
import { getLocale } from '../../i18n/format';
import { cx, vibrate } from '../lib';
import { AmountText, DEFAULT_CURRENCY } from './AmountText';
import { appendKey, evaluateExpression, formatExpression, localeSeparators, sanitizePastedAmount, type KeypadKey } from './amountLogic';
import { KIND_TONE } from './Marks';

export interface AmountKeypadHandle {
  /** Enfoca el campo real (teclado físico y lector de pantalla). */
  focus: () => void;
  /** Vacía la expresión. */
  clear: () => void;
}

export interface AmountKeypadProps {
  /** `amount` Nuevo movimiento; `opening` saldos iniciales (sin «+ otro»). */
  variant?: 'amount' | 'opening';
  kind?: TxKind;
  currency?: Currency;
  locale?: string;
  /** Expresión canónica (`1500+350`). Controlada si se pasa. */
  expression?: string;
  onExpressionChange?: (expression: string, result: Minor | null) => void;
  /** Guardar con el monto resultante (> 0). */
  onSubmit: (minor: Minor) => void;
  /** «+ otro»: guarda y deja la hoja abierta (Ráfaga). Si falta, la tecla no aparece. */
  onAnother?: (minor: Minor) => void;
  /** Texto del botón principal; por defecto «Anotar salida»/«Anotar entrada»/«Transferir». */
  submitLabel?: string;
  /** Mostrar el visor de monto encima de las teclas (por defecto sí). */
  showDisplay?: boolean;
  /** Palabra del tipo a la izquierda del visor. */
  showKindWord?: boolean;
  /** Contenido entre el visor y las teclas (concepto, chips de contexto…). */
  children?: ReactNode;
  /** Usar el teclado del sistema (`inputmode="decimal"`) en lugar del propio (Ajustes, accesibilidad). */
  systemKeyboard?: boolean;
  /**
   * Oculta las teclas (el campo sigue): `collapse` las quita del flujo (un panel ocupa su sitio); `reserve` las deja
   * invisibles conservando su alto (sin saltos al alternar).
   */
  hideKeys?: 'collapse' | 'reserve';
  /** Guardando: bloquea el envío. */
  busy?: boolean;
  /** Etiqueta del campo para lectores de pantalla. */
  label?: string;
}

type KeyDef = { key: KeypadKey; text: ReactNode; aria: string; kind?: 'op' | 'del' };

/** Teclado numérico propio 4×4 con aritmética (+ − ×), campo real `inputmode="none"` y respuesta táctil. */
export const AmountKeypad = forwardRef<AmountKeypadHandle, AmountKeypadProps>(function AmountKeypad(
  {
    variant = 'amount',
    kind = 'expense',
    currency = DEFAULT_CURRENCY,
    locale,
    expression,
    onExpressionChange,
    onSubmit,
    onAnother,
    submitLabel,
    showDisplay = true,
    showKindWord = true,
    children,
    systemKeyboard = false,
    hideKeys,
    busy = false,
    label,
  },
  ref,
) {
  const t = useT();
  const loc = locale ?? getLocale();
  const digits = currency.minorDigits;
  const { decimal } = localeSeparators(loc);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const msgId = useId();
  const [inner, setInner] = useState('');
  const expr = expression ?? inner;
  const [lastValid, setLastValid] = useState<Minor>(0);
  const [shake, setShake] = useState(0);
  const [zeroMsg, setZeroMsg] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const pointerFired = useRef(false);

  const result = evaluateExpression(expr, digits);
  const minor = result.ok ? result.minor : lastValid;
  useEffect(() => {
    if (result.ok) setLastValid(result.minor);
  }, [result.ok, result.ok ? result.minor : 0]);

  const update = (next: string) => {
    if (expression === undefined) setInner(next);
    const r = evaluateExpression(next, digits);
    onExpressionChange?.(next, r.ok ? r.minor : null);
    if (zeroMsg) setZeroMsg(false);
  };
  const press = (key: KeypadKey) => {
    vibrate(8);
    update(appendKey(expr, key, digits));
  };
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), clear: () => update('') }));

  const submit = (another: boolean) => {
    if (busy) return;
    if (minor <= 0) {
      setShake((n) => n + 1);
      setZeroMsg(true);
      vibrate([10, 30, 10]);
      inputRef.current?.focus();
      return;
    }
    if (another) onAnother?.(minor);
    else onSubmit(minor);
  };

  const onPhysicalKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (systemKeyboard) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit(e.ctrlKey && e.shiftKey);
      }
      return;
    }
    const map: Record<string, KeypadKey> = { '+': '+', '-': '-', '*': '*', x: '*', X: '*', Backspace: 'backspace', Delete: 'clear', Escape: 'clear' };
    let k: KeypadKey | undefined = map[e.key];
    if (/^[0-9]$/.test(e.key)) k = e.key as KeypadKey;
    if (e.key === decimal || e.key === '.' || e.key === ',') k = '.';
    if (e.key === 'Enter') {
      e.preventDefault();
      submit(e.ctrlKey && e.shiftKey);
      return;
    }
    if (k === undefined || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (k === 'clear' && expr === '') return;
    press(k);
  };

  const keyDown = (key: KeypadKey) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // conserva el foco en el campo real
    pointerFired.current = true;
    press(key);
    if (key === 'backspace') {
      holdTimer.current = window.setTimeout(() => {
        vibrate(20);
        update('');
      }, 500);
    }
  };
  const keyUp = () => window.clearTimeout(holdTimer.current);
  const keyClick = (key: KeypadKey) => () => {
    // Activación por teclado/lector (Enter/Espacio sobre la tecla) sin doble pulsación tras pointerdown.
    if (pointerFired.current) {
      pointerFired.current = false;
      return;
    }
    press(key);
  };

  const keys: KeyDef[] = [
    { key: '7', text: '7', aria: t('ui.keypad.key.7') },
    { key: '8', text: '8', aria: t('ui.keypad.key.8') },
    { key: '9', text: '9', aria: t('ui.keypad.key.9') },
    { key: 'backspace', text: <Delete aria-hidden="true" />, aria: t('ui.keypad.key.backspace'), kind: 'del' },
    { key: '4', text: '4', aria: t('ui.keypad.key.4') },
    { key: '5', text: '5', aria: t('ui.keypad.key.5') },
    { key: '6', text: '6', aria: t('ui.keypad.key.6') },
    { key: '*', text: '×', aria: t('ui.keypad.key.times'), kind: 'op' },
    { key: '1', text: '1', aria: t('ui.keypad.key.1') },
    { key: '2', text: '2', aria: t('ui.keypad.key.2') },
    { key: '3', text: '3', aria: t('ui.keypad.key.3') },
    { key: '+', text: '+', aria: t('ui.keypad.key.plus'), kind: 'op' },
    { key: '00', text: '00', aria: t('ui.keypad.key.00') },
    { key: '0', text: '0', aria: t('ui.keypad.key.0') },
    { key: '.', text: decimal, aria: t('ui.keypad.key.dot') },
    { key: '-', text: '−', aria: t('ui.keypad.key.minus'), kind: 'op' },
  ];
  const label2 = submitLabel ?? t(`ui.keypad.submit.${kind}`);
  const showAnother = variant === 'amount' && onAnother !== undefined;
  const hasOps = /[+\-*]/.test(expr);

  return (
    <div className={cx('ui-keypad', `ui-keypad--${variant}`, `ui-keypad--${kind}`)} style={{ '--kind-tone': KIND_TONE[kind] } as CSSProperties}>
      {showDisplay ? (
        <output className="ui-keypad__display" role="status" aria-live="polite" htmlFor={inputId}>
          <span className="ui-keypad__expr num" aria-hidden={!hasOps}>
            {hasOps ? formatExpression(expr, loc) : ' '}
          </span>
          <span className="ui-keypad__row">
            {showKindWord ? <span className="ui-keypad__kind">{t(`ui.kind.${kind}`)}</span> : null}
            <span key={shake} className={cx('ui-keypad__value', shake > 0 && 'is-shaking')}>
              <AmountText minor={minor} size="hero" highlight={minor > 0} currency={currency} locale={loc} neutral />
            </span>
          </span>
          <span id={msgId} className="ui-keypad__msg" data-visible={zeroMsg || undefined}>
            {zeroMsg ? t('ui.keypad.zero') : ''}
          </span>
        </output>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        className={cx('ui-keypad__input', systemKeyboard && 'is-visible')}
        inputMode={systemKeyboard ? 'decimal' : 'none'}
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label ?? t('ui.keypad.amount')}
        aria-describedby={`${hintId} ${msgId}`}
        aria-invalid={zeroMsg || undefined}
        value={systemKeyboard ? formatExpression(expr, loc) : expr}
        onChange={(e) => {
          if (systemKeyboard) update(sanitizePastedAmount(e.currentTarget.value, loc, digits));
        }}
        onKeyDown={onPhysicalKey}
        onPaste={(e) => {
          e.preventDefault();
          update(sanitizePastedAmount(e.clipboardData.getData('text'), loc, digits));
        }}
      />
      <span id={hintId} className="visually-hidden">
        {t('ui.keypad.hint')}
      </span>
      {children}
      {systemKeyboard ? null : (
        <div
          className={cx('ui-keypad__keys', hideKeys === 'reserve' && 'ui-keypad__keys--reserve')}
          role="group"
          aria-label={t('ui.keypad.amount')}
          hidden={hideKeys === 'collapse'}
        >
          {keys.map((k) => (
            <button
              key={k.key}
              type="button"
              className={cx('ui-key', k.kind === 'op' && 'ui-key--op', k.kind === 'del' && 'ui-key--del')}
              aria-label={k.aria}
              title={k.kind === 'del' ? t('ui.keypad.key.backspaceHint') : undefined}
              tabIndex={-1}
              onPointerDown={keyDown(k.key)}
              onPointerUp={keyUp}
              onPointerLeave={keyUp}
              onPointerCancel={keyUp}
              onClick={keyClick(k.key)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {k.text}
            </button>
          ))}
        </div>
      )}
      <div className={cx('ui-keypad__actions', !showAnother && 'is-single')}>
        {showAnother ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--key" aria-label={t('ui.keypad.anotherLabel')} onClick={() => submit(true)} disabled={busy}>
            <Plus aria-hidden="true" className="ui-btn__icon" />
            <span className="ui-btn__label">{t('ui.keypad.another').replace('+ ', '')}</span>
          </button>
        ) : null}
        <button type="button" className="ui-btn ui-btn--primary ui-btn--key" onClick={() => submit(false)} disabled={busy} aria-busy={busy || undefined}>
          <span className="ui-btn__label">{label2}</span>
        </button>
      </div>
    </div>
  );
});
