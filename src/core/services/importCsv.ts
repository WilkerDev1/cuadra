// Importación CSV (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2D).
import { notImplemented, type ErrorCode } from '../errors';
import type { MoneyParseError } from '../money';
import type { Field, Id, Minor, Mutation, Warning } from '../types';
import type { CoreDeps } from '../uow';
import type { TxDraft } from './transactions';

export interface RawTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
  encoding: 'utf-8' | 'latin1';
}
export type DateFormat = 'auto' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy' | 'd/M/yy';
export interface ColumnMapping {
  date: { column: number; format: DateFormat };
  amount:
    | { mode: 'signed'; column: number } // negativo = salida
    | { mode: 'split'; inColumn: number; outColumn: number } // columnas Debe/Haber, Entrada/Salida
    | { mode: 'with_type'; column: number; typeColumn: number; inValues: string[] };
  amountLocale: string; // cómo vienen los números en el archivo
  description: { column: number } | { fixed: string };
  notes?: { column: number };
  fields: Record<Id, { column: number }>; // listas: el texto se casa con opciones
  createMissingOptions: boolean;
}
export type ImportRowStatus = 'ok' | 'warning' | 'error' | 'duplicate' | 'opening_suspect' | 'empty';
export interface ImportPreviewRow {
  index: number;
  status: ImportRowStatus;
  skipByDefault: boolean;
  draft: TxDraft | null;
  issues: Array<ErrorCode | MoneyParseError | Warning['code'] | 'unparseable_date'>;
  raw: string[];
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  totals: { inMinor: Minor; outMinor: Minor; count: number }; // solo filas que se importarían
  newOptions: Array<{ fieldId: Id; label: string; rowCount: number }>;
  accountHasOpening: boolean;
}

export interface ImportCsvService {
  parse(text: string, opts?: { delimiter?: string }): RawTable; // papaparse, detecta delimitador
  suggestMapping(raw: RawTable, fields: Field[]): Partial<ColumnMapping>; // "Fecha", "Monto", "Débito", "Concepto"...
  preview(
    workspaceId: Id,
    accountId: Id,
    raw: RawTable,
    mapping: ColumnMapping,
    opts?: { fileTotalMinor?: Minor },
  ): Promise<ImportPreview & { fileTotalDifferenceMinor: Minor | null }>;
  /** Nada se guarda antes de esto. Crea opciones nuevas + un lote 'import'. Nunca toca movimientos existentes. */
  commit(
    workspaceId: Id,
    accountId: Id,
    preview: ImportPreview,
    opts: { include: number[] /* índices de filas */; fileName: string; mapping: ColumnMapping },
  ): Promise<Mutation<{ batchId: Id; imported: number; skipped: number; createdOptions: number }>>;
  /** CSV modelo con las columnas de los campos del espacio (Frappe Books). */
  templateCsv(workspaceId: Id): Promise<string>;
}

export function createImportCsvService(_deps: CoreDeps): ImportCsvService {
  return {
    parse: () => notImplemented('importCsv.parse'),
    suggestMapping: () => notImplemented('importCsv.suggestMapping'),
    preview: async () => notImplemented('importCsv.preview'),
    commit: async () => notImplemented('importCsv.commit'),
    templateCsv: async () => notImplemented('importCsv.templateCsv'),
  };
}
