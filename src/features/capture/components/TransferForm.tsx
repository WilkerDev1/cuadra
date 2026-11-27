// Transferencia (DESIGN §10.7): fichas Desde/Hacia con su saldo, invertir, monto, fecha y nota, y la vista previa
// de los saldos resultantes. Al editar, las cuentas quedan fijas y solo cambia monto, fecha, nota y notas.
import { ArrowDownUp, ArrowLeftRight, CalendarDays, ChevronDown, StickyNote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useSheet } from '../../../app/registry/sheet';
import { addDays, type Id, type IsoDate, type Minor, type Transaction, type TransferDraft, type TxPatch } from '../../../core';
import { formatDate } from '../../../i18n/format';
import { t as tGlobal, useT } from '../../../i18n';
import { ACCOUNT_ICON, AmountText, Button, Chip, DateField, Field, IconButton, InfoTip, Input, Segmented, Textarea, cx, evaluateExpression, type SegmentedOption } from '../../../ui';
import { useCurrency, useKeypadMode, useSignedAmount, useSoftWarnings, useToday } from '../hooks';
import { choose, defaultPair, previewBalances, swap, validateTransfer, type TransferPair } from '../logic/transfer';
import { AccountPicker } from './AccountPicker';
import { AmountEntry } from './AmountEntry';
import { SoftWarnings } from './SoftWarnings';

export interface TransferInitial {
  fromId: Id | null;
  toId: Id | null;
  expr: string;
  date: IsoDate;
  description: string;
  notes: string;
}

export interface TransferFormProps {
  initial: TransferInitial;
  /** Editar: el lado guardado (cualquiera de los dos). */
  original?: Transaction;
}

type SegValue = 'income' | 'expense' | 'transfer';

export function TransferForm({ initial, original }: TransferFormProps) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const sheet = useSheet();
  const keypad = useKeypadMode();
  const today = useToday();
  const currency = useCurrency();
  const money = useSignedAmount();
  const editing = original !== undefined;
  const accounts = useAccounts({ includeArchived: editing }).data ?? [];

  const [pair, setPair] = useState<TransferPair>(() => (editing ? { fromId: initial.fromId, toId: initial.toId } : defaultPair(accounts, initial.fromId, initial.toId)));
  const [expr, setExpr] = useState(initial.expr);
  const [minor, setMinor] = useState<Minor | null>(() => {
    const r = evaluateExpression(initial.expr, currency.minorDigits);
    return r.ok && r.minor > 0 ? r.minor : null;
  });
  const [date, setDate] = useState(initial.date);
  const [description, setDescription] = useState(initial.description);
  const [notes, setNotes] = useState(initial.notes);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [panel, setPanel] = useState<'date' | 'note' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // La primera vez que llegan las cuentas (enlace directo), se arma el par por defecto.
  useEffect(() => {
    if (!editing && pair.fromId === null && accounts.length > 0) setPair(defaultPair(accounts, initial.fromId, initial.toId));
  }, [accounts, editing, initial.fromId, initial.toId, pair.fromId]);

  const { setDirty } = sheet;
  useEffect(() => {
    setDirty(expr !== initial.expr || description.trim() !== initial.description || notes.trim() !== initial.notes || date !== initial.date);
  }, [expr, description, notes, date, initial, setDirty]);

  const from = accounts.find((a) => a.id === pair.fromId);
  const to = accounts.find((a) => a.id === pair.toId);
  const fallbackDescription = from !== undefined && to !== undefined ? t('transfer.defaultDescription', { from: from.name, to: to.name }) : '';
  const effectiveDescription = description.trim() === '' ? fallbackDescription : description.trim();
  const errors = validateTransfer(pair, minor);
  const draft: TransferDraft | null =
    errors.length === 0 && minor !== null && pair.fromId !== null && pair.toId !== null
      ? {
          fromAccountId: pair.fromId,
          toAccountId: pair.toId,
          amountMinor: minor,
          date,
          description: effectiveDescription,
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        }
      : null;
  const warnings = useSoftWarnings(draft, original?.id);
  const previous = original?.amountMinor ?? 0;
  const lines = previewBalances(accounts, pair, minor ?? previous, previous);

  const create = useCuadraMutation((c, d: TransferDraft) => c.transactions.createTransfer(d), {
    successToast: (r) => ({
      key: 'capture.toast.transferred',
      params: { amount: money(r.out.amountMinor), from: from?.name ?? '', to: to?.name ?? '' },
    }),
    undo: (c, r) => c.transactions.void(r.out.id, tGlobal('capture.undoReason')),
    errorToast: false,
  });
  const update = useCuadraMutation((c, input: { id: Id; patch: TxPatch }) => c.transactions.update(input.id, input.patch), {
    successToast: 'capture.toast.updated',
    errorToast: false,
  });
  const busy = create.isPending || update.isPending;

  const save = async (amount: Minor) => {
    setShowErrors(true);
    const errs = validateTransfer(pair, amount);
    if (errs.length > 0 || pair.fromId === null || pair.toId === null) return;
    setSaveError(null);
    try {
      if (original !== undefined) {
        const p: TxPatch = {};
        if (amount !== original.amountMinor) p.amountMinor = amount;
        if (date !== original.date) p.date = date;
        if (effectiveDescription !== original.description) p.description = effectiveDescription;
        if (notes.trim() !== original.notes) p.notes = notes.trim();
        if (Object.keys(p).length > 0) await update.mutateAsync({ id: original.id, patch: p });
      } else {
        await create.mutateAsync({
          fromAccountId: pair.fromId,
          toAccountId: pair.toId,
          amountMinor: amount,
          date,
          description: effectiveDescription,
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        });
      }
      setDirty(false);
      sheet.close();
    } catch (e) {
      setSaveError(errorMessage(e, tGlobal));
    }
  };

  const changeKind = (kind: SegValue) => {
    if (kind === 'transfer') return;
    const q = new URLSearchParams({ tipo: kind === 'income' ? 'entrada' : 'salida' });
    if (expr !== '') q.set('monto', expr);
    if (pair.fromId !== null) q.set('cuenta', pair.fromId);
    setDirty(false);
    void navigate(`/e/${ws}/nuevo?${q.toString()}`, { replace: true });
  };
  const kindOptions: SegmentedOption<SegValue>[] = [
    { value: 'income', label: tGlobal('ui.kind.income'), tone: 'var(--in)' },
    { value: 'expense', label: tGlobal('ui.kind.expense'), tone: 'var(--out)' },
    { value: 'transfer', label: tGlobal('ui.kind.transfer'), tone: 'var(--xfer)' },
  ];

  const card = (side: 'from' | 'to') => {
    const a = side === 'from' ? from : to;
    const caption = side === 'from' ? t('transfer.from') : t('transfer.to');
    const Icon = ACCOUNT_ICON[a?.type ?? 'cash'];
    return (
      <button
        type="button"
        className="cap-xfer__acct"
        disabled={editing}
        aria-expanded={editing ? undefined : picking === side}
        aria-label={editing ? `${caption}: ${a?.name ?? ''}` : t('transfer.change', { side: caption, name: a?.name ?? '' })}
        onClick={() => setPicking((p) => (p === side ? null : side))}
      >
        <span className="cap-xfer__caption">{caption}</span>
        <span className="cap-xfer__name">
          <Icon aria-hidden="true" />
          <span className="truncate">{a?.name ?? t('account.choose')}</span>
          {editing ? null : <ChevronDown aria-hidden="true" className="cap-xfer__chev" />}
        </span>
      </button>
    );
  };

  const noteField = (
    <Field label={t('transfer.note')} {...(keypad ? {} : { aside: <InfoTip>{t('transfer.info')}</InfoTip> })}>
      <Input value={description} placeholder={fallbackDescription} autoComplete="off" enterKeyHint="done" onChange={(e) => setDescription(e.currentTarget.value)} />
    </Field>
  );
  const body = (
    <>
      <div className="cap-xfer__pair">
        {card('from')}
        <IconButton
          label={t('transfer.swap')}
          icon={ArrowDownUp}
          variant="secondary"
          disabled={editing}
          onClick={() => setPair((p) => swap(p))}
        />
        {card('to')}
      </div>
      {picking === null || editing ? null : (
        <div className="cap-panel">
          <AccountPicker
            accounts={accounts}
            value={picking === 'from' ? pair.fromId : pair.toId}
            label={picking === 'from' ? t('transfer.from') : t('transfer.to')}
            variant={keypad ? 'list' : 'chips'}
            onChange={(id) => {
              setPair((p) => choose(p, picking, id));
              setPicking(null);
            }}
          />
        </div>
      )}
      {lines.length === 0 ? null : (
        <dl className="cap-xfer__preview" aria-live="polite">
          {lines.map((l) => (
            <div key={l.accountId} className="cap-xfer__line">
              <dt className="truncate">{l.name}</dt>
              <dd>
                {l.afterMinor === l.beforeMinor ? (
                  <AmountText minor={l.beforeMinor} size="row" currency={currency} />
                ) : (
                  <>
                    <AmountText minor={l.beforeMinor} size="row" currency={currency} className="cap-xfer__before" />
                    <span className="cap-xfer__arrow" aria-label={t('transfer.becomes')}>→</span>
                    <AmountText minor={l.afterMinor} size="row" currency={currency} className="cap-xfer__after" />
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {showErrors && errors.includes('same') ? <p className="cap-error" role="alert">{tGlobal('errors.transfer_same_account')}</p> : null}
      {keypad ? (
        <>
          <div className="cap-chips cap-chips--scroll" role="group" aria-label={t('context.label')}>
            <Chip icon={CalendarDays} aria-expanded={panel === 'date'} aria-label={t('date.change', { date: formatDate(date) })} onClick={() => setPanel((p) => (p === 'date' ? null : 'date'))} className={cx(date > today && 'cap-chip--warn')}>
              <span className="cap-chip__inline">
                {date === today ? tGlobal('ui.date.today') : date === addDays(today, -1) ? tGlobal('ui.date.yesterday') : formatDate(date)}
                <ChevronDown aria-hidden="true" />
              </span>
            </Chip>
            <Chip icon={StickyNote} aria-expanded={panel === 'note'} onClick={() => setPanel((p) => (p === 'note' ? null : 'note'))} className="cap-chip--suggest">
              {description.trim() === '' ? t('transfer.note') : description}
            </Chip>
            <InfoTip>{t('transfer.info')}</InfoTip>
          </div>
          {panel === 'date' ? (
            <div className="cap-panel">
              <DateField value={date} onChange={(d) => d !== '' && setDate(d)} today={today} />
              <Button variant="secondary" onClick={() => setPanel(null)}>
                {t('done')}
              </Button>
            </div>
          ) : null}
          {panel === 'note' ? (
            <div className="cap-panel">
              {noteField}
              <Button variant="secondary" onClick={() => setPanel(null)}>
                {t('done')}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {noteField}
          <div className="cap-group">
            <span className="cap-label">{t('date.label')}</span>
            <DateField value={date} onChange={(d) => d !== '' && setDate(d)} today={today} />
          </div>
          <Field label={t('notes.label')}>
            <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.currentTarget.value)} />
          </Field>
        </>
      )}
      <SoftWarnings warnings={warnings} />
    </>
  );

  return (
    <div className={keypad ? 'cap-entry cap-entry--keypad cap-xfer' : 'cap-entry cap-entry--form cap-xfer'} data-kind="transfer">
      {editing ? (
        <p className="cap-xfer__head">
          <ArrowLeftRight aria-hidden="true" />
          {tGlobal('ui.kind.transfer')}
        </p>
      ) : (
        <Segmented<SegValue> label={t('kind.label')} options={kindOptions} value="transfer" onChange={changeKind} fullWidth />
      )}
      <AmountEntry
        keypad={keypad}
        kind="transfer"
        expr={expr}
        onExprChange={(e, m) => {
          setExpr(e);
          setMinor(m);
          setSaveError(null);
        }}
        onSubmit={(m) => void save(m)}
        submitLabel={editing ? t('saveChanges') : keypad ? tGlobal('ui.keypad.submit.transfer') : t('transfer.submit')}
        busy={busy}
        hideKeys={picking !== null || panel !== null}
        error={saveError}
        autoFocus
      >
        {body}
      </AmountEntry>
    </div>
  );
}
