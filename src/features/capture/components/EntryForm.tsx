// Nuevo movimiento y editar (DESIGN §10.6). Móvil: teclado propio con concepto y chips de contexto entre el visor
// y las teclas; tocar la cuenta, la fecha o «Más campos» pone su panel en el sitio de las teclas. Escritorio:
// formulario vertical (Tipo, Monto, Concepto, Cuenta, Fecha, campos, Notas) con Ctrl+Enter / Ctrl+Shift+Enter.
import { CalendarDays, ChevronDown, Lock, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../../app/data/errorMessage';
import { useAccounts, useFormSchema, useWorkspaceId, useWorkspaceSetting } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useSheet } from '../../../app/registry/sheet';
import { addDays, type FieldValue, type Id, type Minor, type Transaction, type TxDraft, type TxPatch } from '../../../core';
import { t as tGlobal, useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AccountChip, Button, Chip, Field, InfoTip, Segmented, Textarea, cx, evaluateExpression, type SegmentedOption } from '../../../ui';
import { useCurrency, useKeypadMode, useOptionCounts, useSignedAmount, useSoftWarnings, useToday } from '../hooks';
import {
  applySuggestion,
  buildPatch,
  buildTxDraft,
  categoryField,
  isDirty,
  isEmptyPatch,
  nextEntry,
  staleValues,
  topOptions,
  validateEntry,
  type EntryError,
  type EntryState,
} from '../logic/entry';
import { AccountPicker } from './AccountPicker';
import { AmountEntry } from './AmountEntry';
import { DateGroup } from './DateGroup';
import { DescriptionInput } from './DescriptionInput';
import { FieldsPanel } from './FieldsPanel';
import { MiniTape, type TapeLine } from './Tape';
import { SoftWarnings } from './SoftWarnings';

type Panel = 'account' | 'date' | 'fields' | null;
type SegValue = 'income' | 'expense' | 'transfer';

export interface EntryFormProps {
  initial: EntryState;
  /** Editar: el movimiento tal como está guardado (cuenta inmutable). */
  original?: Transaction;
}

export function EntryForm({ initial, original }: EntryFormProps) {
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
  const [state, setState] = useState<EntryState>(initial);
  const [baseline, setBaseline] = useState<EntryState>(initial);
  const [minor, setMinor] = useState<Minor | null>(() => {
    const r = evaluateExpression(initial.expr, currency.minorDigits);
    return r.ok && r.minor > 0 ? r.minor : null;
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [descFocused, setDescFocused] = useState(false);
  const [errors, setErrors] = useState<EntryError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tape, setTape] = useState<TapeLine[]>([]);
  const [rev, setRev] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const descRef = useRef<HTMLInputElement>(null);
  const [, saveLastKind] = useWorkspaceSetting('capture.lastKind');
  const [, saveLastAccount] = useWorkspaceSetting('capture.lastAccountId');

  const schema = useFormSchema(state.kind);
  const fields = useMemo(() => schema.data?.fields ?? [], [schema.data]);
  // Editar y cambiar de tipo: el formulario del tipo original dice qué valores dejan de aplicar (se vacían al guardar).
  const originalKind = original?.kind === 'income' || original?.kind === 'expense' ? original.kind : initial.kind;
  const fromSchema = useFormSchema(originalKind);
  const fromFields = fromSchema.data?.fields;
  const stale = editing && state.kind !== originalKind && fromFields !== undefined && schema.data !== undefined ? staleValues(state.values, fromFields, fields) : [];
  const category = categoryField(fields);
  const counts = useOptionCounts(category?.id, state.kind);
  const topCats = category === undefined ? [] : topOptions(category.options, counts, 6);

  const draft = buildTxDraft(state, minor, fields);
  const warnings = useSoftWarnings(draft, original?.id);

  const { setDirty } = sheet;
  useEffect(() => setDirty(isDirty(baseline, state)), [baseline, state, setDirty]);

  const accountName = (id: Id) => accounts.find((a) => a.id === id)?.name ?? '';
  const create = useCuadraMutation((c, d: TxDraft) => c.transactions.create(d), {
    successToast: (tx) => ({ key: 'capture.toast.saved', params: { amount: money(tx.amountMinor, tx.kind), account: accountName(tx.accountId) } }),
    undo: (c, tx) => c.transactions.void(tx.id, tGlobal('capture.undoReason')),
    errorToast: false,
  });
  const update = useCuadraMutation((c, input: { id: Id; patch: TxPatch }) => c.transactions.update(input.id, input.patch), {
    successToast: 'capture.toast.updated',
    errorToast: false,
  });
  const busy = create.isPending || update.isPending;

  const patch = (next: Partial<EntryState>) => {
    setState((s) => ({ ...s, ...next }));
    setSaveError(null);
  };
  const setValue = (fieldId: Id, value: FieldValue | undefined) =>
    setState((s) => {
      const values = { ...s.values };
      if (value === undefined) delete values[fieldId];
      else values[fieldId] = value;
      return { ...s, values };
    });

  const changeKind = (kind: SegValue) => {
    if (kind === 'transfer') {
      const q = new URLSearchParams();
      if (state.expr !== '') q.set('monto', state.expr);
      if (state.accountId !== null) q.set('cuenta', state.accountId);
      setDirty(false);
      void navigate(`/e/${ws}/transferencia?${q.toString()}`, { replace: true });
      return;
    }
    if (kind === state.kind) return;
    // Al crear, las categorías de un tipo no sirven para el otro: se vacían. Al editar se conservan.
    patch(editing ? { kind } : { kind, values: {} });
    setRev((n) => n + 1);
  };

  const save = async (amount: Minor, another: boolean) => {
    const errs = validateEntry(state, amount, fields);
    setErrors(errs);
    if (errs.includes('description')) {
      setPanel(null);
      descRef.current?.focus();
      return;
    }
    if (errs.length > 0) {
      if (errs.includes('account')) setPanel('account');
      return;
    }
    setSaveError(null);
    try {
      if (original !== undefined) {
        const p = buildPatch(original, state, amount, fields, fromFields);
        if (!isEmptyPatch(p)) await update.mutateAsync({ id: original.id, patch: p });
        setDirty(false);
        sheet.close();
        return;
      }
      const d = buildTxDraft(state, amount, fields);
      if (d === null) return;
      const r = await create.mutateAsync(d);
      void saveLastKind(state.kind).catch(() => undefined);
      void saveLastAccount(d.accountId).catch(() => undefined);
      if (another) {
        const next = nextEntry(state);
        setTape((list) => [...list, { id: r.value.id, minor: r.value.amountMinor, kind: r.value.kind, description: r.value.description }]);
        setState(next);
        setBaseline(next);
        setMinor(null);
        setErrors([]);
        setPanel(null);
        setFocusSignal((n) => n + 1);
      } else {
        setDirty(false);
        sheet.close();
      }
    } catch (e) {
      setSaveError(errorMessage(e, tGlobal));
    }
  };

  const kindOptions: SegmentedOption<SegValue>[] = [
    { value: 'income', label: tGlobal('ui.kind.income'), tone: 'var(--in)' },
    { value: 'expense', label: tGlobal('ui.kind.expense'), tone: 'var(--out)' },
    ...(editing ? [] : [{ value: 'transfer' as const, label: tGlobal('ui.kind.transfer'), tone: 'var(--xfer)' }]),
  ];
  const lockedKind = original !== undefined && original.kind !== 'income' && original.kind !== 'expense';
  const segmented = lockedKind ? null : (
    <Segmented<SegValue> label={t('kind.label')} options={kindOptions} value={state.kind} onChange={changeKind} fullWidth />
  );

  const descriptionError = errors.includes('description') ? t('description.required') : null;
  const description = (
    <DescriptionInput
      ref={descRef}
      value={state.description}
      onChange={(description) => {
        patch({ description });
        if (errors.includes('description') && description.trim() !== '') setErrors((e) => e.filter((x) => x !== 'description'));
      }}
      onPick={(s) => {
        setState((st) => applySuggestion(st, s, fields));
        setRev((n) => n + 1);
        if (keypad) setFocusSignal((n) => n + 1);
      }}
      kind={state.kind}
      error={descriptionError}
      {...(keypad ? { onDone: () => setFocusSignal((n) => n + 1), suggestWhenIdle: false } : {})}
      onFocusChange={setDescFocused}
    />
  );

  const account = accounts.find((a) => a.id === state.accountId);
  const fixedAccount = editing ? (
    <span className="cap-fixed">
      <Chip variant="info" icon={Lock}>
        {account?.name ?? ''}
      </Chip>
      <InfoTip>{t('account.locked')}</InfoTip>
    </span>
  ) : null;

  const staleView =
    stale.length === 0 ? null : (
      <p className="cap-meta" role="status">
        {t('kind.staleValues', {
          n: stale.length,
          list: stale.map((x) => (x.label === '' ? x.field.label : `${x.field.label} «${x.label}»`)).join(', '),
        })}
      </p>
    );
  const warningsView = (
    <>
      {staleView}
      <SoftWarnings warnings={warnings} />
    </>
  );
  const saveErr = saveError ?? (errors.includes('account') ? t('account.required') : null);
  const submitLabel = editing ? t('saveChanges') : keypad ? tGlobal(`ui.keypad.submit.${state.kind}`) : t('save');

  if (!keypad) {
    return (
      <div className="cap-entry cap-entry--form">
        {segmented}
        <AmountEntry
          keypad={false}
          kind={state.kind}
          expr={state.expr}
          onExprChange={(expr, m) => {
            patch({ expr });
            setMinor(m);
          }}
          onSubmit={(m) => void save(m, false)}
          {...(editing ? {} : { onAnother: (m: Minor) => void save(m, true) })}
          submitLabel={submitLabel}
          busy={busy}
          error={saveErr}
          autoFocus
          focusSignal={focusSignal}
        >
          {tape.length === 0 ? null : <MiniTape lines={tape} />}
          {description}
          <div className="cap-group">
            <span className="cap-label">{t('account.label')}</span>
            {fixedAccount ?? (
              <AccountPicker accounts={accounts} value={state.accountId} onChange={(accountId) => patch({ accountId })} label={t('account.label')} />
            )}
          </div>
          <DateGroup label={t('date.label')} value={state.date} onChange={(date) => date !== '' && patch({ date })} today={today} />
          <FieldsPanel fields={fields} values={state.values} onChange={setValue} today={today} rev={rev} />
          <NotesField value={state.notes} onChange={(notes) => patch({ notes })} />
          {warningsView}
        </AmountEntry>
      </div>
    );
  }

  // ── Móvil: teclado propio ───────────────────────────────────────────────────────────
  const dateLabel = state.date === today ? tGlobal('ui.date.today') : state.date === addDays(today, -1) ? tGlobal('ui.date.yesterday') : formatDate(state.date);
  const filled = fields.filter((f) => f.id !== category?.id && state.values[f.id] !== undefined).length + (state.notes.trim() === '' ? 0 : 1);
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const catValue = category === undefined ? undefined : state.values[category.id];
  const selectedCat = catValue?.type === 'list' ? catValue.optionId : null;
  const chipsCats = selectedCat !== null && !topCats.some((o) => o.id === selectedCat) && category !== undefined
    ? [...(category.options.filter((o) => o.id === selectedCat)), ...topCats.slice(0, 5)]
    : topCats;

  return (
    <div className="cap-entry cap-entry--keypad" data-kind={state.kind}>
      {segmented}
      {tape.length === 0 ? null : <MiniTape lines={tape} />}
      <AmountEntry
        keypad
        kind={state.kind}
        expr={state.expr}
        onExprChange={(expr, m) => {
          patch({ expr });
          setMinor(m);
        }}
        onSubmit={(m) => void save(m, false)}
        {...(editing ? {} : { onAnother: (m: Minor) => void save(m, true) })}
        submitLabel={submitLabel}
        busy={busy}
        hideKeys={panel !== null}
        dimKeys={descFocused}
        error={saveErr}
        focusSignal={focusSignal}
      >
        {description}
        <div className="cap-chips cap-chips--scroll" role="group" aria-label={t('context.label')}>
          {fixedAccount ?? (
            <AccountChip
              name={account?.name ?? t('account.choose')}
              accountType={account?.type ?? 'cash'}
              aria-expanded={panel === 'account'}
              aria-label={t('account.change', { name: account?.name ?? '' })}
              onClick={() => toggle('account')}
            />
          )}
          <Chip icon={CalendarDays} aria-expanded={panel === 'date'} aria-label={t('date.change', { date: formatDate(state.date) })} onClick={() => toggle('date')} className={cx(state.date > today && 'cap-chip--warn')}>
            <span className="cap-chip__inline">
              {dateLabel}
              <ChevronDown aria-hidden="true" />
            </span>
          </Chip>
          {category === undefined
            ? null
            : chipsCats.map((o) => (
                <Chip
                  key={o.id}
                  selected={selectedCat === o.id}
                  onClick={() => setValue(category.id, selectedCat === o.id ? undefined : { type: 'list', optionId: o.id })}
                >
                  {o.label}
                </Chip>
              ))}
          <Chip icon={SlidersHorizontal} aria-expanded={panel === 'fields'} onClick={() => toggle('fields')}>
            {filled > 0 ? t('moreFields.count', { n: filled }) : t('moreFields.label')}
          </Chip>
        </div>
        {panel === 'account' ? (
          <div className="cap-panel">
            <AccountPicker
              accounts={accounts}
              value={state.accountId}
              variant="list"
              label={t('account.label')}
              onChange={(accountId) => {
                patch({ accountId });
                setErrors((e) => e.filter((x) => x !== 'account'));
                setPanel(null);
                setFocusSignal((n) => n + 1);
              }}
            />
          </div>
        ) : null}
        {panel === 'date' ? (
          <div className="cap-panel">
            <DateGroup label={t('date.label')} value={state.date} onChange={(date) => date !== '' && patch({ date })} today={today} />
            <Button variant="secondary" onClick={() => { setPanel(null); setFocusSignal((n) => n + 1); }}>
              {t('done')}
            </Button>
          </div>
        ) : null}
        {panel === 'fields' ? (
          <div className="cap-panel">
            <FieldsPanel fields={fields} values={state.values} onChange={setValue} today={today} rev={rev} />
            <NotesField value={state.notes} onChange={(notes) => patch({ notes })} />
            <Button variant="secondary" onClick={() => { setPanel(null); setFocusSignal((n) => n + 1); }}>
              {t('done')}
            </Button>
          </div>
        ) : null}
        {warningsView}
      </AmountEntry>
    </div>
  );
}

function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT('capture');
  return (
    <Field label={t('notes.label')}>
      <Textarea value={value} rows={2} onChange={(e) => onChange(e.currentTarget.value)} />
    </Field>
  );
}
