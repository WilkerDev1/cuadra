import { describe, expect, it } from 'vitest';
import { buildSearchText, editDistance, escapeLike, normalizeSearch, searchTerms } from './text';

describe('text', () => {
  it('normalizeSearch quita tildes, mayúsculas y espacios de más', () => {
    expect(normalizeSearch('  Café   CON Leche ')).toBe('cafe con leche');
    expect(normalizeSearch('Piña ÑAME àéîõü')).toBe('pina name aeiou');
    expect(normalizeSearch('')).toBe('');
  });

  it('buildSearchText junta descripción y notas normalizadas', () => {
    expect(buildSearchText('Pago Electricidad', 'Factura EDESUR')).toBe('pago electricidad factura edesur');
    expect(buildSearchText('Café', '')).toBe('cafe');
  });

  it('searchTerms parte el texto en palabras normalizadas', () => {
    expect(searchTerms(' Café  ventas ')).toEqual(['cafe', 'ventas']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('escapeLike escapa los comodines de LIKE con barra invertida', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });

  it('editDistance mide la distancia de Levenshtein', () => {
    expect(editDistance('electricidad', 'electrisidad')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
