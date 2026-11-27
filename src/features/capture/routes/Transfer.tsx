// /e/:wsId/transferencia?cuenta=&desde=:txId — Transferencia nueva o duplicada (P-08).
import { useSearchParams } from 'react-router';
import { useAccounts, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useT } from '../../../i18n';
import { LoadError, Loading, NoAccounts, OtherWorkspace } from '../components/States';
import { TransferForm } from '../components/TransferForm';
import { useCurrency, useToday } from '../hooks';
import { exprFromMinor } from '../logic/amount';
import { pickAccount } from '../logic/entry';
import { defaultPair } from '../logic/transfer';
import '../capture.css';

export function Component() {
  const t = useT('capture');
  const [search] = useSearchParams();
  const ws = useWorkspaceId();
  const today = useToday();
  const currency = useCurrency();
  const accounts = useAccounts({ includeArchived: true });
  const fromTx = search.get('desde');
  const dup = useCuadraQuery({
    key: ['capture.duplicate', ws, fromTx ?? ''],
    tables: ['transactions', 'transaction_field_values', 'fields', 'field_options'],
    fn: (c) => c.transactions.duplicate(fromTx ?? ''),
    enabled: fromTx !== null,
  });
  if (accounts.isPending || (fromTx !== null && dup.isPending)) return <Loading />;
  if (accounts.isError) return <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />;
  if (fromTx !== null && dup.isError) return <LoadError error={dup.error} onRetry={() => void dup.refetch()} />;
  const active = accounts.data.filter((a) => a.archivedAt === null);
  if (active.length < 2) return <NoAccounts message={t('state.needTwo')} />;

  const d = dup.data;
  if (d !== undefined && !accounts.data.some((a) => a.id === ('fromAccountId' in d ? d.fromAccountId : d.accountId))) return <OtherWorkspace />;
  if (d !== undefined && 'fromAccountId' in d) {
    const pair = defaultPair(accounts.data, d.fromAccountId, d.toAccountId);
    return (
      <TransferForm
        initial={{ fromId: pair.fromId, toId: pair.toId, expr: exprFromMinor(d.amountMinor, currency.minorDigits), date: d.date, description: d.description, notes: d.notes ?? '' }}
      />
    );
  }
  const monto = search.get('monto');
  const from = pickAccount(accounts.data, [search.get('cuenta')]);
  const pair = defaultPair(accounts.data, from);
  return (
    <TransferForm
      initial={{ fromId: pair.fromId, toId: pair.toId, expr: monto !== null && /^[0-9.+\-*]+$/.test(monto) ? monto : '', date: today, description: '', notes: '' }}
    />
  );
}
