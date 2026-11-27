// /e/:wsId/cuentas/:accountId — libro de una cuenta: por día con subtotales, saldo corrido y n.º.
import { Link, useParams } from 'react-router';
import type { DateRange } from '../../../core';
import { useAccounts, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { ACCOUNT_ICON, AmountText, Banner, Chip, InfoTip, Skeleton } from '../../../ui';
import { FilterBar } from '../components/FilterBar';
import { LedgerView } from '../components/LedgerView';
import { useCurrency, useUrlFilter } from '../data';
import { filterChips } from '../logic/filterChips';
import '../ledger.css';

const DEFAULT_PERIOD: DateRange = { preset: 'all' };

export function Component() {
  const t = useT();
  const ws = useWorkspaceId();
  const { accountId = '' } = useParams();
  const accounts = useAccounts({ includeArchived: true });
  const currency = useCurrency();
  const { filter, setFilter } = useUrlFilter({ defaultPeriod: DEFAULT_PERIOD, fixedAccountId: accountId });
  const account = accounts.data?.find((a) => a.id === accountId);

  if (accounts.isPending) return <Skeleton rows={6} />;
  if (account === undefined)
    return (
      <div className="lg">
        <h1>{t('ledger.account.missing')}</h1>
        <Banner tone="warn" action={<Link to={`/e/${ws}/cuentas`}>{t('ledger.account.back')}</Link>}>
          {t('ledger.account.missingText')}
        </Banner>
      </div>
    );

  const filtered =
    filterChips(filter, { accounts: [], fields: [], money: String, date: String, t, fixedAccountId: accountId }).length > 0 ||
    JSON.stringify(filter.period) !== JSON.stringify(DEFAULT_PERIOD);
  const Icon = ACCOUNT_ICON[account.type];

  return (
    <div className="lg">
      <header className="lg-head lg-head--account">
        <div className="lg-head__title">
          <h1>{account.name}</h1>
          <Chip variant="info" icon={Icon}>
            {t(`ledger.accountType.${account.type}`)}
          </Chip>
          {account.archivedAt !== null ? <Chip variant="info">{t('ledger.account.archived')}</Chip> : null}
        </div>
        <div className="lg-head__balance">
          <span className="lg-head__label">
            {t('ledger.account.balance')}
            {account.isNegative ? (
              <InfoTip tone="warn" label={t('ledger.account.negative')}>
                {t('ledger.account.negativeTip')}
              </InfoTip>
            ) : null}
          </span>
          <AmountText minor={account.balanceMinor} currency={currency} size="l" highlight animate />
        </div>
      </header>
      <FilterBar filter={filter} setFilter={setFilter} defaultPeriod={DEFAULT_PERIOD} fixedAccountId={accountId} exportName={account.name} />
      <LedgerView
        filter={filter}
        filtered={filtered}
        onClearFilters={() => setFilter({ period: DEFAULT_PERIOD, accountIds: [accountId] })}
        emptyMessage={t('ledger.account.empty')}
      />
    </div>
  );
}
