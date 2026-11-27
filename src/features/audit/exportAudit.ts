// CSV del historial: la hoja del núcleo (`auditToSheet`) más una columna de monto en decimal exacto.
import Papa from 'papaparse';
import { auditToSheet, sheetToRows } from '../../core';
import type { Account, AuditEntry, Currency, Sheet, SheetCell, Translate } from '../../core';
import { changeLines, entryAmount, textParams, type ChangeContext } from './model';

/** Hoja del historial: la del núcleo con la columna «Monto» (unidad menor; el escritor aplica los decimales). */
export function historySheet(
  entries: readonly AuditEntry[],
  ctx: { accounts: Account[]; currency: Currency; amountHeader: string; actionLabel: (e: AuditEntry) => string; change: ChangeContext; emptyValue: string },
  t: Translate,
): Sheet {
  // El núcleo interpola el mensaje con `params` de texto y número; igual que en pantalla.
  const base = auditToSheet(entries.map((e) => ({ ...e, params: textParams(e.params) })), { accounts: ctx.accounts }, t);
  const actionAt = base.columns.findIndex((c) => c.key === 'action');
  const changesAt = base.columns.findIndex((c) => c.key === 'changes');
  const rows: SheetCell[][] = base.rows.map((row, i) => {
    const entry = entries[i] as AuditEntry;
    // «Monto: RD$1,500.00 → RD$1,850.00», no el entero en unidad menor ni la instantánea JSON del núcleo.
    const lines = changeLines(entry, ctx.change).map((l) => `${l.label}: ${l.old ?? ctx.emptyValue} → ${l.new ?? ctx.emptyValue}`);
    const cells = row.map((cell, j) => (j === actionAt ? ctx.actionLabel(entry) : j === changesAt ? (lines.length === 0 ? null : lines.join('; ')) : cell));
    return [...cells, entryAmount(entry)?.minor ?? null];
  });
  return {
    ...base,
    columns: [...base.columns, { key: 'amount', header: ctx.amountHeader, type: 'money' }],
    rows,
    currency: ctx.currency,
  };
}

export function historyCsv(sheet: Sheet): string {
  return `\uFEFF${Papa.unparse(sheetToRows(sheet), { newline: '\r\n' })}`;
}

/**
 * `t` de la app para el exportador del núcleo: las claves `export.*` no están en el diccionario (el núcleo trae su
 * español por defecto), así que se devuelven tal cual y caen en ese texto sin avisos de clave inexistente.
 */
export function exportTranslate(t: Translate): Translate {
  return (key, params) => (key.startsWith('export.') ? key : t(key, params));
}
