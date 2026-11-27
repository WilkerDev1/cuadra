// Inicio móvil (DESIGN §10.3): saldo a sangre con su línea del mes en curso (desde la apertura hasta hoy), el mes en dos cifras pulsables, lo que pide
// atención, las cuentas en una tira deslizable y los últimos movimientos por día.
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { useDashboard, useWorkspace } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { AmountText, InfoTip, Sparkline } from '../../../ui';
import { groupByDay, tail } from '../logic/chart';
import { mobileOptions } from '../logic/period';
import { useAttention, useCategoryField, useHomeLinks } from '../useHomeModel';
import { AccountsStrip } from './AccountsStrip';
import { HomeEmpty, HomeError, HomeLoading } from './States';
import { Attention, Recent } from './Side';
import { useCompare, useWidth } from './shared';

const OPTS = mobileOptions();

export function Mobile() {
  const t = useT();
  const q = useDashboard(OPTS);
  const ws = useWorkspace();
  const links = useHomeLinks();
  const attention = useAttention(q.data, links);
  const category = useCategoryField();
  const compare = useCompare();

  const heading = <h1 className="visually-hidden">{t('home.heading', { name: ws.data?.name ?? '' })}</h1>;
  if (q.isError && q.data === undefined) return <HomeError heading={heading} onRetry={() => void q.refetch()} />;
  if (q.data === undefined) return <HomeLoading heading={heading} />;
  const d = q.data;
  if (d.isEmpty) return <HomeEmpty heading={heading} recordHref={links.record} />;

  const month = d.period.totals;
  const prev = d.previousPeriod;
  const period = { preset: 'this_month' as const };
  const days = groupByDay(d.recent);
  // La pantalla habla del mes en curso: la línea va de la apertura del mes al cierre de hoy (la serie diaria puede
  // seguir con días posteriores si hay movimientos programados; aquí no se dibujan).
  const trend = [d.dailyOpeningMinor, ...d.daily.filter((x) => x.date <= d.today).map((x) => x.balanceMinor)];
  const monthName = d.period.label.replace(/ \d{4}$/, '');
  const prevName = prev?.label.replace(/ \d{4}$/, '') ?? '';
  const byAccount = Object.fromEntries(Object.entries(d.series.byAccount).map(([id, v]) => [id, tail(v, 30)]));

  return (
    <div className="home home--mob">
      {heading}
      <section className="home-mslab" aria-label={t('home.balance.label')}>
        <p className="home-slab__label">{t('home.balance.label')}</p>
        <AmountText minor={d.balance.totalMinor} size="hero" highlight animate onForest currency={d.currency} />
        {trend.length > 1 ? <HeroSpark values={trend} label={t('home.balance.trend', { period: monthName })} /> : null}
        <p className="home-mslab__meta">
          {t('home.balance.accounts', { n: d.accounts.length, date: formatDate(d.today).replace(/ \d{4}$/, '') })}
        </p>
      </section>

      <section className="home-month" aria-labelledby="home-month-h">
        <div className="home-sec-head">
          <h2 id="home-month-h" className="home-h2">
            {t('home.kpi.month')}
          </h2>
          <InfoTip>{t('home.kpi.info')}</InfoTip>
        </div>
        <div className="home-month__pair">
          <Link to={links.movements({ period, kinds: ['income'] })} className="home-month__cell">
            <span className="home-month__label">
              <ArrowDownLeft aria-hidden="true" className="home-month__icon home-month__icon--in" />
              {t('home.kpi.in')}
            </span>
            <AmountText minor={month.inMinor} kind="income" size="m" currency={d.currency} />
            {prev === null ? null : <span className="home-month__cmp">{compare(month.inMinor, prev.totals.inMinor, prevName)}</span>}
          </Link>
          <Link to={links.movements({ period, kinds: ['expense'] })} className="home-month__cell">
            <span className="home-month__label">
              <ArrowUpRight aria-hidden="true" className="home-month__icon home-month__icon--out" />
              {t('home.kpi.out')}
            </span>
            <AmountText minor={month.outMinor} kind="expense" size="m" currency={d.currency} />
            {prev === null ? null : <span className="home-month__cmp">{compare(month.outMinor, prev.totals.outMinor, prevName)}</span>}
          </Link>
        </div>
      </section>

      <Attention items={attention} currency={d.currency} className="home-att--mob" />

      <AccountsStrip accounts={d.accounts} series={byAccount} currency={d.currency} hrefFor={links.account} />

      <Recent
        rows={d.recent}
        groups={days}
        currency={d.currency}
        today={d.today}
        accounts={d.accounts}
        category={category}
        hrefFor={links.tx}
        allHref={links.movements()}
        layout="days"
      />
    </div>
  );
}

/** Línea del mes a todo el ancho de la tarjeta (se mide al montarse, ya con datos). */
function HeroSpark({ values, label }: { values: readonly number[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  return (
    <div ref={ref} className="home-mslab__spark">
      <Sparkline values={values} label={label} width={width} height={48} onForest />
    </div>
  );
}
