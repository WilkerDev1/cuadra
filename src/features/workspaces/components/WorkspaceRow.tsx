import { Link } from 'react-router';
import type { CSSProperties } from 'react';
import { systemClock, type WorkspaceSummary } from '../../../core';
import { formatRelativeDay } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { AmountText, Button, Chip, Menu, type MenuItem } from '../../../ui';
import { workspaceInitial, workspaceTint } from '../tint';

function Spine({ ws }: { ws: Pick<WorkspaceSummary, 'id' | 'name' | 'color'> }) {
  return (
    <span className="wsp-spine" style={{ '--spine': workspaceTint(ws.color, ws.id) } as CSSProperties} aria-hidden="true">
      {workspaceInitial(ws.name)}
    </span>
  );
}

function Meta({ ws }: { ws: WorkspaceSummary }) {
  const t = useT();
  const today = systemClock.today();
  const last =
    ws.lastMovementDate === null
      ? t('workspaces.noMovements')
      : t('workspaces.last', { when: formatRelativeDay(ws.lastMovementDate, today) });
  return (
    <span className="wsp-meta">
      {last} · {t('workspaces.accounts', { n: ws.accountCount })}
    </span>
  );
}

function Name({ ws }: { ws: WorkspaceSummary }) {
  return (
    <span className="wsp-name">
      <span className="wsp-name__text">{ws.name}</span>
    </span>
  );
}

/** Rótulo «Ejemplo» de los datos de ejemplo (DESIGN §15): junto al saldo, para no recortar el nombre. */
function DemoTag({ ws }: { ws: WorkspaceSummary }) {
  const t = useT();
  return ws.isDemo ? (
    <Chip variant="info" className="wsp-demo">
      {t('workspaces.demo')}
    </Chip>
  ) : null;
}

/** Un espacio activo: el lomo entero es el enlace; el menú ⋯ queda aparte. */
export function ActiveRow({ ws, items }: { ws: WorkspaceSummary; items: readonly MenuItem[] }) {
  const t = useT();
  return (
    <li className="wsp-row">
      <Link to={`/e/${ws.id}`} viewTransition className="wsp-lomo">
        <Spine ws={ws} />
        <span className="wsp-text">
          <Name ws={ws} />
          <Meta ws={ws} />
        </span>
        <span className="wsp-figure">
          <AmountText minor={ws.balanceMinor} currency={ws.currency} size="row" className="wsp-balance" />
          <DemoTag ws={ws} />
        </span>
      </Link>
      <Menu label={t('workspaces.menu', { name: ws.name })} items={items} />
    </li>
  );
}

/** Un espacio archivado: gris, con «Recuperar» a la vista y el resto en el menú. */
export function ArchivedRow({
  ws,
  items,
  onRestore,
  restoring,
}: {
  ws: WorkspaceSummary;
  items: readonly MenuItem[];
  onRestore: () => void;
  restoring: boolean;
}) {
  const t = useT();
  return (
    <li className="wsp-row wsp-row--archived">
      <div className="wsp-lomo">
        <Spine ws={ws} />
        <span className="wsp-text">
          <Name ws={ws} />
          <Meta ws={ws} />
        </span>
        <Button variant="secondary" onClick={onRestore} loading={restoring} aria-label={`${t('workspaces.unarchive')}: ${ws.name}`}>
          {t('workspaces.unarchive')}
        </Button>
      </div>
      <Menu label={t('workspaces.menu', { name: ws.name })} items={items} />
    </li>
  );
}
