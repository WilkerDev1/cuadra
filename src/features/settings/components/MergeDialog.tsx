// Fusionar una opción en otra: pide el destino y muestra cuántos movimientos se mueven antes de hacerlo (F-36).
import { useEffect, useState } from 'react';
import type { Field, FieldOption } from '../../../core';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useT } from '../../../i18n';
import { Banner, Dialog, Field as FormField, Select } from '../../../ui';
import { defaultMergeTarget, mergeCandidates } from '../lib/merge';
import { useRun } from '../lib/useRun';

/** Cuántos movimientos (también anulados) tienen esta opción: es lo que `mergeOptions` mueve. */
export function useOptionUses(field: Pick<Field, 'id'>, optionId: string, enabled = true) {
  const ws = useWorkspaceId();
  return useCuadraQuery({
    key: ['fields.optionUses', ws, optionId],
    tables: ['transactions', 'transaction_field_values', 'field_options'],
    enabled,
    fn: async (c) => {
      const totals = await c.queries.totals(ws, {
        status: 'all',
        fields: [{ fieldId: field.id, op: 'any_of', optionIds: [optionId] }],
      });
      return totals.count;
    },
  });
}

export function MergeDialog({ field, source, onClose }: { field: Field; source: FieldOption | null; onClose: () => void }) {
  return source === null ? null : <MergeBody key={source.id} field={field} source={source} onClose={onClose} />;
}

function MergeBody({ field, source, onClose }: { field: Field; source: FieldOption; onClose: () => void }) {
  const t = useT('settings');
  const ws = useWorkspaceId();
  const { run, error, busy } = useRun();
  const candidates = mergeCandidates(field.options, source.id);
  const similar = useCuadraQuery({
    key: ['fields.similar', ws, field.id, source.label],
    tables: ['field_options'],
    fn: (c) => c.fields.similarOptions(field.id, source.label),
  });
  const [target, setTarget] = useState<string>(() => defaultMergeTarget(candidates, []) ?? '');
  const similarData = similar.data;
  useEffect(() => {
    if (similarData !== undefined) setTarget(defaultMergeTarget(candidates, similarData) ?? '');
    // Solo al llegar las parecidas: lo que elija la persona después no se pisa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarData]);

  const targetOption = candidates.find((o) => o.id === target);
  const uses = useOptionUses(field, source.id);

  const merge = async () => {
    if (targetOption === undefined) return;
    const r = await run(
      (c) => c.fields.mergeOptions(source.id, targetOption.id),
      (m) => ({ key: 'settings.merge.done', params: { n: m.value.movedCount, from: source.label, to: targetOption.label } }),
    );
    if (r.ok) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('merge.title', { name: source.label })}
      confirmLabel={t('merge.confirm')}
      onConfirm={() => void merge()}
      confirmLoading={busy}
    >
      <div className="set-dialog">
        {error === null ? null : <Banner tone="warn">{error}</Banner>}
        <FormField label={t('merge.target')}>
          <Select
            value={target}
            onChange={setTarget}
            options={candidates.map((o) => ({ value: o.id, label: o.label }))}
          />
        </FormField>
        <p className="set-merge" role="status">
          {targetOption === undefined || uses.data === undefined
            ? t('merge.counting')
            : t('merge.preview', { n: uses.data, from: source.label, to: targetOption.label })}
        </p>
      </div>
    </Dialog>
  );
}
