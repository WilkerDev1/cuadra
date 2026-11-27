import { ChevronsUpDown, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Money, systemClock, type WorkspaceSummary } from '../../core';
import { useT } from '../../i18n';
import { formatRelativeDay, getLocale } from '../../i18n/format';
import { Chip, Segmented, Sheet } from '../../ui';
import { htmlAttrs } from '../../ui/lib';
import { useOptionalWorkspaceId, useWorkspaces } from '../data/hooks';
import { filterAndSortWorkspaces, type SwitcherSort } from './switcher';
import { useNavigateWithTransition } from './transitions';
import { workspaceInitial, workspaceTint } from './workspaceTint';

/** Lomo de un espacio: franja de tinta, inicial grande y nombre. */
function Spine({ ws }: { ws: Pick<WorkspaceSummary, 'id' | 'name' | 'color'> }) {
  return (
    <span className="spine" style={{ '--spine': workspaceTint(ws.color, ws.id) } as CSSProperties} aria-hidden>
      {workspaceInitial(ws.name)}
    </span>
  );
}

/**
 * Selector de espacio con moneda y saldo. `sheet`: hoja inferior (encabezado móvil); `popover`: popover anclado
 * al disparador (riel y barra lateral). El disparador muestra el espacio actual (`/e/:wsId`).
 */
export function WorkspaceSwitcher({ presentation, tone = 'plain' }: { presentation: 'sheet' | 'popover'; tone?: 'plain' | 'on-forest' }) {
  const t = useT();
  const go = useNavigateWithTransition();
  const wsId = useOptionalWorkspaceId();
  const list = useWorkspaces();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SwitcherSort>('recent');
  const [sheetOpen, setSheetOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popId = useId();
  const anchor = `--ws${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const current = list.data?.find((w) => w.id === wsId);
  const shown = useMemo(() => filterAndSortWorkspaces(list.data ?? [], query, sort), [list.data, query, sort]);
  const today = systemClock.today();

  const close = () => {
    setSheetOpen(false);
    setQuery('');
    if (popRef.current?.matches(':popover-open') === true) popRef.current.hidePopover();
  };
  const choose = (id: string) => {
    close();
    go(`/e/${id}`);
  };
  const triggerLabel = t('common.switcher.trigger', { name: current?.name ?? t('common.switcher.none') });

  const body = (
    <div className="switcher">
      <div className="switcher__tools">
        <input
          ref={searchRef}
          type="search"
          className="switcher__search"
          placeholder={t('common.switcher.search')}
          aria-label={t('common.switcher.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <Segmented
          label={t('common.switcher.sort')}
          options={[
            { value: 'recent', label: t('common.switcher.recent') },
            { value: 'name', label: t('common.switcher.az') },
          ]}
          value={sort}
          onChange={setSort}
          fullWidth
        />
      </div>
      {list.isError ? (
        <p className="switcher__note">{t('common.switcher.error')}</p>
      ) : list.data !== undefined && list.data.length === 0 ? (
        <p className="switcher__note">{t('common.switcher.empty')}</p>
      ) : shown.length === 0 && list.data !== undefined ? (
        <p className="switcher__note">{t('common.switcher.noMatch')}</p>
      ) : (
        <ul className="switcher__list">
          {shown.map((ws) => (
            <li key={ws.id}>
              <button
                type="button"
                className="switcher__item"
                aria-current={ws.id === wsId ? 'true' : undefined}
                onClick={() => choose(ws.id)}
              >
                <Spine ws={ws} />
                <span className="switcher__text">
                  <span className="switcher__name">
                    {ws.name}
                    {ws.isDemo ? <Chip variant="info">{t('common.switcher.demo')}</Chip> : null}
                  </span>
                  <span className="switcher__meta">
                    {ws.lastMovementDate === null
                      ? t('common.switcher.accounts', { n: ws.accountCount })
                      : t('common.switcher.last', { when: formatRelativeDay(ws.lastMovementDate, today) })}
                  </span>
                </span>
                <span className="switcher__balance num" data-amount>
                  {Money.format(ws.balanceMinor, { locale: getLocale(), currency: ws.currency })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="switcher__foot">
        <Link to="/bienvenida" className="switcher__link" onClick={close}>
          <Plus aria-hidden />
          {t('common.switcher.new')}
        </Link>
        <Link to="/" className="switcher__link" onClick={close}>
          {t('common.switcher.all')}
        </Link>
      </div>
    </div>
  );

  const trigger = (
    <button
      type="button"
      className={`ws-trigger ws-trigger--${tone}`}
      aria-label={triggerLabel}
      title={triggerLabel}
      style={{ anchorName: anchor } as CSSProperties}
      {...(presentation === 'popover' ? { popoverTarget: popId } : { onClick: () => setSheetOpen(true) })}
    >
      {current === undefined ? (
        <span className="spine spine--empty" aria-hidden>
          ·
        </span>
      ) : (
        <Spine ws={current} />
      )}
      <span className="ws-trigger__name">{current?.name ?? t('common.switcher.none')}</span>
      <ChevronsUpDown aria-hidden className="ws-trigger__caret" />
    </button>
  );

  if (presentation === 'sheet') {
    return (
      <>
        {trigger}
        <Sheet open={sheetOpen} onClose={close} title={t('common.switcher.title')} variant="bottom" height="tall">
          {body}
        </Sheet>
      </>
    );
  }
  return (
    <>
      {trigger}
      <div
        ref={popRef}
        id={popId}
        className="ui-pop switcher-pop"
        style={{ positionAnchor: anchor } as CSSProperties}
        aria-label={t('common.switcher.title')}
        {...htmlAttrs({ popover: 'auto' })}
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') requestAnimationFrame(() => searchRef.current?.focus());
          else setQuery('');
        }}
      >
        {body}
      </div>
    </>
  );
}
