import { describe, expect, it } from 'vitest';
import { Money, type AccountWithBalance } from '../../../core';
import { dropSlot, fullOrder, groupByType, moveBy, moveTo, parseOpening, slotToIndex, splitArchived, totalOf } from './accounts';

function acc(id: string, type: AccountWithBalance['type'], balanceMinor: number, sortOrder: number, archived = false): AccountWithBalance {
  return {
    id,
    workspaceId: 'w',
    name: id,
    type,
    color: null,
    icon: null,
    sortOrder,
    archivedAt: archived ? '2026-01-01T00:00:00Z' : null,
    createdAt: '',
    updatedAt: '',
    balanceMinor,
    lastMovementDate: null,
    isNegative: balanceMinor < 0,
    openingTransactionId: null,
  };
}

const parse = (s: string) => Money.parse(s, { locale: 'es-DO', currency: { code: 'DOP', minorDigits: 2 } });

describe('cuentas', () => {
  const list = [acc('banco', 'bank', 310000, 1), acc('caja', 'cash', 1240000, 0), acc('tarjeta', 'card', -435000, 2), acc('vieja', 'cash', 0, 3, true)];

  it('separa archivadas, agrupa por tipo y suma', () => {
    const { active, archived } = splitArchived(list);
    expect(active.map((a) => a.id)).toEqual(['caja', 'banco', 'tarjeta']);
    expect(archived.map((a) => a.id)).toEqual(['vieja']);
    const groups = groupByType(active);
    expect(groups.map((g) => [g.type, g.subtotalMinor])).toEqual([
      ['cash', 1240000],
      ['bank', 310000],
      ['card', -435000],
    ]);
    expect(totalOf(active)).toBe(1115000);
  });

  it('mueve con flechas y por arrastre', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(moveBy(ids, 'b', -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveBy(ids, 'a', -1)).toEqual(ids);
    expect(moveBy(ids, 'd', 1)).toEqual(ids);
    expect(moveTo(ids, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    // Puntos medios 10, 30, 50, 70: el puntero en 45 cae en el hueco 2 (antes de «c»)
    expect(dropSlot([10, 30, 50, 70], 45)).toBe(2);
    expect(dropSlot([10, 30, 50, 70], 90)).toBe(4);
    expect(dropSlot([10, 30, 50, 70], -5)).toBe(0);
    // «a» (0) soltada en el hueco 2 queda en el índice 1
    expect(moveTo(ids, 0, slotToIndex(0, 2))).toEqual(['b', 'a', 'c', 'd']);
    expect(moveTo(ids, 3, slotToIndex(3, 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(fullOrder(['b', 'a'], [list[3]!])).toEqual(['b', 'a', 'vieja']);
  });

  it('valida el saldo inicial', () => {
    expect(parseOpening({ amount: '4,350.00', direction: 'out', date: '2026-01-01' }, parse)).toEqual({
      ok: true,
      value: { amountMinor: 435000, direction: 'out', date: '2026-01-01' },
    });
    expect(parseOpening({ amount: '', direction: 'in', date: '2026-01-01' }, parse)).toEqual({ ok: false, error: 'empty' });
    expect(parseOpening({ amount: '5', direction: 'in', date: '' }, parse)).toEqual({ ok: false, error: 'date_required' });
    expect(parseOpening({ amount: '1.234', direction: 'in', date: '2026-01-01' }, parse)).toEqual({ ok: false, error: 'too_many_decimals' });
  });
});
