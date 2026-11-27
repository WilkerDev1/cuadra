// Ráfaga (DESIGN §10.9): en móvil, la captura de un lote con el teclado propio. Cada línea se anota con «Añadir»,
// la minicinta muestra las últimas tres con la suma (y lo que falta si hay control) y tocar una línea la devuelve
// al visor para corregirla. «Cerrar lote (n)» guarda todo como UN lote; si no cuadra con el control, pide confirmar.
import { Target } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useAccounts, useFormSchema, useWorkspaceId } from '../../../app/data/hooks';
import type { FieldValues, Id, Minor } from '../../../core';
import { t as tGlobal, useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { AccountChip, Button, Chip, Dialog, Field, Input, Segmented } from '../../../ui';
import { useCurrency, useOptionCounts, useSignedAmount, useToday } from '../hooks';
import { exprFromMinor, parseAmountText } from '../logic/amount';
import { removeLine, remaining, sumLines, toCaptureRows, upsertLine, type BurstLine } from '../logic/burst';
import { categoryField, resolveDescription, topOptions, type EntryKind } from '../logic/entry';
import { AccountPicker } from './AccountPicker';
import { AmountEntry } from './AmountEntry';
import { DescriptionInput } from './DescriptionInput';
import { MiniTape } from './Tape';
import { defaultBatchLabel, isNotSaved, useSaveBatch } from './useSaveBatch';

export function BurstCapture({ initialAccountId, initialKind }: { initialAccountId: Id; initialKind: EntryKind }) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  const today = useToday();
  const currency = useCurrency();
  const money = useSignedAmount();
  const locale = getLocale();
  const accounts = useAccounts().data ?? [];
  const seq = useRef(0);

  const [accountId, setAccountId] = useState<Id>(initialAccountId);
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [controlText, setControlText] = useState('');
  const [lines, setLines] = useState<BurstLine[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [expr, setExpr] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<FieldValues>({});
  const [descFocused, setDescFocused] = useState(false);
  const [panel, setPanel] = useState<'account' | 'control' | null>(null);
  const pickAccount = panel === 'account';
  const [descError, setDescError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  const schema = useFormSchema(kind);
  const fields = useMemo(() => schema.data?.fields ?? [], [schema.data]);
  const category = categoryField(fields);
  const counts = useOptionCounts(category?.id, kind);
  const topCats = category === undefined ? [] : topOptions(category.options, counts, 6);
  const catValue = category === undefined ? undefined : values[category.id];
  const selectedCat = catValue?.type === 'list' ? catValue.optionId : null;

  const control = parseAmountText(controlText, locale, currency.minorDigits);
  const controlMinor = control.status === 'ok' ? control.minor : null;
  const sum = sumLines(lines);
  const diff = remaining(controlMinor, sum);
  const account = accounts.find((a) => a.id === accountId);
  const save = useSaveBatch();

  const add = (minor: Minor) => {
    const desc = resolveDescription(description, values, fields);
    if (desc === '') {
      setDescError(true);
      return;
    }
    seq.current += 1;
    const line: BurstLine = { id: editing !== null ? (lines[editing]?.id ?? `b${seq.current}`) : `b${seq.current}`, minor, description: desc, values };
    setLines((l) => upsertLine(l, line, editing));
    setEditing(null);
    setExpr('');
    setDescription('');
    setDescError(false);
    setSaveError(null);
    setFocusSignal((n) => n + 1);
  };

  const edit = (index: number) => {
    const l = lines[index];
    if (l === undefined) return;
    if (editing === index) {
      setEditing(null);
      setExpr('');
      setDescription('');
      return;
    }
    setEditing(index);
    setExpr(exprFromMinor(l.minor, currency.minorDigits));
    setDescription(l.description);
    setValues(l.values);
  };

  const close = async () => {
    setConfirm(false);
    setSaveError(null);
    try {
      await save.mutateAsync({
        workspaceId: ws,
        accountId,
        kind,
        date: today,
        label: defaultBatchLabel(),
        rows: toCaptureRows(lines),
        controlTotalMinor: controlMinor,
        acceptControlMismatch: true,
      });
      setLines([]);
      setEditing(null);
      setControlText('');
      setExpr('');
      setDescription('');
    } catch (e) {
      setSaveError(isNotSaved(e) ? t('grid.nothing') : tGlobal('common.error.unknown'));
    }
  };

  const tapeLines = lines.map((l) => ({ id: l.id, minor: l.minor, kind, description: l.description }));
  return (
    <div className="cap-entry cap-entry--keypad cap-burst" data-kind={kind}>
      <div className="cap-burst__top">
        <Segmented<EntryKind>
          label={t('kind.label')}
          value={kind}
          onChange={(k) => {
            if (lines.length > 0) return;
            setKind(k);
            setValues({});
          }}
          options={[
            { value: 'income', label: tGlobal('ui.kind.income'), tone: 'var(--in)', disabled: lines.length > 0 && kind !== 'income' },
            { value: 'expense', label: tGlobal('ui.kind.expense'), tone: 'var(--out)', disabled: lines.length > 0 && kind !== 'expense' },
          ]}
        />
        {lines.length === 0 ? null : (
          <Button variant="ghost" className="cap-burst__close" onClick={() => (diff !== null && diff !== 0 ? setConfirm(true) : void close())} loading={save.isPending}>
            {t('burst.close', { n: lines.length })}
          </Button>
        )}
      </div>
      {lines.length === 0 ? null : (
        <MiniTape lines={tapeLines} controlMinor={controlMinor} onSelect={edit} selected={editing} />
      )}
      <AmountEntry
        keypad
        kind={kind}
        expr={expr}
        onExprChange={(e) => {
          setExpr(e);
          setSaveError(null);
        }}
        onSubmit={add}
        submitLabel={editing !== null ? t('burst.fix') : t('burst.add', { n: lines.length + 1 })}
        hideKeys={panel !== null}
        dimKeys={descFocused}
        error={saveError}
        focusSignal={focusSignal}
      >
        <DescriptionInput
          value={description}
          onChange={(v) => {
            setDescription(v);
            if (v.trim() !== '') setDescError(false);
          }}
          onPick={(s) => {
            setDescription(s.description);
            setValues((cur) => ({ ...s.lastValues, ...cur }));
            setFocusSignal((n) => n + 1);
          }}
          kind={kind}
          error={descError ? t('description.required') : null}
          onDone={() => setFocusSignal((n) => n + 1)}
          suggestWhenIdle={false}
          onFocusChange={setDescFocused}
        />
        {/* Chips de contexto, como en Nuevo movimiento: cuenta, total de control y las categorías frecuentes */}
        <div className="cap-chips cap-chips--scroll" role="group" aria-label={t('context.label')}>
          <AccountChip
            name={account?.name ?? t('account.choose')}
            accountType={account?.type ?? 'cash'}
            aria-expanded={pickAccount}
            aria-label={t('account.change', { name: account?.name ?? '' })}
            disabled={lines.length > 0}
            onClick={() => setPanel((p) => (p === 'account' ? null : 'account'))}
          />
          <Chip icon={Target} aria-expanded={panel === 'control'} onClick={() => setPanel((p) => (p === 'control' ? null : 'control'))}>
            {controlMinor === null ? t('batch.controlShort') : t('batch.controlValue', { amount: money(controlMinor) })}
          </Chip>
          {category === undefined
            ? null
            : topCats.map((o) => (
              <Chip
                key={o.id}
                selected={selectedCat === o.id}
                onClick={() =>
                  setValues((v) => {
                    const next = { ...v };
                    if (selectedCat === o.id) delete next[category.id];
                    else next[category.id] = { type: 'list', optionId: o.id };
                    return next;
                  })
                }
              >
                {o.label}
              </Chip>
            ))}
        </div>
        {pickAccount ? (
          <div className="cap-panel">
            <AccountPicker
              accounts={accounts}
              value={accountId}
              variant="list"
              label={t('account.label')}
              onChange={(id) => {
                setAccountId(id);
                setPanel(null);
                setFocusSignal((n) => n + 1);
              }}
            />
          </div>
        ) : null}
        {panel === 'control' ? (
          <div className="cap-panel">
            <Field label={t('batch.control')}>
              <Input
                className="num cap-burst__control-input"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                autoFocus
                value={controlText}
                placeholder={t('batch.controlPlaceholder')}
                onChange={(e) => setControlText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  setPanel(null);
                  setFocusSignal((n) => n + 1);
                }}
              />
            </Field>
            <Button variant="secondary" onClick={() => { setPanel(null); setFocusSignal((n) => n + 1); }}>
              {t('done')}
            </Button>
          </div>
        ) : null}
        {editing === null ? null : (
          <Button
            variant="danger"
            onClick={() => {
              setLines((l) => removeLine(l, editing));
              setEditing(null);
              setExpr('');
              setDescription('');
            }}
          >
            {t('burst.remove')}
          </Button>
        )}
      </AmountEntry>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('grid.confirmTitle')}
        description={diff === null ? '' : t('grid.confirmMismatch', { amount: money(Math.abs(diff)) })}
        confirmLabel={t('burst.closeAnyway')}
        confirmLoading={save.isPending}
        onConfirm={() => void close()}
      />
    </div>
  );
}
