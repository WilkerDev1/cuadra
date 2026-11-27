// Cuadre de un lote: suma de los activos contra el total de control (mismo criterio que el panel del núcleo:
// suma de montos de los movimientos activos del lote, sin signo).
import { Money, type Batch, type Minor, type Totals } from '../../../core';

export interface BatchBalance {
  sumMinor: Minor;
  controlMinor: Minor | null;
  /** suma − control; `null` sin total de control. */
  differenceMinor: Minor | null;
  balanced: boolean;
  canVoid: boolean;
  /** Solo si todo el lote está anulado: restaurar devuelve lo que anuló el lote. */
  canRestore: boolean;
}

export function batchBalance(batch: Batch, totals: Totals): BatchBalance {
  const sumMinor = Money.sum([totals.inMinor, totals.outMinor, totals.openingsMinor, totals.transfersOutMinor]);
  const controlMinor = batch.controlTotalMinor;
  const differenceMinor = controlMinor === null ? null : Money.sub(sumMinor, controlMinor);
  return {
    sumMinor,
    controlMinor,
    differenceMinor,
    balanced: differenceMinor === null || differenceMinor === 0,
    canVoid: batch.activeCount > 0,
    canRestore: batch.activeCount === 0 && batch.voidedCount > 0,
  };
}
