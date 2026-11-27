import { useId } from 'react';
import type { AccountWithBalance, DateFormat, Field as CuadraField, RawTable } from '../../../core';
import { useT } from '../../../i18n';
import { Chip, Field, InfoTip, Input, Select, Switch, type SelectOption } from '../../../ui';
import {
  assignTarget,
  distinctValues,
  fieldIdOf,
  isFieldTarget,
  sampleValues,
  type MapOptions,
  type MappingProblem,
  type Target,
} from '../logic';

export interface StepColumnsProps {
  raw: RawTable;
  accounts: readonly AccountWithBalance[];
  fields: readonly CuadraField[];
  accountId: string;
  onAccount: (id: string) => void;
  targets: readonly Target[];
  onTargets: (t: Target[]) => void;
  options: MapOptions;
  onOptions: (o: MapOptions) => void;
  problems: readonly MappingProblem[];
  /** Mostrar los problemas (tras intentar avanzar). */
  showProblems: boolean;
}

const DATE_FORMATS: DateFormat[] = ['auto', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'd/M/yy', 'excel_serial'];
const LOCALES = ['auto', 'es-DO', 'es-ES'] as const;

/** Paso 2 · qué es cada columna: nombre, muestra y destino; más formatos y la cuenta de destino. */
export function StepColumns({ raw, accounts, fields, accountId, onAccount, targets, onTargets, options, onOptions, problems, showProblems }: StepColumnsProps) {
  const t = useT();
  const ids = useId();
  const activeFields = fields.filter((f) => f.active);
  const targetOptions: SelectOption[] = [
    { value: 'ignore', label: t('import.target.ignore') },
    { value: 'date', label: t('import.target.date') },
    { value: 'description', label: t('import.target.description') },
    { value: 'amount', label: t('import.target.amount') },
    { value: 'in', label: t('import.target.in') },
    { value: 'out', label: t('import.target.out') },
    { value: 'type', label: t('import.target.type') },
    { value: 'account', label: t('import.target.account') },
    { value: 'notes', label: t('import.target.notes') },
    ...activeFields.map((f) => ({ value: `field:${f.id}`, label: f.label })),
  ];

  const typeColumn = targets.indexOf('type');
  const typeValues = typeColumn >= 0 ? distinctValues(raw, typeColumn) : [];
  const hasDescription = targets.includes('description');
  const listFieldAssigned = targets.some((tg) => isFieldTarget(tg) && fields.find((f) => f.id === fieldIdOf(tg))?.type === 'list');
  const problemText = (p: MappingProblem) => t(`import.problem.${p}`);
  const has = (p: MappingProblem) => showProblems && problems.includes(p);
  const typeName = typeColumn >= 0 ? raw.headers[typeColumn] || t('import.cols.unnamed', { n: typeColumn + 1 }) : '';

  return (
    <div className="imp-stack">
      <Field label={t('import.cols.account')} help={t('import.cols.accountHelp')} error={showProblems && accountId === '' ? t('import.problem.account_missing') : undefined}>
        <Select options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={accountId} onChange={onAccount} />
      </Field>

      <div className="imp-cols" role="group" aria-label={t('import.step.columns')}>
        <div className="imp-cols__head" aria-hidden="true">
          <span>{t('import.cols.header')}</span>
          <span>{t('import.cols.samples')}</span>
          <span>{t('import.cols.goesTo')}</span>
        </div>
        <ul role="list" className="imp-cols__list">
          {raw.headers.map((header, column) => {
            const name = header === '' ? t('import.cols.unnamed', { n: column + 1 }) : header;
            const samples = sampleValues(raw, column);
            const target = targets[column] ?? 'ignore';
            return (
              <li key={column} className={target === 'ignore' ? 'imp-col imp-col--ignored' : 'imp-col'}>
                <span className="imp-col__name">{name}</span>
                <span className="imp-col__samples">
                  {samples.length === 0 ? <span className="imp-col__empty">{t('import.cols.empty')}</span> : samples.map((s, i) => <span key={i}>{s}</span>)}
                </span>
                <span className="imp-col__select">
                  <Select
                    aria-label={t('import.cols.goesToFor', { name })}
                    options={targetOptions}
                    value={target}
                    onChange={(v) => onTargets(assignTarget(targets, column, v as Target))}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {showProblems && problems.length > 0 ? (
        <ul role="list" className="imp-problems" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{problemText(p)}</li>
          ))}
        </ul>
      ) : null}

      <div className="imp-opts">
        <Field label={t('import.cols.dateFormat')}>
          <Select
            options={DATE_FORMATS.map((f) => ({ value: f, label: t(`import.date.${f}`) }))}
            value={options.dateFormat}
            onChange={(v) => onOptions({ ...options, dateFormat: v as DateFormat })}
          />
        </Field>
        <Field label={t('import.cols.amountFormat')} aside={<InfoTip>{t('import.cols.tipAmounts')}</InfoTip>}>
          <Select
            options={LOCALES.map((l) => ({ value: l, label: t(`import.locale.${l}`) }))}
            value={options.amountLocale}
            onChange={(v) => onOptions({ ...options, amountLocale: v })}
          />
        </Field>
        {!hasDescription ? (
          <Field label={t('import.cols.fixedDesc')} help={t('import.cols.fixedDescHelp')} error={has('description_missing') ? problemText('description_missing') : undefined}>
            <Input value={options.fixedDescription} maxLength={120} autoComplete="off" onChange={(e) => onOptions({ ...options, fixedDescription: e.target.value })} />
          </Field>
        ) : null}
      </div>

      {typeColumn >= 0 ? (
        <fieldset className="imp-invalues">
          <legend className="imp-legend">{t('import.cols.inValues', { name: typeName })}</legend>
          <div className="imp-chips">
            {typeValues.map((v) => {
              const selected = options.inValues.includes(v);
              return (
                <Chip
                  key={v}
                  selected={selected}
                  onClick={() => onOptions({ ...options, inValues: selected ? options.inValues.filter((x) => x !== v) : [...options.inValues, v] })}
                >
                  {v}
                </Chip>
              );
            })}
          </div>
          <p className="imp-note" id={`${ids}-inv`}>
            {t('import.cols.inValuesHelp')}
          </p>
        </fieldset>
      ) : null}

      {listFieldAssigned ? (
        <Switch
          label={t('import.cols.createOptions')}
          description={t('import.cols.createOptionsDesc')}
          checked={options.createMissingOptions}
          onChange={(v) => onOptions({ ...options, createMissingOptions: v })}
        />
      ) : null}
    </div>
  );
}
