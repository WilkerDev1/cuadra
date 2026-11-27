// Panel de escritorio: una pizarra de bosque con el saldo y su evolución, y debajo el libro abierto en dos
// columnas desiguales (flujo y reparto | atención, cuentas y recientes).
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDashboard, useFields, useWorkspace } from '../../../app/data/hooks';
import { periodLabel, systemClock, type DashboardData, type GroupBy } from '../../../core';
import { useT } from '../../../i18n';
import { AmountText, IconButton, InfoTip, Segmented, cx, type SelectOption } from '../../../ui';
import { bucketFilter, periodChart } from '../logic/buckets';
import { desktopOptions, formatPeriodParam, parsePeriodParam, periodFilter, periodRange, PERIOD_KINDS, shortPeriodLabel, type PeriodKind, type PeriodSel } from '../logic/period';
import { useAttention, useCategoryField, useHomeLinks } from '../useHomeModel';
import { BalanceChart } from './BalanceChart';
import { Breakdown } from './Breakdown';
import { FlowChart } from './FlowChart';
import { HomeEmpty, HomeError, HomeLoading } from './States';
import { AccountsList, Attention, Recent } from './Side';
import { chartPeriodLabel, useCompare } from './shared';

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
  // Cubos de las dos gráficas, del resultado (no de la selección): mientras llega el periodo nuevo se sigue
  // dibujando el anterior con su propia rejilla.
  const chart = useMemo(() => (q.data === undefined || q.data.isEmpty ? null : periodChart(q.data)), [q.data]);

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
  if (d.isEmpty || chart === null) return <HomeEmpty heading={heading} recordHref={links.record} />;

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
  const pp = d.previousPeriod;
  // Nombres cortos para la pizarra, los KPI y las gráficas: «dic 2025 – nov 2026», no «1 dic 2025 – 30 nov 2026»
  // (la etiqueta larga partía los KPI en dos renglones en 12 meses).
  const prevShort = pp === null ? null : shortPeriodLabel(pp.label, d.period.label);
  const prevName = prevShort === null || pp === null || pp.from === null || pp.to === null ? prevShort : chartPeriodLabel(prevShort, pp.from, pp.to);
  const compareChange = prevChange === null || prevName === null ? '' : compare(d.balance.periodChangeMinor, prevChange, prevName);
  const chartLabel = chartPeriodLabel(d.period.label, chart.from, chart.to);
  const chartPrevLabel = chart.prev === null ? null : prevName;
  const openBucket = (b: { from: string; to: string }) => links.movements(bucketFilter(b));

  return (
    <div className={cx('home', 'home--desk', q.isFetching && 'is-refreshing')}>
      {heading}
      <PeriodBar sel={sel} label={chartPeriodLabel(periodLabel(range.from, range.to), range.from, range.to)} onChange={setSel} />

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
            <span>{t('home.balance.change', { period: chartLabel })}</span>
          </p>
          {prevChange === null ? null : <p className="home-slab__meta">{compareChange}</p>}
          <Kpis
            d={d}
            periodName={chartLabel}
            prevName={prevName}
            hrefIn={links.movements({ period, kinds: ['income'] })}
            hrefOut={links.movements({ period, kinds: ['expense'] })}
          />
        </div>
        <div className="home-slab__chart">
          <BalanceChart chart={chart} periodLabel={chartLabel} prevLabel={chartPrevLabel} currency={d.currency} />
        </div>
      </section>

      <div className="home-grid">
        <div className="home-main">
          <FlowChart chart={chart} periodLabel={chartLabel} currency={d.currency} hrefFor={openBucket} onOpen={(b) => void navigate(openBucket(b))} />
          <Breakdown
            breakdown={d.breakdown}
            currency={d.currency}
            prevLabel={prevName}
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
        {/* Siempre en el DOM (oculto en el periodo actual) para que la barra no cambie de alto al navegar. */}
        <button
          type="button"
          className={cx('home-link home-bar__today', sel.offset >= 0 && 'is-hidden')}
          disabled={sel.offset >= 0}
          onClick={() => onChange({ ...sel, offset: 0 })}
        >
          {t('home.period.today')}
        </button>
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

function Kpis({ d, periodName, prevName, hrefIn, hrefOut }: { d: DashboardData; periodName: string; prevName: string | null; hrefIn: string; hrefOut: string }) {
  const t = useT();
  const compare = useCompare();
  const cur = d.period.totals;
  const prev = d.previousPeriod;
  const line = (c: number, p: number | undefined) =>
    prev === null || prevName === null || p === undefined ? null : <span className="home-kpi__cmp">{compare(c, p, prevName)}</span>;
  return (
    <div className="home-kpis">
      <Link to={hrefIn} className="home-kpi" aria-label={t('home.kpi.open', { what: t('home.kpi.in').toLowerCase(), period: periodName })}>
        <span className="home-kpi__label">{t('home.kpi.in')}</span>
        <AmountText minor={cur.inMinor} kind="income" size="m" onForest currency={d.currency} />
        {line(cur.inMinor, prev?.totals.inMinor)}
      </Link>
      <Link to={hrefOut} className="home-kpi" aria-label={t('home.kpi.open', { what: t('home.kpi.out').toLowerCase(), period: periodName })}>
        <span className="home-kpi__label">{t('home.kpi.out')}</span>
        <AmountText minor={cur.outMinor} kind="expense" size="m" onForest currency={d.currency} />
        {line(cur.outMinor, prev?.totals.outMinor)}
      </Link>
      <InfoTip className="home-kpi__info">{t('home.kpi.info')}</InfoTip>
    </div>
  );
}
