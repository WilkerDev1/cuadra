import { useT } from '../../../i18n';
import { Page } from '../components/Page';
import { TemplateExport } from '../components/TemplateExport';
import { TemplateImport } from '../components/TemplateImport';

/** Plantillas (raíz): crear un espacio con un archivo y guardar un espacio como plantilla. */
export function Component() {
  const t = useT();
  return (
    <Page title={t('backup.tpl.title')}>
      <div className="bk-grid bk-grid--even">
        <TemplateImport />
        <TemplateExport title={t('backup.tpl.export')} />
      </div>
    </Page>
  );
}
