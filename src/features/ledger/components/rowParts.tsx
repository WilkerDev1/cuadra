// Piezas comunes de una fila de libro: meta, monto, acciones y el diálogo de anular.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Copy, Pencil, RotateCcw } from 'lucide-react';
import type { Account, Currency, Field, Id, TransactionRow } from '../../../core';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { AmountText, Dialog, Field as FormField, Input, type RowAction } from '../../../ui';
import { padSeq } from '../logic/days';
import { formatFieldValue } from '../logic/history';

export interface RowCtx {
  accounts: readonly Account[];
  fields: readonly Field[];
  currency: Currency;
  /** Listado de una sola cuenta: no se repite la cuenta y hay saldo corrido. */
  singleAccount: boolean;
}

export function accountName(accounts: readonly Account[], id: Id): string {
  return accounts.find((a) => a.id === id)?.name ?? '—';
}

/** Primer campo de lista con rol categoría que tenga valor. */
export function categoryOf(row: TransactionRow, fields: readonly Field[]): string | null {
  const cat = fields.find((f) => f.role === 'category' && row.values[f.id] !== undefined);
  if (cat === undefined) return null;
  const v = row.values[cat.id];
  if (v?.type !== 'list') return null;
  return cat.options.find((o) => o.id === v.optionId)?.label ?? null;
}

export function useRowText() {
  const t = useT();
  return {
    title: (row: TransactionRow) => (row.description.trim() === '' ? t(`ledger.kind.${row.kind}`) : row.description),
    meta: (row: TransactionRow, ctx: RowCtx) => {
      const parts: string[] = [];
      if (row.kind === 'transfer' && row.counterpart !== null) {
        const from = row.direction === 'out' ? row.accountId : row.counterpart.accountId;
        const to = row.direction === 'out' ? row.counterpart.accountId : row.accountId;
        parts.push(`${accountName(ctx.accounts, from)} → ${accountName(ctx.accounts, to)}`);
      } else {
        if (row.kind === 'opening') parts.push(t('ledger.kind.opening'));
        const cat = categoryOf(row, ctx.fields);
        if (cat !== null) parts.push(cat);
        if (!ctx.singleAccount) parts.push(accountName(ctx.accounts, row.accountId));
      }
      parts.push(t('ledger.seq', { seq: padSeq(row.seq) }));
      return parts.join(' · ');
    },
  };
}

export function RowAmount({ row, currency, size = 'row', notation = 'sign' }: { row: TransactionRow; currency: Currency; size?: 'row' | 'table'; notation?: 'sign' | 'columns' }) {
  const kind = row.kind === 'opening' ? undefined : row.kind;
  const minor = row.kind === 'opening' ? (row.direction === 'out' ? -row.amountMinor : row.amountMinor) : row.amountMinor;
  return (
    <AmountText
      minor={minor}
      currency={currency}
      size={size}
      notation={notation}
      voided={row.status === 'voided'}
      {...(kind === undefined ? { neutral: true } : { kind })}
    />
  );
}

export function fieldText(row: TransactionRow, field: Field, t: (k: string) => string, date: (iso: string) => string): string | null {
  return formatFieldValue(row.values[field.id], field, { money: String, date, fields: [field], t });
}

/** Acciones de una fila (deslizar, ⋯): Editar, Duplicar, Anular o Restaurar. */
export function useRowActions(onVoid: (row: TransactionRow) => void) {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const restore = useCuadraMutation((c, id: Id) => c.transactions.restore(id), { successToast: 'ledger.toast.restored' });
  return (row: TransactionRow): RowAction[] => {
    const list: RowAction[] = [];
    if (row.status === 'voided') {
      list.push({ id: 'restore', label: t('ledger.action.restoreOne'), icon: RotateCcw, onSelect: () => restore.mutate(row.id) });
      return list;
    }
    if (row.kind !== 'opening') {
      list.push({ id: 'edit', label: t('ledger.action.editOne'), icon: Pencil, onSelect: () => void navigate(`/e/${ws}/nuevo?editar=${row.id}`) });
      list.push({ id: 'dup', label: t('ledger.action.duplicate'), icon: Copy, onSelect: () => void navigate(`/e/${ws}/nuevo?desde=${row.id}`) });
    }
    list.push({ id: 'void', label: t('ledger.action.voidOne'), icon: Ban, tone: 'danger', onSelect: () => onVoid(row) });
    return list;
  };
}

/** «¿Anular este movimiento?» con motivo opcional. */
export function VoidDialog({ target, onClose }: { target: { id: Id; label: string } | null; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const run = useCuadraMutation((c, input: { id: Id; reason: string }) => c.transactions.void(input.id, input.reason === '' ? undefined : input.reason), {
    successToast: 'ledger.toast.voided',
    undo: (c, tx) => c.transactions.restore(tx.id),
  });
  const confirm = async (e?: FormEvent) => {
    e?.preventDefault();
    if (target === null) return;
    await run.mutateAsync({ id: target.id, reason: reason.trim() }).catch(() => undefined);
    setReason('');
    onClose();
  };
  return (
    <Dialog
      open={target !== null}
      onClose={() => {
        setReason('');
        onClose();
      }}
      variant="destructive"
      title={t('ledger.void.title')}
      description={t('ledger.void.description')}
      confirmLabel={t('ledger.void.confirm')}
      onConfirm={() => void confirm()}
      confirmLoading={run.isPending}
    >
      <form onSubmit={(e) => void confirm(e)}>
        <FormField label={t('ledger.void.reason')}>
          <Input value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder={t('ledger.void.reasonExample')} autoComplete="off" />
        </FormField>
      </form>
    </Dialog>
  );
}
