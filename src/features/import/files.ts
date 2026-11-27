// Descarga de archivos generados en el navegador (plantilla CSV y XLSX).
import { saveFile } from '../../app/data/download';
export function downloadBlob(blob: Blob, name: string): void {
  void saveFile(blob, name);
}

/** CSV con BOM para que Excel lo abra en UTF-8 y respete tildes. */
export function csvBlob(text: string): Blob {
  return new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
}

export async function xlsxBlob(table: { headers: string[]; rows: string[][] }, sheetName: string): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = table.headers.map((value) => ({ value, fontWeight: 'bold' as const }));
  const rows = table.rows.map((r) => r.map((value) => (value === '' ? null : value)));
  return writeXlsxFile([header, ...rows], { sheet: sheetName }).toBlob();
}
