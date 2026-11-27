import { describe, expect, it } from 'vitest';
import {
  amountParts,
  appendKey,
  evaluateExpression,
  formatExpression,
  localeSeparators,
  sanitizePastedAmount,
} from './amountLogic';
import { numberToSpanishWords, spokenMoney } from './spoken';

const DOP = { code: 'DOP', minorDigits: 2 } as const;

describe('evaluateExpression', () => {
  it('suma y resta en unidad menor', () => {
    expect(evaluateExpression('1500+350', 2)).toEqual({ ok: true, minor: 185000 });
    expect(evaluateExpression('150+75.50-25', 2)).toEqual({ ok: true, minor: 20050 });
  });
  it('respeta la precedencia de ×', () => {
    expect(evaluateExpression('100+20*3', 2)).toEqual({ ok: true, minor: 16000 });
    expect(evaluateExpression('12.50*3', 2)).toEqual({ ok: true, minor: 3750 });
  });
  it('redondea a la unidad menor al multiplicar por un factor decimal', () => {
    // 10.01 × 0.5 = 5.005 → 5.01 (mitad hacia arriba)
    expect(evaluateExpression('10.01*0.5', 2)).toEqual({ ok: true, minor: 501 });
  });
  it('ignora un operador final mientras se escribe', () => {
    expect(evaluateExpression('1500+', 2)).toEqual({ ok: true, minor: 150000 });
  });
  it('vacío vale cero', () => {
    expect(evaluateExpression('', 2)).toEqual({ ok: true, minor: 0 });
  });
  it('rechaza resultados negativos y expresiones inválidas', () => {
    expect(evaluateExpression('100-200', 2)).toEqual({ ok: false, reason: 'negative' });
    expect(evaluateExpression('1..2', 2)).toEqual({ ok: false, reason: 'invalid' });
    expect(evaluateExpression('1.234', 2)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('rechaza montos fuera del entero seguro', () => {
    expect(evaluateExpression('99999999999999999', 2)).toEqual({ ok: false, reason: 'too_large' });
  });
  it('funciona con monedas sin decimales', () => {
    expect(evaluateExpression('1500+3', 0)).toEqual({ ok: true, minor: 1503 });
  });
});

describe('appendKey', () => {
  it('compone dígitos y quita ceros a la izquierda', () => {
    expect(appendKey('', '0', 2)).toBe('0');
    expect(appendKey('0', '5', 2)).toBe('5');
    expect(appendKey('5', '00', 2)).toBe('500');
  });
  it('limita los decimales a los de la moneda', () => {
    expect(appendKey('12.5', '0', 2)).toBe('12.50');
    expect(appendKey('12.50', '7', 2)).toBe('12.50');
    expect(appendKey('12', '.', 0)).toBe('12');
  });
  it('un solo punto por número y 0. al empezar', () => {
    expect(appendKey('', '.', 2)).toBe('0.');
    expect(appendKey('1.5', '.', 2)).toBe('1.5');
    expect(appendKey('1.5+', '.', 2)).toBe('1.5+0.');
  });
  it('un operador reemplaza al anterior y no abre la expresión', () => {
    expect(appendKey('', '+', 2)).toBe('');
    expect(appendKey('15+', '-', 2)).toBe('15-');
    expect(appendKey('15', '*', 2)).toBe('15*');
  });
  it('borra el último carácter', () => {
    expect(appendKey('150', 'backspace', 2)).toBe('15');
    expect(appendKey('', 'backspace', 2)).toBe('');
  });
});

describe('formatExpression', () => {
  it('agrupa miles y usa glifos de operación con espacios', () => {
    expect(formatExpression('1500+350', 'es-DO')).toBe('1,500 + 350');
    expect(formatExpression('1500.5*3-2', 'es-DO')).toBe('1,500.5 × 3 − 2');
  });
  it('usa el separador decimal del locale', () => {
    expect(formatExpression('1500.5', 'es-ES')).toBe('1500,5');
  });
});

describe('sanitizePastedAmount', () => {
  it('quita símbolo, espacios y separadores de grupo', () => {
    expect(sanitizePastedAmount('RD$ 1,250.50', 'es-DO', 2)).toBe('1250.50');
    expect(sanitizePastedAmount('1.250,5', 'es-ES', 2)).toBe('1250.5');
  });
  it('normaliza operadores', () => {
    expect(sanitizePastedAmount('1500 + 350 − 20 × 2', 'es-DO', 2)).toBe('1500+350-20*2');
  });
  it('recorta decimales sobrantes', () => {
    expect(sanitizePastedAmount('10.999', 'es-DO', 2)).toBe('10.99');
  });
});

describe('localeSeparators', () => {
  it('lee los separadores del locale', () => {
    expect(localeSeparators('es-DO')).toEqual({ decimal: '.', group: ',' });
    expect(localeSeparators('es-ES').decimal).toBe(',');
  });
});

describe('amountParts', () => {
  it('separa símbolo, entero y decimales', () => {
    const p = amountParts(185000, { locale: 'es-DO', currency: DOP });
    expect(p).toMatchObject({ sign: '', symbol: 'RD$', integer: '1,850', decimal: '.', fraction: '00' });
    expect(p.text).toBe('RD$1,850.00');
    expect(p.chars).toBe(8);
  });
  it('salida con menos U+2212 y entrada con +', () => {
    expect(amountParts(185000, { locale: 'es-DO', currency: DOP, kind: 'expense' }).text).toBe('−RD$1,850.00');
    expect(amountParts(185000, { locale: 'es-DO', currency: DOP, kind: 'income' }).text).toBe('+RD$1,850.00');
  });
  it('transferencia y saldo inicial sin signo', () => {
    expect(amountParts(185000, { locale: 'es-DO', currency: DOP, kind: 'transfer' }).sign).toBe('');
    expect(amountParts(185000, { locale: 'es-DO', currency: DOP, kind: 'opening' }).sign).toBe('');
  });
  it('saldo negativo con signo o entre paréntesis', () => {
    expect(amountParts(-120000, { locale: 'es-DO', currency: DOP }).text).toBe('−RD$1,200.00');
    const parens = amountParts(-120000, { locale: 'es-DO', currency: DOP, notation: 'parens', symbol: false });
    expect(parens.text).toBe('(1,200.00)');
    expect(parens.negative).toBe(true);
  });
  it('notación plain nunca lleva signo (columnas Entra/Sale)', () => {
    expect(amountParts(5000, { locale: 'es-DO', currency: DOP, kind: 'expense', notation: 'plain' }).text).toBe('RD$50.00');
  });
  it('no usa flotantes: montos grandes exactos', () => {
    expect(amountParts(123456789, { locale: 'es-DO', currency: DOP }).text).toBe('RD$1,234,567.89');
  });
});

describe('numberToSpanishWords', () => {
  it.each([
    [0, 'cero'],
    [1, 'uno'],
    [15, 'quince'],
    [21, 'veintiuno'],
    [30, 'treinta'],
    [42, 'cuarenta y dos'],
    [100, 'cien'],
    [101, 'ciento uno'],
    [500, 'quinientos'],
    [777, 'setecientos setenta y siete'],
    [1000, 'mil'],
    [1850, 'mil ochocientos cincuenta'],
    [21000, 'veintiún mil'],
    [100000, 'cien mil'],
    [1000000, 'un millón'],
    [2500000, 'dos millones quinientos mil'],
    [1000000000, 'mil millones'],
  ])('%i → %s', (n, words) => {
    expect(numberToSpanishWords(n)).toBe(words);
  });
});

describe('spokenMoney', () => {
  it('lee pesos y centavos', () => {
    expect(spokenMoney(185000, DOP)).toBe('mil ochocientos cincuenta pesos');
    expect(spokenMoney(100, DOP)).toBe('un peso');
    expect(spokenMoney(2150, DOP)).toBe('veintiún pesos con cincuenta centavos');
    expect(spokenMoney(1, DOP)).toBe('cero pesos con un centavo');
  });
  it('lee negativos', () => {
    expect(spokenMoney(-120000, DOP)).toBe('menos mil doscientos pesos');
  });
  it('otras monedas', () => {
    expect(spokenMoney(500, { code: 'USD', minorDigits: 2 })).toBe('cinco dólares');
    expect(spokenMoney(7, { code: 'JPY', minorDigits: 0 })).toBe('siete JPY');
  });
});
