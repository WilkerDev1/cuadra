// /e/:wsId/lotes/:batchId — movimientos del lote, total de control, descuadre y anular/restaurar el lote.
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, RotateCcw } from 'lucide-react';
import type { Batch, TxFilter } from '../../../core';
import { useTotals, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { errorMessage } from '../../../app/data/errorMessage';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AmountText, Banner, Button, Chip, Dialog, Field, Input, Skeleton, Stamp } from '../../../ui';
import { LedgerView } from '../components/LedgerView';
import { accountName } from '../components/rowParts';
import { localDay } from '../components/format';
import { useBatch, useCurrency, useLookups } from '../data';
import { batchBalance } from '../logic/batch';
import '../ledger.css';

export function Component() {
  const t = useT();
  const ws = useWorkspaceId();
  const { batchId } = useParams();
  const batch = useBatch(batchId);
  if (batch.isPending) return <Skeleton rows={6} />;
  if (batch.isError)
    return (
      <div className="lg">
        <h1>{t('ledger.batch.missing')}</h1>
        <Banner tone="warn" action={<Link to={`/e/${ws}/lotes`}>{t('ledger.batches.back')}</Link>}>
          {errorMessage(batch.error, t)}
        </Banner>
      </div>
    );
  return <BatchView batch={batch.data} />;
}

function BatchView({ batch }: { batch: Batch }) {
  const t = useT();
  const ws = useWorkspaceId();
  const currency = useCurrency();
  const { accounts } = useLookups();
  const filter: TxFilter = { batchId: batch.id, status: 'all', period: { preset: 'all' } };
  const totals = useTotals({ batchId: batch.id, period: { preset: 'all' } });
  const [dialog, setDialog] = useState<'void' | 'restore' | null>(null);
  const [reason, setReason] = useState('');
  const voidBatch = useCuadraMutation((c, r: string) => c.batches.void(batch.id, r === '' ? undefined : r), {
    successToast: (o) => ({ key: 'ledger.batch.toast.voided', params: { n: o.voidedCount } }),
    undo: (c) => c.batches.restore(batch.id),
  });
  const restore = useCuadraMutation((c, _: void) => c.batches.restore(batch.id), {
    successToast: (o) => ({ key: 'ledger.batch.toast.restored', params: { n: o.restoredCount } }),
  });
  const balance = totals.data === undefined ? null : batchBalance(batch, totals.data);

  const confirmVoid = async (e?: FormEvent) => {
    e?.preventDefault();
    await voidBatch.mutateAsync(reason.trim()).catch(() => undefined);
    setReason('');
    setDialog(null);
  };

  return (
    <div className="lg">
      <header className="lg-head lg-head--account">
        <Link className="lg-head__link" to={`/e/${ws}/lotes`}>
          {t('ledger.batches.back')}
        </Link>
        <div className="lg-head__title">
          <h1>{batch.label}</h1>
          <Chip variant="info">{t(`ledger.batch.source.${batch.source}`)}</Chip>
        </div>
        <p className="lg-muted">
          {[
            formatDate(localDay(batch.createdAt)),
            batch.accountId === null ? null : accountName(accounts, batch.accountId),
            t('ledger.batch.counts', { active: batch.activeCount, voided: batch.voidedCount }),
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </p>
      </header>

      {balance !== null ? (
        <section className="lg-batch" aria-label={t('ledger.batch.balance')}>
          <dl className="lg-totals__list">
            <div className="lg-totals__item">
              <dt>{t('ledger.batch.sum')}</dt>
              <dd>
                <AmountText minor={balance.sumMinor} currency={currency} size="m" neutral />
              </dd>
            </div>
            {balance.controlMinor !== null ? (
              <div className="lg-totals__item">
                <dt>{t('ledger.batch.control')}</dt>
                <dd>
                  <AmountText minor={balance.controlMinor} currency={currency} size="m" neutral rule="double" />
                </dd>
              </div>
            ) : null}
            {balance.differenceMinor !== null ? (
              <div className="lg-totals__item">
                <dt>{t('ledger.batch.difference')}</dt>
                <dd className="lg-batch__diff">
                  {balance.differenceMinor === 0 ? (
                    <span className="lg-batch__ok">
                      <Stamp size="2rem" />
                      {t('ledger.batch.balanced')}
                    </span>
                  ) : (
                    <span className="lg-batch__warn">
                      {t(balance.differenceMinor < 0 ? 'ledger.batch.missingAmount' : 'ledger.batch.extraAmount')}{' '}
                      <AmountText minor={Math.abs(balance.differenceMinor)} currency={currency} size="m" neutral />
                    </span>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          {batch.controlMismatchAccepted && balance.differenceMinor !== 0 ? <p className="lg-muted">{t('ledger.batch.accepted')}</p> : null}
          <div className="lg-batch__actions">
            {balance.canVoid ? (
              <Button variant="danger" icon={Ban} onClick={() => setDialog('void')}>
                {t('ledger.batch.void')}
              </Button>
            ) : null}
            {balance.canRestore ? (
              <Button icon={RotateCcw} onClick={() => setDialog('restore')}>
                {t('ledger.batch.restore')}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <LedgerView filter={filter} filtered={false} totals={false} emptyMessage={t('ledger.batch.emptyRows')} />

      <Dialog
        open={dialog === 'void'}
        onClose={() => setDialog(null)}
        variant="destructive"
        title={t('ledger.batch.voidTitle', { n: batch.activeCount })}
        description={t('ledger.batch.voidText')}
        confirmLabel={t('ledger.batch.void')}
        confirmLoading={voidBatch.isPending}
        onConfirm={() => void confirmVoid()}
      >
        <form onSubmit={(e) => void confirmVoid(e)}>
          <Field label={t('ledger.void.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder={t('ledger.batch.reasonExample')} autoComplete="off" />
          </Field>
        </form>
      </Dialog>
      <Dialog
        open={dialog === 'restore'}
        onClose={() => setDialog(null)}
        title={t('ledger.batch.restoreTitle')}
        description={t('ledger.batch.restoreText')}
        confirmLabel={t('ledger.batch.restore')}
        confirmLoading={restore.isPending}
        onConfirm={() => restore.mutate(undefined, { onSettled: () => setDialog(null) })}
      />
    </div>
  );
}
