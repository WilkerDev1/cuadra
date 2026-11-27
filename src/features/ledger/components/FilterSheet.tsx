// Hoja de filtros: todos los criterios combinables (AND). Se edita un borrador y se aplica de una vez.
import { useState, type ReactNode } from 'react';
import type { Account, Field, FieldCondition, TxFilter, TxKind } from '../../../core';
import { Money, systemClock } from '../../../core';
import { useMoneyParse } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Button, Chip, DateField, Field as FormField, Input, Segmented, Sheet } from '../../../ui';
import { setFieldCondition, toggle } from '../logic/filterChips';

const KINDS: TxKind[] = ['income', 'expense', 'transfer', 'opening'];

export interface FilterSheetProps {
  open: boolean;
  filter: TxFilter;
  accounts: readonly Account[];
  fields: readonly Field[];
  /** Pantalla de una cuenta: sin selector de cuentas. */
  fixedAccount: boolean;
  minorDigits: number;
  onApply: (filter: TxFilter) => void;
  onClose: () => void;
}

export function FilterSheet(props: FilterSheetProps) {
  // Se monta de nuevo cada vez que se abre: el borrador parte del filtro actual.
  return props.open ? <FilterSheetBody {...props} /> : null;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lg-fs__group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Color de opción guardado como `tint-N` o `#rrggbb` → valor CSS. */
function cssColor(color: string): string {
  return /^tint-[1-8]$/.test(color) ? `var(--${color})` : color;
}

function minorToText(minor: number | undefined, digits: number): string {
  return minor === undefined ? '' : Money.toDecimalString(minor, digits);
}

function FilterSheetBody({ filter, accounts, fields, fixedAccount, minorDigits, onApply, onClose }: FilterSheetProps) {
  const t = useT();
  const parse = useMoneyParse();
  const today = systemClock.today();
  const [draft, setDraft] = useState<TxFilter>(filter);
  const [min, setMin] = useState(minorToText(filter.amount?.min, minorDigits));
  const [max, setMax] = useState(minorToText(filter.amount?.max, minorDigits));
  const [amountError, setAmountError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(filter) || min !== minorToText(filter.amount?.min, minorDigits) || max !== minorToText(filter.amount?.max, minorDigits);

  const apply = () => {
    const amount: { min?: number; max?: number } = {};
    for (const [key, text] of [
      ['min', min],
      ['max', max],
    ] as const) {
      if (text.trim() === '') continue;
      const r = parse(text);
      if (!r.ok) {
        setAmountError(t(`ledger.filter.amountError.${r.error}`));
        return;
      }
      amount[key] = r.value;
    }
    if (amount.min !== undefined && amount.max !== undefined && amount.min > amount.max) {
      setAmountError(t('ledger.filter.amountError.order'));
      return;
    }
    const next: TxFilter = { ...draft };
    if (amount.min === undefined && amount.max === undefined) delete next.amount;
    else next.amount = amount;
    onApply(next);
  };

  const cond = (fieldId: string) => draft.fields?.find((c) => c.fieldId === fieldId);
  const setCond = (fieldId: string, c: FieldCondition | null) => setDraft((d) => setFieldCondition(d, fieldId, c));
  const usable = fields.filter((f) => f.active || cond(f.id) !== undefined);
  const activeAccounts = accounts.filter((a) => a.archivedAt === null || draft.accountIds?.includes(a.id) === true);

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('ledger.filter.title')}
      height="full"
      dirty={dirty}
      footer={
        <div className="lg-fs__actions">
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ ...(filter.period === undefined ? {} : { period: filter.period }), ...(fixedAccount && filter.accountIds !== undefined ? { accountIds: filter.accountIds } : {}) });
              setMin('');
              setMax('');
              setAmountError(null);
            }}
          >
            {t('ledger.filter.clear')}
          </Button>
          <Button variant="primary" onClick={apply}>
            {t('ledger.filter.apply')}
          </Button>
        </div>
      }
    >
      <div className="lg-fs">
        <Group title={t('ledger.filter.kind')}>
          <div className="lg-fs__chips">
            {KINDS.map((k) => (
              <Chip key={k} selected={draft.kinds?.includes(k) === true} onClick={() => setDraft((d) => ({ ...d, kinds: toggle(d.kinds, k) }))}>
                {t(`ledger.kind.${k}`)}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title={t('ledger.filter.status')}>
          <Segmented<'active' | 'voided' | 'all'>
            label={t('ledger.filter.status')}
            value={draft.status ?? 'active'}
            onChange={(s) => setDraft((d) => ({ ...d, status: s }))}
            options={[
              { value: 'active', label: t('ledger.filter.status.active') },
              { value: 'voided', label: t('ledger.filter.status.voided') },
              { value: 'all', label: t('ledger.filter.status.all') },
            ]}
          />
        </Group>
        {fixedAccount ? null : (
          <Group title={t('ledger.filter.account')}>
            <div className="lg-fs__chips">
              {activeAccounts.map((a) => (
                <Chip key={a.id} selected={draft.accountIds?.includes(a.id) === true} onClick={() => setDraft((d) => ({ ...d, accountIds: toggle(d.accountIds, a.id) }))}>
                  {a.name}
                </Chip>
              ))}
            </div>
          </Group>
        )}
        <Group title={t('ledger.filter.amount')}>
          <div className="lg-fs__pair">
            <FormField label={t('ledger.filter.min')} error={amountError ?? undefined}>
              <Input value={min} inputMode="decimal" onChange={(e) => setMin(e.currentTarget.value)} autoComplete="off" />
            </FormField>
            <FormField label={t('ledger.filter.max')}>
              <Input value={max} inputMode="decimal" onChange={(e) => setMax(e.currentTarget.value)} autoComplete="off" />
            </FormField>
          </div>
        </Group>
        <FormField label={t('ledger.filter.text')}>
          <Input type="search" value={draft.text ?? ''} onChange={(e) => setDraft((d) => ({ ...d, text: e.currentTarget.value }))} autoComplete="off" />
        </FormField>
        {usable.map((f) => (
          <FieldFilter key={f.id} field={f} cond={cond(f.id)} onChange={(c) => setCond(f.id, c)} today={today} />
        ))}
      </div>
    </Sheet>
  );
}

function FieldFilter({ field, cond, onChange, today }: { field: Field; cond: FieldCondition | undefined; onChange: (c: FieldCondition | null) => void; today: string }) {
  const t = useT();
  const title = field.active ? field.label : t('ledger.filter.inactiveField', { label: field.label });
  switch (field.type) {
    case 'list': {
      const selected = cond?.op === 'any_of' ? cond.optionIds : [];
      const options = field.options.filter((o) => o.active || selected.includes(o.id));
      return (
        <Group title={title}>
          <div className="lg-fs__chips">
            {options.map((o) => (
              <Chip
                key={o.id}
                selected={selected.includes(o.id)}
                {...(o.color === null ? {} : { tint: cssColor(o.color) })}
                onClick={() => {
                  const next = toggle(selected, o.id);
                  onChange(next.length === 0 ? null : { fieldId: field.id, op: 'any_of', optionIds: next });
                }}
              >
                {o.label}
              </Chip>
            ))}
            <Chip selected={cond?.op === 'empty'} onClick={() => onChange(cond?.op === 'empty' ? null : { fieldId: field.id, op: 'empty' })}>
              {t('ledger.filter.empty')}
            </Chip>
          </div>
        </Group>
      );
    }
    case 'bool': {
      const value = cond?.op === 'is' ? (cond.value ? 'yes' : 'no') : 'any';
      return (
        <Group title={title}>
          <Segmented<'any' | 'yes' | 'no'>
            label={title}
            value={value}
            onChange={(v) => onChange(v === 'any' ? null : { fieldId: field.id, op: 'is', value: v === 'yes' })}
            options={[
              { value: 'any', label: t('ledger.filter.any') },
              { value: 'yes', label: t('ledger.value.yes') },
              { value: 'no', label: t('ledger.value.no') },
            ]}
          />
        </Group>
      );
    }
    case 'text':
      return (
        <FormField label={title}>
          <Input
            value={cond?.op === 'contains' ? cond.value : ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              onChange(v.trim() === '' ? null : { fieldId: field.id, op: 'contains', value: v });
            }}
            autoComplete="off"
          />
        </FormField>
      );
    case 'number': {
      const c = cond?.op === 'between' ? cond : { fieldId: field.id, op: 'between' as const };
      const set = (key: 'min' | 'max', text: string) => {
        const n = text.trim() === '' ? undefined : Number(text);
        const next = { ...c, [key]: n !== undefined && Number.isFinite(n) ? n : undefined };
        if (next.min === undefined) delete next.min;
        if (next.max === undefined) delete next.max;
        onChange(next.min === undefined && next.max === undefined ? null : next);
      };
      return (
        <Group title={title}>
          <div className="lg-fs__pair">
            <FormField label={t('ledger.filter.min')}>
              <Input inputMode="decimal" defaultValue={c.min ?? ''} onChange={(e) => set('min', e.currentTarget.value)} />
            </FormField>
            <FormField label={t('ledger.filter.max')}>
              <Input inputMode="decimal" defaultValue={c.max ?? ''} onChange={(e) => set('max', e.currentTarget.value)} />
            </FormField>
          </div>
        </Group>
      );
    }
    case 'date': {
      const c = cond?.op === 'date_between' ? cond : { fieldId: field.id, op: 'date_between' as const };
      const set = (key: 'from' | 'to', iso: string) => {
        const next = { ...c, [key]: iso === '' ? undefined : iso };
        if (next.from === undefined) delete next.from;
        if (next.to === undefined) delete next.to;
        onChange(next.from === undefined && next.to === undefined ? null : next);
      };
      return (
        <Group title={title}>
          <div className="lg-fs__pair">
            <FormField label={t('ui.period.from')}>
              <DateField value={c.from ?? ''} onChange={(v) => set('from', v)} today={today} quick={false} />
            </FormField>
            <FormField label={t('ui.period.to')}>
              <DateField value={c.to ?? ''} onChange={(v) => set('to', v)} today={today} quick={false} />
            </FormField>
          </div>
        </Group>
      );
    }
  }
}
