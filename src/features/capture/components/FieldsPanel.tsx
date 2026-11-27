// Campos dinámicos del formulario (los cinco tipos) desde `useFormSchema`. Las listas llevan búsqueda y
// «Crear "X"»; antes de crear se ofrecen las opciones parecidas (F-35: «¿Querías decir…?»).
import { useState } from 'react';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useCuadra } from '../../../app/data/CuadraProvider';
import type { Field, FieldOption, FieldValue, FieldValues, Id } from '../../../core';
import { useT } from '../../../i18n';
import { Button, Dialog, FieldInput } from '../../../ui';

export interface FieldsPanelProps {
  fields: ReadonlyArray<Field & { options: FieldOption[] }>;
  values: FieldValues;
  onChange: (fieldId: Id, value: FieldValue | undefined) => void;
  today: string;
  /** Campos que no se pintan aquí (p. ej. la categoría, que ya va en chips). */
  exclude?: ReadonlySet<Id>;
  /**
   * Sube cuando los valores cambian desde fuera (sugerencia, chip de categoría): el combobox guarda su propio
   * texto, así que se vuelve a montar para mostrar la opción nueva.
   */
  rev?: number;
}

interface Pending {
  field: Field;
  label: string;
  similar: FieldOption[];
}

export function FieldsPanel({ fields, values, onChange, today, exclude, rev = 0 }: FieldsPanelProps) {
  const t = useT('capture');
  const cuadra = useCuadra();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = useCuadraMutation((c, input: { fieldId: Id; label: string }) => c.fields.addOption(input.fieldId, { label: input.label }), {
    successToast: (o) => ({ key: 'capture.toast.optionCreated', params: { name: o.label } }),
  });

  const create = async (field: Field, label: string) => {
    const r = await add.mutateAsync({ fieldId: field.id, label }).catch(() => null);
    if (r !== null) onChange(field.id, { type: 'list', optionId: r.value.id });
    setPending(null);
  };

  const ask = async (field: Field, label: string | undefined) => {
    setError(null);
    const name = (label ?? '').trim();
    if (name === '') {
      setError(t('fields.createHint'));
      return;
    }
    const similar = await cuadra.fields.similarOptions(field.id, name).catch(() => []);
    if (similar.length === 0) await create(field, name);
    else setPending({ field, label: name, similar: similar.slice(0, 3) });
  };

  const shown = fields.filter((f) => f.active && exclude?.has(f.id) !== true);
  if (shown.length === 0) return null;
  return (
    <div className="cap-fields">
      {shown.map((f) => (
        <FieldInput
          key={`${f.id}:${rev}`}
          field={f}
          value={values[f.id]}
          onChange={(v) => onChange(f.id, v)}
          today={today}
          listMode="combobox"
          {...(f.type === 'list' ? { onCreateOption: (label?: string) => void ask(f, label) } : {})}
        />
      ))}
      {error === null ? null : (
        <p className="cap-meta" role="status">
          {error}
        </p>
      )}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('fields.similarTitle')}
        confirmLabel={pending === null ? '' : t('fields.createAnyway', { name: pending.label })}
        onConfirm={() => {
          if (pending !== null) void create(pending.field, pending.label);
        }}
        confirmLoading={add.isPending}
      >
        <div className="cap-similar">
          {pending?.similar.map((o) => (
            <Button
              key={o.id}
              variant="secondary"
              onClick={() => {
                onChange(pending.field.id, { type: 'list', optionId: o.id });
                setPending(null);
              }}
            >
              {t('fields.useExisting', { name: o.label })}
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
