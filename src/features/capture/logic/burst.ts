// Ráfaga (DESIGN §10.9): líneas anotadas con el teclado que se guardan juntas como un lote al «Cerrar lote».
import type { CaptureRow, FieldValues, Minor } from '../../../core';

export interface BurstLine {
  id: string;
  minor: Minor;
  description: string;
  values: FieldValues;
}

/** Añade una línea o, si `editing` apunta a una existente, la reemplaza (corregir desde la minicinta). */
export function upsertLine(lines: readonly BurstLine[], line: BurstLine, editing: number | null): BurstLine[] {
  if (editing !== null && editing >= 0 && editing < lines.length) return lines.map((l, i) => (i === editing ? line : l));
  return [...lines, line];
}

export function removeLine(lines: readonly BurstLine[], index: number): BurstLine[] {
  return lines.filter((_, i) => i !== index);
}

export function sumLines(lines: readonly BurstLine[]): Minor {
  let s = 0n;
  for (const l of lines) s += BigInt(l.minor);
  return s > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(s);
}

/** Diferencia contra el control: positiva = falta, negativa = sobra, `null` sin control. */
export function remaining(control: Minor | null, sum: Minor): Minor | null {
  return control === null ? null : control - sum;
}

/**
 * Qué hacer al guardar un lote según su total de control (I-14: nada se escribe con el control descuadrado o
 * ilegible sin que el usuario lo vea). `block`: el control está escrito pero no se entiende, se corrige antes.
 * `confirm`: no cuadra (o hay filas con error), se pide confirmación. `save`: sin control o cuadra.
 */
export function controlGate(control: { status: 'empty' | 'ok' | 'invalid' }, diff: Minor | null, errorRows = 0): 'block' | 'confirm' | 'save' {
  if (control.status === 'invalid') return 'block';
  if (errorRows > 0 || (diff !== null && diff !== 0)) return 'confirm';
  return 'save';
}

/** Las últimas `n` líneas, la más reciente arriba, con su índice real. */
export function tail(lines: readonly BurstLine[], n = 3): Array<{ line: BurstLine; index: number }> {
  return lines
    .map((line, index) => ({ line, index }))
    .slice(-n)
    .reverse();
}

export function toCaptureRows(lines: readonly BurstLine[]): CaptureRow[] {
  return lines.map((l) => ({
    amount: l.minor,
    description: l.description,
    ...(Object.keys(l.values).length === 0 ? {} : { values: l.values }),
  }));
}
