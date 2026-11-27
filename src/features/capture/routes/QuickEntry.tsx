// /e/:wsId/nuevo?tipo=entrada|salida&cuenta=&desde=:txId  ·  /e/:wsId/nuevo?editar=:txId
// Decide qué formulario pintar y con qué datos: nuevo, duplicado (`desde`) o edición (`editar`, con las reglas de
// transferencias y saldos iniciales). El shell pone la hoja / el inspector.
import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useSheet } from '../../../app/registry/sheet';
import { useT } from '../../../i18n';
import { useAccounts, useTransaction, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import type { Transaction } from '../../../core';
import { EntryForm } from '../components/EntryForm';
import { OpeningForm } from '../components/OpeningForm';
import { LoadError, Loading, NoAccounts, VoidedNotice } from '../components/States';
import { TransferForm } from '../components/TransferForm';
import { useCurrency, useToday } from '../hooks';
import { exprFromMinor } from '../logic/amount';
import { parseEntryParams, pickAccount, stateFromTransaction, type EntryParams } from '../logic/entry';
import '../capture.css';

export function Component() {
  const [search] = useSearchParams();
  const ws = useWorkspaceId();
  const params = parseEntryParams(search);
  const t = useT();
  const { setTitle } = useSheet();
  const titleKey = params.editId !== null ? 'capture.entry.editTitle' : params.fromTxId !== null ? 'capture.entry.duplicateTitle' : 'capture.entry.newTitle';
  useEffect(() => {
    setTitle(t(titleKey));
    return () => setTitle(null);
  }, [setTitle, t, titleKey]);
  if (params.editId !== null) return <EditEntry id={params.editId} />;
  if (params.kind === 'transfer') {
    const q = new URLSearchParams();
    const monto = search.get('monto');
    if (monto !== null) q.set('monto', monto);
    if (params.accountId !== null) q.set('cuenta', params.accountId);
    return <Navigate to={`/e/${ws}/transferencia?${q.toString()}`} replace />;
  }
  if (params.fromTxId !== null) return <DuplicateEntry id={params.fromTxId} />;
  return <NewEntry params={params} monto={search.get('monto')} />;
}

function NewEntry({ params, monto }: { params: EntryParams; monto: string | null }) {
  const ws = useWorkspaceId();
  const today = useToday();
  const accounts = useAccounts();
  const defaults = useCuadraQuery({
    key: ['capture.defaults', ws],
    tables: ['settings'],
    fn: async (c) => ({ kind: await c.settings.getWs(ws, 'capture.lastKind'), accountId: await c.settings.getWs(ws, 'capture.lastAccountId') }),
  });
  if (accounts.isPending || defaults.isPending) return <Loading />;
  if (accounts.isError) return <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />;
  const accountId = pickAccount(accounts.data, [params.accountId, defaults.data?.accountId]);
  if (accountId === null) return <NoAccounts />;
  const kind = params.kind === 'income' || params.kind === 'expense' ? params.kind : (defaults.data?.kind ?? 'expense');
  const expr = monto !== null && /^[0-9.+\-*]+$/.test(monto) ? monto : '';
  return <EntryForm initial={{ kind, accountId, expr, date: today, description: '', notes: '', values: {} }} />;
}

function DuplicateEntry({ id }: { id: string }) {
  const ws = useWorkspaceId();
  const currency = useCurrency();
  const accounts = useAccounts();
  const dup = useCuadraQuery({
    key: ['capture.duplicate', ws, id],
    tables: ['transactions', 'transaction_field_values', 'fields', 'field_options'],
    fn: (c) => c.transactions.duplicate(id),
  });
  if (dup.isPending || accounts.isPending) return <Loading />;
  if (dup.isError) return <LoadError error={dup.error} onRetry={() => void dup.refetch()} />;
  const d = dup.data;
  if ('fromAccountId' in d) return <Navigate to={`/e/${ws}/transferencia?desde=${encodeURIComponent(id)}`} replace />;
  // Si la cuenta de origen ya está archivada, se propone otra activa.
  const accountId = pickAccount(accounts.data ?? [], [d.accountId]);
  if (accountId === null) return <NoAccounts />;
  return (
    <EntryForm
      initial={{
        kind: d.kind,
        accountId,
        expr: exprFromMinor(d.amountMinor, currency.minorDigits),
        date: d.date,
        description: d.description,
        notes: d.notes ?? '',
        values: d.values ?? {},
      }}
    />
  );
}

function EditEntry({ id }: { id: string }) {
  const tx = useTransaction(id);
  const accounts = useAccounts({ includeArchived: true });
  if (tx.isPending || accounts.isPending) return <Loading />;
  if (tx.isError) return <LoadError error={tx.error} onRetry={() => void tx.refetch()} />;
  return <EditBody tx={tx.data} />;
}

function EditBody({ tx }: { tx: Transaction }) {
  const currency = useCurrency();
  if (tx.status === 'voided') return <VoidedNotice txId={tx.id} />;
  const expr = exprFromMinor(tx.amountMinor, currency.minorDigits);
  if (tx.kind === 'opening') return <OpeningForm original={tx} />;
  if (tx.kind === 'transfer') {
    const other = tx.counterpart?.accountId ?? null;
    const out = tx.direction === 'out';
    return (
      <TransferForm
        original={tx}
        initial={{
          fromId: out ? tx.accountId : other,
          toId: out ? other : tx.accountId,
          expr,
          date: tx.date,
          description: tx.description,
          notes: tx.notes,
        }}
      />
    );
  }
  return <EntryForm original={tx} initial={stateFromTransaction(tx, expr)} />;
}
