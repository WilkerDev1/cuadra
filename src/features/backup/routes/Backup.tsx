import { useT } from '../../../i18n';
import { ExportCard } from '../components/ExportCard';
import { Page } from '../components/Page';
import { RestoreCard } from '../components/RestoreCard';
import { AutoCopyCard, StorageCard } from '../components/StorageCard';

/** P-14 · Respaldo y restauración (DESIGN §10.14). */
export function Component() {
  const t = useT();
  return (
    <Page title={t('backup.title')}>
      <div className="bk-grid">
        <div className="bk-col">
          <ExportCard />
          <RestoreCard />
        </div>
        <div className="bk-col">
          <StorageCard />
          <AutoCopyCard />
        </div>
      </div>
    </Page>
  );
}
