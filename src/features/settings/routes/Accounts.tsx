// ajustes/cuentas: orden y archivo de las cuentas. Crear y editar viven en la pantalla Cuentas.
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import type { AccountWithBalance } from '../../../core';
import { useAccounts, useMoneyFormat, useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { ACCOUNT_ICON, Banner, EmptyState, InfoTip, LedgerList, Switch } from '../../../ui';
import { Frame } from '../components/Frame';
import { Load } from '../components/Load';
import { ReorderButtons, useAnnouncer } from '../components/Reorder';
import { fullOrder, moveId, positionOf } from '../lib/reorder';
import { splitActive } from '../lib/fieldRules';
import { useRun } from '../lib/useRun';

export function Component() {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const query = useAccounts({ includeArchived: true });
  return (
    <Frame
      title={t('sec.accounts')}
      actions={
        <Link className="set-link" to={`/e/${wsId}/cuentas`}>
          {t('accounts.open')}
        </Link>
      }
    >
      <Load query={query}>{(accounts) => <AccountList accounts={accounts} />}</Load>
    </Frame>
  );
}

function AccountList({ accounts }: { accounts: AccountWithBalance[] }) {
  const t = useT('settings');
  const wsId = useWorkspaceId();
  const money = useMoneyFormat();
  const { run, error } = useRun();
  const [live, announce] = useAnnouncer();
  const { active, inactive } = splitActive(accounts.map((a) => ({ ...a, active: a.archivedAt === null })));
  const activeIds = active.map((a) => a.id);

  if (accounts.length === 0) {
    return (
      <EmptyState
        message={t('accounts.empty')}
        action={
          <Link className="set-link" to={`/e/${wsId}/cuentas`}>
            <Plus aria-hidden="true" /> {t('accounts.emptyAction')}
          </Link>
        }
      />
    );
  }

  const move = async (account: AccountWithBalance, delta: -1 | 1) => {
    const next = moveId(activeIds, account.id, delta);
    if (next === null) return;
    const where = positionOf(next, account.id);
    const r = await run((c) => c.accounts.reorder(wsId, fullOrder(next, inactive.map((a) => a.id))));
    if (r.ok && where !== null) announce(t('moved', { name: account.name, position: where.position, total: where.total }));
  };

  const toggle = (account: AccountWithBalance, on: boolean) =>
    run(
      (c) => (on ? c.accounts.unarchive(account.id) : c.accounts.archive(account.id)),
      () => ({ key: on ? 'settings.accounts.unarchive' : 'settings.accounts.archive', params: { name: account.name } }),
    );

  const row = (account: AccountWithBalance, index: number, listLength: number, isActive: boolean) => {
    const Icon = ACCOUNT_ICON[account.type];
    return (
      <div key={account.id} role="listitem" className="set-row" data-muted={isActive ? undefined : ''}>
        <Icon aria-hidden="true" className="set-row__icon" />
        <span className="set-row__text">
          <span className="set-row__title truncate">{account.name}</span>
          <span className="set-row__meta truncate">
            <span className="visually-hidden">{t(`accounts.type.${account.type}`)}. </span>
            <span className="num">{money(account.balanceMinor)}</span>
          </span>
        </span>
        {isActive ? (
          <ReorderButtons name={account.name} canUp={index > 0} canDown={index < listLength - 1} onMove={(d) => void move(account, d)} />
        ) : null}
        <Switch
          label={<span className="visually-hidden">{t('active', { name: account.name })}</span>}
          checked={isActive}
          onChange={(on) => void toggle(account, on)}
          layout="inline"
        />
      </div>
    );
  };

  return (
    <div className="set-stack">
      {error === null ? null : <Banner tone="warn">{error}</Banner>}
      {live}
      <LedgerList label={t('sec.accounts')}>{active.map((a, i) => row(a, i, active.length, true))}</LedgerList>
      {inactive.length === 0 ? null : (
        <section className="set-sec" aria-labelledby="set-acc-off">
          <h2 id="set-acc-off" className="set-h2">
            {t('accounts.archived', { n: inactive.length })} <InfoTip>{t('accounts.archivedTip')}</InfoTip>
          </h2>
          <LedgerList label={t('accounts.archived', { n: inactive.length })}>{inactive.map((a, i) => row(a, i, inactive.length, false))}</LedgerList>
        </section>
      )}
    </div>
  );
}
