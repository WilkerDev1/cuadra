import { useWorkspaceId } from '../../../app/data/hooks';
import { useT } from '../../../i18n';
import { Page } from '../components/Page';
import { TemplateExport } from '../components/TemplateExport';

/** `/e/:wsId/ajustes/plantilla`: «Guardar este espacio como plantilla» (sección de ajustes del espacio). */
export function Component() {
  const t = useT();
  const wsId = useWorkspaceId();
  return (
    <Page title={t('backup.tpl.workspaceTitle')} embedded>
      <div className="bk-narrow">
        <TemplateExport workspaceId={wsId} title={t('backup.tpl.export')} />
      </div>
    </Page>
  );
}
