// Perfil "Estudio Creativo Brisa, SRL" (ARCHITECTURE.md 6.2, plantilla Despacho contable/cliente): el
// cliente de servicios de un contador independiente. Clientes y proveedores ficticios.
//
// Lo que deja: facturas cobradas por cliente con NCF, fecha de factura, horas y tratamiento de ITBIS (campo
// de lista propio), pagos a proveedores con su NCF, nómina, TSS, retenciones, ITBIS, software y publicidad
// con la tarjeta empresarial, caja chica con reposiciones, conciliado sí/no (nada del mes en curso) y el
// extracto de un mes del banco importado desde una hoja de Excel.
import { addDays, compareIsoDate } from '../dates';
import { Money } from '../money';
import type { IsoDate, Minor } from '../types';
import { PlanBuilder, rd } from './builder';
import {
  dayIn,
  dayOfMonth,
  lastDayOfMonth,
  monthName,
  monthStarts,
  ncf,
  planStart,
  seasonPercent,
  sortPlan,
  type DemoPlan,
  type DemoValues,
  type PlanOptions,
} from './plan';
import { createRng, percentOf, roundToUnit } from './prng';

const CLIENTES = [
  { key: 'costa_azul', label: 'Grupo Hotelero Costa Azul' },
  { key: 'cafe_montana', label: 'Café de la Montaña' },
  { key: 'ferreteria_central', label: 'Ferretería La Central' },
  { key: 'clinica_vida', label: 'Clínica Vida Plena' },
  { key: 'escuela_arcoiris', label: 'Colegio Arcoíris' },
  { key: 'panaderia_trigo', label: 'Panadería El Trigal' },
  { key: 'inmobiliaria_horizonte', label: 'Inmobiliaria Horizonte' },
  { key: 'gimnasio_impulso', label: 'Gimnasio Impulso' },
  { key: 'tienda_brisa_mar', label: 'Boutique Brisa Marina' },
  { key: 'cooperativa_valle', label: 'Cooperativa del Valle' },
  { key: 'agroindustrias_cibao', label: 'Agroindustrias del Cibao' },
] as const;

const PROVEEDORES = [
  { key: 'imprenta_caribe', label: 'Imprenta Litográfica del Caribe', d: 'Impresión de materiales', c: 'materiales', centro: 'produccion', min: 6_000, max: 38_000 },
  { key: 'sonido_bahia', label: 'Estudio de Sonido Bahía', d: 'Grabación y mezcla de audio', c: 'honorarios', centro: 'produccion', min: 8_000, max: 30_000 },
  { key: 'equipos_camaras', label: 'Alquiler de Equipos y Cámaras del Este', d: 'Alquiler de equipo de filmación', c: 'otros_gastos', centro: 'produccion', min: 5_000, max: 25_000 },
  { key: 'fotografo_libre', label: 'Fotografía Independiente Marte', d: 'Sesión de fotos para cliente', c: 'honorarios', centro: 'diseno', min: 7_000, max: 22_000 },
  { key: 'traductora', label: 'Traducciones Puente', d: 'Traducción de textos', c: 'honorarios', centro: 'comercial', min: 2_500, max: 9_000 },
  { key: 'mensajeria_rapida', label: 'Mensajería Rápida Capital', d: 'Mensajería y entregas', c: 'viaticos', centro: 'administracion', min: 800, max: 3_500 },
] as const;

const EQUIPO = [
  { who: 'directora de arte', amount: rd(75_000), centro: 'diseno' },
  { who: 'diseñador gráfico', amount: rd(48_000), centro: 'diseno' },
  { who: 'productor audiovisual', amount: rd(52_000), centro: 'produccion' },
  { who: 'ejecutiva de cuentas', amount: rd(45_000), centro: 'comercial' },
  { who: 'asistente administrativa', amount: rd(35_000), centro: 'administracion' },
] as const;

const SOFTWARE = [
  { name: 'Suite de diseño (licencias)', amount: rd(2_800), centro: 'diseno' },
  { name: 'Almacenamiento en la nube', amount: rd(650), centro: 'administracion' },
  { name: 'Gestor de proyectos', amount: rd(1_450), centro: 'produccion' },
  { name: 'Biblioteca de fotos y tipografías', amount: rd(1_900), centro: 'diseno' },
] as const;

const CAJA_CHICA = [
  { d: 'Café y agua para la oficina', c: 'materiales' },
  { d: 'Taxi a reunión con cliente', c: 'viaticos' },
  { d: 'Papelería', c: 'materiales' },
  { d: 'Mensajería', c: 'viaticos' },
  { d: 'Artículos de limpieza', c: 'otros_gastos' },
  { d: 'Almuerzo de trabajo', c: 'viaticos' },
  { d: 'Parqueo en reunión', c: 'viaticos' },
] as const;

export function planDespacho(opts: PlanOptions): DemoPlan {
  const rng = createRng(opts.seed ^ 0x5eed);
  const anchor = opts.anchor;
  const start = planStart(anchor, opts.months);
  const b = new PlanBuilder(start, anchor);

  const openings = {
    banco_operativo: { amountMinor: rd(310_000), direction: 'in' as const, date: start },
    caja_chica: { amountMinor: rd(10_000), direction: 'in' as const, date: start },
  };
  for (const [k, o] of Object.entries(openings)) b.opening(k, o);

  const months = monthStarts(start, anchor);
  /** El campo de texto "Proyecto" se deja de usar (y se desactiva) al empezar el noveno mes. */
  const proyectoUntil = months[8] ?? addDays(anchor, 1);
  const incomeByMonth = new Map<string, Minor>();
  const cardByMonth = new Map<string, Minor>();
  const pettyByMonth = new Map<string, Minor>();
  let ncfIn = 300;
  let ncfOut = 5000;

  const card = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues) => {
    if (b.tx({ account: 'tarjeta_empresarial', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'tarjeta', ...values } }) !== null) {
      const k = date.slice(0, 7);
      cardByMonth.set(k, Money.add(cardByMonth.get(k) ?? 0, amountMinor));
    }
  };

  // ── Facturas cobradas: 14–22 al mes, cobro con 0–45 días de retraso ──
  const invoicesFor = (m: IsoDate, mi: number) => {
    const invoices = rng.int(14, 22);
    for (let i = 0; i < invoices; i += 1) {
      // En el tercer mes un cliente se anotó con otro nombre ("Costa Azul Hoteles"): luego se fusiona.
      const client = mi === 2 && i < 2 ? { key: 'costa_azul_dup', label: 'Costa Azul Hoteles' } : rng.pick(CLIENTES);
      const invoiceDate = dayIn(m, rng.int(1, 28));
      const paid = addDays(invoiceDate, rng.int(0, 45));
      const amount = roundToUnit(percentOf(rng.rangeMinor(rd(12_000), rd(140_000), rd(500)), seasonPercent(invoiceDate)), rd(500));
      const servicio = rng.chance(0.9);
      const exento = client.key === 'escuela_arcoiris' || client.key === 'clinica_vida';
      const values: DemoValues = {
        categoria: servicio ? 'servicios' : 'reembolsos',
        centro_costo: rng.pick(['diseno', 'produccion', 'comercial']),
        contacto: client.key,
        metodo_pago: rng.pick(['transferencia', 'transferencia', 'cheque', 'deposito']),
        fecha_factura: invoiceDate,
        horas: rng.int(8, 120),
        itbis: exento ? 'exento' : 'gravado_18',
      };
      if (rng.chance(0.92)) values['ncf'] = ncf('B01', (ncfIn += 1));
      if (compareIsoDate(paid, proyectoUntil) < 0) values['proyecto'] = rng.pick(['Campaña de temporada', 'Identidad de marca', 'Video institucional', 'Redes sociales', 'Catálogo impreso']);
      const ref = b.tx({
        account: 'banco_operativo',
        kind: 'income',
        amountMinor: amount,
        date: paid,
        description: `${servicio ? 'Cobro de factura' : 'Reembolso de gastos'} — ${client.label}`,
        values,
      });
      if (ref !== null) incomeByMonth.set(paid.slice(0, 7), Money.add(incomeByMonth.get(paid.slice(0, 7)) ?? 0, amount));
    }
  };
  // Lo facturado el mes anterior al plan se cobra en sus primeras semanas.
  invoicesFor(addDays(months[0] ?? start, -1).slice(0, 8) + '01', -1);

  months.forEach((m, mi) => {
    const mKey = m.slice(0, 7);
    const prevKey = addDays(m, -1).slice(0, 7);

    invoicesFor(m, mi);

    // ── Gastos fijos ──
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: rd(45_000), date: dayIn(m, 1), description: 'Alquiler de la oficina', values: { categoria: 'alquiler', centro_costo: 'administracion', metodo_pago: 'transferencia', contacto: 'arrendador', ncf: ncf('B01', (ncfOut += 1)), itbis: 'gravado_18' } });
    const payroll = Money.sum(EQUIPO.map((e) => e.amount));
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: roundToUnit(percentOf(payroll, 17), rd(10)), date: dayIn(m, 3), description: 'Aportes a la seguridad social (TSS)', values: { categoria: 'tss', centro_costo: 'administracion', metodo_pago: 'debito_automatico', itbis: 'exento' } });
    for (const s of SOFTWARE) card(dayIn(m, rng.int(5, 10)), s.amount, s.name, { categoria: 'software', centro_costo: s.centro, itbis: 'gravado_18' });
    const prevIncome = incomeByMonth.get(prevKey) ?? rd(900_000);
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: Math.max(rd(100), roundToUnit(percentOf(prevIncome, 2), rd(10))), date: dayIn(m, 10), description: 'Retenciones pagadas (IR-17)', values: { categoria: 'retenciones', centro_costo: 'administracion', metodo_pago: 'transferencia', itbis: 'exento' } });
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: rng.rangeMinor(rd(4_500), rd(6_500), rd(10)), date: dayIn(m, 12), description: 'Electricidad, agua e internet', values: { categoria: 'servicios_basicos', centro_costo: 'administracion', metodo_pago: 'debito_automatico', itbis: 'gravado_18' } });
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: Math.max(rd(100), roundToUnit(percentOf(prevIncome, 6), rd(10))), date: dayIn(m, 20), description: 'ITBIS del mes anterior (IT-1)', values: { categoria: 'itbis_pagado', centro_costo: 'administracion', metodo_pago: 'transferencia', itbis: 'exento' } });
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: rd(12_000), date: dayIn(m, 25), description: 'Honorarios del contador', values: { categoria: 'honorarios', centro_costo: 'administracion', metodo_pago: 'transferencia', contacto: 'contador', ncf: ncf('B11', (ncfOut += 1)), itbis: 'gravado_18' } });
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: rd(3_800), date: dayIn(m, 4), description: 'Seguro de equipos', values: { categoria: 'seguros', centro_costo: 'administracion', metodo_pago: 'debito_automatico', itbis: 'gravado_16' } });
    for (const e of EQUIPO) {
      b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: e.amount, date: dayIn(m, 28), description: `Nómina — ${e.who}`, values: { categoria: 'nomina', centro_costo: e.centro, metodo_pago: 'transferencia', itbis: 'exento' } });
    }
    if (m.slice(5, 7) === '12') {
      for (const e of EQUIPO) {
        b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: e.amount, date: dayIn(m, 18), description: `Regalía pascual — ${e.who}`, values: { categoria: 'nomina', centro_costo: e.centro, metodo_pago: 'transferencia', itbis: 'exento' } });
      }
    }
    b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: rng.rangeMinor(rd(250), rd(600), rd(5)), date: lastDayOfMonth(m), description: 'Comisiones bancarias', values: { categoria: 'gastos_bancarios', centro_costo: 'administracion', metodo_pago: 'debito_automatico', itbis: 'exento' } });

    // ── Pagos a proveedores: 10–16 al mes, con NCF ──
    for (let i = rng.int(10, 16); i > 0; i -= 1) {
      const p = rng.pick(PROVEEDORES);
      const amount = rng.rangeMinor(rd(p.min), rd(p.max), rd(50));
      const values: DemoValues = { categoria: p.c, centro_costo: p.centro, contacto: p.key, metodo_pago: rng.pick(['transferencia', 'transferencia', 'cheque']), itbis: p.key === 'traductora' ? 'exento' : 'gravado_18' };
      if (rng.chance(0.85)) values['ncf'] = ncf(rng.chance(0.7) ? 'B01' : 'B11', (ncfOut += 1));
      const date = dayIn(m, rng.int(2, 28));
      values['fecha_factura'] = addDays(date, -rng.int(0, 20));
      b.tx({ account: 'banco_operativo', kind: 'expense', amountMinor: amount, date, description: `${p.d} — ${p.label}`, values });
    }

    // ── Variables: publicidad, viajes y mantenimiento con tarjeta ──
    for (let i = rng.int(3, 5); i > 0; i -= 1) {
      card(dayIn(m, rng.int(1, 28)), rng.rangeMinor(rd(2_000), rd(9_000), rd(50)), rng.pick(['Anuncios en redes sociales', 'Pauta en buscador', 'Impresión de material promocional']), { categoria: 'publicidad', centro_costo: 'comercial', itbis: 'gravado_18' });
    }
    if (rng.chance(0.5)) {
      card(dayIn(m, rng.int(1, 28)), rng.rangeMinor(rd(1_500), rd(7_000), rd(50)), 'Mantenimiento de equipos', { categoria: 'mantenimiento', centro_costo: 'produccion', itbis: 'gravado_18' });
    }
    if (rng.chance(0.35)) {
      card(dayIn(m, rng.int(1, 28)), rng.rangeMinor(rd(3_000), rd(12_000), rd(50)), 'Viaje a filmación en el interior (hotel y combustible)', { categoria: 'viaticos', centro_costo: 'produccion', itbis: 'gravado_18' });
    }

    // ── Pago de la tarjeta (lo del mes anterior) ──
    const due = cardByMonth.get(prevKey) ?? 0;
    if (due > 0) b.transfer({ from: 'banco_operativo', to: 'tarjeta_empresarial', amountMinor: due, date: dayIn(m, 20), description: 'Pago de la tarjeta empresarial' });

    // ── Caja chica: reposición del fondo y 18–28 gastos menores ──
    const spentPrev = pettyByMonth.get(prevKey) ?? 0;
    if (spentPrev > 0) b.transfer({ from: 'banco_operativo', to: 'caja_chica', amountMinor: spentPrev, date: dayIn(m, 2), description: 'Reposición de la caja chica' });
    let spent = 0;
    for (let i = rng.int(18, 28); i > 0; i -= 1) {
      const amount = rng.rangeMinor(rd(100), rd(450), rd(5));
      if (spent + amount > rd(9_000)) break;
      const kind = rng.pick(CAJA_CHICA);
      if (b.tx({ account: 'caja_chica', kind: 'expense', amountMinor: amount, date: dayIn(m, rng.int(3, 28)), description: kind.d, values: { categoria: kind.c, centro_costo: 'administracion', metodo_pago: 'efectivo' } }) !== null) {
        spent += amount;
      }
    }
    pettyByMonth.set(mKey, spent);
  });

  // ── Un mes histórico importado desde Excel (el extracto del banco del cuarto mes) ──
  const im = months[3];
  if (im !== undefined) {
    b.importMonth({
      account: 'banco_operativo',
      from: im,
      to: lastDayOfMonth(im),
      importedOn: addDays(lastDayOfMonth(im), 6),
      label: `Extracto del banco operativo, ${monthName(im)}`,
      fileName: `Extracto banco operativo ${monthName(im)}.xlsx`,
      preamble: ['Banco Comercial del Caribe', 'Estado de cuenta corriente n.º 0123-4567-8', `Periodo: ${monthName(im)}`],
    });
  }

  // Conciliado: sí en lo de más de 15 días, nunca en el mes actual (para que "No conciliados" muestre algo).
  b.reconcile(rng, ['banco_operativo', 'tarjeta_empresarial'], 'conciliado', Math.max(15, dayOfMonth(anchor)), 1);

  // ── Historia ──
  const taken = new Set<string>();
  const voids = b.pickTx(rng, 5, () => true, taken);
  const reasons = ['Registrado dos veces', 'Era de la tarjeta, no del banco', 'Factura anulada por el cliente', 'Monto equivocado', 'Pago devuelto'];
  voids.forEach((it, i) => b.step({ t: 'void', at: addDays(it.date, rng.int(1, 5)), ref: it.ref as string, reason: reasons[i] as string }));
  const restored = voids[voids.length - 1];
  if (restored) b.step({ t: 'restore', at: addDays(restored.date, 8), ref: restored.ref as string });

  const edits = b.pickTx(rng, 6, (it) => it.kind === 'income', taken);
  edits.forEach((it, i) => {
    const at = addDays(it.date, rng.int(1, 6));
    if (i % 2 === 0) b.step({ t: 'edit', at, ref: it.ref as string, patch: { values: { ncf: ncf('B01', 8000 + i) }, notes: 'NCF recibido después del cobro' } });
    else {
      // Descuento por pronto pago y, días después, el NCF de la nota de crédito.
      b.step({ t: 'edit', at, ref: it.ref as string, patch: { amountMinor: Money.sub(it.amountMinor, rd(500)), notes: 'Descuento por pronto pago' } });
      b.step({ t: 'edit', at: addDays(at, 2), ref: it.ref as string, patch: { values: { ncf: ncf('B04', 100 + i) }, notes: 'Descuento por pronto pago (nota de crédito B04)' } });
    }
  });
  // Un cobro que se puso en el mes equivocado: se anula y luego se restaura cuando se aclara.
  const mistaken = b.pickTx(rng, 1, (it) => it.kind === 'income', taken)[0];
  if (mistaken) {
    b.step({ t: 'void', at: addDays(mistaken.date, 2), ref: mistaken.ref as string, reason: 'El cliente dice que no ha pagado' });
    b.step({ t: 'restore', at: addDays(mistaken.date, 4), ref: mistaken.ref as string });
  }

  b.step({ t: 'merge_options', at: months[4] ?? start, field: 'contacto', source: 'costa_azul_dup', target: 'costa_azul' });
  b.step({ t: 'rename_option', at: months[6] ?? start, field: 'contacto', option: 'gimnasio_impulso', label: 'Gimnasio Impulso Fit' });
  b.step({ t: 'deactivate_field', at: proyectoUntil, field: 'proyecto' });

  return sortPlan({
    profile: 'despacho',
    templateId: 'despacho',
    workspace: { name: 'Estudio Creativo Brisa, SRL', ownerName: 'Estudio Creativo Brisa, SRL' },
    start,
    anchor,
    openings,
    extraAccounts: [],
    extraFields: [
      { key: 'proyecto', label: 'Proyecto', type: 'text', appliesTo: 'in' },
      {
        key: 'itbis',
        label: 'ITBIS',
        type: 'list',
        options: [
          { key: 'gravado_18', label: 'Gravado 18 %' },
          { key: 'gravado_16', label: 'Gravado 16 %' },
          { key: 'exento', label: 'Exento' },
        ],
      },
    ],
    extraOptions: {
      contacto: [
        ...CLIENTES.map((c) => ({ key: c.key, label: c.label })),
        { key: 'costa_azul_dup', label: 'Costa Azul Hoteles' },
        ...PROVEEDORES.map((p) => ({ key: p.key, label: p.label })),
        { key: 'arrendador', label: 'Torre Empresarial del Este' },
        { key: 'contador', label: 'Lic. Ramón Peña, contador' },
      ],
      categoria: [{ key: 'itbis_pagado', label: 'ITBIS pagado' }],
    },
    items: b.items,
    steps: b.steps,
    views: [
      {
        name: 'Facturas grandes (más de RD$ 100,000)',
        recipe: { v: 1, kind: 'filter', filter: { kinds: ['income'], amount: { min: rd(100_000) } }, columns: ['date', 'contacto', 'ncf', 'description', 'amount'], sort: { by: 'amount', dir: 'desc' } },
      },
      {
        name: 'Pagos a proveedores con NCF',
        recipe: { v: 1, kind: 'filter', filter: { kinds: ['expense'], fields: [{ fieldId: 'ncf', op: 'not_empty' }] }, columns: ['date', 'fecha_factura', 'ncf', 'contacto', 'amount'] },
      },
      {
        name: 'Ventas e ingresos por tratamiento de ITBIS',
        pinned: true,
        recipe: { v: 1, kind: 'summary', filter: { period: { preset: 'this_year' }, kinds: ['income'] }, groupBy: { by: 'field', fieldId: 'itbis' }, split: { by: 'period', unit: 'quarter' }, measure: 'in', chart: 'bars' },
      },
      {
        name: 'Horas facturadas por cliente',
        recipe: { v: 1, kind: 'summary', filter: { period: { preset: 'last_12_months' }, kinds: ['income'] }, groupBy: { by: 'field', fieldId: 'contacto' }, measure: 'in', chart: 'table' },
      },
      {
        name: 'Anexo de ITBIS del mes pasado',
        recipe: {
          v: 1,
          kind: 'report',
          form: 'detailed',
          filter: { period: { preset: 'last_month' }, fields: [{ fieldId: 'itbis', op: 'any_of', optionIds: ['gravado_18', 'gravado_16'] }] },
          sections: ['header', 'statement', 'by_field', 'movements'],
          groupByFieldIds: ['itbis', 'categoria'],
          columns: ['date', 'ncf', 'contacto', 'description', 'amount'],
          includeVoided: false,
          signature: false,
        },
      },
    ],
    backupVerifiedDaysAgo: 41,
  });
}
