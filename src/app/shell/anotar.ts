// Qué hace un toque en «Anotar» (DESIGN §8.2): abre Nuevo movimiento con el último tipo usado. El shell no conoce
// los tipos de captura: elige entre las acciones rápidas del registro por su `tone` (entrada = in, salida = out).
import type { QuickAction } from '../registry/types';

export function pickDefaultAction(actions: readonly QuickAction[], lastKind: 'income' | 'expense' | null | undefined): QuickAction | undefined {
  const tone = lastKind === 'income' ? 'in' : lastKind === 'expense' ? 'out' : undefined;
  return (tone === undefined ? undefined : actions.find((a) => a.tone === tone)) ?? actions[0];
}

/** Pulsación larga: umbral de DESIGN §8.2. */
export const LONG_PRESS_MS = 400;
