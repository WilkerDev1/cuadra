// Vista previa en vivo del formulario de Nuevo movimiento con los campos activos (DESIGN §10.13, escritorio).
import { useState } from 'react';
import type { Field } from '../../../core';
import { useFormSchema } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { FieldInput, Segmented } from '../../../ui';

type Kind = 'income' | 'expense' | 'transfer';
const NEUTRAL_TODAY = '2000-01-01';

export function FormPreview({ field }: { field: Field }) {
  const t = useT('settings');
  const [kind, setKind] = useState<Kind>(field.appliesTo === 'in' ? 'income' : 'expense');
  const schema = useFormSchema(kind);
  const fields = schema.data?.fields ?? [];
  const present = schema.isPending || fields.some((f) => f.id === field.id);
  return (
    <aside className="set-preview" aria-labelledby="set-preview-h">
      <div className="set-preview__head">
        <h2 id="set-preview-h" className="set-h2">
          {t('field.preview')}
        </h2>
        <Segmented
          label={t('field.previewKind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'income', label: t('field.previewIn') },
            { value: 'expense', label: t('field.previewOut') },
            { value: 'transfer', label: t('field.previewXfer') },
          ]}
        />
      </div>
      <p className="set-preview__base">{t('field.previewBase')}</p>
      <ul className="set-preview__list" inert>
        {fields.map((f) => (
          <li key={f.id} className="set-preview__item" data-current={f.id === field.id ? '' : undefined}>
            <FieldInput field={f} value={undefined} onChange={() => {}} today={NEUTRAL_TODAY} />
          </li>
        ))}
      </ul>
      {present ? null : <p className="set-preview__not">{t('field.previewNot')}</p>}
    </aside>
  );
}
