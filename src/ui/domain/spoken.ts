// Lectura de montos en palabras para lectores de pantalla (DESIGN.md §5.8): «mil ochocientos
// cincuenta pesos». Español; trabaja con BigInt para no perder precisión.
import type { Currency, Minor } from '../../core/types';

const UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos',
];

/** 0–999. `apocope`: «un»/«veintiún» delante de un sustantivo masculino (mil, millón, pesos). */
function below1000(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h] ?? '');
  if (rest > 0 || h === 0) {
    let w: string;
    if (rest < 30) w = UNITS[rest] ?? '';
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      w = u === 0 ? (TENS[t] ?? '') : `${TENS[t] ?? ''} y ${UNITS[u] ?? ''}`;
    }
    if (apocope) w = w.replace(/uno$/, 'ún').replace(/^ún$/, 'un').replace(/ y ún$/, ' y un');
    if (h > 0 && rest === 0) w = '';
    if (w !== '') parts.push(w);
  }
  return parts.join(' ');
}

/** 0 ≤ n < 10^6 */
function below1e6(n: number, apocope: boolean): string {
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (th === 1) parts.push('mil');
  else if (th > 1) parts.push(`${below1000(th, true)} mil`);
  if (rest > 0 || th === 0) parts.push(below1000(rest, apocope));
  return parts.join(' ');
}

/** Entero no negativo en palabras: 1850 → «mil ochocientos cincuenta». */
export function numberToSpanishWords(value: number | bigint, apocope = false): string {
  let n = BigInt(value);
  if (n < 0n) return `menos ${numberToSpanishWords(-n, apocope)}`;
  if (n < 1_000_000n) return below1e6(Number(n), apocope);
  const millions = n / 1_000_000n;
  n %= 1_000_000n;
  const head =
    millions === 1n ? 'un millón' : `${numberToSpanishWords(millions, true)} millones`;
  return n === 0n ? head : `${head} ${below1e6(Number(n), apocope)}`;
}

const NAMES: Record<string, [string, string, string, string]> = {
  // singular, plural, centavo singular, centavo plural
  DOP: ['peso', 'pesos', 'centavo', 'centavos'],
  MXN: ['peso', 'pesos', 'centavo', 'centavos'],
  COP: ['peso', 'pesos', 'centavo', 'centavos'],
  USD: ['dólar', 'dólares', 'centavo', 'centavos'],
  EUR: ['euro', 'euros', 'céntimo', 'céntimos'],
};

/** Monto en unidad menor → lectura completa: «veintiún pesos con cincuenta centavos». */
export function spokenMoney(minor: Minor, currency: Currency): string {
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const scale = 10n ** BigInt(currency.minorDigits);
  const units = abs / scale;
  const cents = abs % scale;
  const names = NAMES[currency.code];
  const unitName = names === undefined ? currency.code : units === 1n ? names[0] : names[1];
  let text = `${numberToSpanishWords(units, names !== undefined)} ${unitName}`;
  if (cents > 0n) {
    const centName = names === undefined ? '' : cents === 1n ? names[2] : names[3];
    text += ` con ${numberToSpanishWords(cents, names !== undefined)}${centName === '' ? '' : ` ${centName}`}`;
  }
  return neg ? `menos ${text}` : text;
}
