// /e/:wsId/lotes — lotes de captura, importación y datos de ejemplo, con su estado.
import { useNavigate } from 'react-router';
import { Layers } from 'lucide-react';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AmountText, Banner, Button, EmptyState, LedgerList, ListRow, Skeleton } from '../../../ui';
import { localDay } from '../components/format';
import { useBatches, useCurrency } from '../data';
import '../ledger.css';

export function Component() {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const currency = useCurrency();
  const batches = useBatches();

  let body;
  if (batches.isPending) body = <Skeleton rows={5} />;
  else if (batches.isError)
    body = <Banner tone="warn" title={t('ledger.error.load')} action={<Button onClick={() => void batches.refetch()}>{t('ledger.retry')}</Button>} />;
  else if (batches.data.length === 0) body = <EmptyState message={t('ledger.batches.empty')} />;
  else
    body = (
      <LedgerList label={t('ledger.batches.title')}>
        {batches.data.map((b) => {
          const meta = [
            t(`ledger.batch.source.${b.source}`),
            formatDate(localDay(b.createdAt)),
            t('ledger.batch.counts', { active: b.activeCount, voided: b.voidedCount }),
          ].join(' · ');
          return (
            <div role="listitem" key={b.id}>
              <ListRow
                icon={Layers}
                title={b.label}
                name={b.label}
                meta={meta}
                muted={b.activeCount === 0}
                voided={b.activeCount === 0 && b.voidedCount > 0}
                {...(b.controlTotalMinor === null
                  ? {}
                  : { trailing: <AmountText minor={b.controlTotalMinor} currency={currency} neutral />, trailingMeta: t('ledger.batch.control') })}
                onOpen={() => void navigate(`/e/${ws}/lotes/${b.id}`)}
              />
            </div>
          );
        })}
      </LedgerList>
    );

  return (
    <div className="lg">
      <header className="lg-head">
        <h1>{t('ledger.batches.title')}</h1>
      </header>
      {body}
    </div>
  );
}
