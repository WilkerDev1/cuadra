import { ChevronUp, Plus } from 'lucide-react';
import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useT } from '../../i18n';
import { htmlAttrs } from '../../ui/lib';
import { useOptionalWorkspaceId, useWorkspaceSetting } from '../data/hooks';
import { useQuickActions } from '../registry/hooks';
import type { QuickAction } from '../registry/types';
import { useUiStore } from '../state/uiStore';
import { LONG_PRESS_MS, pickDefaultAction } from './anotar';
import { useNavigateWithTransition } from './transitions';
import { resolveTo } from './workspaceLink';

/**
 * Botón «Anotar». Toque: abre la acción del último tipo usado. Pulsación larga (400 ms) o `^`: menú con todas las
 * acciones rápidas del registro y su atajo. `pill` es la pastilla de la barra inferior; `side` la del riel y la
 * barra lateral (a 72 px se queda en el icono).
 */
export function Anotar({ variant }: { variant: 'pill' | 'side' }) {
  const t = useT();
  const go = useNavigateWithTransition();
  const wsId = useOptionalWorkspaceId();
  const actions = useQuickActions();
  const [lastKind] = useWorkspaceSetting('capture.lastKind');
  const overlay = useUiStore((s) => s.overlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const menuId = useId();
  const anchor = `--anotar${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const defaultAction = pickDefaultAction(actions, lastKind);

  const open = (action: QuickAction) => {
    menu.current?.hidePopover();
    go(resolveTo('workspace', action.to, wsId));
  };
  const showMenu = () => {
    if (menu.current !== null && !menu.current.matches(':popover-open')) menu.current.showPopover();
  };

  // El atajo `n` pide abrir el menú: lo atiende la instancia visible (hay una por tamaño de pantalla).
  useEffect(() => {
    if (overlay !== 'fab') return;
    if (root.current !== null && root.current.getClientRects().length > 0) {
      closeOverlay('fab');
      showMenu();
    }
  }, [overlay, closeOverlay]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (actions.length === 0 || wsId === undefined) return null;

  const onMenuKey = (event: KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const dir = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    event.preventDefault();
    items[(index + dir + items.length) % items.length]?.focus();
  };

  return (
    <div className={`anotar anotar--${variant}`} ref={root} data-anotar style={{ anchorName: anchor } as CSSProperties}>
      <button
        type="button"
        className="anotar__main"
        title={t('common.fab.label')}
        onPointerDown={() => {
          longPressed.current = false;
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            showMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => window.clearTimeout(timer.current)}
        onPointerLeave={() => window.clearTimeout(timer.current)}
        onPointerCancel={() => window.clearTimeout(timer.current)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          if (defaultAction !== undefined) open(defaultAction);
        }}
      >
        <Plus aria-hidden strokeWidth={2.5} />
        <span className="anotar__label">{t('common.fab.label')}</span>
      </button>
      <button
        type="button"
        className="anotar__caret"
        aria-label={t('common.fab.menu')}
        popoverTarget={menuId}
        aria-haspopup="menu"
      >
        <ChevronUp aria-hidden />
      </button>
      <div
        ref={menu}
        id={menuId}
        role="menu"
        aria-label={t('common.fab.menu')}
        className="ui-pop anotar__menu"
        style={{ positionAnchor: anchor } as CSSProperties}
        {...htmlAttrs({ popover: 'auto' })}
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') {
            requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('button')?.focus());
          }
        }}
        onKeyDown={onMenuKey}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className={`anotar__item anotar__item--${action.tone}`}
            onClick={() => open(action)}
          >
            <action.icon aria-hidden />
            <span>{t(action.labelKey)}</span>
            {action.shortcut === undefined ? null : <kbd>{action.shortcut.toUpperCase()}</kbd>}
          </button>
        ))}
      </div>
    </div>
  );
}
