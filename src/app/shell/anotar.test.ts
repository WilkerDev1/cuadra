import { describe, expect, it } from 'vitest';
import type { QuickAction } from '../registry/types';
import { pickDefaultAction } from './anotar';

const icon = (() => null) as unknown as QuickAction['icon'];
const action = (id: string, tone: QuickAction['tone'], order: number): QuickAction => ({ id, labelKey: id, icon, tone, to: id, order });
const actions = [action('in', 'in', 1), action('out', 'out', 2), action('xfer', 'neutral', 3)];

describe('pickDefaultAction', () => {
  it('elige la acción del último tipo usado', () => {
    expect(pickDefaultAction(actions, 'expense')?.id).toBe('out');
    expect(pickDefaultAction(actions, 'income')?.id).toBe('in');
  });
  it('sin historial, o sin acción de ese tipo, usa la primera', () => {
    expect(pickDefaultAction(actions, null)?.id).toBe('in');
    expect(pickDefaultAction(actions, undefined)?.id).toBe('in');
    expect(pickDefaultAction([action('xfer', 'neutral', 1)], 'expense')?.id).toBe('xfer');
  });
  it('sin acciones no hay nada que abrir', () => {
    expect(pickDefaultAction([], 'income')).toBeUndefined();
  });
});
