// ajustes/campos/:fieldId: editar un campo (nombre, dónde aparece, uso), sus opciones y borrarlo si nunca se usó.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AppliesTo, Field, FieldRole } from '../../../core';
import { useFields, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useT } from '../../../i18n';
import { Banner, Button, Dialog, EmptyState, Field as FormField, FIELD_TYPE_ICON, InfoTip, Input, Segmented, Select, Switch } from '../../../ui';
import { FormPreview } from '../components/FormPreview';
import { Frame } from '../components/Frame';
import { Group } from '../components/Group';
import { Load } from '../components/Load';
import { OptionsEditor } from '../components/OptionsEditor';
import { APPLIES_OPTIONS, canDeleteField, FIELD_ROLES, findDuplicateLabel } from '../lib/fieldRules';
import { useRun } from '../lib/useRun';

export function Component() {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const { fieldId = '' } = useParams();
  const query = useFields({ includeInactive: true });
  const back = { to: `/e/${wsId}/ajustes/campos`, label: t('field.back') };
  return (
    <Load query={query}>
      {(fields) => {
        const field = fields.find((f) => f.id === fieldId);
        if (field === undefined) {
          return (
            <Frame title={t('sec.fields')} back={back}>
              <EmptyState
                message={t('field.notFound')}
                action={
                  <Link className="set-link" to={back.to}>
                    {t('field.back')}
                  </Link>
                }
              />
            </Frame>
          );
        }
        return (
          <Frame title={field.label} back={back}>
            <div className="set-split">
              <FieldEditor field={field} fields={fields} />
              <FormPreview field={field} />
            </div>
          </Frame>
        );
      }}
    </Load>
  );
}

function useFieldUsage(fieldId: string) {
  const ws = useWorkspaceId();
  return useCuadraQuery({
    key: ['fields.usage', ws, fieldId],
    tables: ['fields', 'transactions', 'transaction_field_values'],
    fn: (c) => c.fields.usage(fieldId),
  });
}

function FieldEditor({ field, fields }: { field: Field; fields: Field[] }) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const navigate = useNavigate();
  const { run, error, busy } = useRun();
  const usage = useFieldUsage(field.id);
  const [label, setLabel] = useState(field.label);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const TypeIcon = FIELD_TYPE_ICON[field.type];

  const trimmed = label.trim();
  const renamed = trimmed !== field.label;
  const duplicate = field.active && findDuplicateLabel(trimmed, fields, field.id);
  const labelError = submitted && trimmed === '' ? t('new.nameRequired') : duplicate ? t('new.duplicate') : undefined;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (trimmed === '' || duplicate || !renamed) return;
    const r = await run(
      (c) => c.fields.update(field.id, { label: trimmed }),
      (m) => ({ key: 'settings.field.renamed', params: { label: m.value.label } }),
    );
    if (r.ok) setSubmitted(false);
  };

  const setApplies = (appliesTo: AppliesTo) =>
    run(
      (c) => c.fields.update(field.id, { appliesTo }),
      () => ({ key: 'settings.field.appliesSaved', params: { label: field.label, where: t(`appliesIn.${appliesTo}`) } }),
    );
  const setShowInList = (showInList: boolean) =>
    run(
      (c) => c.fields.update(field.id, { showInList }),
      () => ({ key: showInList ? 'settings.field.showInListOn' : 'settings.field.showInListOff', params: { label: field.label } }),
    );
  const setRole = (value: string) =>
    run(
      (c) => c.fields.update(field.id, { role: value === '' ? null : (value as FieldRole) }),
      () => ({ key: 'settings.field.roleSaved', params: { label: field.label } }),
    );
  const setActive = (on: boolean) =>
    run(
      (c) => (on ? c.fields.reactivate(field.id) : c.fields.deactivate(field.id)),
      () => ({ key: on ? 'settings.fields.on' : 'settings.fields.off', params: { label: field.label } }),
    );
  const remove = async () => {
    setConfirmDelete(false);
    const r = await run(
      (c) => c.fields.delete(field.id),
      () => ({ key: 'settings.field.deleted', params: { label: field.label } }),
    );
    if (r.ok) void navigate(`/e/${wsId}/ajustes/campos`, { replace: true });
  };

  const deletable = canDeleteField(usage.data);
  const uses = usage.data;

  return (
    <div className="set-stack">
      {error === null ? null : <Banner tone="warn">{error}</Banner>}

      <form className="set-form" onSubmit={(e) => void saveName(e)} noValidate>
        <FormField label={t('field.name')} error={labelError}>
          <Input value={label} onChange={(e) => setLabel(e.currentTarget.value)} autoComplete="off" required />
        </FormField>
        {renamed ? (
          <div className="set-savebar">
            <Button type="submit" variant="secondary" loading={busy}>
              {t('field.saveName')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setLabel(field.label);
                setSubmitted(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        ) : null}
      </form>

      <dl className="set-facts">
        <div className="set-fact">
          <dt>
            {t('field.type')} <InfoTip>{t('field.typeTip')}</InfoTip>
          </dt>
          <dd>
            <TypeIcon aria-hidden="true" /> {t(`type.${field.type}`)}
          </dd>
        </div>
        {uses === undefined ? null : (
          <div className="set-fact">
            <dt>{t('field.usage', { n: uses.total })}</dt>
            <dd className="num">{uses.voided > 0 ? t('field.usageVoided', { n: uses.voided }) : ''}</dd>
          </div>
        )}
      </dl>

      <Group label={t('field.applies')} aside={<InfoTip label={t('field.applies')}>{t('field.appliesTip')}</InfoTip>}>
        <Segmented
          label={t('field.applies')}
          value={field.appliesTo}
          onChange={(v) => void setApplies(v)}
          options={APPLIES_OPTIONS.map((a) => ({ value: a, label: t(`appliesShort.${a}`) }))}
          fullWidth
        />
      </Group>

      <Switch label={t('field.showInList')} checked={field.showInList} onChange={(on) => void setShowInList(on)} />

      <FormField label={t('field.role')} aside={<InfoTip label={t('field.role')}>{t('field.roleTip')}</InfoTip>}>
        <Select
          value={field.role ?? ''}
          onChange={(v) => void setRole(v)}
          options={[{ value: '', label: t('role.none') }, ...FIELD_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))]}
        />
      </FormField>

      <div className="set-line">
        <Switch label={t('activeLabel')} checked={field.active} onChange={(on) => void setActive(on)} />
        <InfoTip label={t('activeLabel')}>{t('field.activeTip')}</InfoTip>
      </div>

      {field.type === 'list' ? <OptionsEditor field={field} /> : null}

      <div className="set-danger">
        <Button
          variant="danger"
          disabled={!deletable}
          {...(deletable || uses === undefined ? {} : { disabledReason: t('field.deleteLocked') })}
          onClick={() => setConfirmDelete(true)}
        >
          {t('field.delete')}
        </Button>
      </div>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        variant="destructive"
        title={t('field.deleteTitle', { label: field.label })}
        description={t('field.deleteBody')}
        confirmLabel={t('field.delete')}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
