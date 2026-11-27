import { useParams } from 'react-router';
import { useT } from '../../i18n';
import { Sheet } from '../../ui';
import { useNav, useQuickActions } from '../registry/hooks';
import { useUiStore } from '../state/uiStore';
import { buildShortcutHelp } from './shortcuts';
import { SingleKeySwitch } from './SingleKeySwitch';

/** Hoja de atajos de teclado («?»). Las filas salen del registro, así que siempre dicen lo que de verdad hay. */
export function ShortcutHelp() {
  const t = useT();
  const { wsId } = useParams();
  const open = useUiStore((s) => s.overlay === 'help');
  const close = useUiStore((s) => s.closeOverlay);
  const quickActions = useQuickActions();
  const wsNav = useNav('workspace');
  const rows = buildShortcutHelp({
    quickActions: wsId === undefined ? [] : quickActions,
    goEntries: wsId === undefined ? [] : wsNav.filter((n) => n.goKey !== undefined),
  });
  return (
    <Sheet open={open} onClose={() => close('help')} title={t('common.shortcuts.title')} variant="auto" height="tall">
      <SingleKeySwitch className="shortcut-list__toggle" />
      <dl className="shortcut-list">
        {rows.map((row) => (
          <div key={row.keys.join('+') + row.labelKey} className="shortcut-list__row">
            <dt>{t(row.labelKey)}</dt>
            <dd>
              {row.keys.map((key, i) => (
                <span key={i}>
                  {i > 0 ? <span className="shortcut-list__then"> {t('common.shortcuts.then')} </span> : null}
                  <kbd>{key}</kbd>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="shortcut-list__note">{t('common.shortcuts.note')}</p>
    </Sheet>
  );
}
