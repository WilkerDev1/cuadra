// «Lotes recientes» (DESIGN §10.8): fecha, cantidad, suma, control y [Anular lote] / [Restaurar]. Anular un lote
// anula todos sus movimientos y deja rastro; restaurar solo revive lo que anuló el lote.
import { Link } from 'react-router';
import { useState } from 'react';
import { useAccounts, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { toIsoDate, type Batch } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AmountText, Button, Chip, Dialog, EmptyState, Field, Input } from '../../../ui';
import { useCurrency } from '../hooks';
import { LoadError, Loading } from './States';

export function RecentBatches() {
  const t = useT('capture');
  const ws = useWorkspaceId();
  const q = useCuadraQuery({
    key: ['capture.batches', ws],
    tables: ['batches', 'transactions'],
    fn: (c) => c.batches.list(ws, { source: 'capture', limit: 8 }),
  });
  const [voiding, setVoiding] = useState<Batch | null>(null);
  const [reason, setReason] = useState('');
  const voidBatch = useCuadraMutation((c, input: { id: string; reason: string }) => c.batches.void(input.id, input.reason), {
    successToast: (r) => ({ key: 'capture.toast.batchVoided', params: { n: r.voidedCount } }),
  });
  const restore = useCuadraMutation((c, id: string) => c.batches.restore(id), {
    successToast: (r) => ({ key: 'capture.toast.batchRestored', params: { n: r.restoredCount } }),
  });

  return (
    <section className="cap-batches" aria-labelledby="cap-batches-title">
      <h2 id="cap-batches-title" className="cap-batches__title">
        {t('batches.title')}
      </h2>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState message={t('batches.empty')} rows={3} />
      ) : (
        <ul className="cap-batches__list">
          {q.data.map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              onVoid={() => {
                setReason('');
                setVoiding(b);
              }}
              onRestore={() => restore.mutate(b.id)}
              restoring={restore.isPending && restore.variables === b.id}
            />
          ))}
        </ul>
      )}
      <Dialog
        open={voiding !== null}
        variant="destructive"
        onClose={() => setVoiding(null)}
        title={t('batches.voidTitle', { name: voiding?.label ?? '' })}
        description={t('batches.voidBody', { n: voiding?.activeCount ?? 0 })}
        confirmLabel={t('batches.void')}
        confirmLoading={voidBatch.isPending}
        onConfirm={() => {
          if (voiding === null) return;
          voidBatch.mutate({ id: voiding.id, reason }, { onSettled: () => setVoiding(null) });
        }}
      >
        <Field label={t('batches.reason')}>
          <Input value={reason} placeholder={t('batches.reasonExample')} onChange={(e) => setReason(e.currentTarget.value)} />
        </Field>
      </Dialog>
    </section>
  );
}

function BatchRow({ batch, onVoid, onRestore, restoring }: { batch: Batch; onVoid: () => void; onRestore: () => void; restoring: boolean }) {
  const t = useT('capture');
  const ws = useWorkspaceId();
  const currency = useCurrency();
  const accounts = useAccounts({ includeArchived: true }).data ?? [];
  const totals = useCuadraQuery({
    key: ['capture.batchTotals', ws, batch.id],
    tables: ['transactions'],
    fn: (c) => c.queries.totals(ws, { batchId: batch.id, status: 'all', period: { preset: 'all' } }),
  });
  const voided = batch.activeCount === 0 && batch.voidedCount > 0;
  const account = accounts.find((a) => a.id === batch.accountId)?.name ?? '';
  const sum = totals.data === undefined ? null : totals.data.inMinor > 0 ? { minor: totals.data.inMinor, kind: 'income' as const } : { minor: totals.data.outMinor, kind: 'expense' as const };
  const when = formatDate(toIsoDate(new Date(batch.createdAt)));
  return (
    <li className="cap-batch" data-voided={voided || undefined}>
      <div className="cap-batch__main">
        <Link className="cap-batch__name truncate" to={`/e/${ws}/lotes/${batch.id}`}>
          {batch.label === '' ? t('batches.unnamed') : batch.label}
        </Link>
        <span className="cap-meta">
          {[when, account, t('batches.count', { n: voided ? batch.voidedCount : batch.activeCount })].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="cap-batch__figures">
        {voided ? <Chip variant="info">{t('batches.voided')}</Chip> : null}
        {batch.controlMismatchAccepted ? <Chip variant="info">{t('batches.mismatch')}</Chip> : null}
        {sum === null || sum.minor === 0 ? null : <AmountText minor={sum.minor} kind={sum.kind} size="row" currency={currency} voided={voided} />}
      </div>
      <div className="cap-batch__actions">
        {voided ? (
          <Button variant="secondary" onClick={onRestore} loading={restoring}>
            {t('batches.restore')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onVoid}>
            {t('batches.void')}
          </Button>
        )}
      </div>
    </li>
  );
}
