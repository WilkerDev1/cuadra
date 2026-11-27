import { describe, expect, it } from 'vitest';
import { buildCurrency, currencyToDraft, decimalsLocked, sameCurrency, sampleMinor } from './currency';

describe('buildCurrency', () => {
  it('normaliza el código a mayúsculas y recorta el símbolo', () => {
    expect(buildCurrency({ code: ' usd ', symbol: ' US$ ', minorDigits: 2 })).toEqual({
      ok: true,
      value: { code: 'USD', minorDigits: 2, symbol: 'US$' },
    });
  });
  it('omite el símbolo vacío', () => {
    expect(buildCurrency({ code: 'DOP', symbol: '  ', minorDigits: 2 })).toEqual({ ok: true, value: { code: 'DOP', minorDigits: 2 } });
  });
  it('rechaza códigos que no son de tres letras', () => {
    expect(buildCurrency({ code: 'RD', symbol: '', minorDigits: 2 })).toEqual({ ok: false, issue: 'code' });
    expect(buildCurrency({ code: 'D0P', symbol: '', minorDigits: 2 })).toEqual({ ok: false, issue: 'code' });
  });
  it('rechaza un símbolo largo', () => {
    expect(buildCurrency({ code: 'DOP', symbol: 'DEMASIADO', minorDigits: 2 })).toEqual({ ok: false, issue: 'symbol' });
  });
});

describe('reglas', () => {
  it('bloquea los decimales con cualquier movimiento', () => {
    expect(decimalsLocked(0)).toBe(false);
    expect(decimalsLocked(1)).toBe(true);
  });
  it('compara monedas sin importar símbolo ausente o vacío', () => {
    expect(sameCurrency({ code: 'DOP', minorDigits: 2 }, { code: 'DOP', minorDigits: 2, symbol: '' })).toBe(true);
    expect(sameCurrency({ code: 'DOP', minorDigits: 2 }, { code: 'DOP', minorDigits: 0 })).toBe(false);
  });
  it('ida y vuelta del borrador', () => {
    expect(currencyToDraft({ code: 'EUR', minorDigits: 2, symbol: '€' })).toEqual({ code: 'EUR', symbol: '€', minorDigits: 2 });
  });
  it('la cifra de muestra respeta los decimales', () => {
    expect(sampleMinor(0)).toBe(1235);
    expect(sampleMinor(3)).toBe(1234567);
  });
});
