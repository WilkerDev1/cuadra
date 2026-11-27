// Diálogo «Nuevo campo»: nombre, uno de los cinco tipos, dónde aparece y, si es lista, sus primeras opciones.
import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import type { AppliesTo, Field, FieldType } from '../../../core';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Banner, Chip, Dialog, Field as FormField, FIELD_TYPE_ICON, Input, Segmented, Textarea } from '../../../ui';
import { APPLIES_OPTIONS, FIELD_TYPES, findDuplicateLabel, parseOptionLines } from '../lib/fieldRules';
import { useRun } from '../lib/useRun';
import { Group } from './Group';

export function NewFieldDialog({ open, onClose, fields }: { open: boolean; onClose: () => void; fields: readonly Field[] }) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const navigate = useNavigate();
  const { run, error, clearError, busy } = useRun();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('list');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('both');
  const [optionsText, setOptionsText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const missing = label.trim() === '';
  const duplicate = findDuplicateLabel(label, fields);
  const nameError = submitted ? (missing ? t('new.nameRequired') : duplicate ? t('new.duplicate') : undefined) : duplicate ? t('new.duplicate') : undefined;

  const reset = () => {
    setLabel('');
    setType('list');
    setAppliesTo('both');
    setOptionsText('');
    setSubmitted(false);
    clearError();
  };
  const close = () => {
    reset();
    onClose();
  };

  const create = async () => {
    setSubmitted(true);
    if (missing || duplicate) return;
    const options = type === 'list' ? parseOptionLines(optionsText).map((o) => ({ label: o })) : [];
    const r = await run(
      (c) =>
        c.fields.create({
          workspaceId: wsId,
          label: label.trim(),
          type,
          appliesTo,
          ...(options.length > 0 ? { options } : {}),
        }),
      (m) => ({ key: 'settings.new.created', params: { label: m.value.label } }),
    );
    if (r.ok) {
      const id = r.value.value.id;
      reset();
      onClose();
      void navigate(`/e/${wsId}/ajustes/campos/${id}`);
    }
  };

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      void create();
    }
  };

  return (
    <Dialog open={open} onClose={close} title={t('new.title')} confirmLabel={t('new.create')} onConfirm={() => void create()} confirmLoading={busy}>
      <div className="set-dialog" onKeyDown={onEnter}>
        {error === null ? null : <Banner tone="warn">{error}</Banner>}
        <FormField label={t('new.name')} error={nameError}>
          <Input value={label} onChange={(e) => setLabel(e.currentTarget.value)} autoComplete="off" autoFocus />
        </FormField>
        <Group label={t('new.type')}>
          <div className="set-types">
            {FIELD_TYPES.map((ft) => (
              <Chip
                key={ft}
                selected={type === ft}
                icon={FIELD_TYPE_ICON[ft]}
                onClick={() => setType(ft)}
              >
                {t(`type.${ft}`)}
              </Chip>
            ))}
          </div>
        </Group>
        <Group label={t('new.applies')}>
          <Segmented
            label={t('new.applies')}
            value={appliesTo}
            onChange={setAppliesTo}
            options={APPLIES_OPTIONS.map((a) => ({ value: a, label: t(`appliesShort.${a}`) }))}
            fullWidth
          />
        </Group>
        {type === 'list' ? (
          <FormField label={t('new.options')} help={t('new.optionsHelp')}>
            <Textarea value={optionsText} onChange={(e) => setOptionsText(e.currentTarget.value)} rows={4} />
          </FormField>
        ) : null}
      </div>
    </Dialog>
  );
}
