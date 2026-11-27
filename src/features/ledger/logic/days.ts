// Lista de libro aplanada para el virtualizador: cabeceras de día con subtotal + filas.
import { Money, type Id, type IsoDate, type Minor, type TransactionRow } from '../../../core';

export interface DayItem {
  type: 'day';
  key: string;
  date: IsoDate;
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  count: number;
}
export interface RowItem {
  type: 'row';
  key: string;
  row: TransactionRow;
}
export type LedgerItem = DayItem | RowItem;

/**
 * Una transferencia es UNA fila en la vista de espacio (DESIGN §10.7): se oculta el lado de entrada cuando el de
 * salida también entra en el listado (sin filtro de cuenta, o con su cuenta en el filtro).
 */
export function collapseTransfers(rows: readonly TransactionRow[], accountIds: readonly Id[] | undefined): TransactionRow[] {
  if (accountIds !== undefined && accountIds.length === 1) return [...rows];
  const scope = accountIds === undefined || accountIds.length === 0 ? null : new Set(accountIds);
  return rows.filter((r) => {
    if (r.kind !== 'transfer' || r.direction !== 'in' || r.counterpart === null) return true;
    const outVisible = scope === null || scope.has(r.counterpart.accountId);
    return !outVisible;
  });
}

/**
 * Agrupa filas ya ordenadas por fecha descendente. El subtotal del día cuenta solo entradas y salidas activas
 * (las transferencias y los saldos iniciales quedan fuera, como en los totales del núcleo).
 *
 * `hasMore`: el último día puede estar cortado por la paginación; si hay más de un día cargado se retiene hasta
 * que llegue la página siguiente, para que ningún subtotal se muestre a medias.
 */
export function groupByDay(rows: readonly TransactionRow[], opts: { hasMore: boolean }): LedgerItem[] {
  const days: Array<{ head: DayItem; rows: RowItem[] }> = [];
  for (const row of rows) {
    let day = days.at(-1);
    if (day === undefined || day.head.date !== row.date) {
      day = { head: { type: 'day', key: `d:${row.date}`, date: row.date, inMinor: 0, outMinor: 0, netMinor: 0, count: 0 }, rows: [] };
      days.push(day);
    }
    day.rows.push({ type: 'row', key: `r:${row.id}`, row });
    day.head.count += 1;
    if (row.status === 'active') {
      if (row.kind === 'income') day.head.inMinor = Money.add(day.head.inMinor, row.amountMinor);
      if (row.kind === 'expense') day.head.outMinor = Money.add(day.head.outMinor, row.amountMinor);
    }
  }
  if (opts.hasMore && days.length > 1) days.pop();
  const out: LedgerItem[] = [];
  for (const d of days) {
    d.head.netMinor = Money.sub(d.head.inMinor, d.head.outMinor);
    out.push(d.head, ...d.rows);
  }
  return out;
}

/** Índice de la cabecera de día que debe quedar pegada arriba cuando el primer elemento visible es `start`. */
export function activeDayIndex(items: readonly LedgerItem[], dayIndexes: readonly number[], start: number): number | null {
  let found: number | null = null;
  for (const i of dayIndexes) {
    if (i > start) break;
    found = i;
  }
  return items.length === 0 ? null : found;
}

/** N.º de movimiento con ceros a la izquierda (DESIGN §10.5: «n.º 0142»). */
export function padSeq(seq: number): string {
  return String(seq).padStart(4, '0');
}
