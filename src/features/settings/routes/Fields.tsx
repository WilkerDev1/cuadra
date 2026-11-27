// ajustes/campos: lista de campos, su orden, activar/desactivar y crear uno nuevo (DESIGN §10.13).
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Field } from '../../../core';
import { useFields, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Banner, Button, EmptyState, FIELD_TYPE_ICON, LedgerList, Switch } from '../../../ui';
import { Frame } from '../components/Frame';
import { Load } from '../components/Load';
import { NewFieldDialog } from '../components/NewFieldDialog';
import { ReorderButtons, useAnnouncer } from '../components/Reorder';
import { splitActive } from '../lib/fieldRules';
import { fullOrder, moveId, positionOf } from '../lib/reorder';
import { useRun } from '../lib/useRun';

export function Component() {
  const t = useT('settings');
  const query = useFields({ includeInactive: true });
  const [creating, setCreating] = useState(false);
  return (
    <Frame
      title={t('sec.fields')}
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          {t('fields.new')}
        </Button>
      }
    >
      <Load query={query}>
        {(fields) => (
          <>
            <FieldList fields={fields} onCreate={() => setCreating(true)} />
            <NewFieldDialog open={creating} onClose={() => setCreating(false)} fields={fields} />
          </>
        )}
      </Load>
    </Frame>
  );
}

function FieldList({ fields, onCreate }: { fields: Field[]; onCreate: () => void }) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const { run, error } = useRun();
  const [live, announce] = useAnnouncer();
  const { active, inactive } = splitActive(fields);
  const activeIds = active.map((f) => f.id);

  if (fields.length === 0) {
    return (
      <EmptyState
        message={t('fields.empty')}
        action={
          <Button variant="secondary" icon={Plus} onClick={onCreate}>
            {t('fields.new')}
          </Button>
        }
      />
    );
  }

  const move = async (field: Field, delta: -1 | 1) => {
    const next = moveId(activeIds, field.id, delta);
    if (next === null) return;
    const where = positionOf(next, field.id);
    const r = await run((c) => c.fields.reorder(wsId, fullOrder(next, inactive.map((f) => f.id))));
    if (r.ok && where !== null) announce(t('moved', { name: field.label, position: where.position, total: where.total }));
  };

  const toggle = (field: Field, on: boolean) =>
    run(
      (c) => (on ? c.fields.reactivate(field.id) : c.fields.deactivate(field.id)),
      () => ({ key: on ? 'settings.fields.on' : 'settings.fields.off', params: { label: field.label } }),
    );

  const row = (field: Field, index: number, listLength: number) => {
    const Icon = FIELD_TYPE_ICON[field.type];
    const meta = [t(`type.${field.type}`), t(`applies.${field.appliesTo}`)];
    if (field.type === 'list') meta.push(t('fields.optionsN', { n: field.options.filter((o) => o.active).length }));
    return (
      <div key={field.id} role="listitem" className="set-row" data-muted={field.active ? undefined : ''}>
        <Icon aria-hidden="true" className="set-row__icon" />
        <Link className="set-row__text set-row__link" to={`/e/${wsId}/ajustes/campos/${field.id}`} viewTransition>
          <span className="set-row__title truncate">{field.label}</span>
          <span className="set-row__meta truncate">{meta.join(' · ')}</span>
        </Link>
        {field.active ? (
          <ReorderButtons name={field.label} canUp={index > 0} canDown={index < listLength - 1} onMove={(d) => void move(field, d)} />
        ) : null}
        <Switch
          label={<span className="visually-hidden">{t('active', { name: field.label })}</span>}
          checked={field.active}
          onChange={(on) => void toggle(field, on)}
          layout="inline"
        />
      </div>
    );
  };

  return (
    <div className="set-stack">
      {error === null ? null : <Banner tone="warn">{error}</Banner>}
      {live}
      {active.length === 0 ? null : <LedgerList label={t('sec.fields')}>{active.map((f, i) => row(f, i, active.length))}</LedgerList>}
      {inactive.length === 0 ? null : (
        <section className="set-sec" aria-labelledby="set-fld-off">
          <h2 id="set-fld-off" className="set-h2">
            {t('fields.inactive', { n: inactive.length })}
          </h2>
          <LedgerList label={t('fields.inactive', { n: inactive.length })}>{inactive.map((f, i) => row(f, i, inactive.length))}</LedgerList>
        </section>
      )}
    </div>
  );
}
