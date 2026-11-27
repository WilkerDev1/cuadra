// Perfil "Mis finanzas" (plantilla Finanzas personales). Comercios ficticios y genéricos.
//
// Lo que deja: salario quincenal y regalía, alquiler, servicios, colegio, gastos diarios por categoría
// (colmado, transporte, almuerzo, supermercado, combustible, salidas), ahorro por transferencias cada
// quincena, retiros del cajero, tarjeta de crédito con su pago mensual, un viaje anotado de una vez en la
// tabla de captura y el estado de la tarjeta de un mes importado desde Excel.
import { addDays } from '../dates';
import { Money } from '../money';
import type { IsoDate, Minor } from '../types';
import { PlanBuilder, rd } from './builder';
import {
  dayIn,
  dayOfMonth,
  eachDay,
  lastDayOfMonth,
  monthName,
  monthOf,
  monthStarts,
  planStart,
  sortPlan,
  weekday,
  type DemoPlan,
  type DemoRow,
  type DemoValues,
  type PlanOptions,
} from './plan';
import { createRng } from './prng';

const COMERCIOS = [
  { key: 'super_economico', label: 'Supermercado El Económico' },
  { key: 'colmado_esquina', label: 'Colmado de la esquina' },
  { key: 'farmacia_central', label: 'Farmacia La Central' },
  { key: 'estacion_combustible', label: 'Estación de combustible La Ruta' },
  { key: 'restaurante_patio', label: 'Restaurante El Patio' },
  { key: 'tienda_hogar', label: 'Tienda Hogar y Más' },
  { key: 'colegio', label: 'Colegio San Martín' },
  { key: 'cafeteria_oficina', label: 'Cafetería frente a la oficina' },
  { key: 'super_economico_dup', label: 'Super El Economico' },
] as const;

export function planPersonal(opts: PlanOptions): DemoPlan {
  const rng = createRng(opts.seed ^ 0xfa111);
  const anchor = opts.anchor;
  const start = planStart(anchor, opts.months);
  const b = new PlanBuilder(start, anchor);

  const openings = {
    efectivo: { amountMinor: rd(3_000), direction: 'in' as const, date: start },
    cuenta: { amountMinor: rd(45_000), direction: 'in' as const, date: start },
    ahorros: { amountMinor: rd(80_000), direction: 'in' as const, date: start },
    tarjeta: { amountMinor: rd(12_000), direction: 'out' as const, date: start },
  };
  for (const [k, o] of Object.entries(openings)) b.opening(k, o);

  const months = monthStarts(start, anchor);
  const mergeAt = months[5] ?? addDays(anchor, 1);
  const cardByMonth = new Map<string, Minor>();
  const charge = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues): string | null => {
    const ref = b.tx({ account: 'tarjeta', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'tarjeta_credito', ...values } });
    if (ref !== null) cardByMonth.set(date.slice(0, 7), Money.add(cardByMonth.get(date.slice(0, 7)) ?? 0, amountMinor));
    return ref;
  };
  const cash = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues): void => {
    if (b.balanceOf('efectivo') > amountMinor + rd(200)) {
      b.tx({ account: 'efectivo', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'efectivo', ...values } });
    }
  };
  const superKey = (date: IsoDate): string => (date < mergeAt && rng.chance(0.4) ? 'super_economico_dup' : 'super_economico');

  // Un viaje anotado de una vez en la tabla de captura, con su total de control (el día antes, el retiro).
  const trip = months[Math.max(0, months.length - 4)];
  const tripDate = trip === undefined ? null : dayIn(trip, 14);
  const carRepair = dayIn(months[4] ?? start, 18);

  for (const date of eachDay(start, anchor)) {
    if (tripDate !== null && date === addDays(tripDate, -1)) {
      b.transfer({ from: 'cuenta', to: 'efectivo', amountMinor: rd(14_000), date, description: 'Retiro para el viaje' });
    }
    if (date === tripDate) {
      const rows: DemoRow[] = [
        { amountMinor: rd(2_400), description: 'Combustible del viaje', values: { categoria: 'transporte', metodo_pago: 'efectivo' } },
        { amountMinor: rd(6_800), description: 'Cabaña (una noche)', values: { categoria: 'otros_gastos', metodo_pago: 'efectivo' } },
        { amountMinor: rd(3_150), description: 'Comidas del viaje', values: { categoria: 'restaurantes', metodo_pago: 'efectivo' } },
        { amountMinor: rd(900), description: 'Entradas al parque nacional', values: { categoria: 'otros_gastos', metodo_pago: 'efectivo' } },
        { amountMinor: rd(450), description: 'Peaje', values: { categoria: 'transporte', metodo_pago: 'efectivo' } },
      ];
      b.capture({ account: 'efectivo', kind: 'expense', date, label: 'Gastos del viaje a la montaña', rows });
    }
    const dom = dayOfMonth(date);
    const wd = weekday(date);
    const workday = wd >= 1 && wd <= 5;
    const mKey = date.slice(0, 7);

    // ── Ingresos ──
    if (dom === 15 || date === dayIn(date, 30)) {
      b.tx({ account: 'cuenta', kind: 'income', amountMinor: rd(47_500), date, description: 'Salario quincenal', values: { categoria: 'salario', metodo_pago: 'transferencia' } });
    }
    if (monthOf(date) === 12 && dom === 18) {
      b.tx({ account: 'cuenta', kind: 'income', amountMinor: rd(65_000), date, description: 'Regalía pascual', values: { categoria: 'salario', metodo_pago: 'transferencia' } });
    }
    if (dom === 5) {
      b.tx({ account: 'efectivo', kind: 'income', amountMinor: rng.rangeMinor(rd(5_500), rd(6_500), rd(50)), date, description: 'Remesa de la familia', values: { categoria: 'remesas', metodo_pago: 'efectivo' } });
    }
    if (rng.chance(0.03)) {
      b.tx({ account: 'cuenta', kind: 'income', amountMinor: rng.rangeMinor(rd(3_000), rd(12_000), rd(500)), date, description: 'Trabajo por cuenta propia (diseño de un logo)', values: { categoria: 'ingresos_extra', metodo_pago: 'transferencia' } });
    }
    if (date === lastDayOfMonth(date)) {
      b.tx({ account: 'ahorros', kind: 'income', amountMinor: rng.rangeMinor(rd(80), rd(140), rd(1)), date, description: 'Intereses de la cuenta de ahorros', values: { categoria: 'intereses', metodo_pago: 'transferencia' } });
    }

    // ── Fijos ──
    if (dom === 1) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(18_000), date, description: 'Alquiler del apartamento', values: { categoria: 'vivienda', metodo_pago: 'transferencia' } });
    }
    if (dom === 8) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rng.rangeMinor(rd(2_500), rd(4_000), rd(10)), date, description: 'Luz, agua e internet', values: { categoria: 'servicios', metodo_pago: 'transferencia', vencimiento: addDays(date, 10) } });
    }
    if (dom === 9) charge(date, rd(1_500), 'Plan del teléfono', { categoria: 'telefono' });
    if (dom === 11) charge(date, rd(650), 'Plataforma de series', { categoria: 'suscripciones' });
    if (dom === 13) charge(date, rd(1_200), 'Gimnasio (mensualidad)', { categoria: 'salud' });
    if (dom === 5) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(9_200), date, description: 'Cuota del préstamo del carro', values: { categoria: 'deudas', metodo_pago: 'transferencia' } });
    }
    if (dom === 17) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(3_000), date, description: 'Ayuda a mamá', values: { categoria: 'regalos_donaciones', metodo_pago: 'transferencia' } });
    }
    // Diciembre: regalos y la cena de Nochebuena; enero: la renovación del seguro del carro.
    if (monthOf(date) === 12 && (dom === 12 || dom === 19 || dom === 22)) {
      charge(date, rng.rangeMinor(rd(3_500), rd(7_500), rd(50)), 'Regalos de Navidad', { categoria: 'regalos_donaciones', comercio: 'tienda_hogar' });
    }
    if (monthOf(date) === 12 && dom === 23) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(9_800), date, description: 'Compra para la cena de Nochebuena', values: { categoria: 'supermercado', metodo_pago: 'tarjeta_debito', comercio: 'super_economico' } });
    }
    // Un imprevisto grande: la caja de cambios del carro (con la tarjeta; se paga el mes siguiente).
    if (date === carRepair) {
      charge(date, rd(27_500), 'Reparación del carro (caja de cambios)', { categoria: 'transporte', comercio: 'estacion_combustible', imprevisto: true });
    }
    if (monthOf(date) === 1 && dom === 10) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(16_500), date, description: 'Renovación del seguro del carro', values: { categoria: 'seguro', metodo_pago: 'transferencia' } });
    }
    if (dom === 22) {
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rd(2_850), date, description: 'Seguro médico complementario', values: { categoria: 'seguro', metodo_pago: 'transferencia' } });
    }
    if (dom === 3) {
      const back = monthOf(date) === 8;
      b.tx({
        account: 'cuenta',
        kind: 'expense',
        amountMinor: back ? rd(14_500) : rd(6_500),
        date,
        description: back ? 'Inscripción y útiles escolares' : 'Mensualidad del colegio',
        values: { categoria: 'educacion', metodo_pago: 'transferencia', comercio: 'colegio' },
      });
    }

    // ── Ahorro y movimientos entre cuentas ──
    if (dom === 16 || date === dayIn(date, 30)) {
      const amount = monthOf(date) === 12 ? rd(8_000) : rd(3_000);
      if (b.balanceOf('cuenta') > amount + rd(15_000)) b.transfer({ from: 'cuenta', to: 'ahorros', amountMinor: amount, date, description: 'Ahorro de la quincena' });
    }
    if (dom === 20) {
      const due = cardByMonth.get(addDays(`${mKey}-01`, -1).slice(0, 7)) ?? 0;
      if (due > 0) b.transfer({ from: 'cuenta', to: 'tarjeta', amountMinor: due, date, description: 'Pago de la tarjeta' });
    }
    if ((wd === 6 || wd === 3) && b.balanceOf('efectivo') < rd(2_500) && b.balanceOf('cuenta') > rd(8_000)) {
      b.transfer({ from: 'cuenta', to: 'efectivo', amountMinor: rng.pick([rd(2_000), rd(3_000), rd(4_000)]), date, description: 'Retiro en el cajero' });
    }

    // ── Gastos diarios por categoría ──
    if (wd === 0) {
      const amount = rng.rangeMinor(rd(3_500), rd(7_500), rd(5));
      if (rng.chance(0.5)) charge(date, amount, 'Compra del supermercado', { categoria: 'supermercado', comercio: superKey(date) });
      else b.tx({ account: 'cuenta', kind: 'expense', amountMinor: amount, date, description: 'Compra del supermercado', values: { categoria: 'supermercado', metodo_pago: 'tarjeta_debito', comercio: superKey(date) } });
    }
    if (wd !== 0 && rng.chance(0.65)) {
      cash(date, rng.rangeMinor(rd(150), rd(900), rd(5)), rng.pick(['Colmado', 'Colmado (pan, huevos y café)', 'Colmado (refrescos y picadera)']), { categoria: 'supermercado', comercio: 'colmado_esquina' });
    }
    if (workday && rng.chance(0.85)) cash(date, rng.rangeMinor(rd(100), rd(420), rd(5)), 'Transporte del día (carro público y motoconcho)', { categoria: 'transporte' });
    if (workday && rng.chance(0.55)) {
      const amount = rng.rangeMinor(rd(250), rd(450), rd(5));
      if (rng.chance(0.5)) cash(date, amount, 'Almuerzo', { categoria: 'restaurantes', comercio: 'cafeteria_oficina' });
      else b.tx({ account: 'cuenta', kind: 'expense', amountMinor: amount, date, description: 'Almuerzo', values: { categoria: 'restaurantes', metodo_pago: 'tarjeta_debito', comercio: 'cafeteria_oficina' } });
    }
    if (rng.chance(0.09)) charge(date, rng.rangeMinor(rd(1_000), rd(2_500), rd(50)), 'Combustible', { categoria: 'transporte', comercio: 'estacion_combustible' });
    if ((wd === 5 || wd === 6) && rng.chance(0.2)) charge(date, rng.rangeMinor(rd(900), rd(3_500), rd(50)), 'Cena fuera', { categoria: 'restaurantes', comercio: 'restaurante_patio' });
    if (rng.chance(0.05)) charge(date, rng.rangeMinor(rd(450), rd(1_200), rd(25)), 'Pedido de comida a domicilio', { categoria: 'restaurantes' });
    if (wd === 6 && rng.chance(0.5)) cash(date, rd(300), 'Lavado del carro', { categoria: 'transporte' });
    if (rng.chance(0.04)) {
      const imprevisto = rng.chance(0.5);
      b.tx({ account: 'cuenta', kind: 'expense', amountMinor: rng.rangeMinor(rd(600), rd(4_500), rd(10)), date, description: imprevisto ? 'Consulta y medicinas' : 'Farmacia', values: { categoria: 'salud', metodo_pago: 'tarjeta_debito', comercio: 'farmacia_central', imprevisto } });
    }
    if (rng.chance(0.02)) charge(date, rng.rangeMinor(rd(1_200), rd(5_500), rd(50)), 'Ropa y calzado', { categoria: 'ropa' });
    if (rng.chance(0.015)) charge(date, rng.rangeMinor(rd(1_500), rd(9_000), rd(50)), 'Reparación en la casa', { categoria: 'hogar', comercio: 'tienda_hogar', imprevisto: true });

    // Si la cuenta se queda corta antes del próximo salario, se pasa algo de los ahorros.
    if (b.balanceOf('cuenta') < rd(3_000) && b.balanceOf('ahorros') > rd(20_000)) {
      b.transfer({ from: 'ahorros', to: 'cuenta', amountMinor: rd(10_000), date, description: 'Traspaso desde los ahorros' });
    }
  }

  // El estado de cuenta de la tarjeta de un mes, importado desde Excel.
  const im = months[2];
  if (im !== undefined) {
    b.importMonth({
      account: 'tarjeta',
      from: im,
      to: lastDayOfMonth(im),
      importedOn: addDays(lastDayOfMonth(im), 4),
      label: `Estado de la tarjeta, ${monthName(im)}`,
      fileName: `Estado tarjeta ${monthName(im)}.xlsx`,
      preamble: ['Tarjeta de crédito terminada en 4821', `Estado de cuenta de ${monthName(im)}`],
    });
  }
  b.reconcile(rng, ['tarjeta'], 'conciliado', 10, 0.9);

  // ── Historia ──
  const taken = new Set<string>();
  // Una cena cargada dos veces por el datáfono: el par queda para ver el aviso de posible duplicado.
  const dinner = b.pickTx(rng, 1, (it) => it.description === 'Cena fuera', taken, { to: addDays(anchor, -20) })[0];
  if (dinner) {
    const copy = b.duplicate(dinner, 0);
    if (copy !== null) taken.add(copy);
  }
  // Solo gastos: anular un salario dejaría la cuenta en negativo (y nadie lo anota dos veces).
  const voids = b.pickTx(rng, 3, (it) => it.kind === 'expense', taken);
  const reasons = ['Registrado dos veces', 'Monto equivocado', 'Era de la otra cuenta'];
  voids.forEach((it, i) => b.step({ t: 'void', at: addDays(it.date, 2), ref: it.ref as string, reason: reasons[i] as string }));
  const back = voids[0];
  if (back) b.step({ t: 'restore', at: addDays(back.date, 5), ref: back.ref as string });
  const edits = b.pickTx(rng, 5, (it) => it.kind === 'expense', taken);
  edits.forEach((it, i) => {
    b.step({
      t: 'edit',
      at: addDays(it.date, 1),
      ref: it.ref as string,
      patch: i % 2 === 0 ? { amountMinor: Money.add(it.amountMinor, rd(100)), notes: 'Corregido con el recibo' } : { values: { imprevisto: true }, notes: 'No estaba previsto' },
    });
    if (i === 0) b.step({ t: 'edit', at: addDays(it.date, 3), ref: it.ref as string, patch: { values: { categoria: 'hogar' }, notes: 'Corregido con el recibo; era para la casa' } });
  });
  b.step({ t: 'merge_options', at: mergeAt, field: 'comercio', source: 'super_economico_dup', target: 'super_economico' });
  b.step({ t: 'rename_option', at: months[7] ?? start, field: 'comercio', option: 'colmado_esquina', label: 'Colmado Don Chepe' });

  return sortPlan({
    profile: 'personal',
    templateId: 'personal',
    workspace: { name: 'Mis finanzas', ownerName: 'Mis finanzas' },
    start,
    anchor,
    openings,
    extraAccounts: [],
    extraFields: [],
    extraOptions: { comercio: COMERCIOS.map((c) => ({ key: c.key, label: c.label })) },
    items: b.items,
    steps: b.steps,
    views: [
      {
        name: 'Comida fuera de casa',
        recipe: { v: 1, kind: 'filter', filter: { period: { preset: 'last_30_days' }, fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['restaurantes'] }] }, sort: { by: 'date', dir: 'desc' } },
      },
      {
        name: 'Gastos de la tarjeta por categoría',
        pinned: true,
        recipe: { v: 1, kind: 'summary', filter: { period: { preset: 'last_12_months' }, accountIds: ['tarjeta'], kinds: ['expense'] }, groupBy: { by: 'field', fieldId: 'categoria' }, split: { by: 'period', unit: 'month' }, measure: 'out', chart: 'bars' },
      },
      {
        name: 'Colmado y transporte por mes',
        recipe: {
          v: 1,
          kind: 'summary',
          filter: { period: { preset: 'last_12_months' }, fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['supermercado', 'transporte'] }] },
          groupBy: { by: 'period', unit: 'month' },
          split: { by: 'field', fieldId: 'categoria' },
          measure: 'out',
          chart: 'line',
        },
      },
      {
        name: 'Resumen del año',
        recipe: {
          v: 1,
          kind: 'report',
          form: 'summary',
          filter: { period: { preset: 'this_year' } },
          sections: ['header', 'statement', 'by_account', 'by_field', 'transfers'],
          groupByFieldIds: ['categoria', 'comercio'],
          columns: ['date', 'description', 'account', 'amount'],
          includeVoided: false,
          signature: false,
        },
      },
    ],
    backupVerifiedDaysAgo: 41,
  });
}
