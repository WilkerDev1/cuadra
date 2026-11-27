import { describe, expect, it } from 'vitest';
import { MAX_MINOR, Money, type MoneyParseOptions } from './money';
import type { Currency } from './types';

const DOP: Currency = { code: 'DOP', minorDigits: 2, symbol: 'RD$' };
const EUR: Currency = { code: 'EUR', minorDigits: 2 };
const JPY: Currency = { code: 'JPY', minorDigits: 0 };
const KWD: Currency = { code: 'KWD', minorDigits: 3 };
const doDO: MoneyParseOptions = { locale: 'es-DO', currency: DOP };
const esES: MoneyParseOptions = { locale: 'es-ES', currency: EUR };

const okValue = (value: number) => ({ ok: true, value });
const errValue = (error: string) => ({ ok: false, error });

describe('Money.parse', () => {
  it('parse es-DO "1,234.50" → 123450', () => {
    expect(Money.parse('1,234.50', doDO)).toEqual(okValue(123450));
  });

  it('parse es-ES "1.234,50" → 123450', () => {
    expect(Money.parse('1.234,50', esES)).toEqual(okValue(123450));
  });

  it('parse ignora símbolo y espacios "RD$ 1,000" → 100000', () => {
    expect(Money.parse('RD$ 1,000', doDO)).toEqual(okValue(100000));
    expect(Money.parse('  DOP 1,000  ', doDO)).toEqual(okValue(100000));
    expect(Money.parse('1.234,50 €', esES)).toEqual(okValue(123450));
    expect(Money.parse('US$ 12.00', { locale: 'es-DO', currency: { code: 'USD', minorDigits: 2 } })).toEqual(
      okValue(1200),
    );
  });

  it('parse "12.5" en es-ES se lee como decimal → 1250', () => {
    expect(Money.parse('12.5', esES)).toEqual(okValue(1250));
    expect(Money.parse('12.50', esES)).toEqual(okValue(1250));
    // Con tres dígitos detrás sí es separador de grupo.
    expect(Money.parse('12.500', esES)).toEqual(okValue(1250000));
    // El caso espejo en es-DO: "12,5" es decimal.
    expect(Money.parse('12,5', doDO)).toEqual(okValue(1250));
  });

  it('parse rechaza más decimales que la moneda ("10.555" DOP) → too_many_decimals', () => {
    expect(Money.parse('10.555', doDO)).toEqual(errValue('too_many_decimals'));
    // Ceros de relleno no cambian el valor y se aceptan.
    expect(Money.parse('10.500', doDO)).toEqual(okValue(1050));
    expect(Money.parse('1.2345', { locale: 'es-DO', currency: KWD })).toEqual(errValue('too_many_decimals'));
    expect(Money.parse('1.234', { locale: 'es-DO', currency: KWD })).toEqual(okValue(1234));
  });

  it('parse moneda sin decimales (minorDigits 0) "1,500" → 1500', () => {
    const opts = { locale: 'es-DO', currency: JPY };
    expect(Money.parse('1,500', opts)).toEqual(okValue(1500));
    expect(Money.parse('1,500,000', opts)).toEqual(okValue(1500000));
    expect(Money.parse('15.5', opts)).toEqual(errValue('too_many_decimals'));
  });

  it('parse rechaza negativo salvo allowNegative', () => {
    expect(Money.parse('-50', doDO)).toEqual(errValue('negative_not_allowed'));
    expect(Money.parse('(50)', doDO)).toEqual(errValue('negative_not_allowed'));
    expect(Money.parse('-50', { ...doDO, allowNegative: true })).toEqual(okValue(-5000));
    expect(Money.parse('−8,500.00', { ...doDO, allowNegative: true })).toEqual(okValue(-850000));
    expect(Money.parse('(RD$ 1,250.50)', { ...doDO, allowNegative: true })).toEqual(okValue(-125050));
    expect(Money.parse('RD$ 1,250.50-', { ...doDO, allowNegative: true })).toEqual(okValue(-125050));
  });

  it('parse rechaza valores fuera de MAX_SAFE_INTEGER → too_large', () => {
    expect(MAX_MINOR).toBe(Number.MAX_SAFE_INTEGER);
    expect(Money.parse('90071992547409.91', doDO)).toEqual(okValue(MAX_MINOR));
    expect(Money.parse('90071992547409.92', doDO)).toEqual(errValue('too_large'));
    expect(Money.parse('1000000000000000000000', doDO)).toEqual(errValue('too_large'));
  });

  it('parse distingue vacío, basura y formas válidas parciales', () => {
    expect(Money.parse('', doDO)).toEqual(errValue('empty'));
    expect(Money.parse('   RD$ ', doDO)).toEqual(errValue('empty'));
    expect(Money.parse('12abc', doDO)).toEqual(errValue('not_a_number'));
    expect(Money.parse('1.2.3', doDO)).toEqual(errValue('not_a_number'));
    expect(Money.parse('1.234,50', doDO)).toEqual(errValue('not_a_number'));
    expect(Money.parse('12,34,567', doDO)).toEqual(errValue('not_a_number'));
    expect(Money.parse('--5', { ...doDO, allowNegative: true })).toEqual(errValue('not_a_number'));
    expect(Money.parse('.5', doDO)).toEqual(okValue(50));
    expect(Money.parse('5.', doDO)).toEqual(okValue(500));
    expect(Money.parse('+5', doDO)).toEqual(okValue(500));
    expect(Money.parse('0', doDO)).toEqual(okValue(0));
    expect(Money.parse('-0', doDO)).toEqual(okValue(0));
    expect(Money.parse('007', doDO)).toEqual(okValue(700));
  });
});

describe('Money.parseExpression', () => {
  it('parseExpression "150+75.50-25" → 20050', () => {
    expect(Money.parseExpression('150+75.50-25', doDO)).toEqual(okValue(20050));
  });

  it('acepta espacios, el signo menos tipográfico y separadores de grupo', () => {
    expect(Money.parseExpression(' 1,000 + 250.25 − 0.25 ', doDO)).toEqual(okValue(125000));
    expect(Money.parseExpression('1.000+2,5', esES)).toEqual(okValue(100250));
  });

  it('un número solo es una expresión válida y un operador final se ignora mientras se escribe', () => {
    expect(Money.parseExpression('75.50', doDO)).toEqual(okValue(7550));
    expect(Money.parseExpression('150+', doDO)).toEqual(okValue(15000));
  });

  it('rechaza operadores dobles, vacío y resultados negativos sin allowNegative', () => {
    expect(Money.parseExpression('150++5', doDO)).toEqual(errValue('not_a_number'));
    expect(Money.parseExpression('', doDO)).toEqual(errValue('empty'));
    expect(Money.parseExpression('+', doDO)).toEqual(errValue('empty'));
    expect(Money.parseExpression('10-25', doDO)).toEqual(errValue('negative_not_allowed'));
    expect(Money.parseExpression('10-25', { ...doDO, allowNegative: true })).toEqual(okValue(-1500));
    expect(Money.parseExpression('-10+25', doDO)).toEqual(okValue(1500));
    expect(Money.parseExpression('10.555+1', doDO)).toEqual(errValue('too_many_decimals'));
    expect(Money.parseExpression('90071992547409.91+0.01', doDO)).toEqual(errValue('too_large'));
  });
});

describe('Money.format', () => {
  it('format 123450 DOP es-DO usa el símbolo configurado y 2 decimales', () => {
    expect(Money.format(123450, { locale: 'es-DO', currency: DOP })).toBe('RD$1,234.50');
    expect(Money.format(100, { locale: 'es-DO', currency: { code: 'DOP', minorDigits: 2, symbol: '$' } })).toBe(
      '$1.00',
    );
  });

  it('respeta display, signo y decimales de la moneda', () => {
    expect(Money.format(-123450, { locale: 'es-DO', currency: DOP })).toBe('-RD$1,234.50');
    expect(Money.format(1250, { locale: 'es-DO', currency: DOP, sign: 'always' })).toBe('+RD$12.50');
    expect(Money.format(0, { locale: 'es-DO', currency: DOP, sign: 'always' })).toBe('RD$0.00');
    expect(Money.format(-1250, { locale: 'es-DO', currency: DOP, sign: 'never' })).toBe('RD$12.50');
    expect(Money.format(123450, { locale: 'es-DO', currency: DOP, display: 'none' })).toBe('1,234.50');
    expect(Money.format(123450, { locale: 'es-DO', currency: DOP, display: 'code' })).toMatch(/^DOP\s1,234\.50$/);
    expect(Money.format(1500, { locale: 'es-DO', currency: JPY, display: 'none' })).toBe('1,500');
    expect(Money.format(1234, { locale: 'es-DO', currency: KWD, display: 'none' })).toBe('1.234');
  });

  it('formatea importes enormes sin perder precisión (sin dividir en flotante)', () => {
    expect(Money.format(MAX_MINOR, { locale: 'es-DO', currency: DOP, display: 'none' })).toBe(
      '90,071,992,547,409.91',
    );
  });

  it('compact abrevia sin forzar decimales', () => {
    const text = Money.format(1250000, { locale: 'es-DO', currency: DOP, compact: true });
    expect(text.startsWith('RD$12.5')).toBe(true);
  });
});

describe('Money aritmética', () => {
  it('sum de tres 0.10 da exactamente 30 (sin flotantes)', () => {
    const dime = Money.parse('0.10', doDO);
    expect(dime).toEqual(okValue(10));
    const ten = dime.ok ? dime.value : NaN;
    const total = Money.sum([ten, ten, ten]);
    expect(total).toBe(30);
    expect(Money.toDecimalString(total, 2)).toBe('0.30');
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3); // por qué existe esta regla
  });

  it('allocate 1000 en 3 → [334, 333, 333] y suma el total', () => {
    const parts = Money.allocate(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(Money.sum(parts)).toBe(1000);
  });

  it('allocate con pesos desiguales, decimales, ceros y negativos', () => {
    expect(Money.allocate(100, [70, 30])).toEqual([70, 30]);
    expect(Money.allocate(101, [0.5, 0.25, 0.25])).toEqual([51, 25, 25]);
    expect(Money.allocate(5, [0, 1, 1])).toEqual([0, 3, 2]);
    expect(Money.allocate(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
    expect(() => Money.allocate(100, [])).toThrow(RangeError);
    expect(() => Money.allocate(100, [0, 0])).toThrow(RangeError);
    expect(() => Money.allocate(100, [-1, 2])).toThrow(RangeError);
    expect(() => Money.allocate(1.5, [1])).toThrow(RangeError);
  });

  it('add/sub lanzan RangeError fuera de safe integer', () => {
    expect(Money.add(1, 2)).toBe(3);
    expect(Money.sub(1, 2)).toBe(-1);
    expect(() => Money.add(MAX_MINOR, 1)).toThrow(RangeError);
    expect(() => Money.sub(-MAX_MINOR, 1)).toThrow(RangeError);
    expect(() => Money.add(0.5, 1)).toThrow(RangeError);
  });

  it('signed aplica la dirección', () => {
    expect(Money.signed(500, 'in')).toBe(500);
    expect(Money.signed(500, 'out')).toBe(-500);
    expect(Money.signed(0, 'out')).toBe(0);
  });

  it('isValidAmount solo acepta enteros 0..MAX_MINOR', () => {
    expect(Money.isValidAmount(0)).toBe(true);
    expect(Money.isValidAmount(MAX_MINOR)).toBe(true);
    expect(Money.isValidAmount(-1)).toBe(false);
    expect(Money.isValidAmount(1.5)).toBe(false);
    expect(Money.isValidAmount(MAX_MINOR + 1)).toBe(false);
    expect(Money.isValidAmount('100')).toBe(false);
    expect(Money.isValidAmount(Number.NaN)).toBe(false);
  });
});

describe('Money decimal canónico', () => {
  it('toDecimalString / fromDecimalString hacen ida y vuelta', () => {
    expect(Money.toDecimalString(123450, 2)).toBe('1234.50');
    expect(Money.toDecimalString(5, 2)).toBe('0.05');
    expect(Money.toDecimalString(-5, 2)).toBe('-0.05');
    expect(Money.toDecimalString(1500, 0)).toBe('1500');
    expect(Money.toDecimalString(1234, 3)).toBe('1.234');
    expect(Money.fromDecimalString('1234.50', 2)).toEqual(okValue(123450));
    expect(Money.fromDecimalString('1234.5', 2)).toEqual(okValue(123450));
    expect(Money.fromDecimalString('-0.05', 2)).toEqual(okValue(-5));
    expect(Money.fromDecimalString('1500', 0)).toEqual(okValue(1500));
    expect(Money.fromDecimalString('1.234', 2)).toEqual(errValue('too_many_decimals'));
    expect(Money.fromDecimalString('1,234.50', 2)).toEqual(errValue('not_a_number'));
    expect(Money.fromDecimalString('', 2)).toEqual(errValue('empty'));
    expect(Money.fromDecimalString('90071992547409.92', 2)).toEqual(errValue('too_large'));
    for (const n of [0, 1, 99, 100, 123456789, -42, MAX_MINOR]) {
      expect(Money.fromDecimalString(Money.toDecimalString(n, 2), 2)).toEqual(okValue(n));
    }
  });
});
