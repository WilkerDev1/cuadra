// Avisos suaves en vivo (duplicado, saldo negativo, fecha lejana…): una línea discreta por aviso, nunca bloquean.
import { CircleAlert } from 'lucide-react';
import { useAccounts } from '../../../app/data/hooks';
import type { Warning } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { useSignedAmount } from '../hooks';

export function SoftWarnings({ warnings }: { warnings: readonly Warning[] }) {
  const t = useT('capture');
  const accounts = useAccounts({ includeArchived: true }).data ?? [];
  const money = useSignedAmount();
  const text = (w: Warning): string | null => {
    switch (w.code) {
      case 'zero_amount':
        return null; // el visor ya pide el monto
      case 'possible_duplicate':
        return t('warn.duplicate', { seq: String(w.seq).padStart(4, '0') });
      case 'negative_balance': {
        const name = accounts.find((a) => a.id === w.accountId)?.name ?? '';
        return t('warn.negative', { account: name, amount: money(w.balanceAfterMinor) });
      }
      case 'far_date':
        return w.days > 0 ? t('warn.future', { n: w.days }) : t('warn.past', { n: -w.days });
      case 'before_opening':
        return t('warn.beforeOpening', { date: formatDate(w.openingDate) });
      default:
        return t(`errors.warning.${w.code}`);
    }
  };
  const lines = warnings.map((w) => ({ w, s: text(w) })).filter((x): x is { w: Warning; s: string } => x.s !== null);
  return (
    <ul className="cap-warnings" role="status" aria-live="polite">
      {lines.map(({ w, s }, i) => (
        <li key={`${w.code}-${i}`} className="cap-warnings__item">
          <CircleAlert aria-hidden="true" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}
