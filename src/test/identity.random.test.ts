// Identidad de saldos con datos aleatorios DETERMINISTAS (revisión adversarial, Oleada 2).
//
// Se aplican cientos de operaciones mezcladas (altas, transferencias, saldos iniciales, ediciones que
// cambian monto, fecha, tipo y valores, anulaciones y restauraciones, capturas en lote, anulación y
// restauración de lotes, archivar y desarchivar) a través de la fachada pública, y a la vez se lleva un
// MODELO independiente en memoria con BigInt. Después se comprueba:
//   I-1/I-2 saldos por cuenta y del espacio = modelo (también con asOf);
//   I-3/I-4 totales: entradas/salidas solo income/expense, transferencias entrantes = salientes;
//   I-5 identidad del estado de cuenta en varios periodos, por cuenta y total, y que el cierre = modelo;
//   I-13 la suma de los grupos de cualquier resumen (cuenta, tipo, mes, cada campo) = totales;
//   I-7/I-9 seq 1..n sin huecos y transferencias de dos lados coherentes.
import { afterEach, describe, expect, it } from 'vitest';
import type { Cuadra } from '../core';
import { addDays } from '../core/dates';
import type { DateRange, GroupBy, Id, IsoDate, StatementLine, TxFilter } from '../core/types';
import { createTestCuadra, type TestCuadra } from './harness';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

/** mulberry32: PRNG de 32 bits, determinista. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
    chance: (p: number) => next() < p,
  };
}

interface ModelTx {
  id: Id;
  accountId: Id;
  kind: 'income' | 'expense' | 'transfer' | 'opening';
  direction: 'in' | 'out';
  amount: number;
  date: IsoDate;
  status: 'active' | 'voided';
  partner: Id | null;
  batchId: Id | null;
  voidedWithBatch: boolean;
}

const signed = (t: ModelTx) => (t.direction === 'in' ? BigInt(t.amount) : -BigInt(t.amount));
const START: IsoDate = '2025-01-01';

async function run(seed: number, steps: number) {
  h = await createTestCuadra({ seed });
  const c: Cuadra = h.cuadra;
  const rng = prng(seed);
  const ws = (await c.workspaces.create({ name: `Aleatorio ${seed}`, currency: { code: 'DOP', minorDigits: 2 } })).value.id;
  const accounts: Id[] = [];
  for (const [name, type] of [['Caja', 'cash'], ['Banco', 'bank'], ['Tarjeta', 'card'], ['Ahorro', 'savings']] as const) {
    accounts.push((await c.accounts.create({ workspaceId: ws, name, type })).value.id);
  }
  const cat = (await c.fields.create({ workspaceId: ws, label: 'Categoría', type: 'list', role: 'category', options: ['Ventas', 'Compras', 'Luz', 'Alquiler', 'Nómina'].map((label) => ({ label })) })).value;
  const fondo = (await c.fields.create({ workspaceId: ws, label: 'Fondo', type: 'list', role: 'fund', options: [{ label: 'General' }, { label: 'Obra' }] })).value;
  const conc = (await c.fields.create({ workspaceId: ws, label: 'Conciliado', type: 'bool', role: 'reconciled' })).value;
  const ref = (await c.fields.create({ workspaceId: ws, label: 'Referencia', type: 'text' })).value;
  const units = (await c.fields.create({ workspaceId: ws, label: 'Unidades', type: 'number' })).value;
  const when = (await c.fields.create({ workspaceId: ws, label: 'Vence', type: 'date' })).value;

  const model = new Map<Id, ModelTx>();
  const archived = new Set<Id>();
  const batches: Id[] = [];
  const opened = new Set<Id>();
  const date = (): IsoDate => addDays(START, rng.int(0, 540));
  const amount = () => (rng.chance(0.05) ? 0 : rng.chance(0.1) ? rng.int(1_000_000, 50_000_000) : rng.int(1, 300_000));
  const live = () => accounts.filter((a) => !archived.has(a));
  const values = () => {
    const v: Record<Id, unknown> = {};
    if (rng.chance(0.8)) v[cat.id] = { type: 'list', optionId: rng.pick(cat.options).id };
    if (rng.chance(0.5)) v[fondo.id] = { type: 'list', optionId: rng.pick(fondo.options).id };
    if (rng.chance(0.5)) v[conc.id] = { type: 'bool', value: rng.chance(0.5) };
    if (rng.chance(0.3)) v[ref.id] = { type: 'text', value: `F-${rng.int(1, 999)}` };
    if (rng.chance(0.3)) v[units.id] = { type: 'number', value: rng.int(1, 40) / 4 };
    if (rng.chance(0.2)) v[when.id] = { type: 'date', value: date() };
    return v as never;
  };
  const pickTx = (pred: (t: ModelTx) => boolean) => {
    const xs = [...model.values()].filter(pred);
    return xs.length === 0 ? null : rng.pick(xs);
  };
  const setStatus = (t: ModelTx, status: ModelTx['status'], byBatch = false) => {
    for (const x of [t, t.partner ? model.get(t.partner)! : null]) {
      if (!x) continue;
      x.status = status;
      x.voidedWithBatch = byBatch && status === 'voided';
    }
  };

  for (let i = 0; i < steps; i++) {
    const r = rng.next();
    const accs = live();
    if (r < 0.32 && accs.length > 0) {
      const kind = rng.chance(0.55) ? 'expense' : 'income';
      const t = (await c.transactions.create({ accountId: rng.pick(accs), kind, amountMinor: amount(), date: date(), description: `${kind} ${i}`, values: values() })).value;
      model.set(t.id, { id: t.id, accountId: t.accountId, kind, direction: kind === 'income' ? 'in' : 'out', amount: t.amountMinor, date: t.date, status: 'active', partner: null, batchId: null, voidedWithBatch: false });
    } else if (r < 0.45 && accs.length >= 2) {
      const from = rng.pick(accs);
      const to = rng.pick(accs.filter((a) => a !== from));
      const t = (await c.transactions.createTransfer({ fromAccountId: from, toAccountId: to, amountMinor: amount(), date: date(), description: `transf ${i}`, values: rng.chance(0.3) ? values() : {} })).value;
      model.set(t.out.id, { id: t.out.id, accountId: from, kind: 'transfer', direction: 'out', amount: t.out.amountMinor, date: t.out.date, status: 'active', partner: t.in.id, batchId: null, voidedWithBatch: false });
      model.set(t.in.id, { id: t.in.id, accountId: to, kind: 'transfer', direction: 'in', amount: t.in.amountMinor, date: t.in.date, status: 'active', partner: t.out.id, batchId: null, voidedWithBatch: false });
    } else if (r < 0.5 && accs.length > 0) {
      const acc = rng.pick(accs);
      const input = { amountMinor: amount(), direction: rng.chance(0.8) ? ('in' as const) : ('out' as const), date: addDays(START, rng.int(-30, 200)) };
      const t = (await c.transactions.setOpening(acc, input)).value;
      opened.add(acc);
      model.set(t.id, { id: t.id, accountId: acc, kind: 'opening', direction: input.direction, amount: input.amountMinor, date: input.date, status: 'active', partner: null, batchId: model.get(t.id)?.batchId ?? null, voidedWithBatch: false });
    } else if (r < 0.62) {
      const t = pickTx((x) => x.status === 'active' && x.kind !== 'opening');
      if (!t) continue;
      const patch: Record<string, unknown> = {};
      if (rng.chance(0.6)) patch['amountMinor'] = amount();
      if (rng.chance(0.4)) patch['date'] = date();
      if (t.kind !== 'transfer' && rng.chance(0.3)) patch['kind'] = t.kind === 'income' ? 'expense' : 'income';
      if (rng.chance(0.4)) patch['values'] = values();
      if (rng.chance(0.3) && model.get(t.id)!.kind !== 'transfer') patch['values'] = { [cat.id]: null };
      if (Object.keys(patch).length === 0) patch['description'] = `editado ${i}`;
      await c.transactions.update(t.id, patch as never);
      for (const x of [t, t.partner ? model.get(t.partner)! : null]) {
        if (!x) continue;
        if (patch['amountMinor'] !== undefined) x.amount = patch['amountMinor'] as number;
        if (patch['date'] !== undefined) x.date = patch['date'] as IsoDate;
        if (patch['kind'] !== undefined) {
          x.kind = patch['kind'] as 'income' | 'expense';
          x.direction = x.kind === 'income' ? 'in' : 'out';
        }
      }
    } else if (r < 0.72) {
      const t = pickTx((x) => x.status === 'active');
      if (!t) continue;
      await c.transactions.void(rng.chance(0.5) || !t.partner ? t.id : t.partner, rng.chance(0.5) ? `motivo ${i}` : undefined);
      setStatus(t, 'voided');
    } else if (r < 0.78) {
      const t = pickTx((x) => x.status === 'voided');
      if (!t) continue;
      await c.transactions.restore(t.id);
      setStatus(t, 'active');
    } else if (r < 0.88 && accs.length > 0) {
      const acc = rng.pick(accs);
      const kind = rng.chance(0.5) ? 'income' : 'expense';
      const day = date();
      const rows = Array.from({ length: rng.int(1, 6) }, (_, k) => ({ amount: amount(), description: `lote ${i}.${k}`, values: values(), ...(rng.chance(0.3) ? { date: date() } : {}) }));
      const res = await c.batches.capture({ workspaceId: ws, accountId: acc, kind, date: day, rows, controlTotalMinor: rng.chance(0.5) ? rows.reduce((s, x) => s + x.amount, 0) : null });
      if (res.status !== 'saved') throw new Error(`captura no guardada: ${res.status}`);
      expect(res.rowErrors).toEqual([]);
      batches.push(res.batchId);
      const created = await h.driver.all<{ id: string; amount_minor: number; date: string }>('SELECT id, amount_minor, date FROM transactions WHERE batch_id = ? ORDER BY seq', [res.batchId]);
      expect(created).toHaveLength(rows.length);
      for (const row of created) {
        model.set(row.id, { id: row.id, accountId: acc, kind, direction: kind === 'income' ? 'in' : 'out', amount: Number(row.amount_minor), date: row.date, status: 'active', partner: null, batchId: res.batchId, voidedWithBatch: false });
      }
    } else if (r < 0.93 && batches.length > 0) {
      const b = rng.pick(batches);
      const members = [...model.values()].filter((t) => t.batchId === b);
      if (rng.chance(0.5)) {
        const actives = members.filter((t) => t.status === 'active');
        if (actives.length === 0) continue;
        const res = await c.batches.void(b, 'lote equivocado');
        expect(res.value.voidedCount).toBe(actives.length);
        for (const t of actives) setStatus(t, 'voided', true);
      } else {
        const revivable = members.filter((t) => t.status === 'voided' && t.voidedWithBatch);
        if (revivable.length === 0) continue;
        const res = await c.batches.restore(b);
        expect(res.value.restoredCount).toBe(revivable.length);
        for (const t of revivable) setStatus(t, 'active');
      }
    } else {
      const acc = rng.pick(accounts);
      if (archived.has(acc)) {
        await c.accounts.unarchive(acc);
        archived.delete(acc);
      } else if (live().length > 2) {
        await c.accounts.archive(acc);
        archived.add(acc);
      }
    }
  }
  return { c, ws, accounts, model, fields: { cat, fondo, conc, ref, units, when } };
}

function modelBalance(model: Map<Id, ModelTx>, accountId: Id | null, asOf?: IsoDate): bigint {
  let b = 0n;
  for (const t of model.values()) {
    if (t.status !== 'active' || (accountId !== null && t.accountId !== accountId) || (asOf !== undefined && t.date > asOf)) continue;
    b += signed(t);
  }
  return b;
}

function modelStatement(model: Map<Id, ModelTx>, accountId: Id | null, from: IsoDate | null, to: IsoDate | null): StatementLine {
  const s = { periodOpening: 0n, openings: 0n, in: 0n, out: 0n, tin: 0n, tout: 0n };
  for (const t of model.values()) {
    if (t.status !== 'active' || (accountId !== null && t.accountId !== accountId)) continue;
    if (to !== null && t.date > to) continue;
    if (from !== null && t.date < from) {
      s.periodOpening += signed(t);
      continue;
    }
    if (t.kind === 'opening') s.openings += signed(t);
    else if (t.kind === 'income') s.in += BigInt(t.amount);
    else if (t.kind === 'expense') s.out += BigInt(t.amount);
    else if (t.direction === 'in') s.tin += BigInt(t.amount);
    else s.tout += BigInt(t.amount);
  }
  const closing = s.periodOpening + s.openings + s.in - s.out + s.tin - s.tout;
  const N = Number;
  return { periodOpeningMinor: N(s.periodOpening), openingsInPeriodMinor: N(s.openings), inMinor: N(s.in), outMinor: N(s.out), transfersInMinor: N(s.tin), transfersOutMinor: N(s.tout), closingMinor: N(closing) };
}

const identity = (l: StatementLine) =>
  l.periodOpeningMinor + l.openingsInPeriodMinor + l.inMinor - l.outMinor + l.transfersInMinor - l.transfersOutMinor;

describe('identidad de saldos con operaciones aleatorias deterministas', () => {
  for (const seed of [7, 2026, 31337]) {
    it(`semilla ${seed}: saldos, estado de cuenta y resúmenes cuadran con un modelo independiente`, async () => {
      const { c, ws, accounts, model, fields } = await run(seed, 260);
      expect(model.size).toBeGreaterThan(150);
      const all = [...model.values()];
      // La mezcla ejercita de verdad cada camino: si una semilla deja alguno sin tocar, la prueba lo dice.
      expect(all.some((t) => t.status === 'voided' && t.voidedWithBatch)).toBe(true);
      expect(all.some((t) => t.status === 'voided' && !t.voidedWithBatch)).toBe(true);
      expect(all.filter((t) => t.kind === 'transfer').length).toBeGreaterThan(20);
      expect(all.filter((t) => t.kind === 'opening').length).toBeGreaterThan(1);
      expect(all.filter((t) => t.batchId !== null).length).toBeGreaterThan(30);
      expect(all.some((t) => t.amount === 0)).toBe(true);

      // I-1 / I-2, también con asOf.
      for (const asOf of [undefined, '2025-03-31', '2025-12-31', '2026-02-28']) {
        const b = await c.queries.balances(ws, asOf ? { asOf } : {});
        for (const a of accounts) expect(b.byAccount[a] ?? 0, `cuenta ${a} asOf ${asOf}`).toBe(Number(modelBalance(model, a, asOf)));
        expect(b.totalMinor).toBe(Number(modelBalance(model, null, asOf)));
        expect(b.totalMinor).toBe(Object.values(b.byAccount).reduce((x, y) => x + y, 0));
      }
      const listed = await c.accounts.list(ws, { includeArchived: true });
      for (const a of listed) expect(a.balanceMinor).toBe(Number(modelBalance(model, a.id)));

      // I-3 / I-4
      const totals = await c.queries.totals(ws, {});
      expect(totals.transfersInMinor).toBe(totals.transfersOutMinor);
      const st = modelStatement(model, null, null, null);
      expect(totals).toMatchObject({ inMinor: st.inMinor, outMinor: st.outMinor, netMinor: st.inMinor - st.outMinor, transfersInMinor: st.transfersInMinor, openingsMinor: st.openingsInPeriodMinor });
      expect(totals.count).toBe([...model.values()].filter((t) => t.status === 'active').length);

      // I-5 en varios periodos.
      const periods: Array<{ range: DateRange; from: IsoDate | null; to: IsoDate | null }> = [
        { range: { preset: 'all' }, from: null, to: null },
        { range: { from: '2025-01-01', to: '2025-06-30' }, from: '2025-01-01', to: '2025-06-30' },
        { range: { from: '2025-07-01', to: '2025-12-31' }, from: '2025-07-01', to: '2025-12-31' },
        { range: { from: '2025-11-15', to: '2026-02-03' }, from: '2025-11-15', to: '2026-02-03' },
        { range: { from: '2026-03-01' }, from: '2026-03-01', to: null },
        { range: { to: '2025-05-05' }, from: null, to: '2025-05-05' },
      ];
      for (const p of periods) {
        const doc = await c.reports.build(ws, c.reports.preset('summary', p.range));
        const label = JSON.stringify(p.range);
        expect(identity(doc.statement), label).toBe(doc.statement.closingMinor);
        expect(doc.statement, label).toEqual(modelStatement(model, null, p.from, p.to));
        for (const line of doc.byAccount) {
          expect(identity(line), label).toBe(line.closingMinor);
          const { account, ...rest } = line;
          expect(rest, `${label} ${account.name}`).toEqual(modelStatement(model, account.id, p.from, p.to));
        }
        const sum = (k: keyof StatementLine) => doc.byAccount.reduce((s, l) => s + l[k], 0);
        for (const k of Object.keys(doc.statement) as Array<keyof StatementLine>) expect(sum(k), `${label} Σ${k}`).toBe(doc.statement[k]);
        // byField: los grupos de cada campo suman las entradas/salidas del estado.
        for (const bf of doc.byField) {
          expect(bf.groups.reduce((s, g) => s + g.inMinor, 0), `${label} ${bf.field.label}`).toBe(doc.statement.inMinor);
          expect(bf.groups.reduce((s, g) => s + g.outMinor, 0), `${label} ${bf.field.label}`).toBe(doc.statement.outMinor);
        }
      }

      // I-13: la suma de los grupos de cualquier resumen = totales del mismo filtro.
      const groupings: GroupBy[] = [
        { by: 'account' },
        { by: 'kind' },
        { by: 'period', unit: 'month' },
        { by: 'period', unit: 'week' },
        { by: 'period', unit: 'quarter' },
        ...Object.values(fields).map((f) => ({ by: 'field' as const, fieldId: f.id })),
      ];
      const filters: TxFilter[] = [
        {},
        { period: { from: '2025-04-01', to: '2025-09-30' } },
        { accountIds: [accounts[0]!, accounts[2]!] },
        { fields: [{ fieldId: fields.cat.id, op: 'any_of', optionIds: [fields.cat.options[0]!.id, fields.cat.options[2]!.id] }] },
        { fields: [{ fieldId: fields.conc.id, op: 'is', value: false }], amount: { min: 1000, max: 200_000 } },
        { status: 'all', period: { from: '2025-06-01', to: '2026-01-31' } },
      ];
      for (const filter of filters) {
        const t = await c.queries.totals(ws, filter);
        for (const groupBy of groupings) {
          const s = await c.queries.summarize(ws, { filter, groupBy, split: { by: 'account' } });
          const label = `${JSON.stringify(filter)} ${JSON.stringify(groupBy)}`;
          expect(s.groups.reduce((x, g) => x + g.inMinor, 0), label).toBe(t.inMinor);
          expect(s.groups.reduce((x, g) => x + g.outMinor, 0), label).toBe(t.outMinor);
          expect(s.groups.reduce((x, g) => x + g.netMinor, 0), label).toBe(t.netMinor);
          expect(s.totals.inMinor, label).toBe(t.inMinor);
          for (const g of s.groups) {
            if (!g.split) continue;
            expect(g.split.reduce((x, y) => x + y.inMinor, 0), `${label} split ${g.label}`).toBe(g.inMinor);
            expect(g.split.reduce((x, y) => x + y.outMinor, 0), `${label} split ${g.label}`).toBe(g.outMinor);
          }
        }
      }

      // I-7 / I-9 con SQL directo.
      const seqs = await h!.driver.all<{ c: number; mx: number; next_seq: number }>(
        'SELECT COUNT(t.id) AS c, COALESCE(MAX(t.seq), 0) AS mx, a.next_seq FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id GROUP BY a.id',
      );
      for (const s of seqs) {
        expect(Number(s.c)).toBe(Number(s.mx));
        expect(Number(s.next_seq)).toBe(Number(s.mx) + 1);
      }
      const badTransfers = await h!.driver.all(
        `SELECT transfer_group_id FROM transactions WHERE transfer_group_id IS NOT NULL GROUP BY transfer_group_id
         HAVING COUNT(*) <> 2 OR COUNT(DISTINCT direction) <> 2 OR COUNT(DISTINCT amount_minor) <> 1
             OR COUNT(DISTINCT date) <> 1 OR COUNT(DISTINCT status) <> 1`,
      );
      expect(badTransfers).toEqual([]);

      // I-15: exportar → restaurar deja los mismos saldos.
      const before = await c.queries.balances(ws);
      const ex = await c.backup.export({ scope: 'all' });
      await c.backup.restoreAll(ex.text, { confirm: true });
      expect(await c.queries.balances(ws)).toEqual(before);
    }, 60_000);
  }
});
