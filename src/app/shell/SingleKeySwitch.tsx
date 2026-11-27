import { useT } from '../../i18n';
import { Switch } from '../../ui';
import { useUiStore } from '../state/uiStore';

/** Encender o apagar los atajos de una sola tecla (WCAG 2.1.4). Ctrl/⌘+K sigue funcionando siempre. */
export function SingleKeySwitch({ className }: { className?: string }) {
  const t = useT();
  const on = useUiStore((s) => s.singleKeyShortcuts);
  const set = useUiStore((s) => s.setSingleKeyShortcuts);
  return (
    <Switch
      className={className}
      label={t('common.shortcuts.singleKey')}
      description={t('common.shortcuts.singleKeyHint')}
      checked={on}
      onChange={set}
    />
  );
}
