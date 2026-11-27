// Ayudas comunes a los perfiles de datos de ejemplo: acumulan elementos, siguen el saldo de cada cuenta
// (para no dejar en negativo lo que no debe) y eligen movimientos para la "historia" (ediciones, anulados).
import { addDays, compareIsoDate } from '../dates';
import { Money } from '../money';
import type { IsoDate, Minor } from '../types';
import type { DemoItem, DemoOpening, DemoRow, DemoStep, DemoValues } from './plan';
import type { Rng } from './prng';

type TxItem = Extract<DemoItem, { t: 'tx' }>;

export class PlanBuilder {
  readonly items: DemoItem[] = [];
  readonly steps: DemoStep[] = [];
  private readonly balance = new Map<string, Minor>();
  private n = 0;

  constructor(
    readonly start: IsoDate,
    readonly anchor: IsoDate,
  ) {}

  opening(account: string, o: DemoOpening): void {
    this.move(account, Money.signed(o.amountMinor, o.direction));
  }

  balanceOf(account: string): Minor {
    return this.balance.get(account) ?? 0;
  }

  private move(account: string, delta: Minor): void {
    this.balance.set(account, Money.add(this.balanceOf(account), delta));
  }

  ref(prefix: string): string {
    this.n += 1;
    return `${prefix}${this.n}`;
  }

  /** ¿La fecha cae dentro del plan (no en el futuro)? */
  within(date: IsoDate): boolean {
    return compareIsoDate(date, this.start) >= 0 && compareIsoDate(date, this.anchor) <= 0;
  }

  tx(item: Omit<TxItem, 't' | 'ref'> & { ref?: string }): string | null {
    if (!this.within(item.date)) return null;
    const ref = item.ref ?? this.ref('m');
    this.items.push({ t: 'tx', ...item, ref });
    this.move(item.account, item.kind === 'income' ? item.amountMinor : -item.amountMinor);
    return ref;
  }

  transfer(item: { from: string; to: string; amountMinor: Minor; date: IsoDate; description: string; values?: DemoValues }): string | null {
    if (!this.within(item.date) || item.amountMinor <= 0) return null;
    const ref = this.ref('t');
    this.items.push({ t: 'transfer', ref, ...item });
    this.move(item.from, -item.amountMinor);
    this.move(item.to, item.amountMinor);
    return ref;
  }

  capture(item: {
    account: string;
    kind: 'income' | 'expense';
    date: IsoDate;
    label: string;
    rows: DemoRow[];
    mismatchMinor?: Minor;
    mismatchNote?: string;
    /** false: el lote se anulará en la historia y no cuenta para el saldo que sigue el plan. */
    countsForBalance?: boolean;
  }): string | null {
    if (!this.within(item.date) || item.rows.length === 0) return null;
    const ref = this.ref('c');
    const sum = Money.sum(item.rows.map((r) => r.amountMinor));
    this.items.push({
      t: 'capture',
      ref,
      account: item.account,
      kind: item.kind,
      date: item.date,
      label: item.label,
      controlTotalMinor: Money.add(sum, item.mismatchMinor ?? 0),
      ...(item.mismatchNote === undefined ? {} : { mismatchNote: item.mismatchNote }),
      rows: item.rows,
    });
    if (item.countsForBalance !== false) this.move(item.account, item.kind === 'income' ? sum : -sum);
    return ref;
  }

  /** Saca del plan los movimientos simples de una cuenta en [from, to] y los mete en un lote importado. */
  importMonth(input: {
    account: string;
    from: IsoDate;
    to: IsoDate;
    importedOn: IsoDate;
    label: string;
    fileName: string;
    preamble: string[];
  }): string | null {
    const rows: Array<DemoRow & { kind: 'income' | 'expense'; date: IsoDate }> = [];
    const keep: DemoItem[] = [];
    for (const it of this.items) {
      if (it.t === 'tx' && it.account === input.account && compareIsoDate(it.date, input.from) >= 0 && compareIsoDate(it.date, input.to) <= 0) {
        rows.push({
          kind: it.kind,
          date: it.date,
          amountMinor: it.amountMinor,
          description: it.description,
          ...(it.notes === undefined ? {} : { notes: it.notes }),
          values: it.values,
        });
      } else keep.push(it);
    }
    if (rows.length === 0 || !this.within(input.importedOn)) return null;
    this.items.length = 0;
    this.items.push(...keep);
    const ref = this.ref('i');
    this.items.push({
      t: 'import',
      ref,
      account: input.account,
      date: input.importedOn,
      label: input.label,
      fileName: input.fileName,
      preamble: input.preamble,
      rows,
    });
    return ref;
  }

  /** Copia de un movimiento `days` días después: mismo monto, cuenta y descripción (aviso de posible duplicado). */
  duplicate(orig: TxItem, days: number): string | null {
    return this.tx({
      account: orig.account,
      kind: orig.kind,
      amountMinor: orig.amountMinor,
      date: addDays(orig.date, days),
      description: orig.description,
      ...(orig.notes === undefined ? {} : { notes: orig.notes }),
      values: { ...orig.values },
    });
  }

  step(s: DemoStep): void {
    if (compareIsoDate(s.at, this.anchor) > 0) return;
    this.steps.push(s);
  }

  /** Elige `count` movimientos simples distintos que cumplan `filter`, entre `from` y `to`, sin repetir `taken`. */
  pickTx(rng: Rng, count: number, filter: (it: TxItem) => boolean, taken: Set<string>, window?: { from?: IsoDate; to?: IsoDate }): TxItem[] {
    const from = window?.from ?? addDays(this.start, 10);
    const to = window?.to ?? addDays(this.anchor, -7);
    const pool = this.items.filter(
      (it): it is TxItem =>
        it.t === 'tx' &&
        it.ref !== undefined &&
        !taken.has(it.ref) &&
        compareIsoDate(it.date, from) >= 0 &&
        compareIsoDate(it.date, to) <= 0 &&
        filter(it),
    );
    const out: TxItem[] = [];
    while (out.length < count && pool.length > 0) {
      const i = rng.int(0, pool.length - 1);
      const [it] = pool.splice(i, 1);
      if (it === undefined) break;
      out.push(it);
      taken.add(it.ref as string);
    }
    return out;
  }

  /** Marca conciliado (sí/no) en lo de estas cuentas: sí si tiene más de `days` días, con probabilidad `p`. */
  reconcile(rng: Rng, accounts: readonly string[], field: string, days: number, p: number): void {
    const cutoff = addDays(this.anchor, -days);
    const flag = (date: IsoDate): boolean => compareIsoDate(date, cutoff) <= 0 && rng.chance(p);
    for (const it of this.items) {
      if (it.t === 'tx' && accounts.includes(it.account)) it.values[field] = flag(it.date);
      else if (it.t === 'transfer' && (accounts.includes(it.from) || accounts.includes(it.to))) {
        it.values = { ...(it.values ?? {}), [field]: flag(it.date) };
      } else if (it.t === 'import' && accounts.includes(it.account)) {
        for (const r of it.rows) r.values[field] = flag(r.date);
      }
    }
  }
}

/** Reparte `total` en partes con pesos aleatorios, cada una redondeada a `unit` (la última absorbe el resto). */
export function splitAmount(rng: Rng, total: Minor, parts: number, unit: Minor): Minor[] {
  if (parts <= 1) return [total];
  const weights = Array.from({ length: parts }, () => rng.int(20, 100));
  const raw = Money.allocate(total, weights);
  const out: Minor[] = [];
  let used = 0;
  for (let i = 0; i < parts - 1; i += 1) {
    const r = raw[i] ?? 0;
    const rem = ((r % unit) + unit) % unit;
    const v = Math.max(unit, r - rem);
    out.push(v);
    used = Money.add(used, v);
  }
  const last = Money.sub(total, used);
  if (last <= 0) return [total];
  out.push(last);
  return out;
}

/** RD$ → unidad menor (2 decimales). Solo para constantes enteras del generador. */
export const rd = (pesos: number): Minor => {
  if (!Number.isSafeInteger(pesos)) throw new RangeError(`rd necesita pesos enteros: ${pesos}`);
  return pesos * 100;
};
