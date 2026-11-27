import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Money } from '../../core';
import { useT } from '../../i18n';
import { getLocale } from '../../i18n/format';
import { cx } from '../../ui';
import { htmlAttrs, lightDismissFallback } from '../../ui/lib';
import { useAuth } from '../data/auth';
import { useWorkspaces } from '../data/hooks';
import { useNav, useQuickActions } from '../registry/hooks';
import { useUiStore } from '../state/uiStore';
import { buildPaletteItems, filterPalette, groupBySection, type PaletteItem, type PaletteRun } from './palette';
import { useNavigateWithTransition } from './transitions';

/** Paleta de comandos (Ctrl/⌘+K, «/» o el botón Buscar): navegación, acciones de Anotar y espacios. */
export function CommandPalette() {
  const open = useUiStore((s) => s.overlay === 'palette');
  // Montada siempre, pero sin trabajo mientras está cerrada.
  return <PaletteDialog open={open} />;
}

function PaletteDialog({ open }: { open: boolean }) {
  const t = useT();
  const go = useNavigateWithTransition();
  const { wsId } = useParams();
  const auth = useAuth();
  const quickActions = useQuickActions();
  const wsNav = useNav('workspace');
  const rootNav = useNav('root');
  const workspaces = useWorkspaces();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const ref = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo(
    () =>
      open
        ? buildPaletteItems({
            t,
            wsId,
            quickActions,
            nav: [...wsNav, ...rootNav],
            workspaces: workspaces.data ?? [],
            formatMoney: (minor, currency) => Money.format(minor, { locale: getLocale(), currency }),
            authEnabled: auth.enabled,
            theme,
          })
        : [],
    [open, t, wsId, quickActions, wsNav, rootNav, workspaces.data, auth.enabled, theme],
  );
  const results = useMemo(() => filterPalette(items, query), [items, query]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (open && !el.open) {
      setQuery('');
      setActive(0);
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    return el === null ? undefined : lightDismissFallback(el, () => closeOverlay('palette'));
  }, [closeOverlay]);

  const run = (action: PaletteRun) => {
    closeOverlay('palette');
    if (action.type === 'navigate') go(action.to);
    else if (action.type === 'theme') setTheme(action.value);
    else if (action.type === 'lock') void auth.lock();
    else openOverlay('help');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const n = results.length;
      if (n > 0) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[active];
      if (item !== undefined) run(item.run);
    }
  };

  const grouped = query.trim() === '';
  const flat = results;
  const optionId = (item: PaletteItem) => `${listId}-${item.id}`;
  const activeItem = flat[Math.min(active, Math.max(flat.length - 1, 0))];

  const renderOption = (item: PaletteItem) => {
    const Icon = item.icon;
    return (
      <li
        key={item.id}
        id={optionId(item)}
        role="option"
        aria-selected={item === activeItem}
        className={cx('palette__option', item === activeItem && 'is-active')}
        onPointerMove={() => setActive(flat.indexOf(item))}
        onClick={() => run(item.run)}
      >
        {Icon === undefined ? <span className="palette__icon" aria-hidden /> : <Icon aria-hidden className={cx('palette__icon', item.tone !== undefined && `palette__icon--${item.tone}`)} />}
        <span className="palette__label">{item.label}</span>
        {item.hint === undefined ? null : <span className="palette__hint num">{item.hint}</span>}
      </li>
    );
  };

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={t('common.palette.title')}
      onClose={() => closeOverlay('palette')}
      {...htmlAttrs({ closedby: 'any' })}
    >
      <div className="palette__bar">
        <Search aria-hidden size={20} />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeItem === undefined ? undefined : optionId(activeItem)}
          aria-autocomplete="list"
          className="palette__input"
          placeholder={t('common.palette.placeholder')}
          aria-label={t('common.palette.placeholder')}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden>Esc</kbd>
      </div>
      <div className="palette__results">
        {flat.length === 0 ? (
          <p className="palette__empty">{t('common.palette.empty', { query: query.trim() })}</p>
        ) : grouped ? (
          <ul id={listId} role="listbox" aria-label={t('common.palette.title')}>
            {groupBySection(flat).map((g) => (
              <li key={g.section} role="presentation" className="palette__group">
                <p className="palette__heading" aria-hidden>
                  {t(`common.palette.section.${g.section}`)}
                </p>
                <ul role="group" aria-label={t(`common.palette.section.${g.section}`)}>
                  {g.items.map(renderOption)}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <ul id={listId} role="listbox" aria-label={t('common.palette.title')}>
            {flat.map(renderOption)}
          </ul>
        )}
      </div>
      <p className="visually-hidden" role="status">
        {t('common.palette.results', { n: flat.length })}
      </p>
    </dialog>
  );
}
