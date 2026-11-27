import { describe, expect, it } from 'vitest';
import type { TxFilter } from '../../core';
import { decodeTxFilter, encodeTxFilter, movementsHref, normalizeFilter, readLedgerSearch } from './txFilterUrl';

const DEFAULT = { period: { preset: 'this_month' as const } };
const read = (href: string) => readLedgerSearch(new URLSearchParams(href.split('?')[1] ?? ''), DEFAULT);

describe('formato compartido de filtros en la URL', () => {
  const cases: Array<[string, TxFilter]> = [
    ['sin nada (periodo por defecto)', {}],
    ['preset distinto del de por defecto', { period: { preset: 'this_year' } }],
    ['rango con una cuenta', { period: { from: '2026-10-01', to: '2026-10-31' }, accountIds: ['acc1'] }],
    ['varias cuentas y tipos', { accountIds: ['b', 'a'], kinds: ['income', 'expense'] }],
    ['campo de lista y texto con tildes', { fields: [{ fieldId: 'f1', op: 'any_of', optionIds: ['o1'] }], text: 'Categoría ñ' }],
    ['monto, estado y lote', { amount: { min: 100000 }, status: 'voided', batchId: 'b1' }],
    ['rango abierto', { period: { to: '2026-11-30' } }],
  ];
  it.each(cases)('ida y vuelta: %s', (_name, filter) => {
    const href = movementsHref('ws1', filter);
    expect(href.startsWith('/e/ws1/movimientos')).toBe(true);
    const got = read(href);
    expect(got.invalid).toBe(false);
    expect(got.filter).toEqual(normalizeFilter({ ...filter, period: filter.period ?? DEFAULT.period }));
  });
  it('f suelto (como lo escribían Inicio y Resumen) se lee igual', () => {
    const filter: TxFilter = { period: { from: '2026-04-01', to: '2026-04-30' }, kinds: ['expense', 'income'] };
    expect(read(`/e/ws/movimientos?f=${encodeTxFilter(filter)}`).filter).toEqual(normalizeFilter(filter));
  });
  it('periodo y cuenta en claro ganan sobre f', () => {
    const f = encodeTxFilter({ period: { preset: 'last_month' }, accountIds: ['x'] });
    expect(read(`/e/ws/movimientos?f=${f}&periodo=this_year&cuenta=y`).filter).toMatchObject({ period: { preset: 'this_year' }, accountIds: ['y'] });
  });
  it('decodeTxFilter rechaza lo que no es un filtro', () => {
    expect(decodeTxFilter('no-es-json')).toBeNull();
    expect(decodeTxFilter(null)).toBeNull();
    expect(decodeTxFilter(encodeTxFilter({ kinds: ['nope'] } as never))).toBeNull();
    expect(encodeTxFilter({ text: '¿ñ?' })).not.toMatch(/[+/=]/);
  });
  it('un f mal formado se ignora y se avisa', () => {
    expect(read('/e/ws/movimientos?f=%%%')).toMatchObject({ invalid: true, filter: normalizeFilter(DEFAULT) });
  });
});
