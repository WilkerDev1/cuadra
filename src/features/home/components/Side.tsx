// Columna lateral del panel y bloques que comparte con el móvil: cuentas con tendencia, lo que pide atención y
// los últimos movimientos.
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { AccountWithBalance, Currency, Field, Id, IsoDate, Minor, TransactionRow } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate, formatDayHeader } from '../../../i18n/format';
import { ACCOUNT_ICON, AmountText, DoubleRule, KIND_ICON, Sparkline, cx } from '../../../ui';

export interface AttentionItem {
  id: string;
  text: string;
  href: string;
  detail?: { minor: Minor; kind?: 'income' | 'expense' };
}

export function Attention({ items, currency, className }: { items: readonly AttentionItem[]; currency: Currency; className?: string }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section className={cx('home-att', className)} aria-labelledby="home-att-h">
      <h2 id="home-att-h" className="home-h2 home-att__h">
        <CircleAlert aria-hidden="true" />
        {t('home.attention.title')}
        <span className="home-att__count num">{items.length}</span>
      </h2>
      <ul className="home-att__list" role="list">
        {items.map((it) => (
          <li key={it.id}>
            <Link to={it.href} className="home-att__item">
              <span className="home-att__text">{it.text}</span>
              {it.detail === undefined ? null : (
                <AmountText minor={it.detail.minor} size="row" currency={currency} {...(it.detail.kind === undefined ? {} : { kind: it.detail.kind })} />
              )}
              <ChevronRight aria-hidden="true" className="home-att__go" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface AccountsListProps {
  accounts: readonly AccountWithBalance[];
  series: Record<Id, Minor[]>;
  currency: Currency;
  hrefFor: (id: Id) => string;
  totalMinor: Minor;
}

export function AccountsList({ accounts, series, currency, hrefFor, totalMinor }: AccountsListProps) {
  const t = useT();
  return (
    <section className="home-acc" aria-labelledby="home-acc-h">
      <h2 id="home-acc-h" className="home-h2">
        {t('home.accounts.title')}
      </h2>
      {accounts.length === 0 ? (
        <p className="meta">{t('home.accounts.none')}</p>
      ) : (
        <ul className="home-acc__list" role="list">
          {accounts.map((a) => {
            const Icon = ACCOUNT_ICON[a.type];
            const values = series[a.id] ?? [];
            return (
              <li key={a.id}>
                <Link to={hrefFor(a.id)} className="home-acc__row" aria-label={t('home.accounts.open', { name: a.name })}>
                  <Icon aria-hidden="true" className="home-acc__icon" />
                  <span className="home-acc__name truncate">{a.name}</span>
                  <span className="home-acc__spark" aria-hidden="true">
                    {values.length > 1 ? <Sparkline values={values} label={t('home.accounts.trend', { name: a.name })} width={72} height={22} /> : null}
                  </span>
                  <AmountText minor={a.balanceMinor} size="row" currency={currency} className="home-acc__amt" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {accounts.length > 1 ? (
        <div className="home-acc__total">
          <span>{t('home.balance.label')}</span>
          <span className="home-acc__total-fig">
            <AmountText minor={totalMinor} size="row" currency={currency} />
            <DoubleRule />
          </span>
        </div>
      ) : null}
    </section>
  );
}

export interface RecentProps {
  rows: readonly TransactionRow[];
  currency: Currency;
  today: IsoDate;
  accounts: readonly AccountWithBalance[];
  category: Field | null;
  hrefFor: (id: Id) => string;
  allHref: string;
  /** `days`: agrupado por día con cabecera (móvil); `flat`: con la fecha en la meta (escritorio). */
  layout: 'days' | 'flat';
  groups?: Array<{ date: IsoDate; items: TransactionRow[] }>;
  /** Filas como máximo (tras juntar los dos lados de cada transferencia). */
  max?: number;
}

/** Concepto con su meta: categoría · cuenta (· fecha). */
export function useRowMeta(accounts: readonly AccountWithBalance[], category: Field | null) {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const options = new Map((category?.options ?? []).map((o) => [o.id, o.label]));
  return (r: TransactionRow): string[] => {
    const v = category === null ? undefined : r.values[category.id];
    const cat = v !== undefined && v.type === 'list' ? options.get(v.optionId) : undefined;
    const acct = names.get(r.accountId);
    const other = r.counterpart === null ? undefined : names.get(r.counterpart.accountId);
    return [cat, r.kind === 'transfer' && other !== undefined ? `${acct ?? ''} › ${other}` : acct].filter((x): x is string => x !== undefined && x !== '');
  };
}

export function Recent({ rows, currency, today, accounts, category, hrefFor, allHref, layout, groups, max = 10 }: RecentProps) {
  const t = useT();
  const meta = useRowMeta(accounts, category);
  // Una transferencia trae sus dos lados: se muestra una sola vez (el de salida, «Caja › Banco»).
  const once = (r: TransactionRow) => r.kind !== 'transfer' || r.direction === 'out';
  rows = rows.filter(once).slice(0, max);
  const keep = new Set(rows.map((r) => r.id));
  groups = groups?.map((g) => ({ ...g, items: g.items.filter((r) => keep.has(r.id)) })).filter((g) => g.items.length > 0);
  const row = (r: TransactionRow, withDate: boolean) => {
    const Icon = KIND_ICON[r.kind];
    const parts = meta(r);
    return (
      <li key={r.id}>
        <Link to={hrefFor(r.id)} className={cx('home-rec__row', `home-rec__row--${r.kind}`)}>
          <Icon aria-hidden="true" className="home-rec__icon" />
          <span className="home-rec__text">
            <span className="home-rec__title truncate">{r.description === '' ? t(`ui.kind.${r.kind}`) : r.description}</span>
            <span className="home-rec__meta truncate">{[...(withDate ? [formatDayHeader(r.date, today)] : []), ...parts].join(' · ')}</span>
          </span>
          <AmountText minor={r.amountMinor} kind={r.kind} size="row" currency={currency} />
        </Link>
      </li>
    );
  };
  return (
    <section className="home-rec" aria-labelledby="home-rec-h">
      <div className="home-sec-head">
        <h2 id="home-rec-h" className="home-h2">
          {t('home.recent.title')}
        </h2>
        <Link to={allHref} className="home-link">
          {t(layout === 'flat' ? 'home.recent.all' : 'home.recent.allLong')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="meta">{t('home.recent.none')}</p>
      ) : layout === 'flat' ? (
        <ul className="home-rec__list" role="list">
          {rows.map((r) => row(r, true))}
        </ul>
      ) : (
        <div className="home-rec__days">
          {(groups ?? []).map((g) => (
            <section key={g.date} className="home-rec__day" aria-label={formatDate(g.date)}>
              <h3 className="home-rec__dayhead">{formatDayHeader(g.date, today)}</h3>
              <ul className="home-rec__list" role="list">
                {g.items.map((r) => row(r, false))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
