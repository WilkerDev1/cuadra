// Editor de filtros en hoja (inferior en móvil, lateral en escritorio). Cada cambio se aplica al momento.
import type { Account, Field } from '../../../core';
import { useT } from '../../../i18n';
import { Button, Chip, Field as FormField, Input, Segmented, Sheet } from '../../../ui';
import { boolValue, selectedOptions, setBool, setText, toggleAccount, toggleKind, toggleOption } from '../model/filters';
import { cleanFilters, type Filters } from '../model/state';

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  onChange: (f: Filters) => void;
  accounts: readonly Account[];
  fields: readonly Field[];
}

export function FiltersSheet({ open, onClose, filters, onChange, accounts, fields }: FiltersSheetProps) {
  const t = useT();
  const lists = fields.filter((f) => f.type === 'list' && (f.active || selectedOptions(filters, f.id).length > 0));
  const bools = fields.filter((f) => f.type === 'bool' && (f.active || boolValue(filters, f.id) !== null));
  const shownAccounts = accounts.filter((a) => a.archivedAt === null || (filters.accountIds ?? []).includes(a.id));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('insights.filters.edit')}
      variant="auto"
      footer={
        <div className="ins-sheet-actions">
          <Button variant="ghost" disabled={Object.keys(cleanFilters(filters)).length === 0} onClick={() => onChange({})}>
            {t('insights.filters.clear')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('insights.filters.done')}
          </Button>
        </div>
      }
    >
      <div className="ins-filters">
        <fieldset className="ins-filters__group">
          <legend>{t('insights.filters.kind')}</legend>
          <div className="ins-chips">
            {(['income', 'expense'] as const).map((k) => (
              <Chip key={k} selected={(filters.kinds ?? []).includes(k)} onClick={() => onChange(toggleKind(filters, k))}>
                {t(k === 'income' ? 'insights.measure.in' : 'insights.measure.out')}
              </Chip>
            ))}
          </div>
        </fieldset>
        {shownAccounts.length > 1 ? (
          <fieldset className="ins-filters__group">
            <legend>{t('insights.filters.account')}</legend>
            <div className="ins-chips">
              {shownAccounts.map((a) => (
                <Chip key={a.id} selected={(filters.accountIds ?? []).includes(a.id)} onClick={() => onChange(toggleAccount(filters, a.id))}>
                  {a.name}
                </Chip>
              ))}
            </div>
          </fieldset>
        ) : null}
        {lists.map((f) => {
          const sel = selectedOptions(filters, f.id);
          const options = f.options.filter((o) => (o.active && o.mergedIntoId === null) || sel.includes(o.id));
          if (options.length === 0) return null;
          return (
            <fieldset key={f.id} className="ins-filters__group">
              <legend>{f.label}</legend>
              <div className="ins-chips">
                {options.map((o) => (
                  <Chip key={o.id} selected={sel.includes(o.id)} onClick={() => onChange(toggleOption(filters, f.id, o.id))}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
          );
        })}
        {bools.map((f) => {
          const v = boolValue(filters, f.id);
          return (
            <fieldset key={f.id} className="ins-filters__group">
              <legend>{f.label}</legend>
              <Segmented
                label={f.label}
                value={v === null ? 'any' : v ? 'yes' : 'no'}
                options={[
                  { value: 'any', label: t('insights.filters.any') },
                  { value: 'yes', label: t('insights.filters.yes') },
                  { value: 'no', label: t('insights.filters.no') },
                ]}
                onChange={(x) => onChange(setBool(filters, f.id, x === 'any' ? null : x === 'yes'))}
              />
            </fieldset>
          );
        })}
        <FormField label={t('insights.filters.text')} help={t('insights.filters.textHelp')}>
          <Input type="search" value={filters.text ?? ''} onChange={(e) => onChange(setText(filters, e.currentTarget.value))} />
        </FormField>
      </div>
    </Sheet>
  );
}
