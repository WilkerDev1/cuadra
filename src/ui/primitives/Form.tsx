import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CircleAlert, ChevronsUpDown } from 'lucide-react';
import { useT } from '../../i18n';
import { normalizeForSearch } from './text';
import { cx, htmlAttrs, supports } from '../lib';

// ── Field ───────────────────────────────────────────────────────────────────────────────

interface FieldCtx {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}
const FieldContext = createContext<FieldCtx | null>(null);

/** Ids que un control dentro de `Field` debe usar (los toma solo: Input, Textarea, Select…). */
export function useFieldControl(): FieldCtx | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  /** Etiqueta siempre visible encima (nunca solo placeholder). */
  label: ReactNode;
  /** Ayuda en --ink-3. */
  help?: ReactNode;
  /** Error en --warn-ink con icono; se enlaza con aria-describedby. */
  error?: ReactNode;
  /** Etiqueta secundaria a la derecha («opcional», un InfoTip…). */
  aside?: ReactNode;
  /** id del control; si falta se genera. */
  id?: string;
  children: ReactNode;
  className?: string;
}

/** Envoltorio de campo: etiqueta, control, ayuda y error accesibles. */
export function Field({ label, help, error, aside, id, children, className }: FieldProps) {
  const auto = useId();
  const controlId = id ?? auto;
  const helpId = help === undefined ? undefined : `${controlId}-help`;
  const errorId = error === undefined || error === null || error === false ? undefined : `${controlId}-err`;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  const ctx = useMemo(() => ({ id: controlId, describedBy, invalid: errorId !== undefined }), [controlId, describedBy, errorId]);
  return (
    <div className={cx('ui-field', errorId !== undefined && 'ui-field--invalid', className)}>
      <div className="ui-field__head">
        <label className="ui-field__label" htmlFor={controlId}>
          {label}
        </label>
        {aside === undefined ? null : <span className="ui-field__aside">{aside}</span>}
      </div>
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {errorId === undefined ? null : (
        <p id={errorId} className="ui-field__error">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {help === undefined ? null : (
        <p id={helpId} className="ui-field__help">
          {help}
        </p>
      )}
    </div>
  );
}

function useControlProps(id: string | undefined, describedBy: string | undefined, invalid: boolean | undefined) {
  const ctx = useFieldControl();
  return {
    id: id ?? ctx?.id,
    'aria-describedby': [ctx?.describedBy, describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': invalid === true || ctx?.invalid === true ? true : undefined,
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Texto fijo a la izquierda dentro del campo (p. ej. `RD$`). */
  prefix?: string;
  /** Texto o resultado a la derecha (el `amount` muestra aquí el resultado de la aritmética). */
  suffix?: ReactNode;
  invalid?: boolean;
}

/** Campo de texto de 48/40px. Dentro de `Field` toma id y descripciones solo. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefix, suffix, invalid, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const control = useControlProps(id, describedBy, invalid);
  return (
    <span className={cx('ui-input', className)}>
      {prefix === undefined ? null : (
        <span className="ui-input__prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input ref={ref} className="ui-input__control" {...control} {...rest} />
      {suffix === undefined ? null : <span className="ui-input__suffix">{suffix}</span>}
    </span>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Área de texto que crece con el contenido (`field-sizing: content`, respaldo `rows=3`). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, id, rows = 3, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const control = useControlProps(id, describedBy, invalid);
  return <textarea ref={ref} rows={rows} className={cx('ui-textarea', className)} {...control} {...rest} />;
});

// ── Select nativo ───────────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  /** Opción desactivada: no se ofrece al crear, pero se muestra en gris con «(inactiva)» si es el valor actual. */
  inactive?: boolean;
}

const CREATE = '__ui_create__';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Muestra «+ Crear…» al final; se llama al elegirlo (el valor no cambia). */
  onCreate?: () => void;
  /** Texto de la opción vacía; si falta no hay opción vacía. */
  placeholder?: string;
  invalid?: boolean;
}

/** Select nativo (móvil). Las opciones inactivas solo aparecen si son el valor actual. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, value, onChange, onCreate, placeholder, invalid, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const t = useT();
  const control = useControlProps(id, describedBy, invalid);
  const visible = options.filter((o) => o.inactive !== true || o.value === value);
  return (
    <span className={cx('ui-select', className)}>
      <select
        ref={ref}
        className="ui-select__control"
        value={value}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === CREATE) {
            e.currentTarget.value = value;
            onCreate?.();
          } else onChange(v);
        }}
        {...control}
        {...rest}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {visible.map((o) => (
          <option key={o.value} value={o.value} disabled={o.inactive === true}>
            {o.inactive === true ? t('ui.select.inactive', { label: o.label }) : o.label}
          </option>
        ))}
        {onCreate === undefined ? null : <option value={CREATE}>{t('ui.select.create')}</option>}
      </select>
      <ChevronsUpDown aria-hidden="true" className="ui-select__chevron" />
    </span>
  );
});

// ── Combobox (escritorio) ───────────────────────────────────────────────────────────────

export interface ComboboxProps {
  options: readonly SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** «Crear "X"» al final cuando el texto no coincide con ninguna opción. */
  onCreate?: (label: string) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
}

/** Combobox con autocompletado en popover anclado (anchor positioning con respaldo bajo el campo). */
export function Combobox({ options, value, onChange, onCreate, placeholder, id, invalid, 'aria-describedby': describedBy }: ComboboxProps) {
  const t = useT();
  const control = useControlProps(id, describedBy, invalid);
  const listId = useId();
  const anchor = `--cb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);
  const [text, setText] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = normalizeForSearch(text);
  const filtered = options.filter(
    (o) => o.inactive !== true && (query === '' || selected?.label === text || normalizeForSearch(o.label).includes(query)),
  );
  const exact = options.some((o) => normalizeForSearch(o.label) === query);
  const canCreate = onCreate !== undefined && query !== '' && !exact;
  const total = filtered.length + (canCreate ? 1 : 0);

  const show = () => {
    setOpen(true);
    const el = listRef.current;
    if (el !== null && !el.matches(':popover-open')) el.showPopover();
  };
  const hide = () => {
    setOpen(false);
    const el = listRef.current;
    if (el !== null && el.matches(':popover-open')) el.hidePopover();
  };
  const choose = (index: number) => {
    const opt = filtered[index];
    if (opt !== undefined) {
      onChange(opt.value);
      setText(opt.label);
    } else if (canCreate) onCreate?.(text.trim());
    hide();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) show();
      setActive((a) => Math.min(total - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      hide();
    }
  };
  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <span className="ui-combobox" style={{ anchorName: anchor } as CSSProperties}>
      <span className="ui-input">
        <input
          ref={inputRef}
          className="ui-input__control"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && total > 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setActive(0);
            show();
          }}
          onFocus={show}
          onBlur={() => {
            setTimeout(hide, 120);
            if (selected !== undefined && text !== selected.label && !canCreate) setText(selected.label);
          }}
          onKeyDown={onKey}
          {...control}
        />
        <ChevronsUpDown aria-hidden="true" className="ui-select__chevron" />
      </span>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        className="ui-combobox__list"
        style={{ positionAnchor: anchor } as CSSProperties}
        data-anchored={supports.anchor() || undefined}
        {...htmlAttrs({ popover: 'manual' })}
      >
        {filtered.map((o, i) => (
          <li
            key={o.value}
            id={optionId(i)}
            role="option"
            aria-selected={o.value === value}
            data-active={i === active || undefined}
            onPointerDown={(e) => {
              e.preventDefault();
              choose(i);
            }}
          >
            {o.label}
          </li>
        ))}
        {canCreate ? (
          <li
            id={optionId(filtered.length)}
            role="option"
            aria-selected={false}
            className="ui-combobox__create"
            data-active={active === filtered.length || undefined}
            onPointerDown={(e) => {
              e.preventDefault();
              choose(filtered.length);
            }}
          >
            {t('ui.select.createNamed', { name: text.trim() })}
          </li>
        ) : null}
        {total === 0 ? <li className="ui-combobox__empty">{t('ui.select.empty')}</li> : null}
      </ul>
    </span>
  );
}

// ── DateField ───────────────────────────────────────────────────────────────────────────

export interface DateFieldProps {
  /** Fecha ISO `YYYY-MM-DD`. */
  value: string;
  onChange: (iso: string) => void;
  /** Hoy en ISO (lo da el reloj del núcleo; la UI no inventa la fecha). */
  today: string;
  /** Ofrece chips Hoy/Ayer encima del campo nativo. */
  quick?: boolean;
  id?: string;
  min?: string | undefined;
  max?: string | undefined;
  invalid?: boolean;
  'aria-describedby'?: string;
}

function shiftIso(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12));
  return date.toISOString().slice(0, 10);
}

/** Fecha nativa `<input type="date">` con atajos Hoy/Ayer y aviso de fecha futura. */
export function DateField({ value, onChange, today, quick = true, id, min, max, invalid, 'aria-describedby': describedBy }: DateFieldProps) {
  const t = useT();
  const control = useControlProps(id, describedBy, invalid);
  const yesterday = shiftIso(today, -1);
  const future = value > today;
  return (
    <div className="ui-datefield">
      {quick ? (
        <div className="ui-datefield__quick" role="group" aria-label={t('ui.date.pick')}>
          <button type="button" className="ui-chip ui-chip--choice" aria-pressed={value === today} onClick={() => onChange(today)}>
            <span className="ui-chip__label">{t('ui.date.today')}</span>
          </button>
          <button type="button" className="ui-chip ui-chip--choice" aria-pressed={value === yesterday} onClick={() => onChange(yesterday)}>
            <span className="ui-chip__label">{t('ui.date.yesterday')}</span>
          </button>
        </div>
      ) : null}
      <span className="ui-input">
        <input
          type="date"
          className="ui-input__control num"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.currentTarget.value)}
          {...control}
        />
      </span>
      {future ? (
        <p className="ui-field__error ui-datefield__future" role="status">
          <CircleAlert aria-hidden="true" />
          <span>{t('ui.date.future')}</span>
        </p>
      ) : null}
    </div>
  );
}
