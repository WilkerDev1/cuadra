// Configuración del informe: tipo, periodo, cuentas, agrupación y opciones. Se aplica al instante (vista previa viva).
import type { ReactNode } from 'react';
import { Save } from 'lucide-react';
import type { Account, Field } from '../../core';
import { systemClock } from '../../core';
import { useT } from '../../i18n';
import { Button, Chip, InfoTip, PeriodPicker, Segmented, Switch } from '../../ui';
import { MAX_GROUPS, REPORT_PERIODS, groupableFields, toggleLimited, type ReportConfig, type ReportForm } from './model';

export interface ConfigFormProps {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  accounts: readonly Account[];
  fields: readonly Field[];
  /** Guardar la configuración como vista de informe nueva. */
  onSaveAs: () => void;
  /** Solo en una vista guardada con cambios. */
  onUpdate?: (() => void) | undefined;
  updating?: boolean;
}

function Group({ legend, aside, children }: { legend: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="rep-group">
      <legend className="rep-group__legend">
        {legend}
        {aside}
      </legend>
      {children}
    </fieldset>
  );
}

export function ConfigForm({ config, onChange, accounts, fields, onSaveAs, onUpdate, updating }: ConfigFormProps) {
  const t = useT('reports');
  const dims = groupableFields(fields);
  const set = (patch: Partial<ReportConfig>) => onChange({ ...config, ...patch });
  const full = config.groupByFieldIds.length >= MAX_GROUPS;

  return (
    <div className="rep-form">
      <Segmented<ReportForm>
        label={t('form.label')}
        fullWidth
        value={config.form}
        onChange={(form) => set({ form })}
        options={[
          { value: 'summary', label: t('form.summary') },
          { value: 'detailed', label: t('form.detailed') },
        ]}
      />

      <Group legend={t('cfg.period')}>
        <PeriodPicker value={config.period} onChange={(period) => set({ period })} today={systemClock.today()} presets={REPORT_PERIODS} />
      </Group>

      <Group legend={t('cfg.accounts')} aside={<InfoTip>{t('cfg.accounts.hint')}</InfoTip>}>
        <div className="rep-chips">
          {accounts.map((a) => (
            <Chip
              key={a.id}
              selected={config.accountIds.includes(a.id)}
              onClick={() => set({ accountIds: toggleLimited(config.accountIds, a.id, accounts.length) })}
            >
              {a.name}
            </Chip>
          ))}
        </div>
      </Group>

      <Group legend={t('cfg.group')} aside={<InfoTip>{t('cfg.group.hint')}</InfoTip>}>
        {dims.length === 0 ? (
          <p className="meta">{t('cfg.group.none')}</p>
        ) : (
          <div className="rep-chips">
            {dims.map((f) => {
              const on = config.groupByFieldIds.includes(f.id);
              return (
                <Chip
                  key={f.id}
                  selected={on}
                  disabled={full && !on}
                  onClick={() => set({ groupByFieldIds: toggleLimited(config.groupByFieldIds, f.id, MAX_GROUPS) })}
                >
                  {f.label}
                </Chip>
              );
            })}
          </div>
        )}
      </Group>

      <div className="rep-switches">
        <div className="rep-switch">
          <Switch label={t('cfg.voided')} checked={config.includeVoided} onChange={(includeVoided) => set({ includeVoided })} />
          <InfoTip>{t('cfg.voided.hint')}</InfoTip>
        </div>
        <Switch label={t('cfg.signature')} checked={config.signature} onChange={(signature) => set({ signature })} />
      </div>

      <div className="rep-form__save">
        {onUpdate === undefined ? null : (
          <Button variant="secondary" icon={Save} loading={updating === true} onClick={onUpdate}>
            {t('cfg.update')}
          </Button>
        )}
        <Button variant={onUpdate === undefined ? 'secondary' : 'ghost'} {...(onUpdate === undefined ? { icon: Save } : {})} onClick={onSaveAs}>
          {t('cfg.save')}
        </Button>
      </div>
    </div>
  );
}
