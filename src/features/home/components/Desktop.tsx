// Panel de escritorio: una pizarra de bosque con el saldo y su evolución, y debajo el libro abierto en dos
// columnas desiguales (flujo y reparto | atención, cuentas y recientes).
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDashboard, useFields, useWorkspace } from '../../../app/data/hooks';
import { periodLabel, systemClock, type DashboardData, type GroupBy } from '../../../core';
import { useT } from '../../../i18n';
import { AmountText, IconButton, InfoTip, Segmented, cx, type SelectOption } from '../../../ui';
import { desktopOptions, formatPeriodParam, parsePeriodParam, periodFilter, periodRange, PERIOD_KINDS, shortPeriodLabel, type PeriodKind, type PeriodSel } from '../logic/period';
import { useAttention, useCategoryField, useHomeLinks } from '../useHomeModel';
import { BalanceChart } from './BalanceChart';
import { Breakdown } from './Breakdown';
import { FlowChart } from './FlowChart';
import { HomeEmpty, HomeError, HomeLoading } from './States';
import { AccountsList, Attention, Recent } from './Side';
import { useCompare } from './shared';

/** `d` en la URL: `field:<id>`, `account` o vacío (la dimensión por defecto del núcleo). */
function parseDimension(raw: string | null): GroupBy | undefined {
  if (raw === 'account') return { by: 'account' };
  if (raw !== null && raw.startsWith('field:')) return { by: 'field', fieldId: raw.slice(6) };
  return undefined;
}
const dimensionValue = (g: GroupBy): string => (g.by === 'field' ? `field:${g.fieldId}` : g.by === 'account' ? 'account' : '');

export function Desktop() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = systemClock.today();
  const sel = parsePeriodParam(params.get('p'));
  const breakdown = parseDimension(params.get('d'));
  const measure = params.get('m') === 'in' ? 'in' : 'out';
  const opts = useMemo(
    () => desktopOptions(sel, today, { measure, ...(breakdown === undefined ? {} : { breakdown }) }),
    [sel.kind, sel.offset, today, measure, params.get('d')],
  );
  const q = useDashboard(opts);
  const ws = useWorkspace();
  const fields = useFields();
  const links = useHomeLinks();
  const attention = useAttention(q.data, links);
  const category = useCategoryField();
  const compare = useCompare();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const setSel = (s: PeriodSel) => setParam('p', s.kind === 'month' && s.offset === 0 ? null : formatPeriodParam(s));

  const heading = <h1 className="visually-hidden">{t('home.heading', { name: ws.data?.name ?? '' })}</h1>;
  if (q.isError && q.data === undefined) return <HomeError heading={heading} onRetry={() => void q.refetch()} />;
  if (q.data === undefined) return <HomeLoading heading={heading} />;
  const d = q.data;
  if (d.isEmpty) return <HomeEmpty heading={heading} recordHref={links.record} />;

  const dimensions: SelectOption[] = [
    ...(fields.data ?? []).filter((f) => f.type === 'list' && f.active).map((f) => ({ value: `field:${f.id}`, label: f.label })),
    { value: 'account', label: t('home.breakdown.account') },
  ];
  const period = periodFilter(sel, today);
  // Rótulos calculados aquí (no del resultado): cambian al instante aunque la consulta nueva aún no haya llegado.
  const range = periodRange(sel, today);
  const accountName = new Map(d.accounts.map((a) => [a.id, a.name]));
  const pt = d.previousPeriod?.totals;
  const prevChange = pt === undefined ? null : pt.inMinor - pt.outMinor + pt.transfersInMinor - pt.transfersOutMinor + pt.openingsMinor;
  const compareChange =
    prevChange === null || d.previousPeriod === null ? '' : compare(d.balance.periodChangeMinor, prevChange, shortPeriodLabel(d.previousPeriod.label, d.period.label));

  return (
    <div className={cx('home', 'home--desk', q.isFetching && 'is-refreshing')}>
      {heading}
      <PeriodBar sel={sel} label={periodLabel(range.from, range.to)} onChange={setSel} />

      <section className="home-slab" aria-label={t('home.balance.label')}>
        <div className="home-slab__hero">
          <p className="home-slab__label">{t('home.balance.label')}</p>
          <AmountText minor={d.balance.totalMinor} size="hero" highlight animate onForest currency={d.currency} />
          <p className="home-slab__change">
            <AmountText
              minor={Math.abs(d.balance.periodChangeMinor)}
              kind={d.balance.periodChangeMinor < 0 ? 'expense' : 'income'}
              size="m"
              onForest
              currency={d.currency}
            />
            <span>{t('home.balance.change', { period: d.period.label })}</span>
          </p>
          {prevChange === null ? null : <p className="home-slab__meta">{compareChange}</p>}
          <Kpis d={d} hrefIn={links.movements({ period, kinds: ['income'] })} hrefOut={links.movements({ period, kinds: ['expense'] })} />
        </div>
        <div className="home-slab__chart">
          <BalanceChart keys={d.series.keys} values={d.series.totalMinor} unit={d.series.unit} currency={d.currency} range={d.period} />
        </div>
      </section>

      <div className="home-grid">
        <div className="home-main">
          <FlowChart flow={d.flow} range={d.period} currency={d.currency} hrefFor={links.month} onOpen={(k) => void navigate(links.month(k))} />
          <Breakdown
            breakdown={d.breakdown}
            currency={d.currency}
            prevLabel={d.previousPeriod?.label ?? null}
            dimension={dimensionValue(d.breakdown.groupBy)}
            dimensions={dimensions}
            onDimension={(v) => setParam('d', v)}
            onMeasure={(v) => setParam('m', v === 'in' ? 'in' : null)}
            hrefFor={(key) => links.group(d.breakdown.groupBy, key, period, measure === 'in' ? 'income' : 'expense')}
            labelFor={(g) => (d.breakdown.groupBy.by === 'account' && g.key !== null ? (accountName.get(g.key) ?? g.label) : g.label)}
          />
        </div>
        <aside className="home-side" aria-label={t('home.accounts.title')}>
          <Attention items={attention} currency={d.currency} />
          <AccountsList accounts={d.accounts} series={d.series.byAccount} currency={d.currency} hrefFor={links.account} totalMinor={d.balance.totalMinor} />
          <Recent
            rows={d.recent}
            currency={d.currency}
            today={d.today}
            accounts={d.accounts}
            category={category}
            hrefFor={links.tx}
            allHref={links.movements()}
            layout="flat"
            max={6}
          />
        </aside>
      </div>
    </div>
  );
}

function PeriodBar({ sel, label, onChange }: { sel: PeriodSel; label: string; onChange: (s: PeriodSel) => void }) {
  const t = useT();
  return (
    <div className="home-bar">
      <div className="home-bar__step">
        <IconButton icon={ChevronLeft} label={t('home.period.prev')} variant="ghost" onClick={() => onChange({ ...sel, offset: sel.offset - 1 })} />
        <p className="home-bar__label" aria-live="polite">
          <span className="home-bar__period">{label}</span>
        </p>
        <IconButton
          icon={ChevronRight}
          label={t('home.period.next')}
          variant="ghost"
          disabled={sel.offset >= 0}
          onClick={() => onChange({ ...sel, offset: Math.min(0, sel.offset + 1) })}
        />
        {sel.offset < 0 ? (
          <button type="button" className="home-link home-bar__today" onClick={() => onChange({ ...sel, offset: 0 })}>
            {t('home.period.today')}
          </button>
        ) : null}
      </div>
      <Segmented<PeriodKind>
        label={t('home.period.group')}
        value={sel.kind}
        onChange={(kind) => onChange({ kind, offset: 0 })}
        options={PERIOD_KINDS.map((k) => ({ value: k, label: t(`home.period.${k}`) }))}
      />
    </div>
  );
}

function Kpis({ d, hrefIn, hrefOut }: { d: DashboardData; hrefIn: string; hrefOut: string }) {
  const t = useT();
  const compare = useCompare();
  const cur = d.period.totals;
  const prev = d.previousPeriod;
  const prevName = prev === null ? '' : shortPeriodLabel(prev.label, d.period.label);
  const line = (c: number, p: number | undefined) => (prev === null || p === undefined ? null : <span className="home-kpi__cmp">{compare(c, p, prevName)}</span>);
  return (
    <div className="home-kpis">
      <Link to={hrefIn} className="home-kpi" aria-label={t('home.kpi.open', { what: t('home.kpi.in').toLowerCase(), period: d.period.label })}>
        <span className="home-kpi__label">{t('home.kpi.in')}</span>
        <AmountText minor={cur.inMinor} kind="income" size="m" onForest currency={d.currency} />
        {line(cur.inMinor, prev?.totals.inMinor)}
      </Link>
      <Link to={hrefOut} className="home-kpi" aria-label={t('home.kpi.open', { what: t('home.kpi.out').toLowerCase(), period: d.period.label })}>
        <span className="home-kpi__label">{t('home.kpi.out')}</span>
        <AmountText minor={cur.outMinor} kind="expense" size="m" onForest currency={d.currency} />
        {line(cur.outMinor, prev?.totals.outMinor)}
      </Link>
      <InfoTip className="home-kpi__info">{t('home.kpi.info')}</InfoTip>
    </div>
  );
}
