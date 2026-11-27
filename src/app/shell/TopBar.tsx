import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import { IconButton } from '../../ui';
import { useUiStore } from '../state/uiStore';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** Encabezado de 56 px en móvil: chip del espacio (abre el selector) y buscar. */
export function TopBar() {
  const t = useT();
  const open = useUiStore((s) => s.openOverlay);
  return (
    <header className="topbar">
      <WorkspaceSwitcher presentation="sheet" />
      <IconButton label={t('common.nav.search')} icon={Search} onClick={() => open('palette')} />
    </header>
  );
}
