// Diálogos de cuenta: crear, renombrar/cambiar tipo y saldo inicial.
import { useEffect, useState, type FormEvent } from 'react';
import { Money, systemClock, type AccountType, type AccountWithBalance, type Currency, type Direction } from '../../../core';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useMoneyParse, useTransaction, useWorkspaceId } from '../../../app/data/hooks';
import { errorMessage } from '../../../app/data/errorMessage';
import { useT } from '../../../i18n';
import { DateField, Dialog, Field, Input, Segmented, Select } from '../../../ui';
import { parseOpening, TYPE_ORDER } from '../logic/accounts';

type Mode = { kind: 'create' } | { kind: 'edit'; account: AccountWithBalance } | { kind: 'opening'; account: AccountWithBalance };

export interface AccountDialogProps {
  mode: Mode | null;
  currency: Currency;
  onClose: () => void;
}

/** Un solo diálogo según el modo; `mode === null` lo cierra. */
export function AccountDialog({ mode, currency, onClose }: AccountDialogProps) {
  if (mode === null) return <Dialog open={false} onClose={onClose} title="" />;
  if (mode.kind === 'opening') return <OpeningDialog account={mode.account} currency={currency} onClose={onClose} />;
  return <AccountEditDialog mode={mode} currency={currency} onClose={onClose} />;
}

function useTypeOptions() {
  const t = useT();
  return TYPE_ORDER.map((type) => ({ value: type, label: t(`accounts.type.${type}`) }));
}

function DirectionPicker({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  const t = useT();
  return (
    <Segmented<Direction>
      label={t('accounts.opening.direction')}
      value={value}
      onChange={onChange}
      fullWidth
      options={[
        { value: 'in', label: t('accounts.opening.positive') },
        { value: 'out', label: t('accounts.opening.negative'), tone: 'var(--out)' },
      ]}
    />
  );
}

function AccountEditDialog({ mode, currency, onClose }: { mode: Exclude<Mode, { kind: 'opening' }>; currency: Currency; onClose: () => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const parse = useMoneyParse();
  const editing = mode.kind === 'edit' ? mode.account : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<AccountType>(editing?.type ?? 'cash');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<Direction>('in');
  const [date, setDate] = useState(systemClock.today());
  const [error, setError] = useState<{ field: 'name' | 'amount'; message: string } | null>(null);

  const create = useCuadraMutation(
    (c, input: Parameters<typeof c.accounts.create>[0]) => c.accounts.create(input),
    { successToast: (a) => ({ key: 'accounts.toast.created', params: { name: a.name } }), errorToast: false },
  );
  const update = useCuadraMutation(
    (c, input: { id: string; name: string; type: AccountType }) => c.accounts.update(input.id, { name: input.name, type: input.type }),
    { successToast: 'accounts.toast.saved', errorToast: false },
  );
  const busy = create.isPending || update.isPending;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (name.trim() === '') {
      setError({ field: 'name', message: t('errors.name_required') });
      return;
    }
    try {
      if (editing !== null) {
        await update.mutateAsync({ id: editing.id, name: name.trim(), type });
      } else {
        let opening: { amountMinor: number; direction: Direction; date: string } | undefined;
        if (amount.trim() !== '') {
          const r = parseOpening({ amount, direction, date }, (s) => parse(s));
          if (!r.ok) {
            setError({ field: 'amount', message: t(`accounts.error.${r.error}`) });
            return;
          }
          opening = r.value;
        }
        await create.mutateAsync({ workspaceId: ws, name: name.trim(), type, ...(opening === undefined ? {} : { opening }) });
      }
      onClose();
    } catch (err) {
      setError({ field: 'name', message: errorMessage(err, t) });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing === null ? t('accounts.create.title') : t('accounts.edit.title', { name: editing.name })}
      confirmLabel={editing === null ? t('accounts.create.confirm') : t('accounts.edit.confirm')}
      onConfirm={() => void submit()}
      confirmLoading={busy}
    >
      <form className="acc-form" onSubmit={(e) => void submit(e)}>
        <Field label={t('accounts.field.name')} error={error?.field === 'name' ? error.message : undefined}>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" placeholder={t('accounts.field.namePlaceholder')} />
        </Field>
        <Field label={t('accounts.field.type')}>
          <Select options={useTypeOptions()} value={type} onChange={(v) => setType(v as AccountType)} />
        </Field>
        {editing === null ? (
          <fieldset className="acc-form__group">
            <legend>{t('accounts.opening.optional')}</legend>
            <Field label={t('accounts.opening.amount')} error={error?.field === 'amount' ? error.message : undefined}>
              <Input
                value={amount}
                inputMode="decimal"
                prefix={currency.symbol ?? currency.code}
                onChange={(e) => setAmount(e.currentTarget.value)}
                autoComplete="off"
              />
            </Field>
            <DirectionPicker value={direction} onChange={setDirection} />
            <Field label={t('accounts.opening.date')}>
              <DateField value={date} onChange={setDate} today={systemClock.today()} />
            </Field>
          </fieldset>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function OpeningDialog({ account, currency, onClose }: { account: AccountWithBalance; currency: Currency; onClose: () => void }) {
  const t = useT();
  const parse = useMoneyParse();
  const existing = useTransaction(account.openingTransactionId);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<Direction>('in');
  const [date, setDate] = useState(systemClock.today());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(account.openingTransactionId === null);

  useEffect(() => {
    const tx = existing.data;
    if (tx === undefined || loaded) return;
    setAmount(Money.toDecimalString(tx.amountMinor, currency.minorDigits));
    setDirection(tx.direction);
    setDate(tx.date);
    setLoaded(true);
  }, [existing.data, loaded, currency.minorDigits]);

  const save = useCuadraMutation(
    (c, input: { amountMinor: number; direction: Direction; date: string }) => c.transactions.setOpening(account.id, input),
    { successToast: { key: 'accounts.toast.opening', params: { name: account.name } }, errorToast: false },
  );

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const r = parseOpening({ amount, direction, date }, (s) => parse(s));
    if (!r.ok) {
      setError(t(`accounts.error.${r.error}`));
      return;
    }
    try {
      await save.mutateAsync(r.value);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('accounts.opening.title', { name: account.name })}
      confirmLabel={t('accounts.opening.confirm')}
      onConfirm={() => void submit()}
      confirmLoading={save.isPending}
    >
      <form className="acc-form" onSubmit={(e) => void submit(e)}>
        <Field label={t('accounts.opening.amount')} error={error ?? undefined}>
          <Input
            value={amount}
            inputMode="decimal"
            prefix={currency.symbol ?? currency.code}
            onChange={(e) => setAmount(e.currentTarget.value)}
            autoComplete="off"
            disabled={!loaded}
          />
        </Field>
        <DirectionPicker value={direction} onChange={setDirection} />
        <Field label={t('accounts.opening.date')}>
          <DateField value={date} onChange={setDate} today={systemClock.today()} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
