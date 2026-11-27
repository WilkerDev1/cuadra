// Guardar un lote de captura (tabla o Ráfaga) con aviso «Deshacer» y su nombre automático.
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import type { CaptureInput, CaptureResult } from '../../../core';
import { t as tGlobal } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { useSignedAmount } from '../hooks';

/** Nombre automático editable: «Lote 27 nov, 14:32». */
export function defaultBatchLabel(now: Date = new Date()): string {
  const day = formatDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`).replace(/ \d{4}$/, '');
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return tGlobal('capture.batch.defaultLabel', { date: day, time });
}

class NotSaved extends Error {
  constructor(readonly result: Exclude<CaptureResult, { status: 'saved' }>) {
    super(result.status);
  }
}

/** Guardar un lote con aviso «Deshacer» (anula el lote entero). */
export function useSaveBatch() {
  const money = useSignedAmount();
  return useCuadraMutation(
    async (c, input: CaptureInput) => {
      const r = await c.batches.capture(input);
      if (r.status !== 'saved') throw new NotSaved(r);
      return { value: r, warnings: [], auditActionId: null };
    },
    {
      successToast: (r, input) => {
        let sum = 0;
        for (const i of r.savedRowIndexes) {
          const a = input.rows[i]?.amount;
          if (typeof a === 'number') sum += a;
        }
        return { key: 'capture.toast.batch', params: { n: r.savedRowIndexes.length, amount: money(sum, input.kind) } };
      },
      undo: (c, r) => c.batches.void(r.batchId, tGlobal('capture.undoReason')),
      errorToast: false,
    },
  );
}

export function isNotSaved(e: unknown): e is NotSaved {
  return e instanceof NotSaved;
}
