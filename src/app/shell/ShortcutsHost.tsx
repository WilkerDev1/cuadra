import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { useNav, useQuickActions } from '../registry/hooks';
import { useUiStore } from '../state/uiStore';
import { INITIAL_SHORTCUT_STATE, isTypingTarget, resolveShortcut, type ShortcutState } from './shortcuts';
import { useNavigateWithTransition } from './transitions';
import { resolveTo } from './workspaceLink';

/** Un solo oyente de teclado para todo el shell; la lógica vive en shortcuts.ts. */
export function ShortcutsHost() {
  const { wsId } = useParams();
  const go = useNavigateWithTransition();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const quickActions = useQuickActions();
  const wsNav = useNav('workspace');
  const rootNav = useNav('root');
  const singleKey = useUiStore((s) => s.singleKeyShortcuts);
  const state = useRef<ShortcutState>(INITIAL_SHORTCUT_STATE);

  useEffect(() => {
    const ctx = {
      quickActions: wsId === undefined ? [] : quickActions,
      goEntries: [...(wsId === undefined ? [] : wsNav), ...rootNav].filter((n) => n.goKey !== undefined),
      singleKey,
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Con la pantalla de bloqueo puesta no se atiende nada: la app de detrás sigue montada pero oculta.
      if (document.documentElement.dataset['locked'] === 'true') return;
      const result = resolveShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          typing: isTypingTarget(event.target as HTMLElement | null),
          modalOpen: document.querySelector('dialog:modal') !== null,
        },
        ctx,
        state.current,
        Date.now(),
      );
      state.current = result.state;
      if (result.consumed) event.preventDefault();
      const action = result.action;
      if (action === null) return;
      if (action.type === 'palette') openOverlay('palette');
      else if (action.type === 'help') openOverlay('help');
      else if (action.type === 'newMenu') openOverlay('fab');
      else if (action.type === 'quick') go(resolveTo('workspace', action.action.to, wsId));
      else go(resolveTo(action.entry.scope, action.entry.to, wsId));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [wsId, go, openOverlay, quickActions, wsNav, rootNav, singleKey]);
  return null;
}
