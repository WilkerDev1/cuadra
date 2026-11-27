// Datos de ejemplo (ARCHITECTURE.md 6, pruebas 104–105 y cobertura de PLAN.md "Datos de ejemplo").
// Los tres espacios se cargan una vez con seedAll (sólo servicios públicos) y cada punto que pide PLAN.md se
// afirma sobre la base resultante.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { addDays, compareIsoDate, diffDays } from '../dates';
import type { ChangeEvent } from '../events';
import type { DemoProgress, DemoSeedResult } from '../services/demo';
import type { DateRange, Id, Mutation, StatementLine } from '../types';
import { countPlanTransactions, DEMO_PROFILES, DEMO_SEED, hashPlan, planDemo, recordedOn, type DemoPlan } from './index';
import { percentOf, roundToUnit } from './prng';

const ANCHOR = '2026-11-27';
const PROFILES = ['colmado', 'despacho', 'personal'] as const;
const NAMES = { colmado: 'Colmado La Esquina', despacho: 'Estudio Creativo Brisa, SRL', personal: 'Mis finanzas' } as const;

const salesOf = (p: DemoPlan, month: string): number =>
  p.items.reduce(
    (s, i) => (i.t === 'capture' && i.kind === 'income' && i.date.startsWith(month) && !i.label.includes('dup') ? s + i.rows.reduce((a, r) => a + r.amountMinor, 0) : s),
    0,
  );

/** Saldo total (todas las cuentas) al cierre de cada mes y neto del mes, según el plan (sin la historia). */
function monthEnds(p: DemoPlan): Array<{ month: string; net: number; balance: number }> {
  const net = new Map<string, number>();
  const add = (d: string, v: number) => net.set(d.slice(0, 7), (net.get(d.slice(0, 7)) ?? 0) + v);
  let opening = 0;
  for (const o of [...Object.values(p.openings), ...p.extraAccounts.flatMap((a) => (a.opening ? [a.opening] : []))]) {
    opening += o.direction === 'in' ? o.amountMinor : -o.amountMinor;
  }
  for (const it of p.items) {
    if (it.t === 'tx') add(it.date, it.kind === 'income' ? it.amountMinor : -it.amountMinor);
    else if (it.t === 'capture') {
      // El lote duplicado (anulado entero en la historia) no cuenta.
      const voided = p.steps.some((s) => s.t === 'void_batch' && s.ref === it.ref);
      if (!voided) for (const r of it.rows) add(it.date, it.kind === 'income' ? r.amountMinor : -r.amountMinor);
    } else if (it.t === 'import') for (const r of it.rows) add(r.date, r.kind === 'income' ? r.amountMinor : -r.amountMinor);
  }
  let balance = opening;
  return [...net.keys()].sort().map((month) => {
    balance += net.get(month) ?? 0;
    return { month, net: net.get(month) ?? 0, balance };
  });
}

/** Saldo de una cuenta al final del plan. */
function finalBalance(p: DemoPlan, account: string): number {
  const o = p.openings[account] ?? p.extraAccounts.find((a) => a.key === account)?.opening;
  let b = o === undefined ? 0 : o.direction === 'in' ? o.amountMinor : -o.amountMinor;
  for (const it of p.items) {
    if (it.t === 'tx' && it.account === account) b += it.kind === 'income' ? it.amountMinor : -it.amountMinor;
    else if (it.t === 'transfer') b += it.to === account ? it.amountMinor : it.from === account ? -it.amountMinor : 0;
    else if (it.t === 'import' && it.account === account) for (const r of it.rows) b += r.kind === 'income' ? r.amountMinor : -r.amountMinor;
    else if (it.t === 'capture' && it.account === account) for (const r of it.rows) b += it.kind === 'income' ? r.amountMinor : -r.amountMinor;
  }
  return b;
}

const RD = 100;

describe('plan de datos de ejemplo (puro)', () => {
  it('saldos creíbles: oscilan en cientos de miles, con meses de neto negativo, caída y recuperación', () => {
    const bounds = { colmado: [80_000, 900_000], despacho: [150_000, 1_500_000], personal: [40_000, 350_000] } as const;
    for (const profile of PROFILES) {
      const p = planDemo(profile, { anchor: ANCHOR });
      const ends = monthEnds(p);
      const [lo, hi] = bounds[profile];
      for (const e of ends) {
        expect(e.balance, `${profile} ${e.month}`).toBeGreaterThanOrEqual(lo * RD);
        expect(e.balance, `${profile} ${e.month}`).toBeLessThanOrEqual(hi * RD);
      }
      // No crece sin parar: el último cierre no llega al doble del primero.
      expect(ends[ends.length - 1]!.balance, profile).toBeLessThan(ends[0]!.balance * 2);
      // Al menos dos meses (completos) con neto negativo.
      expect(ends.slice(1, -1).filter((e) => e.net < 0).length, profile).toBeGreaterThanOrEqual(2);
      // Caída visible desde un máximo (≥ 12 %) y recuperación posterior (≥ 12 % sobre ese punto bajo).
      const balances = ends.map((e) => e.balance);
      const dipAndRecovery = balances.some((v, j) => {
        const peak = Math.max(...balances.slice(0, j + 1));
        return j > 0 && v <= peak * 0.88 && Math.max(...balances.slice(j + 1), -Infinity) >= v * 1.12;
      });
      expect(dipAndRecovery, `${profile} ${balances.map((v) => Math.round(v / RD / 1000)).join(' ')}`).toBe(true);
    }
  });

  it('colmado: inventario fuerte antes de diciembre, retiros del dueño, alquiler, nómina, préstamo y depósitos', () => {
    const p = planDemo('colmado', { anchor: ANCHOR });
    const purchases = (month: string) =>
      p.items.reduce((s, i) => (i.t === 'tx' && i.date.startsWith(month) && i.values['categoria'] === 'mercancia' ? s + i.amountMinor : s), 0);
    const sales = (month: string) => salesOf(p, month);
    // En noviembre se compra mucho más de lo que se vende en proporción; en diciembre, al revés.
    expect(purchases('2025-11') / sales('2025-11')).toBeGreaterThan((purchases('2025-12') / sales('2025-12')) * 1.3);
    expect(purchases('2025-11')).toBeGreaterThan(purchases('2025-10') * 1.15);
    for (const text of ['Retiro del dueño', 'Alquiler del local', 'Nómina', 'Cuota del préstamo']) {
      expect(p.items.filter((i) => i.t === 'tx' && i.description.startsWith(text)).length, text).toBeGreaterThanOrEqual(12);
    }
    expect(p.items.filter((i) => i.t === 'transfer' && i.description.startsWith('Depósito del efectivo')).length).toBeGreaterThan(80);
    expect(finalBalance(p, 'tarjeta')).toBeLessThan(0);
  });

  it('personal: sueldo quincenal, ahorro modesto que crece y tarjeta que se paga cada mes', () => {
    const p = planDemo('personal', { anchor: ANCHOR });
    expect(p.items.filter((i) => i.t === 'tx' && i.description === 'Salario quincenal').length).toBeGreaterThanOrEqual(27);
    const ahorros = finalBalance(p, 'ahorros');
    expect(ahorros).toBeGreaterThan(p.openings['ahorros']!.amountMinor);
    expect(ahorros).toBeLessThan(p.openings['ahorros']!.amountMinor + 150_000 * RD);
    expect(p.items.filter((i) => i.t === 'transfer' && i.description === 'Pago de la tarjeta').length).toBeGreaterThanOrEqual(12);
    expect(finalBalance(p, 'tarjeta')).toBeLessThan(0);
  });

  it('la historia de cada movimiento empieza después de anotarlo (bloque semanal, lote o importación)', () => {
    for (const profile of PROFILES) {
      const p = planDemo(profile, { anchor: ANCHOR });
      const recorded = new Map<string, string>();
      for (const it of p.items) if (it.ref !== undefined) recorded.set(it.ref, recordedOn(it, ANCHOR));
      let checked = 0;
      for (const s of p.steps) {
        if (!('ref' in s)) continue;
        const at = recorded.get(s.ref);
        expect(at, `${profile} ${s.ref}`).toBeDefined();
        expect(compareIsoDate(s.at, at!), `${profile} ${s.t} ${s.ref} el ${s.at}, anotado el ${at}`).toBeGreaterThan(0);
        checked += 1;
      }
      expect(checked, profile).toBeGreaterThan(5);
    }
  });
  it('misma semilla y misma fecha ancla → mismo plan (hash idéntico); otra semilla u otra ancla → otro', () => {
    for (const profile of PROFILES) {
      const a = planDemo(profile, { anchor: ANCHOR });
      const b = planDemo(profile, { anchor: ANCHOR, seed: DEMO_SEED });
      expect(hashPlan(a), profile).toBe(hashPlan(b));
      expect(hashPlan(planDemo(profile, { anchor: ANCHOR, seed: 7 })), profile).not.toBe(hashPlan(a));
      expect(hashPlan(planDemo(profile, { anchor: '2026-11-28' })), profile).not.toBe(hashPlan(a));
    }
  });

  it('montos enteros positivos en unidad menor, fechas dentro del plan y pasos ordenados', () => {
    for (const profile of PROFILES) {
      const p = planDemo(profile, { anchor: ANCHOR });
      const amounts: number[] = [];
      for (const it of p.items) {
        expect(compareIsoDate(it.date, p.start) >= 0 && compareIsoDate(it.date, ANCHOR) <= 0, `${profile} ${it.date}`).toBe(true);
        if (it.t === 'tx' || it.t === 'transfer') amounts.push(it.amountMinor);
        else amounts.push(...it.rows.map((r) => r.amountMinor));
      }
      for (const a of amounts) expect(Number.isSafeInteger(a) && a > 0, `${profile} ${a}`).toBe(true);
      const ats = p.steps.map((s) => s.at);
      expect([...ats].sort()).toEqual(ats);
      for (const at of ats) expect(compareIsoDate(at, ANCHOR) <= 0).toBe(true);
    }
  });

  it('ayudas de redondeo sin flotantes', () => {
    expect(roundToUnit(1_234_549, 500)).toBe(1_234_500);
    expect(roundToUnit(1_234_750, 500)).toBe(1_235_000);
    expect(roundToUnit(-1_250, 500)).toBe(-1_000);
    expect(percentOf(3_200_000, 140)).toBe(4_480_000);
    expect(percentOf(999, 4)).toBe(40);
    expect(() => roundToUnit(1.5, 500)).toThrow(RangeError);
  });

  it('anclado al reloj: ~14 meses que terminan HOY, con actividad este mes en cada perfil', () => {
    for (const anchor of [ANCHOR, '2027-03-01', '2026-02-28']) {
      for (const profile of PROFILES) {
        const p = planDemo(profile, { anchor });
        expect(diffDays(p.start, anchor), profile).toBeGreaterThanOrEqual(390); // 13 meses completos + el mes en curso
        expect(compareIsoDate(p.items[p.items.length - 1]!.date, addDays(anchor, -3)) >= 0, `${profile} ${anchor}`).toBe(true);
        expect(p.items.filter((i) => i.date.startsWith(anchor.slice(0, 7))).length, profile).toBeGreaterThan(0);
      }
    }
  });

  it('volumen total 6 000–9 000 movimientos; colmado con lotes diarios y cuatro descuadres anotados', () => {
    const plans = PROFILES.map((profile) => planDemo(profile, { anchor: ANCHOR }));
    const total = plans.reduce((s, p) => s + countPlanTransactions(p), 0);
    expect(total).toBeGreaterThanOrEqual(6_000);
    expect(total).toBeLessThanOrEqual(9_000);
    const colmado = plans[0]!;
    const captures = colmado.items.filter((i) => i.t === 'capture');
    expect(captures.length).toBeGreaterThan(380);
    const mismatched = captures.filter((c) => c.t === 'capture' && c.mismatchNote !== undefined);
    expect(mismatched).toHaveLength(4);
    for (const c of mismatched) expect(c.t === 'capture' && c.label.includes(c.mismatchNote ?? '∅')).toBe(true);
  });

  it('estacionalidad: diciembre fuerte, enero flojo y quincenas al alza', () => {
    const p = planDemo('colmado', { anchor: ANCHOR });
    const months = ['2025-10', '2025-11', '2026-02', '2026-03', '2026-04', '2026-05'];
    const typical = months.reduce((s, m) => s + salesOf(p, m), 0) / months.length;
    expect(salesOf(p, '2025-12')).toBeGreaterThan(typical * 1.2);
    expect(salesOf(p, '2026-01')).toBeLessThan(typical * 0.95);
    // Venta media de los días de cobro (15/16 y 30/31) frente a los días 8–12.
    const daily = new Map<string, number>();
    for (const i of p.items) if (i.t === 'capture' && i.kind === 'income') daily.set(i.date, (daily.get(i.date) ?? 0) + i.rows.reduce((a, r) => a + r.amountMinor, 0));
    const avg = (pick: (dom: number) => boolean) => {
      const xs = [...daily].filter(([d]) => pick(Number(d.slice(8, 10)))).map(([, v]) => v);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg((d) => d === 15 || d === 16 || d === 30 || d === 31)).toBeGreaterThan(avg((d) => d >= 8 && d <= 12) * 1.05);
  });
});

/** Comprueba I-1, I-2, I-4, I-6, I-7 e I-9 directamente sobre la base. */
async function checkInvariants(h: TestCuadra, ws: Id): Promise<void> {
  const d = h.driver;
  // I-1: saldo de cada cuenta = Σ con signo de sus activos (y la fachada da lo mismo).
  const sums = await d.all<{ id: string; b: number }>(
    `SELECT a.id, COALESCE(SUM(CASE WHEN t.status = 'active' THEN CASE t.direction WHEN 'in' THEN t.amount_minor ELSE -t.amount_minor END END), 0) AS b
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE a.workspace_id = ? GROUP BY a.id`,
    [ws],
  );
  const accounts = await h.cuadra.accounts.list(ws, { includeArchived: true });
  for (const s of sums) expect(accounts.find((a) => a.id === s.id)?.balanceMinor, s.id).toBe(Number(s.b));
  // I-2: saldo del espacio = Σ saldos de sus cuentas, archivadas incluidas.
  const summary = (await h.cuadra.workspaces.list({ includeArchived: true })).find((w) => w.id === ws);
  expect(summary?.balanceMinor).toBe(sums.reduce((a, s) => a + Number(s.b), 0));
  // I-4 e I-9: transferencias en pares out/in del mismo monto, fecha y estado; Σ entrantes = Σ salientes.
  const bad = await d.all(
    `SELECT transfer_group_id FROM transactions WHERE workspace_id = ? AND kind = 'transfer' GROUP BY transfer_group_id
     HAVING COUNT(*) <> 2 OR SUM(direction = 'in') <> 1 OR COUNT(DISTINCT amount_minor) <> 1 OR COUNT(DISTINCT date) <> 1
        OR COUNT(DISTINCT status) <> 1`,
    [ws],
  );
  expect(bad).toEqual([]);
  const tr = await d.get<{ i: number; o: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_minor END), 0) AS i, COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_minor END), 0) AS o
     FROM transactions WHERE workspace_id = ? AND kind = 'transfer' AND status = 'active'`,
    [ws],
  );
  expect(Number(tr?.i)).toBe(Number(tr?.o));
  // I-6: como mucho un saldo inicial por cuenta.
  expect(await d.all(`SELECT account_id FROM transactions WHERE workspace_id = ? AND kind = 'opening' GROUP BY account_id HAVING COUNT(*) > 1`, [ws])).toEqual([]);
  // I-7: seq 1..n sin huecos por cuenta y next_seq = n + 1.
  const seqs = await d.all<{ id: string; n: number; mx: number; mn: number; next_seq: number }>(
    `SELECT a.id, COUNT(t.id) AS n, MAX(t.seq) AS mx, MIN(t.seq) AS mn, a.next_seq FROM accounts a
     JOIN transactions t ON t.account_id = a.id WHERE a.workspace_id = ? GROUP BY a.id`,
    [ws],
  );
  for (const s of seqs) {
    expect(Number(s.mn), s.id).toBe(1);
    expect(Number(s.mx), s.id).toBe(Number(s.n));
    expect(Number(s.next_seq), s.id).toBe(Number(s.n) + 1);
  }
  // Credibilidad: solo las tarjetas pasan por saldo negativo; caja, bancos y ahorros nunca, en ningún día.
  const dips = await d.all(
    `WITH s AS (SELECT account_id, date, SUM(SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END))
                OVER (PARTITION BY account_id ORDER BY date) AS b
              FROM transactions WHERE workspace_id = ? AND status = 'active' GROUP BY account_id, date)
     SELECT a.name, MIN(s.b) AS b FROM s JOIN accounts a ON a.id = s.account_id WHERE s.b < 0 AND a.type <> 'card' GROUP BY a.id`,
    [ws],
  );
  expect(dips).toEqual([]);
}

const identity = (s: StatementLine): number =>
  s.periodOpeningMinor + s.openingsInPeriodMinor + s.inMinor - s.outMinor + s.transfersInMinor - s.transfersOutMinor;

/** Resumen comparable de un espacio (prueba de determinismo: dos cargas → mismos totales). */
async function fingerprint(h: TestCuadra, ws: Id) {
  const accounts = (await h.cuadra.accounts.list(ws, { includeArchived: true })).map((a) => [a.name, a.balanceMinor, a.archivedAt !== null]);
  const kinds = await h.driver.all(
    `SELECT kind, status, COUNT(*) AS n, SUM(amount_minor) AS s FROM transactions WHERE workspace_id = ? GROUP BY kind, status ORDER BY kind, status`,
    [ws],
  );
  const values = await h.driver.get(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT v.field_id) AS f FROM transaction_field_values v JOIN transactions t ON t.id = v.transaction_id WHERE t.workspace_id = ?`,
    [ws],
  );
  const actions = await h.driver.all(`SELECT action, COUNT(*) AS n FROM audit_log WHERE workspace_id = ? GROUP BY action ORDER BY action`, [ws]);
  const batches = await h.driver.all(`SELECT source, COUNT(*) AS n FROM batches WHERE workspace_id = ? GROUP BY source ORDER BY source`, [ws]);
  const year = await h.cuadra.queries.summarize(ws, { filter: { period: { preset: 'last_12_months' } }, groupBy: { by: 'period', unit: 'month' } });
  return { accounts, kinds, values, actions, batches, year: year.groups.map((g) => [g.key, g.inMinor, g.outMinor]) };
}

describe('demo.seedAll', () => {
  let h: TestCuadra;
  let results: Array<Mutation<DemoSeedResult>>;
  const progress: DemoProgress[] = [];
  const events: ChangeEvent[] = [];
  const ws = {} as Record<(typeof PROFILES)[number], Id>;
  let elapsedMs = 0;

  beforeAll(async () => {
    h = await createTestCuadra({ today: ANCHOR });
    h.cuadra.subscribe((e) => events.push(e));
    const t0 = performance.now();
    results = await h.cuadra.demo.seedAll({ onProgress: (p) => progress.push(p) });
    elapsedMs = performance.now() - t0;
    PROFILES.forEach((p, i) => (ws[p] = results[i]!.value.workspace.id));
  }, 120_000);
  afterAll(async () => {
    await h.driver.close();
  });

  it('tres espacios de ejemplo con 6 000–9 000 movimientos, en pocos segundos', async () => {
    console.info(`[demo] seedAll en Node: ${Math.round(elapsedMs)} ms, ${results.map((r) => `${r.value.workspace.name}: ${r.value.transactions}`).join(' · ')}`);
    expect(elapsedMs).toBeLessThan(30_000);
    expect(results.map((r) => r.value.workspace.name)).toEqual(PROFILES.map((p) => NAMES[p]));
    expect(results.every((r) => r.value.workspace.isDemo)).toBe(true);
    expect(results.map((r) => r.value.workspace.templateId)).toEqual(['negocio', 'despacho', 'personal']);
    const n = await h.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(Number(n?.n)).toBeGreaterThanOrEqual(6_000);
    expect(Number(n?.n)).toBeLessThanOrEqual(9_000);
    for (const [i, profile] of PROFILES.entries()) {
      const plan = h.cuadra.demo.plan(profile);
      const count = await h.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ?', [ws[profile]]);
      expect(Number(count?.n), profile).toBe(countPlanTransactions(plan));
      expect(results[i]!.value.transactions, profile).toBe(countPlanTransactions(plan));
      expect(results[i]!.value.views, profile).toBe(plan.views.length);
    }
    expect(DEMO_PROFILES.map((p) => p.name)).toEqual(PROFILES.map((p) => NAMES[p]));
  });

  it('progreso: fracción que nunca baja y termina en 1; UN evento de cambio por espacio', () => {
    expect(progress.length).toBeGreaterThan(100);
    for (let i = 1; i < progress.length; i += 1) expect(progress[i]!.fraction).toBeGreaterThanOrEqual(progress[i - 1]!.fraction);
    expect(progress[progress.length - 1]).toMatchObject({ profile: 'personal', phase: 'done', fraction: 1 });
    expect(new Set(progress.map((p) => p.phase))).toEqual(new Set(['structure', 'movements', 'history', 'done']));
    const seeds = events.filter((e) => e.reason === 'demo.seed');
    expect(seeds.map((e) => e.workspaceId)).toEqual(PROFILES.map((p) => ws[p]));
    expect(events).toHaveLength(3);
    expect(seeds[0]!.tables).toEqual(expect.arrayContaining(['transactions', 'batches', 'audit_log', 'saved_views', 'field_options']));
  });

  it('invariantes I-1..I-9 en los tres espacios; solo las tarjetas en negativo', async () => {
    for (const profile of PROFILES) await checkInvariants(h, ws[profile]);
  });

  it('historia coherente en el tiempo: cada acción, después de anotar lo que toca, y nada después de ahora', async () => {
    const now = h.clock.now().toISOString();
    for (const profile of PROFILES) {
      const id = ws[profile];
      const txActions = await h.driver.all<{ action: string; at: string; created: string; description: string }>(
        `SELECT a.action, a.at, MAX(t.recorded_at) AS created, MIN(t.description) AS description FROM audit_log a
         JOIN transactions t ON (a.entity_type = 'transaction' AND t.id = a.entity_id) OR (a.entity_type = 'transfer' AND t.transfer_group_id = a.entity_id)
         WHERE a.workspace_id = ? AND a.action IN ('edit', 'void', 'restore') GROUP BY a.id`,
        [id],
      );
      expect(txActions.length, profile).toBeGreaterThan(5);
      expect(txActions.filter((x) => x.at <= x.created), profile).toEqual([]);
      const batchActions = await h.driver.all<{ action: string; at: string; created: string }>(
        `SELECT a.action, a.at, b.created_at AS created FROM audit_log a JOIN batches b ON b.id = a.entity_id
         WHERE a.workspace_id = ? AND a.action IN ('batch_void', 'batch_restore')`,
        [id],
      );
      expect(batchActions.filter((x) => x.at <= x.created), profile).toEqual([]);
      // Ningún movimiento se anotó antes de su propia fecha (salvo los saldos iniciales, del primer día).
      const early = await h.driver.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ? AND substr(recorded_at, 1, 10) < date AND date < ?`,
        [id, addDays(ANCHOR, -1)],
      );
      expect(Number(early?.n), profile).toBe(0);
      const latest = await h.driver.get<{ a: string; c: string; u: string; b: string }>(
        `SELECT (SELECT MAX(at) FROM audit_log WHERE workspace_id = ?1) AS a,
                (SELECT MAX(recorded_at) FROM transactions WHERE workspace_id = ?1) AS c,
                (SELECT MAX(updated_at) FROM transactions WHERE workspace_id = ?1) AS u,
                (SELECT MAX(created_at) FROM batches WHERE workspace_id = ?1) AS b`,
        [id],
      );
      for (const [k, v] of Object.entries(latest ?? {})) expect(v <= now, `${profile} ${k} ${v} > ${now}`).toBe(true);
    }
  });

  it('identidad de saldos de los informes sobre los datos generados (varios periodos y cada cuenta)', async () => {
    for (const profile of PROFILES) {
      const id = ws[profile];
      const periods: DateRange[] = [
        { preset: 'this_month' },
        { preset: 'last_month' },
        { preset: 'last_quarter' },
        { preset: 'last_12_months' },
        { preset: 'all' },
        { from: '2025-12-01', to: '2025-12-31' },
        { from: '2026-03-10', to: '2026-07-22' },
      ];
      for (const period of periods) {
        const doc = await h.cuadra.reports.build(id, h.cuadra.reports.preset('summary', period));
        const label = `${profile} ${JSON.stringify(period)}`;
        expect(identity(doc.statement), label).toBe(doc.statement.closingMinor);
        for (const line of doc.byAccount) expect(identity(line), `${label} ${line.account.name}`).toBe(line.closingMinor);
      }
      // Cierre de "todo" = saldos de hoy; el inicial de un mes = el cierre del mes anterior.
      const all = await h.cuadra.reports.build(id, h.cuadra.reports.preset('summary', { preset: 'all' }));
      const balances = await h.cuadra.accounts.list(id, { includeArchived: true });
      expect(all.statement.closingMinor, profile).toBe(balances.reduce((s, a) => s + a.balanceMinor, 0));
      const nov = await h.cuadra.reports.build(id, h.cuadra.reports.preset('summary', { from: '2025-11-01', to: '2025-11-30' }));
      const dec = await h.cuadra.reports.build(id, h.cuadra.reports.preset('summary', { from: '2025-12-01', to: '2025-12-31' }));
      expect(dec.statement.periodOpeningMinor, profile).toBe(nov.statement.closingMinor);
    }
  });

  it('cuentas: la tarjeta del colmado en negativo con su aviso y una cuenta archivada', async () => {
    const accounts = await h.cuadra.accounts.list(ws.colmado, { includeArchived: true });
    const card = accounts.find((a) => a.name === 'Tarjeta de crédito');
    expect(card?.isNegative).toBe(true);
    expect(results[0]!.warnings).toContainEqual({ code: 'negative_balance', accountId: card!.id, balanceAfterMinor: card!.balanceMinor });
    const archived = accounts.filter((a) => a.archivedAt !== null);
    expect(archived.map((a) => a.name)).toEqual(['Cuenta de ahorro anterior']);
    expect(archived[0]?.balanceMinor).toBe(0);
    for (const a of accounts.filter((x) => x.type !== 'card')) expect(a.balanceMinor, a.name).toBeGreaterThanOrEqual(0);
    const dash = await h.cuadra.queries.dashboard(ws.colmado);
    expect(dash.attention.negativeAccounts.map((a) => a.id)).toContain(card!.id);
  });

  it('entradas, salidas, transferencias y saldos iniciales en cada espacio', async () => {
    for (const profile of PROFILES) {
      const kinds = await h.driver.all<{ kind: string }>('SELECT DISTINCT kind FROM transactions WHERE workspace_id = ? ORDER BY kind', [ws[profile]]);
      expect(kinds.map((k) => k.kind), profile).toEqual(['expense', 'income', 'opening', 'transfer']);
    }
    // Colmado: depósitos Caja → Banco.
    const deposits = await h.cuadra.queries.listTransactions(ws.colmado, { filter: { kinds: ['transfer'], text: 'Depósito del efectivo' }, limit: 5 });
    expect(deposits.totals.transfersInMinor).toBeGreaterThan(0);
    // Mis finanzas: ahorro por transferencias cada quincena.
    const savings = await h.cuadra.queries.listTransactions(ws.personal, { filter: { kinds: ['transfer'], text: 'Ahorro de la quincena' }, limit: 5 });
    expect(savings.totals.transfersInMinor).toBeGreaterThan(0);
  });

  it('lotes de captura con total de control (uno con descuadre anotado) y un lote anulado entero', async () => {
    const captures = await h.cuadra.batches.list(ws.colmado, { source: 'capture', limit: 1000 });
    expect(captures.length).toBeGreaterThan(380);
    expect(captures.every((b) => b.controlTotalMinor !== null)).toBe(true);
    const mismatched = captures.filter((b) => b.controlMismatchAccepted);
    expect(mismatched).toHaveLength(4);
    for (const b of mismatched) expect(b.label).toMatch(/\((faltó|sobró) efectivo al cuadrar\)$/);
    const voidedBatch = captures.filter((b) => b.activeCount === 0 && b.voidedCount > 0);
    expect(voidedBatch).toHaveLength(1);
    const batchVoid = await h.cuadra.audit.list(ws.colmado, { actions: ['batch_void'], limit: 5 });
    expect(batchVoid.items).toHaveLength(1);
    expect(batchVoid.items[0]?.batchId).toBe(voidedBatch[0]!.id);
    // Cada lote de captura dejó su propia acción de historial.
    const created = await h.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id = ? AND action = 'batch_create'`, [ws.colmado]);
    expect(Number(created?.n)).toBe(captures.length);
  });

  it('un lote IMPORTADO desde una hoja tipo Excel en el despacho (y otro en Mis finanzas), con su acción "import"', async () => {
    for (const profile of ['despacho', 'personal'] as const) {
      const imports = await h.cuadra.batches.list(ws[profile], { source: 'import' });
      expect(imports, profile).toHaveLength(1);
      expect(imports[0]!.label).toMatch(/\.xlsx$/);
      const plan = h.cuadra.demo.plan(profile);
      const item = plan.items.find((i) => i.t === 'import')!;
      expect(imports[0]!.activeCount + imports[0]!.voidedCount).toBe(item.t === 'import' ? item.rows.length : -1);
      const action = await h.cuadra.audit.list(ws[profile], { actions: ['import'], limit: 5 });
      expect(action.items).toHaveLength(1);
      expect(action.items[0]?.batchId).toBe(imports[0]!.id);
    }
    // Lo importado lleva valores de los cinco tipos de campo (la hoja traía una columna por campo).
    const types = await h.driver.all<{ type: string }>(
      `SELECT DISTINCT f.type FROM transaction_field_values v JOIN transactions t ON t.id = v.transaction_id JOIN batches b ON b.id = t.batch_id
       JOIN fields f ON f.id = v.field_id WHERE b.workspace_id = ? AND b.source = 'import' ORDER BY f.type`,
      [ws.despacho],
    );
    expect(types.map((t) => t.type)).toEqual(['bool', 'date', 'list', 'number', 'text']);
  });

  it('campos de los cinco tipos con valores; ITBIS como dimensión del despacho; conciliado sí y no', async () => {
    for (const profile of ['colmado', 'despacho'] as const) {
      const types = await h.driver.all<{ type: string }>(
        `SELECT DISTINCT f.type FROM transaction_field_values v JOIN fields f ON f.id = v.field_id WHERE f.workspace_id = ? ORDER BY f.type`,
        [ws[profile]],
      );
      expect(types.map((t) => t.type), profile).toEqual(['bool', 'date', 'list', 'number', 'text']);
    }
    const itbis = (await h.cuadra.fields.list(ws.despacho)).find((f) => f.label === 'ITBIS')!;
    expect(itbis.type).toBe('list');
    const byItbis = await h.cuadra.queries.summarize(ws.despacho, { filter: { kinds: ['income'] }, groupBy: { by: 'field', fieldId: itbis.id } });
    expect(byItbis.groups.filter((g) => g.inMinor > 0).length).toBeGreaterThanOrEqual(2);
    const conciliado = await h.driver.all<{ b: number; n: number }>(
      `SELECT v.value_bool AS b, COUNT(*) AS n FROM transaction_field_values v JOIN fields f ON f.id = v.field_id
       WHERE f.workspace_id = ? AND f.key = 'conciliado' GROUP BY v.value_bool ORDER BY b`,
      [ws.despacho],
    );
    expect(conciliado.map((c) => Number(c.b))).toEqual([0, 1]);
    // Nada del mes en curso está conciliado (el filtro "No conciliados" muestra algo).
    const thisMonth = await h.driver.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions t JOIN transaction_field_values v ON v.transaction_id = t.id JOIN fields f ON f.id = v.field_id
       WHERE t.workspace_id = ? AND f.key = 'conciliado' AND v.value_bool = 1 AND t.date >= ?`,
      [ws.despacho, `${ANCHOR.slice(0, 7)}-01`],
    );
    expect(Number(thisMonth?.n)).toBe(0);
  });

  it('una opción renombrada, dos opciones fusionadas y un campo desactivado que conserva lo histórico', async () => {
    const fields = await h.cuadra.fields.list(ws.colmado, { includeInactive: true });
    const contacto = fields.find((f) => f.key === 'contacto')!;
    expect(contacto.options.map((o) => o.label)).toContain('Almacenes del Norte, SRL');
    expect(contacto.options.map((o) => o.label)).not.toContain('Almacenes del Norte');
    const categoria = fields.find((f) => f.key === 'categoria')!;
    const luz = categoria.options.find((o) => o.label === 'Luz')!;
    const electricidad = categoria.options.find((o) => o.key === 'electricidad')!;
    expect(luz.active).toBe(false);
    expect(luz.mergedIntoId).toBe(electricidad.id);
    const left = await h.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transaction_field_values WHERE value_option_id = ?', [luz.id]);
    expect(Number(left?.n)).toBe(0);
    const merge = await h.cuadra.audit.list(ws.colmado, { actions: ['merge'], limit: 5 });
    expect(merge.items).toHaveLength(1);
    expect(Number(merge.items[0]?.params?.['movedCount'])).toBeGreaterThan(0);

    const units = fields.find((f) => f.key === 'unidades')!;
    expect(units.active).toBe(false);
    expect((await h.cuadra.fields.usage(units.id)).total).toBeGreaterThan(20);
    // Sigue disponible para filtrar y agrupar lo histórico.
    expect((await h.cuadra.fields.dimensions(ws.colmado)).some((f) => f.id === units.id)).toBe(true);
    // Y fuera del formulario de hoy.
    expect((await h.cuadra.fields.formSchema(ws.colmado, 'expense')).fields.some((f) => f.id === units.id)).toBe(false);
  });

  it('movimientos editados con historial de varios cambios, fechados en el pasado', async () => {
    const multi = await h.driver.all<{ entity_id: string; n: number }>(
      `SELECT entity_id, COUNT(*) AS n FROM audit_log WHERE workspace_id = ? AND action = 'edit' AND entity_type = 'transaction'
       GROUP BY entity_id HAVING COUNT(*) >= 3`,
      [ws.colmado],
    );
    expect(multi.length).toBeGreaterThanOrEqual(3);
    const history = await h.cuadra.transactions.history(multi[0]!.entity_id);
    const edits = history.filter((e) => e.action === 'edit');
    expect(edits.length).toBeGreaterThanOrEqual(3);
    for (const e of edits) expect(compareIsoDate(e.at.slice(0, 10), ANCHOR) < 0).toBe(true);
    expect(new Set(edits.flatMap((e) => e.changes.map((c) => c.path))).size).toBeGreaterThanOrEqual(3);
    const total = await h.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'edit' AND entity_type = 'transaction'`);
    expect(Number(total?.n)).toBeGreaterThanOrEqual(25);
  });

  it('anulados con motivo, y anulados y restaurados, en cada espacio', async () => {
    for (const profile of PROFILES) {
      const voided = await h.driver.all<{ void_reason: string | null }>(
        "SELECT void_reason FROM transactions WHERE workspace_id = ? AND status = 'voided' AND voided_with_batch = 0",
        [ws[profile]],
      );
      expect(voided.length, profile).toBeGreaterThanOrEqual(2);
      expect(voided.every((v) => (v.void_reason ?? '').trim() !== ''), profile).toBe(true);
      const restores = await h.cuadra.audit.list(ws[profile], { actions: ['restore'], limit: 10 });
      expect(restores.items.length, profile).toBeGreaterThanOrEqual(1);
      const back = await h.cuadra.transactions.get(restores.items[0]!.entityId!);
      expect(back.status).toBe('active');
      const trail = (await h.cuadra.transactions.history(back.id)).map((e) => e.action);
      expect(trail).toEqual(expect.arrayContaining(['void', 'restore']));
    }
  });

  it('pares de posibles duplicados: el aviso sale al revisar la copia', async () => {
    let pairs = 0;
    for (const profile of PROFILES) {
      const candidates = await h.driver.all<{ a: string; b: string }>(
        `SELECT x.id AS a, y.id AS b FROM transactions x JOIN transactions y
           ON y.account_id = x.account_id AND y.direction = x.direction AND y.amount_minor = x.amount_minor
          AND y.description = x.description AND y.id > x.id AND y.date BETWEEN date(x.date, '-1 day') AND date(x.date, '+1 day')
         WHERE x.workspace_id = ? AND x.status = 'active' AND y.status = 'active' AND x.kind IN ('income', 'expense')`,
        [ws[profile]],
      );
      for (const c of candidates) {
        const copy = await h.cuadra.transactions.get(c.b);
        if (copy.kind !== 'income' && copy.kind !== 'expense') continue;
        const warnings = await h.cuadra.transactions.check(
          ws[profile],
          { accountId: copy.accountId, kind: copy.kind, amountMinor: copy.amountMinor, date: copy.date, description: copy.description },
          { editingId: copy.id },
        );
        if (warnings.some((w) => w.code === 'possible_duplicate' && w.transactionId === c.a)) pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(2);
  });

  it('vistas guardadas útiles además de las de la plantilla, y todas se abren con datos', async () => {
    for (const profile of PROFILES) {
      const plan = h.cuadra.demo.plan(profile);
      const template = h.cuadra.templates.get(plan.templateId);
      const all = [
        ...(await h.cuadra.views.list(ws[profile], 'filter')),
        ...(await h.cuadra.views.list(ws[profile], 'summary')),
        ...(await h.cuadra.views.list(ws[profile], 'report')),
      ];
      expect(all.length, profile).toBe(template.views.length + plan.views.length);
      for (const kind of ['filter', 'summary', 'report'] as const) {
        expect(plan.views.some((v) => v.recipe.kind === kind), `${profile} ${kind}`).toBe(true);
      }
      for (const v of all.filter((x) => plan.views.some((pv) => pv.name === x.name))) {
        const r = v.recipe;
        if (r.kind === 'filter') {
          expect((await h.cuadra.queries.listTransactions(ws[profile], { filter: r.filter, limit: 5 })).items.length, v.name).toBeGreaterThan(0);
        } else if (r.kind === 'summary') {
          const s = await h.cuadra.queries.summarize(ws[profile], { filter: r.filter, groupBy: r.groupBy, ...(r.split ? { split: r.split } : {}) });
          expect(s.groups.length, v.name).toBeGreaterThan(0);
        } else {
          const doc = await h.cuadra.reports.build(ws[profile], r);
          expect(doc.statement.inMinor + doc.statement.outMinor, v.name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('respaldo: queda uno verificado hace 41 días, así el recordatorio sale vencido', async () => {
    const at = await h.cuadra.settings.get('backup.lastVerifiedAt');
    expect(at?.slice(0, 10)).toBe(addDays(ANCHOR, -41));
    for (const profile of PROFILES) expect((await h.cuadra.queries.dashboard(ws[profile])).attention.backup.overdue, profile).toBe(true);
  });

  it('nombres y descripciones creíbles de República Dominicana, sin marcas ni personas reales', async () => {
    const texts = await h.driver.all<{ t: string }>(
      `SELECT DISTINCT description AS t FROM transactions UNION SELECT label FROM field_options UNION SELECT name FROM accounts
       UNION SELECT label FROM batches UNION SELECT name FROM saved_views UNION SELECT value_text FROM transaction_field_values WHERE value_text IS NOT NULL`,
    );
    const joined = texts.map((x) => x.t).join('\n');
    expect(joined).toMatch(/RD\$|ITBIS|NCF|TSS|IR-17|colmado|quincena/i);
    const brands = /\b(Claro|Altice|Viva|Banreservas|Popular|BHD|Scotiabank|Edesur|Edenorte|Edeeste|Coca|Pepsi|Presidente|Brugal|Jumbo|Sirena|Nacional|Bravo|Netflix|Spotify|Adobe|Google|Facebook|Instagram|Meta|Uber|Shell|Texaco|Esso|Visa|Mastercard|Amazon|Microsoft|Apple)\b/;
    expect(joined.match(brands)).toBeNull();
    expect(texts.every((x) => x.t.trim() !== '')).toBe(true);
  });

  it('determinismo: otra carga desde cero deja exactamente los mismos totales', async () => {
    const h2 = await createTestCuadra({ today: ANCHOR, seed: 99 });
    try {
      const again = await h2.cuadra.demo.seedAll();
      for (const [i, profile] of PROFILES.entries()) {
        expect(await fingerprint(h2, again[i]!.value.workspace.id), profile).toEqual(await fingerprint(h, ws[profile]));
      }
    } finally {
      await h2.driver.close();
    }
  }, 120_000);

  it('perfil desconocido → not_found y no deja nada a medias', async () => {
    const before = (await h.cuadra.workspaces.list({ includeArchived: true })).length;
    await expect(h.cuadra.demo.seed('otro' as 'colmado')).rejects.toMatchObject({ code: 'not_found' });
    expect((await h.cuadra.workspaces.list({ includeArchived: true })).length).toBe(before);
  });
});

describe('demo.seed (un perfil) y rendimiento', () => {
  it('un fallo a mitad de la carga borra el espacio entero', async () => {
    const h = await createTestCuadra({ today: ANCHOR });
    try {
      // La transacción n.º 40 (ya con el espacio y parte de los movimientos guardados) falla.
      const original = h.driver.transaction.bind(h.driver);
      let n = 0;
      h.driver.transaction = (async (fn: Parameters<typeof original>[0]) => {
        n += 1;
        if (n === 40) throw new Error('fallo simulado del disco');
        return original(fn);
      }) as typeof h.driver.transaction;
      await expect(h.cuadra.demo.seed('personal', { months: 2 })).rejects.toThrow('fallo simulado del disco');
      h.driver.transaction = original;
      expect(await h.cuadra.workspaces.list({ includeArchived: true })).toEqual([]);
      const rows = await h.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
      expect(Number(rows?.n)).toBe(0);
    } finally {
      await h.driver.close();
    }
  });

  it('idas al driver por movimiento (lo que cruza postMessage en el navegador)', async () => {
    const h = await createTestCuadra({ today: ANCHOR });
    try {
      let calls = 0;
      const d = h.driver;
      const count = <T extends object>(ex: T): T =>
        new Proxy(ex, {
          get(target, prop, receiver) {
            const v = Reflect.get(target, prop, receiver) as unknown;
            if (typeof v === 'function' && ['all', 'get', 'run', 'runMany'].includes(String(prop))) {
              return (...args: unknown[]) => {
                calls += 1;
                return (v as (...a: unknown[]) => unknown).apply(target, args);
              };
            }
            return v;
          },
        });
      const original = d.transaction.bind(d);
      d.transaction = ((fn: Parameters<typeof original>[0]) => {
        calls += 2; // BEGIN y COMMIT
        return original((tx) => fn(count(tx)));
      }) as typeof d.transaction;
      for (const m of ['all', 'get', 'run', 'runMany'] as const) {
        const f = (d[m] as (...a: unknown[]) => unknown).bind(d);
        (d as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
          calls += 1;
          return f(...args);
        };
      }
      const t0 = performance.now();
      const r = await h.cuadra.demo.seed('colmado');
      const ms = performance.now() - t0;
      const perTx = calls / r.value.transactions;
      console.info(`[demo] colmado: ${r.value.transactions} movimientos, ${calls} idas al driver (${perTx.toFixed(2)} por movimiento), ${Math.round(ms)} ms`);
      expect(perTx).toBeLessThan(5);
    } finally {
      await h.driver.close();
    }
  }, 60_000);
});
