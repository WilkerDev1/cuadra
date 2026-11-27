// /e/:wsId/lotes — lotes de captura, importación y datos de ejemplo: monto con signo, si cuadran contra su total
// de control, filtro «Descuadrados» (el mismo conjunto que avisa Inicio) y paginación con «Ver más».
// `?ver=descuadrados` abre la página ya filtrada.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Layers } from 'lucide-react';
import type { Batch } from '../../../core';
import { useDashboard, useTotals, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { AmountText, Banner, Button, EmptyState, LedgerList, ListRow, Segmented, Skeleton } from '../../../ui';
import { localDay, shortDate } from '../components/format';
import { useBatches, useCurrency } from '../data';
import { batchRowSummary } from '../logic/batch';
import '../ledger.css';

const PAGE = 40;
type View = 'all' | 'unbalanced';

export function Component() {
  const t = useT();
  const [search, setSearch] = useSearchParams();
  const view: View = search.get('ver') === 'descuadrados' ? 'unbalanced' : 'all';
  const [shown, setShown] = useState(PAGE);
  const batches = useBatches();
  // Mismo conjunto que «N lotes descuadrados» de Inicio (incluye los guardados aceptando el descuadre).
  const dashboard = useDashboard();
  const unbalanced = dashboard.data?.attention.unbalancedBatches ?? [];
  const unbalancedIds = new Set(unbalanced.map((u) => u.batch.id));

  const setView = (v: View) => {
    const next = new URLSearchParams(search);
    if (v === 'unbalanced') next.set('ver', 'descuadrados');
    else next.delete('ver');
    setSearch(next, { replace: true });
    setShown(PAGE);
  };

  let body;
  if (batches.isPending) body = <Skeleton rows={5} />;
  else if (batches.isError)
    body = <Banner tone="warn" title={t('ledger.error.load')} action={<Button onClick={() => void batches.refetch()}>{t('ledger.retry')}</Button>} />;
  else {
    const list = view === 'unbalanced' ? batches.data.filter((b) => unbalancedIds.has(b.id)) : batches.data;
    if (list.length === 0)
      body = <EmptyState message={t(view === 'unbalanced' ? 'ledger.batches.noneUnbalanced' : 'ledger.batches.empty')} />;
    else
      body = (
        <>
          <LedgerList label={t('ledger.batches.title')} className="lg-batches">
            {list.slice(0, shown).map((b) => (
              <BatchRow key={b.id} batch={b} />
            ))}
          </LedgerList>
          {list.length > shown ? (
            <div className="lg-batches__more">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                {t('ledger.batches.more', { n: Math.min(PAGE, list.length - shown), total: list.length })}
              </Button>
            </div>
          ) : null}
        </>
      );
  }

  return (
    <div className="lg">
      <header className="lg-head">
        <h1>{t('ledger.batches.title')}</h1>
        <Segmented<View>
          label={t('ledger.batches.view')}
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: t('ledger.batches.all') },
            { value: 'unbalanced', label: dashboard.data === undefined ? t('ledger.batches.unbalanced') : t('ledger.batches.unbalancedN', { n: unbalanced.length }) },
          ]}
        />
      </header>
      {body}
    </div>
  );
}

function BatchRow({ batch }: { batch: Batch }) {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const currency = useCurrency();
  // Misma consulta (y misma clave de caché) que el cuadre de BatchDetail.
  const totals = useTotals({ batchId: batch.id, period: { preset: 'all' } });
  const summary = totals.data === undefined ? null : batchRowSummary(batch, totals.data);
  const voided = batch.activeCount === 0 && batch.voidedCount > 0;

  // Corta para que quepa a 390px: la fuente solo si no es una captura (lo habitual), fecha sin año si es de este año.
  const meta = [
    batch.source === 'capture' ? null : t(`ledger.batch.source.${batch.source}`),
    shortDate(localDay(batch.createdAt), localDay(new Date().toISOString())),
    voided
      ? t('ledger.batches.countVoided', { n: batch.voidedCount })
      : batch.voidedCount > 0
        ? t('ledger.batches.countMixed', { active: batch.activeCount, voided: batch.voidedCount })
        : t('ledger.batches.count', { n: batch.activeCount }),
  ]
    .filter((x) => x !== null)
    .join(' · ');

  let status = null;
  if (summary !== null && summary.status !== 'voided' && summary.status !== 'noControl') {
    status =
      summary.status === 'balanced' ? (
        <span className="lg-batches__ok">{t('ledger.batches.balanced')}</span>
      ) : (
        <span className="lg-batches__warn">
          {t(summary.status === 'missing' ? 'ledger.batch.missingAmount' : 'ledger.batch.extraAmount')}{' '}
          <AmountText minor={summary.gapMinor ?? 0} currency={currency} size="table" neutral />
        </span>
      );
  }
  const amount =
    summary?.amount == null ? undefined : summary.amount.kind === null ? (
      <AmountText minor={summary.amount.minor} currency={currency} size="row" neutral />
    ) : (
      <AmountText minor={summary.amount.minor} currency={currency} size="row" kind={summary.amount.kind} />
    );

  return (
    <div role="listitem">
      <ListRow
        icon={Layers}
        title={batch.label === '' ? t('ledger.batch.title') : batch.label}
        name={batch.label}
        meta={meta}
        muted={batch.activeCount === 0}
        voided={voided}
        {...(amount === undefined ? {} : { trailing: amount })}
        {...(status === null ? {} : { trailingMeta: status })}
        onOpen={() => void navigate(`/e/${ws}/lotes/${batch.id}`)}
      />
    </div>
  );
}
