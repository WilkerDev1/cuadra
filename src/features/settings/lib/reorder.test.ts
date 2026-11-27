import { describe, expect, it } from 'vitest';
import { fullOrder, moveId, positionOf } from './reorder';

describe('moveId', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('sube y baja una posición', () => {
    expect(moveId(ids, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveId(ids, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('no se sale por los bordes', () => {
    expect(moveId(ids, 'a', -1)).toBeNull();
    expect(moveId(ids, 'd', 1)).toBeNull();
  });
  it('ignora ids desconocidos y no modifica la entrada', () => {
    expect(moveId(ids, 'z', 1)).toBeNull();
    moveId(ids, 'a', 1);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('positionOf', () => {
  it('cuenta desde 1', () => {
    expect(positionOf(['a', 'b', 'c'], 'b')).toEqual({ position: 2, total: 3 });
    expect(positionOf(['a'], 'x')).toBeNull();
  });
});

describe('fullOrder', () => {
  it('deja lo inactivo al final sin repetir ids', () => {
    expect(fullOrder(['b', 'a'], ['z', 'a'])).toEqual(['b', 'a', 'z']);
  });
});
