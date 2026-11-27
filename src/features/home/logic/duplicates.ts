// Posibles duplicados entre movimientos recientes: misma cuenta, mismo tipo y monto, fechas a ± 3 días y
// descripción parecida. Es la misma regla que el núcleo usa al anotar (validation.ts, prueba 85), aplicada en
// lectura para el bloque «Pide atención». Aproximado a propósito: solo avisa, nunca decide.
import { addDays, normalizeSearch, type Id, type IsoDate, type Minor, type Transaction } from '../../../core';

export const DUPLICATE_WINDOW_DAYS = 3;

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j] ?? 0;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] ?? 0;
}

export function similarDescriptions(a: string, b: string): boolean {
  const x = normalizeSearch(a);
  const y = normalizeSearch(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  const longer = Math.max(x.length, y.length);
  const tolerance = longer >= 8 ? 2 : longer >= 4 ? 1 : 0;
  return tolerance > 0 && Math.abs(x.length - y.length) <= tolerance && editDistance(x, y) <= tolerance;
}

export interface DuplicatePair {
  /** El más reciente (fecha, luego número). */
  latest: Transaction;
  earlier: Transaction;
  accountId: Id;
  amountMinor: Minor;
  from: IsoDate;
  to: IsoDate;
}

type Tx = Pick<Transaction, 'id' | 'accountId' | 'kind' | 'amountMinor' | 'date' | 'description' | 'status' | 'seq'>;

/** Pares de posibles duplicados (cada movimiento aparece en un par como mucho), más recientes primero. */
export function findPossibleDuplicates<T extends Tx>(rows: readonly T[]): Array<Omit<DuplicatePair, 'latest' | 'earlier'> & { latest: T; earlier: T }> {
  const candidates = rows
    .filter((r) => r.status === 'active' && (r.kind === 'income' || r.kind === 'expense') && r.amountMinor > 0)
    .sort((a, b) => (a.date === b.date ? b.seq - a.seq : a.date < b.date ? 1 : -1));
  const used = new Set<Id>();
  const out: Array<Omit<DuplicatePair, 'latest' | 'earlier'> & { latest: T; earlier: T }> = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i] as T;
    if (used.has(a.id)) continue;
    const floor = addDays(a.date, -DUPLICATE_WINDOW_DAYS);
    for (let j = i + 1; j < candidates.length; j += 1) {
      const b = candidates[j] as T;
      if (b.date < floor) break;
      if (used.has(b.id)) continue;
      if (b.accountId !== a.accountId || b.kind !== a.kind || b.amountMinor !== a.amountMinor) continue;
      if (!similarDescriptions(a.description, b.description)) continue;
      used.add(a.id);
      used.add(b.id);
      out.push({ latest: a, earlier: b, accountId: a.accountId, amountMinor: a.amountMinor, from: b.date, to: a.date });
      break;
    }
  }
  return out;
}
