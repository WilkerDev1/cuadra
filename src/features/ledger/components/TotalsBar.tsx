// Totales del filtro: entradas, salidas y neto. Transferencias y saldos iniciales van aparte (no suman aquí).
import type { Currency, Totals } from '../../../core';
import { useT } from '../../../i18n';
import { AmountText, InfoTip } from '../../../ui';

export function TotalsBar({ totals, currency }: { totals: Totals; currency: Currency }) {
  const t = useT();
  return (
    <section className="lg-totals" aria-label={t('ledger.totals.label')}>
      <dl className="lg-totals__list">
        <div className="lg-totals__item">
          <dt>{t('ledger.totals.in')}</dt>
          <dd>
            {/* Un cero no es una entrada ni una salida: va en tinta neutra, sin signo ni color */}
            <AmountText minor={totals.inMinor} {...(totals.inMinor === 0 ? { neutral: true } : { kind: 'income' as const })} currency={currency} size="m" />
          </dd>
        </div>
        <div className="lg-totals__item">
          <dt>{t('ledger.totals.out')}</dt>
          <dd>
            <AmountText minor={totals.outMinor} {...(totals.outMinor === 0 ? { neutral: true } : { kind: 'expense' as const })} currency={currency} size="m" />
          </dd>
        </div>
        <div className="lg-totals__item lg-totals__item--net">
          <dt>
            {t('ledger.totals.net')}
            <InfoTip>{t('ledger.totals.tip')}</InfoTip>
          </dt>
          <dd>
            <AmountText minor={totals.netMinor} currency={currency} size="m" rule="double" animate />
          </dd>
        </div>
      </dl>
      <p className="lg-totals__count">
        {t('ledger.totals.count', { n: totals.count })}
        {totals.voidedCount > 0 ? ` · ${t('ledger.totals.voided', { n: totals.voidedCount })}` : ''}
      </p>
    </section>
  );
}
