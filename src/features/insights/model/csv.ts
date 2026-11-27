// Exportar la tabla del Resumen a CSV. Pasa SIEMPRE por sheetToRows (dinero como decimal canónico y celdas de
// texto protegidas contra inyección de fórmulas).
import Papa from 'papaparse';
import { sheetToRows, summaryToSheet } from '../../../core';
import type { Currency, Sheet, SummaryResult, Translate } from '../../../core';
import type { Point } from './series';

export interface SummarySheetInput {
  result: SummaryResult;
  currency: Currency;
  groupHeader: string;
  splitHeader?: string;
  /** Con comparación: una columna con el valor anterior de la medida (solo grupos de primer nivel). */
  compare?: { header: string; points: readonly Point[]; money: boolean };
  name: string;
}

export function summarySheet(input: SummarySheetInput, t?: Translate): Sheet {
  const sheet = summaryToSheet(
    input.result,
    {
      currency: input.currency,
      groupHeader: input.groupHeader,
      name: input.name,
      ...(input.splitHeader === undefined ? {} : { splitHeader: input.splitHeader }),
    },
    t,
  );
  const cmp = input.compare;
  if (cmp === undefined) return sheet;
  const hasSplit = sheet.columns.some((c) => c.key === 'split');
  // Filas en el orden de summaryToSheet: grupo, sus subgrupos, …, total.
  const rows: Sheet['rows'] = [];
  let pi = 0;
  let prevTotal = 0;
  for (const row of sheet.rows) {
    const isTotal = rows.length === sheet.rows.length - 1;
    const isSub = hasSplit && row[1] !== null && !isTotal;
    if (isTotal) rows.push([...row, prevTotal]);
    else if (isSub) rows.push([...row, null]);
    else {
      const prev = cmp.points[pi]?.prev ?? null;
      pi += 1;
      if (prev !== null) prevTotal += prev;
      rows.push([...row, prev]);
    }
  }
  return {
    ...sheet,
    columns: [...sheet.columns, { key: 'previous', header: cmp.header, type: cmp.money ? 'money' : 'integer' }],
    rows,
  };
}

export function sheetToCsv(sheet: Sheet): string {
  return Papa.unparse(sheetToRows(sheet), { newline: '\r\n' });
}

/** «resumen-gastos-por-categoria-2026-11-27.csv». */
export function csvFileName(name: string, today: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug === '' ? 'resumen' : slug.startsWith('resumen') ? slug : `resumen-${slug}`}-${today}.csv`;
}
