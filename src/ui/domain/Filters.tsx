import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Calendar, CalendarDays, Hash, List, ToggleLeft, Type, type LucideIcon } from 'lucide-react';
import type { DateRange, Field as FieldDef, FieldType, FieldValue, PeriodPreset } from '../../core/types';
import { useT } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { cx, htmlAttrs } from '../lib';
import { Button } from '../primitives/Button';
import { Chip } from '../primitives/Choice';
import { Combobox, DateField, Field, Input, Select, type SelectOption } from '../primitives/Form';
import { Switch } from '../primitives/Choice';

// ── FieldInput ──────────────────────────────────────────────────────────────────────────

export const FIELD_TYPE_ICON: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  date: Calendar,
  list: List,
  bool: ToggleLeft,
};

export interface FieldInputProps {
  /** Definición del campo personalizable (núcleo). */
  field: FieldDef;
  /** Valor actual; `undefined` = vacío. */
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
  /** Hoy en ISO (para el campo fecha). */
  today: string;
  /** Listas: `native` select (móvil) o `combobox` con autocompletado (escritorio). */
  listMode?: 'native' | 'combobox';
  /** Listas: crear una opción nueva («+ Crear…» / «Crear "X"»). */
  onCreateOption?: (label?: string) => void;
  error?: ReactNode;
  help?: ReactNode;
}

/** Renderiza un campo personalizable según su tipo: texto, número, fecha, lista o sí/no. */
export function FieldInput({ field, value, onChange, today, listMode = 'native', onCreateOption, error, help }: FieldInputProps) {
  const t = useT();
  const common = { ...(error === undefined ? {} : { error }), ...(help === undefined ? {} : { help }) };
  switch (field.type) {
    case 'text':
      return (
        <Field label={field.label} {...common}>
          <Input value={value?.type === 'text' ? value.value : ''} onChange={(e) => {
            const v = e.currentTarget.value;
            onChange(v === '' ? undefined : { type: 'text', value: v });
          }} />
        </Field>
      );
    case 'number':
      return (
        <Field label={field.label} {...common}>
          <Input
            inputMode="decimal"
            className="num"
            value={value?.type === 'number' ? String(value.value) : ''}
            onChange={(e) => {
              const raw = e.currentTarget.value.replace(',', '.');
              if (raw === '') onChange(undefined);
              else if (/^-?\d*\.?\d*$/.test(raw) && raw !== '-' && raw !== '.') onChange({ type: 'number', value: Number(raw) });
            }}
          />
        </Field>
      );
    case 'date':
      return (
        <Field label={field.label} {...common}>
          <DateField
            today={today}
            quick={false}
            value={value?.type === 'date' ? value.value : ''}
            onChange={(iso) => onChange(iso === '' ? undefined : { type: 'date', value: iso })}
          />
        </Field>
      );
    case 'bool':
      return (
        <Switch
          label={field.label}
          description={help}
          checked={value?.type === 'bool' ? value.value : false}
          onChange={(checked) => onChange({ type: 'bool', value: checked })}
        />
      );
    case 'list': {
      const current = value?.type === 'list' ? value.optionId : '';
      const options: SelectOption[] = field.options
        .filter((o) => o.mergedIntoId === null || o.id === current)
        .map((o) => ({ value: o.id, label: o.label, inactive: !o.active }));
      return (
        <Field label={field.label} {...common}>
          {listMode === 'combobox' ? (
            <Combobox
              options={options}
              value={current === '' ? null : current}
              onChange={(id) => onChange({ type: 'list', optionId: id })}
              {...(onCreateOption === undefined ? {} : { onCreate: (label: string) => onCreateOption(label) })}
            />
          ) : (
            <Select
              options={options}
              value={current}
              placeholder={t('ui.select.placeholder')}
              onChange={(id) => onChange(id === '' ? undefined : { type: 'list', optionId: id })}
              {...(onCreateOption === undefined ? {} : { onCreate: () => onCreateOption() })}
            />
          )}
        </Field>
      );
    }
  }
}

// ── FilterChips ─────────────────────────────────────────────────────────────────────────

export interface ActiveFilter {
  id: string;
  /** «Periodo», «Categoría». */
  label: string;
  /** «Este mes», «Materiales +2». */
  value: string;
  /** Abre su popover/hoja de edición. */
  onOpen?: () => void;
  /** Quitarlo; si falta, el chip no lleva ×. */
  onRemove?: () => void;
}

export interface FilterChipsProps {
  filters: readonly ActiveFilter[];
  /** Añadir un filtro; muestra «+ Filtro». */
  onAdd?: () => void;
  /** Quitar todos; aparece con dos o más filtros quitables. */
  onClear?: () => void;
  className?: string;
}

/** Fila de chips de filtro con scroll horizontal. */
export function FilterChips({ filters, onAdd, onClear, className }: FilterChipsProps) {
  const t = useT();
  const removable = filters.filter((f) => f.onRemove !== undefined).length;
  return (
    <div className={cx('ui-filters', className)} role="group" aria-label={t('ui.filters.label')}>
      {filters.map((f) => (
        <Chip
          key={f.id}
          variant="filter"
          value={f.value}
          {...(f.onOpen === undefined ? {} : { onClick: f.onOpen })}
          {...(f.onRemove === undefined ? {} : { onRemove: f.onRemove })}
        >
          {f.label}
        </Chip>
      ))}
      {onAdd === undefined ? null : (
        <button type="button" className="ui-filters__add" onClick={onAdd}>
          {t('ui.filters.add')}
        </button>
      )}
      {onClear !== undefined && removable >= 2 ? (
        <button type="button" className="ui-filters__add" onClick={onClear}>
          {t('ui.filters.clear')}
        </button>
      ) : null}
    </div>
  );
}

// ── PeriodPicker ────────────────────────────────────────────────────────────────────────

const DEFAULT_PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'this_quarter', 'this_year', 'last_12_months', 'all'];

export interface PeriodPickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Hoy en ISO (para el rango personalizado). */
  today: string;
  /** Presets ofrecidos (por defecto los del Resumen). */
  presets?: readonly PeriodPreset[];
  /** Texto del chip; si falta se deriva del valor (preset o «1 nov 2026 al 30 nov 2026»). */
  label?: string;
}

/** Chip de periodo que abre un popover anclado con presets y un rango personalizado. */
export function PeriodPicker({ value, onChange, today, presets = DEFAULT_PRESETS, label }: PeriodPickerProps) {
  const t = useT();
  const id = useId();
  const anchor = `--pp${id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const popRef = useRef<HTMLDivElement>(null);
  const custom = !('preset' in value);
  const [from, setFrom] = useState(custom ? (value.from ?? '') : today.slice(0, 8) + '01');
  const [to, setTo] = useState(custom ? (value.to ?? '') : today);
  const shown =
    label ??
    ('preset' in value
      ? t(`ui.period.${value.preset}`)
      : t('ui.period.range', {
          from: value.from === undefined ? '…' : formatDate(value.from),
          to: value.to === undefined ? '…' : formatDate(value.to),
        }));
  const pick = (range: DateRange) => {
    onChange(range);
    popRef.current?.hidePopover();
  };
  return (
    <span className="ui-period">
      <button
        type="button"
        className="ui-chip ui-chip--choice ui-period__trigger"
        style={{ anchorName: anchor } as CSSProperties}
        aria-haspopup="dialog"
        popoverTarget={id}
      >
        <CalendarDays aria-hidden="true" className="ui-chip__icon" />
        <span className="ui-chip__label">
          <span className="visually-hidden">{t('ui.period.label')}: </span>
          {shown}
        </span>
      </button>
      <div ref={popRef} id={id} role="dialog" aria-label={t('ui.period.label')} className="ui-pop ui-period__pop" style={{ positionAnchor: anchor } as CSSProperties} {...htmlAttrs({ popover: 'auto' })}>
        <div className="ui-period__presets" role="group" aria-label={t('ui.period.label')}>
          {presets.map((p) => (
            <button key={p} type="button" className="ui-menu__item" aria-pressed={'preset' in value && value.preset === p} onClick={() => pick({ preset: p })}>
              {t(`ui.period.${p}`)}
            </button>
          ))}
        </div>
        <fieldset className="ui-period__custom">
          <legend>{t('ui.period.custom')}</legend>
          <Field label={t('ui.period.from')}>
            <DateField today={today} quick={false} value={from} max={to === '' ? undefined : to} onChange={setFrom} />
          </Field>
          <Field label={t('ui.period.to')}>
            <DateField today={today} quick={false} value={to} min={from === '' ? undefined : from} onChange={setTo} />
          </Field>
          <Button variant="secondary" disabled={from === '' || to === '' || from > to} onClick={() => pick({ from, to })}>
            {t('ui.period.apply')}
          </Button>
        </fieldset>
      </div>
    </span>
  );
}
