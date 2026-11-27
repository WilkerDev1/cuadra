import { describe, expect, it } from 'vitest';
import type { FieldOption } from '../../../core';
import { defaultMergeTarget, mergeCandidates } from './merge';

const opt = (id: string, label: string, active = true): FieldOption => ({
  id,
  fieldId: 'f',
  key: id,
  label,
  color: null,
  appliesTo: 'both',
  sortOrder: 0,
  active,
  mergedIntoId: null,
});

describe('mergeCandidates', () => {
  const options = [opt('a', 'Varios'), opt('b', 'Otros gastos'), opt('c', 'Viejo', false)];
  it('excluye el origen y las inactivas', () => {
    expect(mergeCandidates(options, 'a').map((o) => o.id)).toEqual(['b']);
  });
});

describe('defaultMergeTarget', () => {
  const candidates = [opt('b', 'Otros gastos'), opt('c', 'Electricidad')];
  it('propone la parecida si es candidata', () => {
    expect(defaultMergeTarget(candidates, [opt('c', 'Electricidad')])).toBe('c');
  });
  it('ignora parecidas que no son candidatas', () => {
    expect(defaultMergeTarget(candidates, [opt('z', 'Otra')])).toBe('b');
  });
  it('sin candidatas no hay destino', () => {
    expect(defaultMergeTarget([], [])).toBeNull();
  });
});
