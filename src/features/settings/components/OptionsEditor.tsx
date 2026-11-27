// Editor de opciones de una lista: añadir (con aviso de parecidas), renombrar en línea, tinta, orden,
// desactivar, fusionar y eliminar solo lo que nunca se usó (DESIGN §10.13).
import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { Combine, Power, Trash2 } from 'lucide-react';
import type { Field, FieldOption } from '../../../core';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useT } from '../../../i18n';
import { Banner, Button, Field as FormField, Input, LedgerList, Menu, type MenuItem } from '../../../ui';
import { canDeleteOption, splitActive } from '../lib/fieldRules';
import { fullOrder, moveId, positionOf } from '../lib/reorder';
import { tintCss } from '../lib/tint';
import { useRun } from '../lib/useRun';
import { MergeDialog, useOptionUses } from './MergeDialog';
import { ReorderButtons, useAnnouncer } from './Reorder';
import { TintPicker } from './TintPicker';

export function OptionsEditor({ field }: { field: Field }) {
  const t = useT('settings');
  const { run, error } = useRun();
  const [live, announce] = useAnnouncer();
  const [merging, setMerging] = useState<FieldOption | null>(null);
  const { active, inactive } = splitActive(field.options);
  const activeIds = active.map((o) => o.id);
  const byId = new Map(field.options.map((o) => [o.id, o]));

  const move = async (option: FieldOption, delta: -1 | 1) => {
    const next = moveId(activeIds, option.id, delta);
    if (next === null) return;
    const where = positionOf(next, option.id);
    const r = await run((c) => c.fields.reorderOptions(field.id, fullOrder(next, inactive.map((o) => o.id))));
    if (r.ok && where !== null) announce(t('moved', { name: option.label, position: where.position, total: where.total }));
  };

  const rows = (options: FieldOption[], movable: boolean) =>
    options.map((option, i) => (
      <OptionRow
        key={option.id}
        field={field}
        option={option}
        mergedInto={option.mergedIntoId === null ? undefined : byId.get(option.mergedIntoId)?.label}
        canUp={movable && i > 0}
        canDown={movable && i < options.length - 1}
        movable={movable}
        canMerge={option.active && active.length > 1}
        onMove={(d) => void move(option, d)}
        onMerge={() => setMerging(option)}
        run={run}
      />
    ));

  return (
    <section className="set-sec" aria-labelledby="set-opts-h">
      <h2 id="set-opts-h" className="set-h2">
        {t('options.title')}
      </h2>
      {error === null ? null : <Banner tone="warn">{error}</Banner>}
      {live}
      <AddOption field={field} run={run} />
      {active.length === 0 ? (
        <p className="set-empty-line">{t('options.empty')}</p>
      ) : (
        <LedgerList label={t('options.title')}>{rows(active, true)}</LedgerList>
      )}
      {inactive.length === 0 ? null : (
        <>
          <h3 className="set-h3">{t('options.inactive', { n: inactive.length })}</h3>
          <LedgerList label={t('options.inactive', { n: inactive.length })}>{rows(inactive, false)}</LedgerList>
        </>
      )}
      <MergeDialog field={field} source={merging} onClose={() => setMerging(null)} />
    </section>
  );
}

type Run = ReturnType<typeof useRun>['run'];

function AddOption({ field, run }: { field: Field; run: Run }) {
  const t = useT('settings');
  const ws = useWorkspaceId();
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = label.trim();
  const similar = useCuadraQuery({
    key: ['fields.similarTyping', ws, field.id, trimmed],
    tables: ['field_options'],
    enabled: trimmed.length >= 2,
    fn: (c) => c.fields.similarOptions(field.id, trimmed),
  });
  const names = trimmed.length >= 2 ? (similar.data ?? []).slice(0, 3).map((o) => `«${o.label}»`) : [];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (trimmed === '') return;
    const r = await run(
      (c) => c.fields.addOption(field.id, { label: trimmed }),
      (m) => ({ key: 'settings.options.added', params: { label: m.value.label } }),
    );
    if (r.ok) {
      setLabel('');
      setTouched(false);
    }
  };

  return (
    <form className="set-add" onSubmit={(e) => void add(e)}>
      <FormField
        label={t('options.add')}
        error={touched && trimmed === '' ? t('new.nameRequired') : undefined}
        help={names.length > 0 ? t('options.similar', { names: names.join(', ') }) : undefined}
      >
        <Input value={label} onChange={(e) => setLabel(e.currentTarget.value)} autoComplete="off" />
      </FormField>
      <Button type="submit" variant="secondary">
        {t('options.addAction')}
      </Button>
    </form>
  );
}

interface OptionRowProps {
  field: Field;
  option: FieldOption;
  mergedInto: string | undefined;
  canUp: boolean;
  canDown: boolean;
  movable: boolean;
  canMerge: boolean;
  onMove: (delta: -1 | 1) => void;
  onMerge: () => void;
  run: Run;
}

function OptionRow({ field, option, mergedInto, canUp, canDown, movable, canMerge, onMove, onMerge, run }: OptionRowProps) {
  const t = useT('settings');
  const [name, setName] = useState(option.label);
  const [tray, setTray] = useState(false);
  const uses = useOptionUses(field, option.id);
  useEffect(() => setName(option.label), [option.label]);

  const commitName = async () => {
    const next = name.trim();
    if (next === option.label) return;
    if (next === '') {
      setName(option.label);
      return;
    }
    const r = await run(
      (c) => c.fields.updateOption(option.id, { label: next }),
      (m) => ({ key: 'settings.options.renamed', params: { label: m.value.label } }),
    );
    if (!r.ok) setName(option.label);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setName(option.label);
      e.currentTarget.blur();
    }
  };

  const setTint = (color: string | null) =>
    run(
      (c) => c.fields.updateOption(option.id, { color }),
      (m) => ({ key: 'settings.options.tintSaved', params: { label: m.value.label } }),
    );

  const toggle = () =>
    run(
      (c) => (option.active ? c.fields.deactivateOption(option.id) : c.fields.reactivateOption(option.id)),
      (m) => ({ key: option.active ? 'settings.options.deactivated' : 'settings.options.reactivated', params: { label: m.value.label } }),
    );
  const remove = () =>
    run(
      (c) => c.fields.deleteOption(option.id),
      () => ({ key: 'settings.options.deleted', params: { label: option.label } }),
    );

  const items: MenuItem[] = [
    { id: 'toggle', label: option.active ? t('options.deactivate') : t('options.reactivate'), icon: Power, onSelect: () => void toggle() },
  ];
  if (option.active && canMerge) items.push({ id: 'merge', label: t('options.merge'), icon: Combine, onSelect: onMerge });
  if (canDeleteOption(option, uses.data)) {
    items.push({ id: 'delete', label: t('options.delete'), icon: Trash2, tone: 'danger', onSelect: () => void remove() });
  }

  const dot = tintCss(option.color);
  return (
    <div role="listitem" className="set-opt" data-muted={option.active ? undefined : ''}>
      <button
        type="button"
        className="set-dot"
        style={dot === null ? undefined : ({ '--set-tint': dot } as CSSProperties)}
        aria-label={t('options.tint', { name: option.label })}
        aria-expanded={tray}
        onClick={() => setTray((v) => !v)}
      />
      <input
        className="set-inline"
        value={name}
        aria-label={t('options.name', { name: option.label })}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={() => void commitName()}
        onKeyDown={onKey}
        autoComplete="off"
      />
      <span className="set-opt__uses num">
        {mergedInto !== undefined && !option.active
          ? t('options.mergedInto', { target: mergedInto })
          : uses.data === undefined
            ? ''
            : t('options.uses', { n: uses.data })}
      </span>
      {movable ? <ReorderButtons name={option.label} canUp={canUp} canDown={canDown} onMove={onMove} /> : <span className="set-reorder" />}
      <Menu label={t('options.more', { name: option.label })} items={items} />
      {tray ? (
        <div className="set-opt__tray">
          <TintPicker
            label={t('options.tint', { name: option.label })}
            value={option.color}
            onChange={(c) => void setTint(c)}
            allowNone
          />
        </div>
      ) : null}
    </div>
  );
}
