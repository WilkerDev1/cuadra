// Exportar lo filtrado (core/export → archivo). El núcleo arma la hoja neutra; aquí se escribe CSV o XLSX.
// El dinero llega en unidad menor: en CSV va como decimal canónico (sheetToRows); en XLSX como número con el
// formato de la moneda, convertido desde ese mismo texto decimal (nunca dividiendo).
import { Money, sheetToRows, type Sheet } from '../../../core';

/** CSV con BOM (Excel en Windows lo abre como UTF-8) y separador coma. */
export function sheetToCsv(sheet: Sheet, unparse: (rows: unknown[][]) => string): string {
  return '﻿' + unparse(sheetToRows(sheet));
}

export interface XlsxCell {
  value: string | number | null;
  type?: typeof String | typeof Number;
  format?: string;
  fontWeight?: 'bold';
}

/** Formato numérico de Excel para la moneda: `#,##0.00` según los decimales. */
export function moneyFormat(minorDigits: number): string {
  return minorDigits === 0 ? '#,##0' : `#,##0.${'0'.repeat(minorDigits)}`;
}

export function sheetToXlsxData(sheet: Sheet): XlsxCell[][] {
  const digits = sheet.currency?.minorDigits ?? 2;
  const header: XlsxCell[] = sheet.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' }));
  const rows = sheet.rows.map((row) =>
    row.map((cell, i): XlsxCell => {
      const col = sheet.columns[i];
      if (cell === null) return { value: null };
      if (col?.type === 'money' && typeof cell === 'number') {
        return { value: Number(Money.toDecimalString(cell, digits)), type: Number, format: moneyFormat(digits) };
      }
      if (typeof cell === 'number') return { value: cell, type: Number };
      return { value: cell, type: String };
    }),
  );
  return [header, ...rows];
}

/** `movimientos-colmado-2026-11-27.csv`: nombre de archivo sin caracteres raros. */
export function exportFileName(base: string, today: string, ext: 'csv' | 'xlsx'): string {
  const slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug === '' ? 'cuadra' : slug}-${today}.${ext}`;
}
