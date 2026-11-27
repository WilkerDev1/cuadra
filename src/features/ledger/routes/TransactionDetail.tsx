// /e/:wsId/movimientos/:txId (hoja o inspector) — detalle con todos los campos, historial y acciones (DESIGN §10.10).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, Copy, Pencil, RotateCcw } from 'lucide-react';
import type { AuditEntry, Field, Transaction } from '../../../core';
import { useMoneyFormat, useTransaction, useTransactionHistory, useWorkspaceId } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { errorMessage } from '../../../app/data/errorMessage';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AmountText, Banner, Button, Skeleton, Stamp } from '../../../ui';
import { accountName, VoidDialog } from '../components/rowParts';
import { dateTime, localDay, longDate } from '../components/format';
import { useCurrency, useLookups } from '../data';
import { padSeq } from '../logic/days';
import { actionKey, changeLines, formatFieldValue } from '../logic/history';
import '../ledger.css';

export function Component() {
  const t = useT();
  const { txId } = useParams();
  const tx = useTransaction(txId);
  if (tx.isPending) return <Skeleton rows={6} />;
  if (tx.isError) return <Banner tone="warn" title={t('ledger.detail.missing')}>{errorMessage(tx.error, t)}</Banner>;
  return <Detail tx={tx.data} />;
}

function Detail({ tx }: { tx: Transaction }) {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const currency = useCurrency();
  const { accounts, fields } = useLookups();
  const [voiding, setVoiding] = useState(false);
  const restore = useCuadraMutation((c, id: string) => c.transactions.restore(id), { successToast: 'ledger.toast.restored' });
  const voided = tx.status === 'voided';
  const account = accountName(accounts, tx.accountId);
  const kindLabel = t(`ledger.kind.${tx.kind}`);
  const recordedDay = localDay(tx.recordedAt);

  const valueRows = fields
    .map((f) => ({ field: f, text: formatFieldValue(tx.values[f.id], f, { money: String, date: formatDate, fields, t }) }))
    .filter((r): r is { field: Field; text: string } => r.text !== null);

  return (
    <article className="lg-detail" aria-labelledby="lg-detail-head">
      <header className="lg-detail__head">
        <p id="lg-detail-head" className="lg-detail__kind">
          {t('ledger.detail.headline', { kind: kindLabel, seq: padSeq(tx.seq), account })}
        </p>
        <div className="lg-detail__amount">
          <AmountText
            minor={tx.kind === 'opening' && tx.direction === 'out' ? -tx.amountMinor : tx.amountMinor}
            currency={currency}
            size="l"
            voided={voided}
            {...(tx.kind === 'opening' ? { neutral: true } : { kind: tx.kind })}
          />
          {voided ? <Stamp variant="anulado" className="lg-detail__stamp" /> : null}
        </div>
        <p className="lg-detail__date">
          {longDate(tx.date)}
          {recordedDay !== tx.date ? <span className="lg-detail__recorded"> · {t('ledger.detail.recorded', { date: formatDate(recordedDay) })}</span> : null}
        </p>
        {voided && tx.voidedAt !== null ? (
          <p className="lg-detail__voided">
            {t('ledger.detail.voidedOn', { date: formatDate(localDay(tx.voidedAt)) })}
            {tx.voidReason !== null && tx.voidReason !== '' ? ` · ${tx.voidReason}` : ''}
          </p>
        ) : null}
      </header>

      <div className="lg-detail__actions">
        {voided ? (
          <Button icon={RotateCcw} loading={restore.isPending} onClick={() => restore.mutate(tx.id)}>
            {t('ledger.action.restoreOne')}
          </Button>
        ) : (
          <>
            {tx.kind !== 'opening' ? (
              <>
                <Button icon={Pencil} onClick={() => void navigate(`/e/${ws}/nuevo?editar=${tx.id}`)}>
                  {t('ledger.action.editOne')}
                </Button>
                <Button icon={Copy} onClick={() => void navigate(`/e/${ws}/nuevo?desde=${tx.id}`)}>
                  {t('ledger.action.duplicate')}
                </Button>
              </>
            ) : null}
            <Button variant="danger" icon={Ban} onClick={() => setVoiding(true)}>
              {t('ledger.action.voidOne')}
            </Button>
          </>
        )}
      </div>

      <dl className="lg-dl">
        <div>
          <dt>{t('ledger.field.description')}</dt>
          <dd>{tx.description === '' ? kindLabel : tx.description}</dd>
        </div>
        {tx.kind === 'transfer' && tx.counterpart !== null ? (
          <>
            <div>
              <dt>{t('ledger.field.from')}</dt>
              <dd>
                <TransferSide accountId={tx.direction === 'out' ? tx.accountId : tx.counterpart.accountId} seq={tx.direction === 'out' ? tx.seq : tx.counterpart.seq} txId={tx.direction === 'out' ? null : tx.counterpart.transactionId} />
              </dd>
            </div>
            <div>
              <dt>{t('ledger.field.to')}</dt>
              <dd>
                <TransferSide accountId={tx.direction === 'in' ? tx.accountId : tx.counterpart.accountId} seq={tx.direction === 'in' ? tx.seq : tx.counterpart.seq} txId={tx.direction === 'in' ? null : tx.counterpart.transactionId} />
              </dd>
            </div>
          </>
        ) : (
          <div>
            <dt>{t('ledger.field.account')}</dt>
            <dd>
              <Link to={`/e/${ws}/cuentas/${tx.accountId}`}>{account}</Link>
            </dd>
          </div>
        )}
        {valueRows.map((r) => (
          <div key={r.field.id}>
            <dt>{r.field.active ? r.field.label : t('ledger.filter.inactiveField', { label: r.field.label })}</dt>
            <dd>{r.text}</dd>
          </div>
        ))}
        {tx.notes !== '' ? (
          <div>
            <dt>{t('ledger.field.notes')}</dt>
            <dd className="lg-dl__notes">{tx.notes}</dd>
          </div>
        ) : null}
        {tx.batchId !== null ? (
          <div>
            <dt>{t('ledger.field.batch')}</dt>
            <dd>
              <Link to={`/e/${ws}/lotes/${tx.batchId}`}>{t('ledger.detail.openBatch')}</Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <History tx={tx} />
      {voiding ? <VoidDialog target={{ id: tx.id, label: tx.description }} onClose={() => setVoiding(false)} /> : null}
    </article>
  );
}

function TransferSide({ accountId, seq, txId }: { accountId: string; seq: number; txId: string | null }) {
  const t = useT();
  const ws = useWorkspaceId();
  const { accounts } = useLookups();
  const label = `${accountName(accounts, accountId)} · ${t('ledger.seq', { seq: padSeq(seq) })}`;
  return txId === null ? <span>{label}</span> : <Link to={`/e/${ws}/movimientos/${txId}`}>{label}</Link>;
}

function History({ tx }: { tx: Transaction }) {
  const t = useT();
  const money = useMoneyFormat();
  const { fields } = useLookups();
  const history = useTransactionHistory(tx.id);
  // Línea de tiempo que crece hacia abajo: la primera entrada siempre es el alta.
  const entries: AuditEntry[] = [...(history.data ?? [])].sort((a, b) => {
    const ca = actionKey(a) === 'ledger.action.create' ? 0 : 1;
    const cb = actionKey(b) === 'ledger.action.create' ? 0 : 1;
    return ca - cb || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  });
  return (
    <section className="lg-history" aria-labelledby="lg-history-title">
      <h2 id="lg-history-title">{t('ledger.history.title')}</h2>
      {history.isPending ? (
        <Skeleton rows={2} />
      ) : history.isError ? (
        <p className="lg-muted">{errorMessage(history.error, t)}</p>
      ) : (
        <ol className="lg-timeline">
          {entries.map((e) => {
            const lines = changeLines(e, { money, date: formatDate, fields, t });
            return (
              <li key={e.id} className="lg-timeline__item">
                <p className="lg-timeline__when">
                  <time dateTime={e.at}>{dateTime(e.at)}</time> · {t(actionKey(e))}
                </p>
                {lines.length > 0 ? (
                  <ul className="lg-changes">
                    {lines.map((l, i) => (
                      <li key={i}>
                        <span className="lg-changes__label">{l.labelKey === 'field' ? l.fieldLabel : t(`ledger.field.${l.labelKey}`)}</span>
                        <span className="lg-changes__values">
                          {l.old === null ? <span className="lg-changes__empty">{t('ledger.value.empty')}</span> : <del>{l.old}</del>}
                          <span aria-hidden="true"> → </span>
                          <span className="visually-hidden"> {t('ledger.history.to')} </span>
                          {l.new === null ? <span className="lg-changes__empty">{t('ledger.value.empty')}</span> : <ins>{l.new}</ins>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
