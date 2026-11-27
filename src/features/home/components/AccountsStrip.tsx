// Tira horizontal de cuentas (móvil): fichas de cuenta con scroll-snap, saldo y línea de 30 días.
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { AccountWithBalance, Currency, Id, Minor } from '../../../core';
import { useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { AccountChip, Sparkline } from '../../../ui';

export interface AccountsStripProps {
  accounts: readonly AccountWithBalance[];
  series: Record<Id, Minor[]>;
  currency: Currency;
  hrefFor: (id: Id) => string;
}

export function AccountsStrip({ accounts, series, currency, hrefFor }: AccountsStripProps) {
  const t = useT();
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  return (
    <section className="home-strip" aria-labelledby="home-strip-h">
      <h2 id="home-strip-h" className="home-h2">
        {t('home.accounts.title')}
      </h2>
      <ul className="home-strip__track" role="list">
        {accounts.map((a) => {
          const values = series[a.id] ?? [];
          return (
            <li key={a.id}>
              <AccountChip
                variant="card"
                name={a.name}
                accountType={a.type}
                balanceMinor={a.balanceMinor}
                currency={currency}
                aria-label={t('home.accounts.open', { name: a.name })}
                onClick={() => void navigate(hrefFor(a.id))}
                extra={
                  values.length > 1 ? (
                    <span className="home-strip__spark" aria-hidden="true">
                      <Sparkline values={values} label={t('home.accounts.trend', { name: a.name })} width={112} height={22} />
                    </span>
                  ) : undefined
                }
              />
            </li>
          );
        })}
        <li>
          <Link to={`/e/${ws}/cuentas`} className="ui-acct ui-acct--card home-strip__add">
            <Plus aria-hidden="true" />
            <span>{t('home.accounts.new')}</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
