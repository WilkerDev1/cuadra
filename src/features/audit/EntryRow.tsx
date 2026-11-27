// Una entrada del historial: hora, qué pasó con las palabras del núcleo (`audit.*`), el monto y los cambios.
import { Link } from 'react-router';
import type { AuditEntry, Currency } from '../../core';
import { useT } from '../../i18n';
import { AmountText } from '../../ui';
import { actionLabelKey, entryAmount, entryTarget, textParams, type ChangeContext, changeLines } from './model';

const MAX_LINES = 4;

const time = new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit' });

export interface EntryRowProps {
  entry: AuditEntry;
  wsId: string;
  currency: Currency;
  accountName: string | null;
  ctx: ChangeContext;
}

export function EntryRow({ entry, wsId, currency, accountName, ctx }: EntryRowProps) {
  const t = useT('auditlog');
  const tAll = useT();
  const amount = entryAmount(entry);
  const target = entryTarget(entry, wsId);
  const lines = changeLines(entry, ctx);
  const actionLabel = t(actionLabelKey(entry));

  const message = tAll(entry.message, textParams(entry.params));
  // Un mensaje sin texto no debe enseñar la clave: se cae al nombre de la acción.
  const text = message === entry.message || message.startsWith('⟦') ? actionLabel : message;
  const reason = lines.find((l) => l.path === 'void_reason');
  const shown = lines.filter((l) => l !== reason).slice(0, MAX_LINES);
  const hidden = lines.filter((l) => l !== reason).length - shown.length;

  return (
    <div role="listitem" className="aud-entry" data-action={entry.action}>
      <time className="aud-entry__time num" dateTime={entry.at}>
        {time.format(new Date(entry.at))}
      </time>
      <div className="aud-entry__main">
        <p className="aud-entry__text">{text}</p>
        <p className="aud-entry__meta">
          <span>{actionLabel}</span>
          {accountName === null ? null : <span>{accountName}</span>}
          {target === null ? null : (
            <Link to={target.to} className="aud-entry__link">
              {t(`link.${target.kind}`)}
            </Link>
          )}
        </p>
        {reason?.new == null ? null : (
          <p className="aud-entry__reason">
            <span className="aud-change__label">{t('reason')}</span> {reason.new}
          </p>
        )}
        {shown.length === 0 && hidden <= 0 ? null : (
          <ul className="aud-changes">
            {shown.map((l, i) => (
              <li key={`${l.path}-${i}`} className="aud-change">
                <span className="aud-change__label">{l.label}</span>
                <span className="aud-change__values">
                  <span className="visually-hidden">{t('changeFrom')} </span>
                  <del className="aud-change__old">{l.old ?? t('empty.value')}</del>
                  <span aria-hidden="true"> → </span>
                  <span className="visually-hidden"> {t('changeTo')} </span>
                  <span className="aud-change__new">{l.new ?? t('empty.value')}</span>
                </span>
              </li>
            ))}
            {hidden > 0 ? <li className="aud-change aud-change--more">{t('moreChanges', { n: hidden })}</li> : null}
          </ul>
        )}
      </div>
      <div className="aud-entry__amount">
        {amount === null ? null : (
          <AmountText
            minor={amount.minor}
            currency={currency}
            size="row"
            {...(amount.kind === undefined ? { neutral: true } : { kind: amount.kind })}
            {...(entry.action === 'void' || entry.action === 'batch_void' ? { voided: true } : {})}
          />
        )}
      </div>
    </div>
  );
}
