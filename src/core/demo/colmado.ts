// Perfil "Colmado La Esquina" (ARCHITECTURE.md 6.1, plantilla Negocio pequeño). Nombres de comercios y
// contactos ficticios y genéricos: ninguna marca ni persona real.
//
// Lo que deja: ventas diarias en lotes de captura con total de control (cuatro descuadres aceptados y
// anotados en el rótulo), liquidaciones de tarjeta en el banco, compras a distribuidoras, pan del día,
// gastos menores semanales en otra tabla de captura, nómina quincenal y regalía, alquiler, luz, agua,
// impuestos, depósitos Caja → Banco, pago de la tarjeta (que va en negativo) y una cuenta de ahorro que se
// cierra y se archiva. Estacionalidad: diciembre fuerte, enero flojo, agosto y quincenas al alza.
import { addDays, compareIsoDate } from '../dates';
import { Money } from '../money';
import type { IsoDate, Minor } from '../types';
import { PlanBuilder, rd, splitAmount } from './builder';
import {
  dayIn,
  dayOfMonth,
  eachDay,
  goodFriday,
  lastDayOfMonth,
  monthOf,
  monthStarts,
  ncf,
  paydayPercent,
  planStart,
  seasonPercent,
  sortPlan,
  weekday,
  type DemoPlan,
  type DemoRow,
  type DemoValues,
  type PlanOptions,
} from './plan';
import { createRng, percentOf, roundToUnit } from './prng';

const DISTRIBUIDORAS = [
  { key: 'dist_sol', label: 'Distribuidora Sol Naciente' },
  { key: 'dist_norte', label: 'Almacenes del Norte' },
  { key: 'dist_lacteos', label: 'Lácteos La Pradera' },
  { key: 'dist_bebidas', label: 'Bebidas del Valle' },
  { key: 'dist_granos', label: 'Granos y Más' },
  { key: 'dist_limpieza', label: 'Limpieza Brillante' },
] as const;

/** Turnos de la caja: rótulo, peso en la venta del día y probabilidad de que el turno tenga fila. */
const TURNOS = [
  { label: 'Ventas de la mañana', categoria: 'ventas', p: 1 },
  { label: 'Ventas del mediodía', categoria: 'ventas', p: 1 },
  { label: 'Ventas de la tarde', categoria: 'ventas', p: 1 },
  { label: 'Ventas de la noche', categoria: 'ventas', p: 0.9 },
  { label: 'Recargas y pagos de servicios', categoria: 'servicios', p: 0.95 },
  { label: 'Pedidos por delivery', categoria: 'ventas', p: 0.7 },
  { label: 'Cobro de fiados', categoria: 'cobros_credito', p: 0.5 },
  { label: 'Venta de hielo y botellones de agua', categoria: 'ventas', p: 0.6 },
] as const;

const GASTOS_MENORES = [
  { d: 'Fundas y empaques', c: 'suministros', min: 300, max: 1_200 },
  { d: 'Hielo para la nevera', c: 'suministros', min: 200, max: 600 },
  { d: 'Gasolina del motor de delivery', c: 'transporte', min: 400, max: 1_100 },
  { d: 'Reparación de la nevera exhibidora', c: 'mantenimiento', min: 800, max: 3_500 },
  { d: 'Artículos de limpieza del local', c: 'suministros', min: 250, max: 900 },
  { d: 'Bombillos y extensiones', c: 'mantenimiento', min: 300, max: 1_400 },
  { d: 'Volantes de ofertas', c: 'publicidad', min: 500, max: 1_500 },
  { d: 'Propina al motorista de delivery', c: 'otros_gastos', min: 200, max: 500 },
] as const;

const VOID_REASONS = ['Registrado dos veces', 'Monto equivocado', 'Era de la otra cuenta'] as const;

const ddmm = (d: IsoDate): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function planColmado(opts: PlanOptions): DemoPlan {
  const rng = createRng(opts.seed);
  const anchor = opts.anchor;
  const start = planStart(anchor, opts.months);
  const b = new PlanBuilder(start, anchor);

  const openings = {
    caja: { amountMinor: rd(15_000), direction: 'in' as const, date: start },
    banco: { amountMinor: rd(120_000), direction: 'in' as const, date: start },
    tarjeta: { amountMinor: rd(8_500), direction: 'out' as const, date: start },
  };
  for (const [k, o] of Object.entries(openings)) b.opening(k, o);
  const ahorroOpening = { amountMinor: rd(25_000), direction: 'in' as const, date: start };
  b.opening('ahorro_anterior', ahorroOpening);

  const months = monthStarts(start, anchor);
  /** "Unidades compradas" se deja de usar (y se desactiva) al empezar el séptimo mes. */
  const unitsUntil = months[6] ?? addDays(anchor, 1);
  /** Hasta el sexto mes la luz se anotaba con una opción duplicada "Luz"; luego se fusiona con Electricidad. */
  const luzUntil = months[5] ?? addDays(anchor, 1);

  const closed = new Set<IsoDate>();
  for (const m of months) {
    if (monthOf(m) === 1) closed.add(m);
    closed.add(goodFriday(Number(m.slice(0, 4))));
  }

  const salesByMonth = new Map<string, Minor>();
  const cardByMonth = new Map<string, Minor>();
  const days = eachDay(start, anchor);
  const mismatchDays = new Set<number>();
  while (mismatchDays.size < 4) mismatchDays.add(rng.int(20, days.length - 10));
  const dupDayIndex = rng.int(Math.floor(days.length * 0.55), Math.floor(days.length * 0.65));
  let invoice = 1200;
  let dupCapture: string | null = null;

  const chargeCard = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues) => {
    if (b.tx({ account: 'tarjeta', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'tarjeta_credito', ...values } }) !== null) {
      const k = date.slice(0, 7);
      cardByMonth.set(k, Money.add(cardByMonth.get(k) ?? 0, amountMinor));
    }
  };

  const purchase = (date: IsoDate, opts2: { cheque?: boolean; credit?: boolean } = {}) => {
    const dist = rng.pick(DISTRIBUIDORAS);
    const amount = rng.rangeMinor(rd(8_000), rd(45_000), rd(50));
    const fromCaja = !opts2.cheque && !opts2.credit && rng.chance(0.6) && b.balanceOf('caja') > amount + rd(5_000);
    const account = fromCaja ? 'caja' : 'banco';
    const values: DemoValues = {
      categoria: rng.chance(0.85) ? 'mercancia' : 'suministros',
      metodo_pago: opts2.credit ? 'credito' : opts2.cheque ? 'cheque' : fromCaja ? 'efectivo' : 'transferencia',
      contacto: dist.key,
    };
    if (rng.chance(0.6)) values['comprobante'] = ncf('B01', (invoice += 1));
    if (opts2.cheque || opts2.credit) values['vencimiento'] = addDays(date, opts2.credit ? 30 : 15);
    if (compareIsoDate(date, unitsUntil) < 0 && values['categoria'] === 'mercancia') values['unidades'] = rng.int(12, 320);
    return b.tx({
      account,
      kind: 'expense',
      amountMinor: amount,
      date,
      description: opts2.credit ? `Pago de compra a crédito — ${dist.label}` : `Compra de mercancía — ${dist.label}`,
      values,
    });
  };

  days.forEach((date, index) => {
    const wd = weekday(date);
    const dom = dayOfMonth(date);
    const mKey = date.slice(0, 7);
    const open = !closed.has(date);

    // ── Ventas del día en efectivo: un lote de captura en Caja con una fila por turno ──
    if (open) {
      let mean = rd(28_000);
      if (wd === 6) mean = percentOf(mean, 140);
      if (wd === 0) mean = percentOf(mean, 70);
      mean = percentOf(percentOf(mean, seasonPercent(date)), paydayPercent(date));
      const total = rng.normalMinor(mean, rd(5_000), rd(5));
      const turnos = TURNOS.filter((x) => x.p >= 1 || rng.chance(x.p));
      const amounts = splitAmount(rng, total, turnos.length, rd(5));
      const rows: DemoRow[] = amounts.map((amountMinor, i) => {
        const turno = turnos[i] ?? TURNOS[0];
        const movil = turno.categoria === 'servicios' && rng.chance(0.3);
        return {
          amountMinor,
          description: turno.label,
          values: { categoria: turno.categoria, metodo_pago: movil ? 'pago_movil' : 'efectivo', contacto: 'cliente_contado' },
        };
      });
      const mismatch = mismatchDays.has(index);
      const diff = mismatch ? (rng.chance(0.5) ? 1 : -1) * rng.rangeMinor(rd(50), rd(200), rd(10)) : 0;
      const note = diff > 0 ? 'faltó efectivo al cuadrar' : 'sobró efectivo al cuadrar';
      const ref = b.capture({
        account: 'caja',
        kind: 'income',
        date,
        label: mismatch ? `Ventas del ${ddmm(date)} (${note})` : `Ventas del ${ddmm(date)}`,
        rows,
        ...(mismatch ? { mismatchMinor: diff, mismatchNote: note } : {}),
      });
      if (ref !== null) salesByMonth.set(mKey, Money.add(salesByMonth.get(mKey) ?? 0, Money.sum(amounts)));
      // Un día se anotó dos veces (más tarde se anula el lote entero).
      if (index === dupDayIndex) {
        dupCapture = b.capture({
          account: 'caja',
          kind: 'income',
          date,
          label: `Ventas del ${ddmm(date)}`,
          rows: rows.map((r) => ({ ...r, values: { ...r.values } })),
          countsForBalance: false,
        });
      }

      // ── Ventas con tarjeta: la liquidación del datáfono llega al banco ──
      if (wd !== 0) {
        const card = rng.normalMinor(percentOf(percentOf(rd(5_500), seasonPercent(date)), paydayPercent(date)), rd(1_500), rd(5));
        b.tx({
          account: 'banco',
          kind: 'income',
          amountMinor: card,
          date,
          description: 'Liquidación de ventas con tarjeta',
          values: { categoria: 'ventas', metodo_pago: 'tarjeta_debito', contacto: 'cliente_contado' },
        });
      }

      // ── Pan del día para reventa, en efectivo ──
      if (wd !== 0) {
        b.tx({
          account: 'caja',
          kind: 'expense',
          amountMinor: rng.rangeMinor(rd(1_200), rd(2_400), rd(25)),
          date,
          description: 'Compra de pan para reventa — Panadería El Buen Trigo',
          values: { categoria: 'mercancia', metodo_pago: 'efectivo', contacto: 'panaderia' },
        });
      }
    }

    // ── Gastos menores de la semana: los sábados, otra tabla de captura (salidas de Caja) ──
    if (wd === 6) {
      const n = rng.int(5, 9);
      const rows: DemoRow[] = [];
      for (let i = 0; i < n; i += 1) {
        const g = rng.pick(GASTOS_MENORES);
        rows.push({ amountMinor: rng.rangeMinor(rd(g.min), rd(g.max), rd(25)), description: g.d, values: { categoria: g.c, metodo_pago: 'efectivo' } });
      }
      const sum = Money.sum(rows.map((r) => r.amountMinor));
      if (b.balanceOf('caja') > sum + rd(3_000)) {
        b.capture({ account: 'caja', kind: 'expense', date, label: `Gastos menores de la semana (${ddmm(date)})`, rows });
      }
    }

    // ── Compras de mercancía: martes, jueves y algunos lunes, viernes y sábados ──
    if (wd === 2 || wd === 4 || ((wd === 1 || wd === 5 || wd === 6) && rng.chance(0.5))) purchase(date, { cheque: wd === 4 && rng.chance(0.1) });
    if (dom === 18) purchase(date, { credit: true });

    // ── Fijos mensuales ──
    if (dom === 1) {
      b.tx({
        account: 'banco',
        kind: 'expense',
        amountMinor: rd(35_000),
        date,
        description: 'Alquiler del local',
        values: { categoria: 'alquiler', metodo_pago: 'transferencia', contacto: 'inmobiliaria', comprobante: ncf('B01', (invoice += 1)) },
      });
    }
    if (dom === 6) {
      const beforeMerge = compareIsoDate(date, luzUntil) < 0;
      b.tx({
        account: 'banco',
        kind: 'expense',
        amountMinor: percentOf(rng.rangeMinor(rd(7_500), rd(12_000), rd(50)), monthOf(date) >= 6 && monthOf(date) <= 9 ? 120 : 100),
        date: addDays(date, rng.int(0, 2)),
        description: 'Factura de electricidad',
        values: { categoria: beforeMerge ? 'luz' : 'electricidad', metodo_pago: 'transferencia', comprobante: ncf('B14', (invoice += 1)) },
      });
    }
    if (dom === 10) {
      b.tx({ account: 'caja', kind: 'expense', amountMinor: rng.rangeMinor(rd(600), rd(900), rd(50)), date, description: 'Agua potable (factura del mes)', values: { categoria: 'agua', metodo_pago: 'efectivo' } });
    }
    if (dom === 12) chargeCard(date, rd(2_300), 'Internet y teléfono del local', { categoria: 'internet' });
    if (dom === 20) {
      const prev = salesByMonth.get(addDays(`${mKey}-01`, -1).slice(0, 7)) ?? salesByMonth.get(mKey) ?? rd(800_000);
      b.tx({
        account: 'banco',
        kind: 'expense',
        amountMinor: Math.max(rd(100), roundToUnit(percentOf(prev, 4), rd(100))),
        date,
        description: 'Pago de impuestos (anticipo e ITBIS)',
        values: { categoria: 'impuestos', metodo_pago: 'transferencia' },
      });
    }
    if (dom === 28) {
      b.tx({ account: 'banco', kind: 'expense', amountMinor: rd(6_000), date, description: 'Honorarios del contador', values: { categoria: 'contador', metodo_pago: 'transferencia', contacto: 'contador_externo' } });
    }
    if (date === lastDayOfMonth(date)) {
      b.tx({ account: 'banco', kind: 'expense', amountMinor: rng.rangeMinor(rd(150), rd(350), rd(5)), date, description: 'Comisiones bancarias', values: { categoria: 'comisiones', metodo_pago: 'transferencia' } });
    }
    if (dom === 14 || date === lastDayOfMonth(date)) {
      b.tx({ account: 'banco', kind: 'expense', amountMinor: rng.rangeMinor(rd(25_000), rd(40_000), rd(500)), date, description: 'Retiro del dueño', values: { categoria: 'retiro_dueno', metodo_pago: 'transferencia' } });
    }
    if (dom === 15) {
      b.tx({ account: 'banco', kind: 'expense', amountMinor: rd(45_000), date, description: 'Cuota del préstamo de la nevera industrial', values: { categoria: 'pago_prestamo', metodo_pago: 'transferencia' } });
    }

    // ── Nómina quincenal (y regalía pascual en diciembre) ──
    if (dom === 15 || date === dayIn(date, 30)) {
      const q = dom === 15 ? '1.ª' : '2.ª';
      for (const [who, amount] of [['despachador', rd(9_500)], ['cajera', rd(8_000)], ['motorista de delivery', rd(7_000)]] as const) {
        const cash = b.balanceOf('caja') > amount + rd(2_000);
        b.tx({
          account: cash ? 'caja' : 'banco',
          kind: 'expense',
          amountMinor: amount,
          date,
          description: `Nómina ${q} quincena — ${who}`,
          values: { categoria: 'nomina', metodo_pago: cash ? 'efectivo' : 'transferencia' },
        });
      }
    }
    if (monthOf(date) === 12 && dom === 20) {
      for (const [who, amount] of [['despachador', rd(19_000)], ['cajera', rd(16_000)], ['motorista de delivery', rd(14_000)]] as const) {
        b.tx({ account: 'banco', kind: 'expense', amountMinor: amount, date, description: `Regalía pascual — ${who}`, values: { categoria: 'nomina', metodo_pago: 'transferencia' } });
      }
    }

    // ── Gastos con tarjeta: 4–8 al mes ──
    if (rng.chance(0.2)) {
      const fuel = rng.chance(0.6);
      const amount = fuel ? rng.rangeMinor(rd(1_500), rd(3_500), rd(50)) : rng.rangeMinor(rd(800), rd(4_000), rd(50));
      chargeCard(
        date,
        amount,
        fuel ? 'Combustible de la camioneta' : rng.pick(['Fundas y empaques al por mayor', 'Bombillos y extensiones', 'Papel para la caja registradora']),
        { categoria: fuel ? 'transporte' : 'suministros' },
      );
    }

    // ── Transferencias: depósitos lunes y jueves (≈ 70 % del efectivo), pago de la tarjeta el 25 ──
    if (wd === 1 || wd === 4) {
      const cash = b.balanceOf('caja');
      const amount = cash > rd(5_000) ? roundToUnit(percentOf(cash, 70), rd(1_000)) : 0;
      if (amount > 0 && amount < cash) b.transfer({ from: 'caja', to: 'banco', amountMinor: amount, date, description: 'Depósito del efectivo en el banco' });
    }
    if (dom === 25) {
      // Se paga lo del mes anterior: la tarjeta siempre debe algo (saldo negativo con su aviso).
      const due = cardByMonth.get(addDays(`${mKey}-01`, -1).slice(0, 7)) ?? rd(4_000);
      b.transfer({ from: 'banco', to: 'tarjeta', amountMinor: due, date, description: 'Pago de la tarjeta de crédito' });
    }
  });

  // ── Cuenta de ahorro anterior: intereses, cierre y archivo ──
  const m2 = months[1] ?? start;
  const m3 = months[2] ?? start;
  b.tx({ account: 'ahorro_anterior', kind: 'income', amountMinor: rd(85), date: dayIn(m2, 3), description: 'Intereses de la cuenta de ahorro', values: { categoria: 'otros_ingresos', metodo_pago: 'transferencia' } });
  b.transfer({ from: 'ahorro_anterior', to: 'banco', amountMinor: b.balanceOf('ahorro_anterior'), date: dayIn(m3, 5), description: 'Cierre de la cuenta de ahorro anterior' });
  b.step({ t: 'archive_account', at: dayIn(m3, 6), account: 'ahorro_anterior' });

  // ── Posibles duplicados: dos compras anotadas otra vez al día siguiente; una se anula, la otra queda ──
  const taken = new Set<string>();
  const dupBase = b.pickTx(rng, 2, (it) => it.account === 'banco' && it.description.startsWith('Compra de mercancía'), taken);
  dupBase.forEach((orig, i) => {
    const copy = b.duplicate(orig, 1);
    if (copy === null) return;
    taken.add(copy);
    if (i === 0) b.step({ t: 'void', at: addDays(orig.date, 3), ref: copy, reason: 'Registrado dos veces' });
  });

  b.reconcile(rng, ['banco', 'tarjeta'], 'conciliado', 10, 0.85);

  // ── Historia: anulados con motivo, uno restaurado, ediciones (algunas con varios cambios) ──
  const voids = b.pickTx(rng, 6, (it) => it.account !== 'ahorro_anterior', taken);
  voids.forEach((it, i) => {
    b.step({ t: 'void', at: addDays(it.date, rng.int(1, 4)), ref: it.ref as string, reason: VOID_REASONS[i % VOID_REASONS.length] as string });
  });
  const restored = voids[voids.length - 1];
  if (restored) b.step({ t: 'restore', at: addDays(restored.date, 6), ref: restored.ref as string });

  const edits = b.pickTx(rng, 10, (it) => it.account !== 'ahorro_anterior' && !it.description.startsWith('Factura de electricidad'), taken);
  edits.forEach((it, i) => {
    const at = addDays(it.date, rng.int(1, 5));
    const ref = it.ref as string;
    switch (i % 5) {
      case 0:
        b.step({ t: 'edit', at, ref, patch: { amountMinor: Money.add(it.amountMinor, rd(rng.pick([50, 100, 250]))), notes: 'Se corrigió el monto según la factura' } });
        break;
      case 1:
        b.step({ t: 'edit', at, ref, patch: { description: `${it.description} (con factura)`, values: { comprobante: ncf('B01', 9000 + i) } } });
        break;
      case 2:
        b.step({ t: 'edit', at, ref, patch: { notes: 'Pagado por adelantado; confirmar con el proveedor' } });
        break;
      case 3:
        b.step({ t: 'edit', at, ref, patch: { date: addDays(it.date, -1), notes: 'La fecha real era el día anterior' } });
        break;
      default:
        b.step({ t: 'edit', at, ref, patch: { values: { categoria: it.kind === 'expense' ? 'otros_gastos' : 'otros_ingresos' }, notes: 'Reclasificado' } });
    }
  });
  // Tres compras con historial largo: monto, luego comprobante y vencimiento, luego una nota.
  const longEdits = b.pickTx(rng, 3, (it) => it.description.startsWith('Compra de mercancía') && it.account === 'banco', taken);
  for (const it of longEdits) {
    const ref = it.ref as string;
    b.step({ t: 'edit', at: addDays(it.date, 1), ref, patch: { amountMinor: Money.sub(it.amountMinor, rd(500)), notes: 'Devolución de mercancía dañada' } });
    b.step({ t: 'edit', at: addDays(it.date, 3), ref, patch: { values: { comprobante: ncf('B01', (invoice += 1)), metodo_pago: 'cheque', vencimiento: addDays(it.date, 15) } } });
    b.step({ t: 'edit', at: addDays(it.date, 5), ref, patch: { notes: 'Devolución de mercancía dañada; nota de crédito recibida' } });
  }

  if (dupCapture !== null) b.step({ t: 'void_batch', at: addDays(days[dupDayIndex] as IsoDate, 1), ref: dupCapture, reason: 'Día duplicado' });
  b.step({ t: 'merge_options', at: luzUntil, field: 'categoria', source: 'luz', target: 'electricidad' });
  b.step({ t: 'rename_option', at: months[4] ?? start, field: 'contacto', option: 'dist_norte', label: 'Almacenes del Norte, SRL' });
  b.step({ t: 'deactivate_field', at: unitsUntil, field: 'unidades' });

  return sortPlan({
    profile: 'colmado',
    templateId: 'negocio',
    workspace: { name: 'Colmado La Esquina', ownerName: 'Colmado La Esquina' },
    start,
    anchor,
    openings,
    extraAccounts: [{ key: 'ahorro_anterior', name: 'Cuenta de ahorro anterior', type: 'savings', icon: 'PiggyBank', opening: ahorroOpening }],
    extraFields: [{ key: 'unidades', label: 'Unidades compradas', type: 'number', appliesTo: 'out' }],
    extraOptions: {
      contacto: [
        ...DISTRIBUIDORAS.map((d) => ({ key: d.key, label: d.label })),
        { key: 'panaderia', label: 'Panadería El Buen Trigo' },
        { key: 'inmobiliaria', label: 'Inmobiliaria Los Pinos' },
        { key: 'contador_externo', label: 'Servicios Contables del Este' },
      ],
      categoria: [{ key: 'luz', label: 'Luz' }],
    },
    items: b.items,
    steps: b.steps,
    views: [
      {
        name: 'Compras a Almacenes del Norte',
        recipe: { v: 1, kind: 'filter', filter: { kinds: ['expense'], fields: [{ fieldId: 'contacto', op: 'any_of', optionIds: ['dist_norte'] }] }, sort: { by: 'date', dir: 'desc' } },
      },
      { name: 'Anulados', recipe: { v: 1, kind: 'filter', filter: { status: 'voided' }, sort: { by: 'date', dir: 'desc' } } },
      {
        name: 'Gastos grandes del año (más de RD$ 20,000)',
        recipe: { v: 1, kind: 'filter', filter: { period: { preset: 'this_year' }, kinds: ['expense'], amount: { min: rd(20_000) } }, sort: { by: 'amount', dir: 'desc' } },
      },
      {
        name: 'Gastos fijos por mes',
        pinned: true,
        recipe: {
          v: 1,
          kind: 'summary',
          filter: { period: { preset: 'last_12_months' }, fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['alquiler', 'electricidad', 'agua', 'internet', 'nomina'] }] },
          groupBy: { by: 'period', unit: 'month' },
          split: { by: 'field', fieldId: 'categoria' },
          measure: 'out',
          chart: 'bars',
        },
      },
      {
        name: 'Ventas por mes',
        recipe: { v: 1, kind: 'summary', filter: { period: { preset: 'last_12_months' }, kinds: ['income'] }, groupBy: { by: 'period', unit: 'month' }, measure: 'in', chart: 'line' },
      },
      {
        name: 'Informe del trimestre para el banco',
        recipe: {
          v: 1,
          kind: 'report',
          form: 'custom',
          filter: { period: { preset: 'last_quarter' } },
          sections: ['header', 'statement', 'by_account', 'by_field', 'transfers', 'signature'],
          groupByFieldIds: ['categoria', 'contacto'],
          columns: ['date', 'description', 'account', 'amount'],
          includeVoided: false,
          signature: true,
        },
      },
    ],
    backupVerifiedDaysAgo: 41,
  });
}
