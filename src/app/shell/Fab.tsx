import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useT } from '../../i18n';
import { Button } from '../../ui';
import { useQuickActions } from '../registry/hooks';
import type { QuickAction } from '../registry/types';
import { resolveTo } from './workspaceLink';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Botón «Anotar»: abre un menú con las acciones rápidas del registro y registra sus atajos de teclado. */
export function Fab() {
  const t = useT();
  const navigate = useNavigate();
  const { wsId } = useParams();
  const actions = useQuickActions();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  const go = (action: QuickAction) => {
    setOpen(false);
    void navigate(resolveTo('workspace', action.to, wsId));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const hit = actions.find((a) => a.shortcut !== undefined && a.shortcut === event.key.toLowerCase());
      if (hit !== undefined) {
        event.preventDefault();
        setOpen(false);
        void navigate(resolveTo('workspace', hit.to, wsId));
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [actions, navigate, wsId]);

  if (actions.length === 0) return null;
  return (
    <div className="fab" ref={root}>
      {open ? (
        <ul className="fab-menu" id={menuId} aria-label={t('common.fab.menu')}>
          {actions.map((action) => (
            <li key={action.id}>
              <button type="button" className={`fab-item fab-item-${action.tone}`} onClick={() => go(action)}>
                <action.icon aria-hidden size={20} />
                <span>{t(action.labelKey)}</span>
                {action.shortcut === undefined ? null : <kbd>{action.shortcut.toUpperCase()}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="primary"
        shape="pill"
        icon={Plus}
        className="fab-button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {t('common.fab.label')}
      </Button>
    </div>
  );
}
