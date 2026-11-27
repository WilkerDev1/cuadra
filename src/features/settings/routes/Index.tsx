// /e/:wsId/ajustes: índice de las secciones que registran las features (`settingsSections`).
// En ancho, el contenido de «Espacio» ocupa la columna derecha para que la página no quede vacía.
import { useT } from '../../../i18n';
import { Frame } from '../components/Frame';
import { WorkspacePanel } from './Workspace';

export function Component() {
  const t = useT('settings');
  return (
    <Frame title={t('title')} index>
      <h2 className="set-h2">{t('sec.space')}</h2>
      <WorkspacePanel />
    </Frame>
  );
}
