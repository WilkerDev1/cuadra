// Exportación de informes: CSV (papaparse) y Excel (write-excel-file) a partir de las hojas neutras del núcleo
// (`reportToSheets`). El dinero nunca se divide en flotante: el CSV usa `sheetToRows` (decimal canónico en texto) y
// el Excel convierte el texto decimal canónico a número (una cadena como "1234.50" es exacta para el doble más
// cercano; dividir 123450 / 100 no lo sería siempre).
import Papa from 'papaparse';
import { Money, csvSafeText, sheetToRows } from '../../core';
import type { Sheet, SheetCell, SheetColumn, Translate } from '../../core';
import { saveFile } from '../../app/data/download';

// ── CSV ─────────────────────────────────────────────────────────────────────────────────

/**
 * Una sola cadena CSV con todas las hojas del informe, una tras otra: el nombre de la hoja, su tabla y una línea en
 * blanco. Con un BOM para que Excel lea bien las tildes. Todo pasa por `sheetToRows` (texto seguro y dinero decimal).
 */
export function sheetsToCsv(sheets: readonly Sheet[]): string {
  const rows: SheetCell[][] = [];
  for (const sheet of sheets) {
    if (rows.length > 0) rows.push([]);
    if (sheets.length > 1) rows.push([csvSafeText(sheet.name)]);
    for (const row of sheetToRows(sheet)) rows.push(row);
  }
  return `\uFEFF${Papa.unparse(rows, { newline: '\r\n' })}`;
}

// ── Excel ───────────────────────────────────────────────────────────────────────────────

/** Celda de Excel: lo mínimo de `write-excel-file` que usamos. */
export interface ExcelCell {
  value: string | number | Date;
  type?: StringConstructor | NumberConstructor | DateConstructor;
  format?: string;
  fontWeight?: 'bold';
  align?: 'left' | 'center' | 'right';
}
export interface ExcelSheet {
  data: Array<Array<ExcelCell | null>>;
  sheet: string;
  columns: Array<{ width?: number }>;
}

const WIDTH: Record<SheetColumn['type'], number> = { text: 28, date: 12, money: 16, integer: 8, number: 12 };

/** Formato de número de Excel con los decimales de la moneda; negativos entre paréntesis como en el informe. */
export function moneyFormat(minorDigits: number): string {
  const body = minorDigits > 0 ? `#,##0.${'0'.repeat(minorDigits)}` : '#,##0';
  return `${body};(${body})`;
}

function isoToDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Una celda de la hoja neutra → celda de Excel. El texto va siempre como texto (nunca como fórmula ni número). */
export function toExcelCell(cell: SheetCell, column: SheetColumn, minorDigits: number): ExcelCell | null {
  if (cell === null) return null;
  switch (column.type) {
    case 'money':
      if (typeof cell !== 'number') return { value: String(cell), type: String };
      return { value: Number(Money.toDecimalString(cell, minorDigits)), type: Number, format: moneyFormat(minorDigits) };
    case 'integer':
      return typeof cell === 'number' ? { value: cell, type: Number, format: '0' } : { value: String(cell), type: String };
    case 'number':
      return typeof cell === 'number' ? { value: cell, type: Number } : { value: String(cell), type: String };
    case 'date': {
      const date = typeof cell === 'string' ? isoToDate(cell) : null;
      return date === null ? { value: String(cell), type: String } : { value: date, type: Date, format: 'yyyy-mm-dd', align: 'left' };
    }
    default:
      return { value: String(cell), type: String };
  }
}

/** Hojas neutras → hojas de `write-excel-file` (encabezado en negrita y anchos por tipo). */
export function sheetsToExcel(sheets: readonly Sheet[]): ExcelSheet[] {
  return sheets.map((sheet) => {
    const digits = sheet.currency?.minorDigits ?? 2;
    const header: Array<ExcelCell | null> = sheet.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' }));
    const data = sheet.rows.map((row) => row.map((cell, i) => toExcelCell(cell, sheet.columns[i] as SheetColumn, digits)));
    return {
      sheet: sheet.name,
      data: [header, ...data],
      columns: sheet.columns.map((c) => ({ width: c.width ?? WIDTH[c.type] })),
    };
  });
}

type ExcelWriter = (sheets: ExcelSheet[]) => { toBlob: () => Promise<Blob> };

/** Libro de Excel. `writer` es inyectable para las pruebas; en la app se carga `write-excel-file` al vuelo. */
export async function sheetsToXlsxBlob(sheets: readonly Sheet[], writer?: ExcelWriter): Promise<Blob> {
  const write: ExcelWriter =
    writer ?? ((await import('write-excel-file/browser')).default as unknown as ExcelWriter);
  return write(sheetsToExcel(sheets)).toBlob();
}

// ── Descarga y compartir ────────────────────────────────────────────────────────────────

export const MIME = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** Nombre de archivo sin caracteres problemáticos: «Informe-Colmado-La-Esquina-noviembre-2026». */
export function fileStem(...parts: readonly string[]): string {
  const clean = parts
    .map((p) =>
      p
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((p) => p !== '');
  return clean.join('-').slice(0, 80) || 'informe';
}

export function downloadBlob(blob: Blob, filename: string): void {
  void saveFile(blob, filename);
}

/** ¿Se pueden compartir archivos desde este navegador? (Web Share nivel 2) */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([''], 'a.csv', { type: 'text/csv' })] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

/**
 * `t` de la app para el exportador: las claves `export.*` no están en el diccionario (el núcleo trae su español
 * por defecto), así que se devuelven tal cual y `label()` cae en ese texto sin avisos de clave inexistente.
 */
export function exportTranslate(t: Translate): Translate {
  return (key, params) => (key.startsWith('export.') ? key : t(key, params));
}
