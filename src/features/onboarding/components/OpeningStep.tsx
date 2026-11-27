import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getLocale } from '../../../i18n/format';
import { useT } from '../../../i18n';
import {
  ACCOUNT_ICON,
  AmountKeypad,
  AmountText,
  Banner,
  Button,
  Segmented,
  Sheet,
  Total,
  type AmountKeypadHandle,
} from '../../../ui';
import { useDraft } from '../draft';
import type { TemplateEntry } from '../entries';
import {
  defaultDirection,
  hasOpenings,
  minorToExpression,
  openingTotal,
  type CurrencyOption,
  type OpeningEntry,
} from '../logic';
import type { Direction } from '../../../core';

interface Account {
  key: string;
  name: string;
  type: TemplateEntry['preview']['accounts'][number]['type'];
}

function OpeningSheet({
  account,
  currency,
  entry,
  open,
  onSave,
  onRemove,
  onClose,
}: {
  account: Account;
  currency: CurrencyOption;
  entry: OpeningEntry | undefined;
  open: boolean;
  onSave: (entry: OpeningEntry) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const pad = useRef<AmountKeypadHandle>(null);
  const [direction, setDirection] = useState<Direction>(entry?.direction ?? defaultDirection(account.type));
  const [expr, setExpr] = useState(entry === undefined ? '' : minorToExpression(entry.amountMinor, currency.minorDigits));

  // Cada vez que se abre sobre una cuenta, vuelve a empezar desde su saldo actual.
  useEffect(() => {
    if (!open) return;
    setDirection(entry?.direction ?? defaultDirection(account.type));
    setExpr(entry === undefined ? '' : minorToExpression(entry.amountMinor, currency.minorDigits));
    const id = window.setTimeout(() => pad.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [open, account.key]);

  return (
    <Sheet open={open} onClose={onClose} title={t('onboarding.opening.edit', { name: account.name })} variant="auto" height="tall">
      <div className="onb-sheet">
        <Segmented
          label={t('onboarding.opening.direction')}
          fullWidth
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'in', label: t('onboarding.opening.have') },
            { value: 'out', label: t('onboarding.opening.owe'), tone: 'var(--out)' },
          ]}
        />
        <AmountKeypad
          ref={pad}
          variant="opening"
          kind="opening"
          currency={currency}
          locale={getLocale()}
          expression={expr}
          onExpressionChange={(e) => setExpr(e)}
          showKindWord={false}
          label={t('onboarding.opening.edit', { name: account.name })}
          onSubmit={(minor) => onSave({ amountMinor: minor, direction })}
        />
        {entry === undefined ? null : (
          <Button variant="ghost" onClick={onRemove}>
            {t('onboarding.opening.remove')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Paso 3: una fila por cuenta de la plantilla; tocar una abre el teclado de saldos en una hoja. */
export function OpeningStep({
  entry,
  currency,
  creating,
  error,
  onCreate,
}: {
  entry: TemplateEntry;
  currency: CurrencyOption;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  const t = useT();
  const openings = useDraft((s) => s.openings);
  const setOpening = useDraft((s) => s.setOpening);
  const [editing, setEditing] = useState<{ account: Account; open: boolean } | null>(null);
  const any = hasOpenings(openings);
  const total = openingTotal(openings);

  return (
    <div className="onb-step">
      <h1 className="onb-h1" tabIndex={-1}>
        {t('onboarding.opening.title')}
      </h1>

      <ul className="onb-accts" role="list">
        {entry.preview.accounts.map((a) => {
          const Icon = ACCOUNT_ICON[a.type];
          const op = openings[a.key];
          return (
            <li key={a.key}>
              <button type="button" className="onb-acct" onClick={() => setEditing({ account: a, open: true })}>
                <Icon aria-hidden="true" className="onb-acct__icon" />
                <span className="onb-acct__name">
                  <span>{a.name}</span>
                  <span className="onb-acct__type">{t(`ui.account.${a.type}`)}</span>
                </span>
                {op === undefined ? (
                  <span className="onb-acct__none">
                    <Plus aria-hidden="true" />
                    {t('onboarding.opening.none')}
                  </span>
                ) : (
                  <AmountText
                    minor={op.direction === 'in' ? op.amountMinor : -op.amountMinor}
                    currency={currency}
                    locale={getLocale()}
                    size="row"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {any ? <Total label={t('onboarding.opening.total')} minor={total} currency={currency} /> : null}

      {error === null ? null : <Banner tone="warn">{error}</Banner>}

      <div className="onb-actions onb-actions--stack">
        <Button variant="primary" fullWidth loading={creating} onClick={onCreate}>
          {t('onboarding.opening.create')}
        </Button>
        {any ? null : (
          <Button variant="ghost" fullWidth disabled={creating} onClick={onCreate}>
            {t('onboarding.opening.later')}
          </Button>
        )}
      </div>

      {editing === null ? null : (
        <OpeningSheet
          account={editing.account}
          currency={currency}
          entry={openings[editing.account.key]}
          open={editing.open}
          onClose={() => setEditing((e) => (e === null ? e : { ...e, open: false }))}
          onSave={(op) => {
            setOpening(editing.account.key, op);
            setEditing((e) => (e === null ? e : { ...e, open: false }));
          }}
          onRemove={() => {
            setOpening(editing.account.key, null);
            setEditing((e) => (e === null ? e : { ...e, open: false }));
          }}
        />
      )}
    </div>
  );
}
