// Enlaces del panel a Movimientos. El formato (`periodo`, `cuenta`, `f`) es el compartido de
// app/data/txFilterUrl: el mismo que lee Movimientos y que usa el Resumen.
import { movementsHref as sharedMovementsHref } from '../../../app/data/txFilterUrl';
import type { TxFilter } from '../../../core';

export function movementsHref(wsId: string, filter: TxFilter = {}): string {
  return sharedMovementsHref(wsId, filter);
}
