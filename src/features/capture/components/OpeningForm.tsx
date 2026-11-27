// Editar el saldo inicial de una cuenta: monto, a favor o en contra, y fecha (`transactions.setOpening`).
import { Scale } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useSheet } from '../../../app/registry/sheet';
import type { Direction, Minor, Transaction } from '../../../core';
import { t as tGlobal, useT } from '../../../i18n';
import { DateField, InfoTip, Segmented } from '../../../ui';
import { useCurrency, useKeypadMode, useToday } from '../hooks';
import { exprFromMinor } from '../logic/amount';
import { AmountEntry } from './AmountEntry';

export function OpeningForm({ original }: { original: Transaction }) {
  const t = useT('capture');
  const sheet = useSheet();
  const keypad = useKeypadMode();
  const today = useToday();
  const currency = useCurrency();
  const account = (useAccounts({ includeArchived: true }).data ?? []).find((a) => a.id === original.accountId);
  const initialExpr = exprFromMinor(original.amountMinor, currency.minorDigits);
  const [expr, setExpr] = useState(initialExpr);
  const [direction, setDirection] = useState<Direction>(original.direction);
  const [date, setDate] = useState(original.date);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { setDirty } = sheet;
  useEffect(() => setDirty(expr !== initialExpr || direction !== original.direction || date !== original.date), [expr, direction, date, initialExpr, original, setDirty]);

  const save = useCuadraMutation(
    (c, input: { amountMinor: Minor; direction: Direction; date: string }) => c.transactions.setOpening(original.accountId, input),
    { successToast: 'capture.toast.updated', errorToast: false },
  );
  const submit = async (amountMinor: Minor) => {
    setSaveError(null);
    try {
      const unchanged = amountMinor === original.amountMinor && direction === original.direction && date === original.date;
      if (!unchanged) await save.mutateAsync({ amountMinor, direction, date });
      setDirty(false);
      sheet.close();
    } catch (e) {
      setSaveError(errorMessage(e, tGlobal));
    }
  };

  return (
    <div className={keypad ? 'cap-entry cap-entry--keypad' : 'cap-entry cap-entry--form'} data-kind="opening">
      <p className="cap-xfer__head">
        <Scale aria-hidden="true" />
        {t('opening.title', { account: account?.name ?? '' })}
        <InfoTip>{t('opening.info')}</InfoTip>
      </p>
      <Segmented<Direction>
        label={t('opening.direction')}
        options={[
          { value: 'in', label: t('opening.in') },
          { value: 'out', label: t('opening.out') },
        ]}
        value={direction}
        onChange={setDirection}
        fullWidth
      />
      <AmountEntry
        keypad={keypad}
        kind="opening"
        expr={expr}
        onExprChange={(e) => {
          setExpr(e);
          setSaveError(null);
        }}
        onSubmit={(m) => void submit(m)}
        submitLabel={t('saveChanges')}
        busy={save.isPending}
        error={saveError}
        autoFocus
      >
        <div className="cap-group">
          <span className="cap-label">{t('date.label')}</span>
          <DateField value={date} onChange={(d) => d !== '' && setDate(d)} today={today} />
        </div>
      </AmountEntry>
    </div>
  );
}

