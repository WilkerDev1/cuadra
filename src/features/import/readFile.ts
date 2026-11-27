// Lee un archivo elegido (CSV/TXT o XLSX) y lo entrega como `RawTable` del núcleo. El CSV pasa por
// `importCsv.decode/parse` (UTF-8 o Windows-1252, separador detectado); el Excel se lee en el navegador con
// read-excel-file y sus filas pasan por `importCsv.fromRows`.
import type { Cuadra, RawTable } from '../../core';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export type ReadFailure = 'unsupported' | 'xls' | 'empty' | 'tooBig' | 'failed';

export interface LoadedFile {
  fileName: string;
  kind: 'csv' | 'xlsx';
  raw: RawTable;
  /** Solo Excel: nombres de las hojas con datos y la elegida. */
  sheets: string[];
  sheet: string | null;
  /** Solo CSV. */
  delimiter: string | null;
  encoding: 'utf-8' | 'latin1' | null;
}

export type ReadResult = { ok: true; file: LoadedFile } | { ok: false; reason: ReadFailure };

export function fileKind(name: string): 'csv' | 'xlsx' | 'xls' | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') return 'xls';
  return null;
}

type SheetData = readonly (readonly (string | number | boolean | Date | null)[])[];
interface WorkbookSheet {
  sheet: string;
  data: SheetData;
}

async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  try {
    const mod = await import('read-excel-file/browser');
    return (await mod.default(file)) as WorkbookSheet[];
  } catch (first) {
    // Sin Web Workers (WebView antiguo o política de seguridad): la versión universal lee en el hilo principal.
    try {
      const mod = await import('read-excel-file/universal');
      return (await mod.default(file)) as WorkbookSheet[];
    } catch {
      throw first;
    }
  }
}

export async function readImportFile(cuadra: Cuadra, file: File, opts: { sheet?: string } = {}): Promise<ReadResult> {
  const kind = fileKind(file.name);
  if (kind === null) return { ok: false, reason: 'unsupported' };
  if (kind === 'xls') return { ok: false, reason: 'xls' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, reason: 'tooBig' };
  try {
    if (kind === 'csv') {
      const decoded = cuadra.importCsv.decode(new Uint8Array(await file.arrayBuffer()));
      const raw = cuadra.importCsv.parse(decoded.text);
      if (raw.rows.length === 0) return { ok: false, reason: 'empty' };
      return { ok: true, file: { fileName: file.name, kind, raw, sheets: [], sheet: null, delimiter: raw.delimiter ?? null, encoding: decoded.encoding } };
    }
    const sheets = (await readWorkbook(file)).filter((s) => s.data.some((row) => row.some((c) => c !== null && c !== undefined && c !== '')));
    const chosen = sheets.find((s) => s.sheet === opts.sheet) ?? sheets[0];
    if (chosen === undefined) return { ok: false, reason: 'empty' };
    const raw = cuadra.importCsv.fromRows(chosen.data);
    if (raw.rows.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, file: { fileName: file.name, kind, raw, sheets: sheets.map((s) => s.sheet), sheet: chosen.sheet, delimiter: null, encoding: null } };
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[import] no se pudo leer el archivo', error);
    return { ok: false, reason: 'failed' };
  }
}

/** Cambia de hoja en un Excel ya leído (vuelve a leer el archivo: es barato y evita guardar todo el libro). */
export async function readSheetOf(cuadra: Cuadra, file: File, sheet: string): Promise<ReadResult> {
  return readImportFile(cuadra, file, { sheet });
}
