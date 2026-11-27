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
  /**
   * Mientras quede algo anulado por el propio lote (`restorableCount`), aunque se haya restaurado a mano parte de él:
   * `batches.restore` revive solo eso. Lo anulado a mano no cuenta.
   */
  canRestore: boolean;
  /** Cuántos movimientos devolvería «Restaurar lote». */
  restorableCount: number;
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
    canRestore: batch.restorableCount > 0,
    restorableCount: batch.restorableCount,
  };
}

export type BatchStatus = 'voided' | 'noControl' | 'balanced' | 'missing' | 'extra';

export interface BatchRowSummary {
  /** Cifra con signo para la lista: neto entradas − salidas; sin entradas ni salidas, la suma neutra. */
  amount: { minor: Minor; kind: 'income' | 'expense' | null } | null;
  status: BatchStatus;
  /** |suma − control| cuando falta o sobra. */
  gapMinor: Minor | null;
}

/** Fila de la página Lotes: monto con signo y si cuadra contra el control (mismo criterio que `batchBalance`). */
export function batchRowSummary(batch: Batch, totals: Totals): BatchRowSummary {
  if (batch.activeCount === 0) return { amount: null, status: 'voided', gapMinor: null };
  const b = batchBalance(batch, totals);
  const net = Money.sub(totals.inMinor, totals.outMinor);
  const amount =
    totals.inMinor !== 0 || totals.outMinor !== 0
      ? { minor: Math.abs(net), kind: net >= 0 ? ('income' as const) : ('expense' as const) }
      : b.sumMinor !== 0
        ? { minor: b.sumMinor, kind: null }
        : null;
  if (b.differenceMinor === null) return { amount, status: 'noControl', gapMinor: null };
  if (b.differenceMinor === 0) return { amount, status: 'balanced', gapMinor: null };
  return { amount, status: b.differenceMinor < 0 ? 'missing' : 'extra', gapMinor: Math.abs(b.differenceMinor) };
}
