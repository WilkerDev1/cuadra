import { describe, expect, it } from 'vitest';
import { readLedgerSearch } from '../../../app/data/txFilterUrl';
import { movementsHref } from './links';
import {
  balanceLine,
  bucketFilter,
  bucketRanges,
  buildBuckets,
  dayTicks,
  grainFor,
  isWeekend,
  bucketDays,
  bucketMonth,
  monthStarts,
  periodChart,
  previousLine,
  type DayPoint,
} from './buckets';

const day = (date: string, inMinor = 0, outMinor = 0, balanceMinor = 0, count = 0): DayPoint => ({
  date,
  inMinor,
  outMinor,
  netMinor: inMinor - outMinor,
  balanceMinor,
  count,
});

/** Días [from, to] con entradas de 100 y saldo que crece 100 al día desde `opening`. */
function days(from: string, to: string, opening = 0): DayPoint[] {
  const out: DayPoint[] = [];
  let run = opening;
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    run += 100;
    out.push(day(d.toISOString().slice(0, 10), 100, 0, run, 1));
  }
  return out;
}

describe('granularidad por periodo', () => {
  it('mes → día, trimestre → semana, año y 12 meses → mes', () => {
    expect(grainFor('2026-11-01', '2026-11-30')).toBe('day');
    expect(grainFor('2026-02-01', '2026-02-28')).toBe('day');
    expect(grainFor('2026-10-01', '2026-12-31')).toBe('week');
    expect(grainFor('2026-01-01', '2026-12-31')).toBe('month');
    expect(grainFor('2025-12-01', '2026-11-30')).toBe('month');
  });
});

describe('cubos del periodo', () => {
  it('mes: un cubo por día', () => {
    const r = bucketRanges('2026-11-01', '2026-11-30', 'day');
    expect(r).toHaveLength(30);
    expect(r[0]).toEqual({ key: '2026-11-01', from: '2026-11-01', to: '2026-11-01' });
    expect(r.at(-1)?.key).toBe('2026-11-30');
  });
  it('trimestre: semanas de lunes a domingo recortadas al periodo, sin huecos ni solapes', () => {
    const r = bucketRanges('2026-10-01', '2026-12-31', 'week');
    expect(r).toHaveLength(14);
    expect(r[0]).toEqual({ key: '2026-10-01', from: '2026-10-01', to: '2026-10-04' }); // jueves a domingo
    expect(r[1]).toEqual({ key: '2026-10-05', from: '2026-10-05', to: '2026-10-11' });
    expect(r.at(-1)).toEqual({ key: '2026-12-28', from: '2026-12-28', to: '2026-12-31' });
    for (let i = 1; i < r.length; i++) {
      const prevTo = new Date(`${r[i - 1]!.to}T12:00:00Z`);
      prevTo.setUTCDate(prevTo.getUTCDate() + 1);
      expect(r[i]!.from).toBe(prevTo.toISOString().slice(0, 10));
    }
    // Un trimestre que empieza en lunes: 13 semanas.
    expect(bucketRanges('2024-01-01', '2024-03-31', 'week')).toHaveLength(13);
  });
  it('año y 12 meses: un cubo por mes', () => {
    const y = bucketRanges('2026-01-01', '2026-12-31', 'month');
    expect(y.map((b) => b.key)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`));
    expect(y[1]).toEqual({ key: '2026-02', from: '2026-02-01', to: '2026-02-28' });
    const m12 = bucketRanges('2025-12-01', '2026-11-30', 'month');
    expect(m12[0]?.key).toBe('2025-12');
    expect(m12.at(-1)?.key).toBe('2026-11');
  });
});

describe('agregación de los días en cubos', () => {
  it('mes en curso: días hasta hoy con datos; los futuros quedan vacíos (sin cero ni saldo)', () => {
    const b = buildBuckets(bucketRanges('2026-11-01', '2026-11-30', 'day'), days('2026-11-01', '2026-11-27', 1000), '2026-11-27', 1000);
    expect(b).toHaveLength(30);
    expect(b[0]).toMatchObject({ inMinor: 100, outMinor: 0, netMinor: 100, count: 1, closeMinor: 1100, future: false, current: false });
    expect(b[26]).toMatchObject({ key: '2026-11-27', closeMinor: 3700, future: false, current: true });
    expect(b[27]).toMatchObject({ key: '2026-11-28', closeMinor: null, future: true, inMinor: 0, count: 0 });
  });
  it('semanas y meses suman sus días; el cierre es el del último día con dato', () => {
    const ds = days('2026-10-01', '2026-11-27', 0);
    const w = buildBuckets(bucketRanges('2026-10-01', '2026-12-31', 'week'), ds, '2026-11-27', 0);
    expect(w[0]).toMatchObject({ inMinor: 400, count: 4, closeMinor: 400 });
    const cur = w.find((x) => x.current);
    expect(cur).toMatchObject({ from: '2026-11-23', inMinor: 500, closeMinor: ds.at(-1)!.balanceMinor });
    expect(w.filter((x) => x.future).every((x) => x.closeMinor === null)).toBe(true);
    const m = buildBuckets(bucketRanges('2026-01-01', '2026-12-31', 'month'), days('2026-01-01', '2026-11-27', 0), '2026-11-27', 0);
    expect(m[0]).toMatchObject({ inMinor: 3100, closeMinor: 3100 });
    expect(m[10]).toMatchObject({ key: '2026-11', inMinor: 2700, current: true });
    expect(m[11]).toMatchObject({ key: '2026-12', future: true, closeMinor: null });
    // Las sumas de los cubos son las del periodo: nada se pierde al agrupar.
    expect(m.reduce((s, x) => s + x.inMinor, 0)).toBe(331 * 100);
  });
  it('periodo sin movimientos: cubos en cero y saldo plano en la apertura', () => {
    const quiet = ['2025-09-01', '2025-09-02'].map((d) => day(d, 0, 0, 0));
    const b = buildBuckets(bucketRanges('2025-09-01', '2025-09-02', 'day'), quiet, '2026-11-27', 0);
    expect(b.every((x) => x.inMinor === 0 && x.outMinor === 0 && x.closeMinor === 0 && !x.future)).toBe(true);
  });
  it('movimientos con fecha posterior a hoy: cuentan en su cubo (programados), sin mover el cierre de hoy', () => {
    // Hasta hoy (27) +100 al día; el 29 entran 5 000 más.
    const ds = [...days('2026-11-01', '2026-11-27', 1000), day('2026-11-29', 5000, 0, 3700 + 5000, 1)];
    const b = buildBuckets(bucketRanges('2026-11-01', '2026-11-30', 'day'), ds, '2026-11-27', 1000);
    expect(b[26]).toMatchObject({ closeMinor: 3700, endMinor: 3700, pending: false, current: true });
    expect(b[27]).toMatchObject({ future: true, pending: false, inMinor: 0, closeMinor: null, endMinor: 3700 });
    expect(b[28]).toMatchObject({ future: true, pending: true, inMinor: 5000, count: 1, closeMinor: null, endMinor: 8700 });
    expect(b[29]).toMatchObject({ future: true, pending: false, endMinor: 8700 });
    // Lo que suman los cubos es lo que suman los días: igual que los totales del periodo.
    expect(b.reduce((s, x) => s + x.inMinor, 0)).toBe(ds.reduce((s, x) => s + x.inMinor, 0));
    // La semana en curso (23–29 nov) incluye el 29 en sus barras, pero su cierre en la línea sigue siendo el de hoy.
    const w = buildBuckets(bucketRanges('2026-10-01', '2026-12-31', 'week'), ds, '2026-11-27', 1000);
    const cur = w.find((x) => x.current)!;
    expect(cur).toMatchObject({ from: '2026-11-23', to: '2026-11-29', inMinor: 500 + 5000, count: 6, closeMinor: 3700, endMinor: 8700, pending: true });
  });
  it('un día pasado sin dato (fuera de la serie) arrastra el último saldo conocido', () => {
    const b = buildBuckets(bucketRanges('2026-11-01', '2026-11-03', 'day'), [day('2026-11-02', 0, 50, 950, 1)], '2026-11-27', 1000);
    expect(b.map((x) => x.closeMinor)).toEqual([1000, 950, 950]);
  });
});

describe('línea de saldo', () => {
  it('arranca en la apertura y sigue con el cierre de cada cubo; el futuro queda en null', () => {
    const b = buildBuckets(bucketRanges('2026-11-01', '2026-11-30', 'day'), days('2026-11-01', '2026-11-03', 1000), '2026-11-03', 1000);
    const line = balanceLine(1000, b);
    expect(line).toHaveLength(31);
    expect(line.slice(0, 5)).toEqual([1000, 1100, 1200, 1300, null]);
  });
  it('comparación: el periodo anterior con la misma rejilla, alineado por posición y recortado', () => {
    // Octubre (31 días) frente a noviembre (30 cubos): 31 valores (apertura + 30 cierres).
    const prev = { openingMinor: 500, balances: days('2026-10-01', '2026-10-31', 500).map((d) => ({ date: d.date, balanceMinor: d.balanceMinor })) };
    const line = previousLine(prev, { from: '2026-10-01', to: '2026-10-31' }, 'day', 30);
    expect(line.values).toHaveLength(31);
    expect(line.values[0]).toBe(500);
    expect(line.values[30]).toBe(500 + 30 * 100);
    expect(line.ranges[0]?.from).toBe('2026-10-01');
    // Semanas del trimestre anterior y meses del año anterior.
    const q = previousLine(
      { openingMinor: 0, balances: days('2026-07-01', '2026-09-30').map((d) => ({ date: d.date, balanceMinor: d.balanceMinor })) },
      { from: '2026-07-01', to: '2026-09-30' },
      'week',
      14,
    );
    expect(q.values).toHaveLength(15);
    expect(q.values[1]).toBe(500); // 1–5 jul
    expect(previousLine(null, { from: '2026-07-01', to: '2026-09-30' }, 'week', 14).values).toEqual([]);
  });
});

describe('ejes', () => {
  it('fin de semana', () => {
    expect(isWeekend('2026-11-28')).toBe(true); // sábado
    expect(isWeekend('2026-11-29')).toBe(true);
    expect(isWeekend('2026-11-30')).toBe(false);
  });
  it('días rotulados: el 1, los lunes y hoy, sin que se pisen', () => {
    const r = bucketRanges('2026-11-01', '2026-11-30', 'day');
    // 1 nov es domingo: el lunes 2 se cae por estar pegado al 1.
    expect(dayTicks(r, null)).toEqual([0, 8, 15, 22, 29]);
    // Hoy (27) manda: el lunes 23 queda a cuatro días y se conserva; el 30 está pegado a hoy y se cae.
    expect(dayTicks(r, '2026-11-27')).toEqual([0, 8, 15, 22, 26]);
    // Hoy martes 24: se cae el lunes 23 y vuelve el 30.
    expect(dayTicks(r, '2026-11-24')).toEqual([0, 8, 15, 23, 29]);
    // Hoy fuera del periodo (un mes pasado): no cuenta.
    expect(dayTicks(r, '2026-12-05')).toEqual([0, 8, 15, 22, 29]);
  });
  it('inicio de cada mes en una rejilla de semanas: la semana con la mayoría de sus días en el mes nuevo', () => {
    // T4 2026: «26 oct – 1 nov» es de octubre (6 días); «30 nov – 6 dic» ya es de diciembre (6 de 7 días).
    const r = bucketRanges('2026-10-01', '2026-12-31', 'week');
    expect(monthStarts(r)).toEqual([0, 5, 9]);
    expect(r[9]).toMatchObject({ from: '2026-11-30', to: '2026-12-06' });
    expect(r.map(bucketMonth).slice(8, 10)).toEqual(['2026-11', '2026-12']);
    // T3 2026: «27 jul – 2 ago» es de julio (5 días); «31 ago – 6 sept» es de septiembre, no de agosto.
    const q3 = bucketRanges('2026-07-01', '2026-09-30', 'week');
    expect(monthStarts(q3)).toEqual([0, 5, 9]);
    expect(q3[9]).toMatchObject({ from: '2026-08-31', to: '2026-09-06' });
    // Días y meses: el mes de su inicio.
    expect(bucketMonth({ key: '2026-11', from: '2026-11-01', to: '2026-11-30' })).toBe('2026-11');
  });
  it('días que cubre cada cubo (semanas parciales al borde del trimestre)', () => {
    const r = bucketRanges('2026-10-01', '2026-12-31', 'week');
    expect(bucketDays(r[0]!)).toBe(4);
    expect(bucketDays(r[1]!)).toBe(7);
    expect(bucketDays(r.at(-1)!)).toBe(4);
  });
});

describe('enlace de un cubo a Movimientos', () => {
  it('abre exactamente el día, la semana o el mes', () => {
    const read = (href: string) => readLedgerSearch(new URLSearchParams(href.split('?')[1] ?? ''), { period: { preset: 'this_month' } }).filter;
    const dayHref = movementsHref('ws', bucketFilter({ from: '2026-11-03', to: '2026-11-03' }));
    expect(read(dayHref)).toMatchObject({ period: { from: '2026-11-03', to: '2026-11-03' } });
    expect([...(read(dayHref).kinds ?? [])].sort()).toEqual(['expense', 'income']);
    const weekHref = movementsHref('ws', bucketFilter({ from: '2026-10-01', to: '2026-10-04' }));
    expect(read(weekHref)).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-04' } });
  });
});

describe('gráficas de un resultado del panel', () => {
  it('mes en curso con comparación del mes anterior', () => {
    const c = periodChart({
      today: '2026-11-27',
      period: { from: '2026-11-01', to: '2026-11-30' },
      previousPeriod: { from: '2026-10-01', to: '2026-10-31', label: 'octubre 2026' },
      daily: days('2026-11-01', '2026-11-27', 1000),
      dailyOpeningMinor: 1000,
      previousDaily: { openingMinor: 500, balances: days('2026-10-01', '2026-10-31', 500).map((d) => ({ date: d.date, balanceMinor: d.balanceMinor })) },
    });
    expect(c.grain).toBe('day');
    expect(c.buckets).toHaveLength(30);
    expect(c.line).toHaveLength(31);
    expect(c.lastIndex).toBe(27);
    expect(c.today).toBe('2026-11-27');
    expect(c.prev?.values).toHaveLength(31);
    expect(c.prev?.label).toBe('octubre 2026');
    expect(c.prev?.start).toBe(0);
    expect(c.quiet).toBe(false);
  });
  it('un mes pasado: sin hoy; sin periodo anterior no hay comparación', () => {
    const c = periodChart({
      today: '2026-11-27',
      period: { from: '2025-09-01', to: '2025-09-30' },
      previousPeriod: null,
      daily: days('2025-09-01', '2025-09-30').map((d) => ({ ...d, inMinor: 0, count: 0, balanceMinor: 0 })),
      dailyOpeningMinor: 0,
      previousDaily: null,
    });
    expect(c.today).toBeNull();
    expect(c.lastIndex).toBe(30);
    expect(c.prev).toBeNull();
    expect(c.quiet).toBe(true);
  });
  it('comparación con un periodo anterior en que aún no había datos: se traza desde el último cero', () => {
    const year = (since: string) =>
      periodChart({
        today: '2026-11-27',
        period: { from: '2026-01-01', to: '2026-12-31' },
        previousPeriod: { from: '2025-01-01', to: '2025-12-31', label: '2025' },
        daily: days('2026-01-01', '2026-11-27', 5000),
        dailyOpeningMinor: 5000,
        previousDaily: { openingMinor: 0, balances: days('2025-01-01', '2025-12-31').map((d) => ({ date: d.date, balanceMinor: d.date < since ? 0 : 5000 })) },
      });
    // Apertura + ene…abr en cero; mayo (índice 5) es el primer cierre con saldo: la línea empieza ahí.
    expect(year('2025-05-01').prev?.start).toBe(5);
    // Si solo cubre un tramo corto (oct–dic: 3 de 13 posiciones), no se dibuja: prometería una comparación que no hay.
    expect(year('2025-10-01').prev).toBeNull();
    const none = periodChart({
      today: '2026-11-27',
      period: { from: '2026-11-01', to: '2026-11-30' },
      previousPeriod: { from: '2026-10-01', to: '2026-10-31', label: 'octubre 2026' },
      daily: days('2026-11-01', '2026-11-27'),
      dailyOpeningMinor: 0,
      previousDaily: { openingMinor: 0, balances: days('2026-10-01', '2026-10-31').map((d) => ({ date: d.date, balanceMinor: 0 })) },
    });
    expect(none.prev).toBeNull();
  });
  it('programados: las barras suman todo el periodo y la línea sigue punteada hasta el último programado', () => {
    const daily = [...days('2026-11-01', '2026-11-27', 1000), day('2026-11-28', 0, 0, 3700), day('2026-11-29', 5000, 0, 8700, 1)];
    const c = periodChart({
      today: '2026-11-27',
      period: { from: '2026-11-01', to: '2026-11-30' },
      previousPeriod: null,
      daily,
      dailyOpeningMinor: 1000,
      previousDaily: null,
    });
    expect(c.buckets.reduce((s, b) => s + b.inMinor, 0)).toBe(2700 + 5000);
    expect(c.lastIndex).toBe(27); // la línea sólida acaba en hoy
    // Desde hoy (posición 27) hasta el cierre del 29 (posición 29).
    expect(c.projection).toEqual({ start: 27, values: [3700, 3700, 8700] });
    // Sin programados no hay proyección; con uno en la semana en curso, llega al cierre de la semana siguiente.
    expect(periodChart({ ...base(), daily: days('2026-11-01', '2026-11-27', 1000) }).projection).toBeNull();
    const q = periodChart({ ...base(), period: { from: '2026-10-01', to: '2026-12-31' }, daily: [...days('2026-10-01', '2026-11-27', 1000), day('2026-11-29', 5000, 0, 1000 + 5800 + 5000, 1)] });
    expect(q.grain).toBe('week');
    expect(q.projection?.values).toEqual([6800, 11800]);
  });
});

function base() {
  return {
    today: '2026-11-27',
    period: { from: '2026-11-01', to: '2026-11-30' },
    previousPeriod: null,
    daily: [] as DayPoint[],
    dailyOpeningMinor: 1000,
    previousDaily: null,
  };
}
