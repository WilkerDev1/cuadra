// Perfil "Iglesia Camino de Luz" (plantilla Organización): una iglesia mediana sin fines de lucro. Nombre,
// proveedores y contactos ficticios y genéricos: ninguna iglesia, denominación, persona ni marca real.
//
// Lo que deja: el conteo de diezmos y ofrendas en un lote con total de control cada domingo, miércoles
// (culto de oración) y sábado (culto de jóvenes), con tres conteos descuadrados anotados y uno anulado por
// duplicado; diezmos y donaciones por transferencia; depósitos Caja → Banco y de lo pro-templo al fondo de
// construcción, que paga la obra por etapas; alquiler del local, luz, agua, internet, sustento pastoral y
// personal, misiones, aporte a la red de iglesias, ayudas sociales y becas, escuela dominical, sonido,
// limpieza, transporte y caja chica. Actividades: retiro de Semana Santa, campamento de jóvenes, ventas de
// comida pro-templo, aniversario, Día del Pastor y Navidad. Estacionalidad: diciembre fuerte, enero flojo,
// vacaciones de verano algo más flojas y los domingos tras la quincena con más diezmos. Un mes del banco
// llega importado desde Excel.
import { addDays, compareIsoDate } from '../dates';
import { Money } from '../money';
import type { IsoDate, Minor } from '../types';
import { PlanBuilder, rd } from './builder';
import {
  dayIn,
  dayOfMonth,
  easterSunday,
  eachDay,
  goodFriday,
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
import { createRng, percentOf, roundToUnit } from './prng';

/** Año de fundación (ficticio): el aniversario de septiembre cuenta desde aquí. */
const FOUNDED = 2011;

const MINISTERIOS = [
  { key: 'general', label: 'Administración general' },
  { key: 'jovenes', label: 'Jóvenes' },
  { key: 'damas', label: 'Damas' },
  { key: 'caballeros', label: 'Caballeros' },
  { key: 'ninos', label: 'Niños y escuela dominical' },
  { key: 'alabanza', label: 'Alabanza' },
  { key: 'misiones', label: 'Misiones' },
  { key: 'accion_social', label: 'Acción social' },
  // Duplicado que alguien creó los primeros meses: luego se fusiona con «Jóvenes».
  { key: 'juvenil_dup', label: 'Ministerio juvenil' },
] as const;

const CULTOS = [
  { key: 'dominical', label: 'Culto dominical' },
  { key: 'oracion', label: 'Culto de oración (miércoles)' },
  { key: 'jovenes', label: 'Culto de jóvenes (sábado)' },
  { key: 'especial', label: 'Culto especial' },
  { key: 'retiro', label: 'Retiro' },
  { key: 'campamento', label: 'Campamento' },
  { key: 'venta', label: 'Venta de comida' },
  { key: 'aniversario', label: 'Aniversario' },
  { key: 'navidad', label: 'Navidad' },
] as const;

const CONTACTOS = [
  { key: 'miembros', label: 'Miembro de la congregación', appliesTo: 'in' as const },
  { key: 'comercio_amigo', label: 'Comercio amigo del barrio', appliesTo: 'in' as const },
  { key: 'arrendador', label: 'Inmobiliaria Las Palmas', appliesTo: 'out' as const },
  { key: 'ferreteria', label: 'Ferretería y Materiales El Progreso', appliesTo: 'out' as const },
  { key: 'constructora', label: 'Constructora Roca Firme', appliesTo: 'out' as const },
  { key: 'sonido_armonia', label: 'Sonido y Luces Armonía', appliesTo: 'out' as const },
  { key: 'libreria', label: 'Librería y Papelería Los Pinos', appliesTo: 'out' as const },
  { key: 'campamento', label: 'Campamento Las Colinas', appliesTo: 'out' as const },
  { key: 'transporte', label: 'Transporte Ruta Feliz', appliesTo: 'out' as const },
  { key: 'obra_misionera', label: 'Obra misionera del Suroeste', appliesTo: 'out' as const },
  { key: 'red_iglesias', label: 'Red de iglesias del sector', appliesTo: 'out' as const },
  { key: 'fumigadora', label: 'Fumigadora Hogar Limpio', appliesTo: 'out' as const },
] as const;

const AYUDAS = [
  { d: 'Compra de alimentos para una familia necesitada', min: 1_500, max: 4_500 },
  { d: 'Ayuda para medicinas de un hermano enfermo', min: 1_000, max: 5_000 },
  { d: 'Ayuda para pagar la luz de una familia', min: 1_200, max: 3_000 },
  { d: 'Ayuda para el alquiler de una madre soltera', min: 2_500, max: 6_000 },
  { d: 'Pasaje y comida para un hermano que fue al hospital', min: 600, max: 1_800 },
  { d: 'Leche y pañales para un recién nacido de la comunidad', min: 900, max: 2_500 },
] as const;

const MANTENIMIENTO = [
  'Reparación de abanicos de techo',
  'Plomería del baño del templo',
  'Bombillos y extensiones',
  'Cerradura nueva del salón de la escuela dominical',
  'Pintura para retocar el frente del local',
] as const;

const ETAPAS = ['zapatas y columnas', 'muros y vigas', 'techo del salón principal', 'pisos y terminaciones'] as const;

const VOID_REASONS = ['Registrado dos veces', 'Monto equivocado', 'Era de la caja chica, no de la caja', 'Parecía que la transferencia no había salido'] as const;

const ddmm = (d: IsoDate): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Ofrendas y diezmos por temporada (%): diciembre fuerte, enero flojo, julio y agosto de vacaciones. */
function givingPercent(iso: IsoDate): number {
  const m = monthOf(iso);
  if (m === 12) return 130;
  if (m === 1) return 78;
  if (m === 7 || m === 8) return 92;
  return 100;
}

/** El domingo (o miércoles) justo después de cobrar la quincena se recogen más diezmos. */
function titheDayPercent(iso: IsoDate): number {
  const d = dayOfMonth(iso);
  return (d >= 15 && d <= 18) || d >= 30 || d <= 3 ? 125 : 100;
}

/** n-ésimo `wd` (0 = domingo) del mes de `iso`; n = -1 → el último. */
function nthWeekday(iso: IsoDate, wd: number, n: number): IsoDate {
  if (n === -1) {
    let d = lastDayOfMonth(iso);
    while (weekday(d) !== wd) d = addDays(d, -1);
    return d;
  }
  let d = `${iso.slice(0, 8)}01`;
  while (weekday(d) !== wd) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

export function planIglesia(opts: PlanOptions): DemoPlan {
  const rng = createRng(opts.seed ^ 0x1915);
  const anchor = opts.anchor;
  const start = planStart(anchor, opts.months);
  const b = new PlanBuilder(start, anchor);

  const openings = {
    caja: { amountMinor: rd(6_000), direction: 'in' as const, date: start },
    banco: { amountMinor: rd(210_000), direction: 'in' as const, date: start },
    caja_chica: { amountMinor: rd(5_000), direction: 'in' as const, date: start },
  };
  for (const [k, o] of Object.entries(openings)) b.opening(k, o);
  const fondoOpening = { amountMinor: rd(260_000), direction: 'in' as const, date: start };
  b.opening('fondo_construccion', fondoOpening);

  const months = monthStarts(start, anchor);
  const mergeAt = months[5] ?? addDays(anchor, 1);
  const days = eachDay(start, anchor);
  const sundays = days.filter((d) => weekday(d) === 0);
  const wednesdays = days.filter((d) => weekday(d) === 3);
  const mismatch = new Set<IsoDate>();
  while (mismatch.size < Math.min(3, sundays.length - 6)) mismatch.add(sundays[rng.int(3, sundays.length - 3)] as IsoDate);
  const dupWednesday = wednesdays[rng.int(Math.floor(wednesdays.length * 0.55), Math.floor(wednesdays.length * 0.65))];
  let dupCapture: string | null = null;

  /** Etapas de la obra: el quinto, el noveno y el decimotercer mes, día 10. */
  const stageDays = [4, 8, 12].flatMap((i) => (months[i] === undefined ? [] : [dayIn(months[i] as IsoDate, 10)]));

  let recibo = 340;
  let donacion = 80;
  const R = (): string => `R-${String((recibo += 1)).padStart(5, '0')}`;
  /** Recibo en el 85 % de los gastos (la vista «Gastos sin recibo» muestra el resto). */
  const withRecibo = (v: DemoValues, p = 0.85): DemoValues => (rng.chance(p) ? { ...v, recibo: R() } : v);
  const ministerio = (key: string, date: IsoDate): string =>
    key === 'jovenes' && compareIsoDate(date, mergeAt) < 0 && rng.chance(0.4) ? 'juvenil_dup' : key;

  /** Lo pro-templo contado en Caja que aún no se ha depositado en la cuenta del fondo. */
  let proTemplo: Minor = 0;
  const titheByMonth = new Map<string, Minor>();
  const missionsByMonth = new Map<string, Minor>();
  const addTo = (m: Map<string, Minor>, date: IsoDate, v: Minor) => m.set(date.slice(0, 7), Money.add(m.get(date.slice(0, 7)) ?? 0, v));
  const prevMonth = (date: IsoDate): string => addDays(`${date.slice(0, 8)}01`, -1).slice(0, 7);

  /** Salida del banco; si no alcanza (dejando un colchón), no se hace. */
  const bank = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues): string | null => {
    if (b.balanceOf('banco') - amountMinor < rd(15_000)) return null;
    return b.tx({ account: 'banco', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'transferencia', ...values } });
  };
  /** Salida en efectivo de Caja; si la caja no alcanza, se paga con la tarjeta de débito de la cuenta bancaria. */
  const cash = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues): string | null => {
    if (b.balanceOf('caja') - amountMinor >= rd(500)) {
      return b.tx({ account: 'caja', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'efectivo', ...values } });
    }
    return bank(date, amountMinor, description, { metodo_pago: 'tarjeta', ...values });
  };
  /** Gasto menor de la caja chica (si no alcanza, de Caja). */
  const petty = (date: IsoDate, amountMinor: Minor, description: string, values: DemoValues): string | null => {
    if (b.balanceOf('caja_chica') - amountMinor >= 0) {
      return b.tx({ account: 'caja_chica', kind: 'expense', amountMinor, date, description, values: { metodo_pago: 'efectivo', ...values } });
    }
    return cash(date, amountMinor, description, values);
  };
  const capture = (date: IsoDate, label: string, rows: DemoRow[], extra: { mismatchMinor?: Minor; mismatchNote?: string; countsForBalance?: boolean } = {}) => {
    const ref = b.capture({ account: 'caja', kind: 'income', date, label, rows, ...extra });
    if (ref !== null && extra.countsForBalance !== false) {
      for (const r of rows) {
        if (r.values['fondo'] === 'construccion') proTemplo = Money.add(proTemplo, r.amountMinor);
        if (r.values['categoria'] === 'diezmos') addTo(titheByMonth, date, r.amountMinor);
        if (r.values['fondo'] === 'misiones') addTo(missionsByMonth, date, r.amountMinor);
      }
    }
    return ref;
  };
  const row = (amountMinor: Minor, description: string, values: DemoValues): DemoRow => ({
    amountMinor,
    description,
    values: { metodo_pago: 'efectivo', fondo: 'general', ...values },
  });

  // ── Calendario de actividades ──
  const easters = new Set(months.map((m) => easterSunday(Number(m.slice(0, 4)))));
  const holy = (date: IsoDate) => {
    const e = easterSunday(Number(date.slice(0, 4)));
    return { easter: e, palm: addDays(e, -7), monday: addDays(e, -6), thursday: addDays(e, -3), friday: goodFriday(Number(date.slice(0, 4))) };
  };
  const anniversary = (date: IsoDate): IsoDate => {
    let d = `${date.slice(0, 4)}-09-13`;
    while (weekday(d) !== 0) d = addDays(d, 1);
    return d;
  };
  const campStart = (date: IsoDate): IsoDate => nthWeekday(`${date.slice(0, 4)}-07-01`, 4, 3);
  /** Ventas de comida pro-templo: segundo sábado de febrero, junio, octubre y diciembre, y el sábado antes de Ramos. */
  const foodSale = (date: IsoDate): 'locrio' | 'pasteles' | 'habichuelas' | null => {
    if (weekday(date) !== 6) return null;
    if (date === addDays(holy(date).palm, -1)) return 'habichuelas';
    const m = monthOf(date);
    if (![2, 6, 10, 12].includes(m) || date !== nthWeekday(date, 6, 2)) return null;
    return m === 12 ? 'pasteles' : 'locrio';
  };

  for (const date of days) {
    const wd = weekday(date);
    const dom = dayOfMonth(date);
    const m = monthOf(date);
    const season = givingPercent(date);
    const hw = holy(date);
    const isEaster = easters.has(date);
    const isAnniversary = date === anniversary(date);
    const camp = campStart(date);
    const sale = foodSale(date);

    // ── Ingresos en Caja: el conteo de cada culto, en un lote con total de control ──
    if (wd === 0) {
      const tithes = rng.normalMinor(percentOf(percentOf(percentOf(rd(44_000), season), titheDayPercent(date)), isEaster ? 110 : 100), rd(6_500), rd(50));
      const inSobre = roundToUnit(percentOf(tithes, rng.int(72, 85)), rd(50));
      let attendance = rng.int(205, 255);
      if (isEaster) attendance = percentOf(attendance, 145);
      else if (isAnniversary) attendance = percentOf(attendance, 150);
      else attendance = percentOf(attendance, m === 12 ? 112 : m === 1 ? 85 : m === 7 || m === 8 ? 92 : 100);
      const offering = rng.normalMinor(percentOf(percentOf(rd(13_500), season), isEaster ? 140 : 100), rd(2_200), rd(5));
      const rows: DemoRow[] = [
        row(inSobre, 'Diezmos en sobre', { categoria: 'diezmos', ministerio: 'general', culto: 'dominical' }),
        row(Money.sub(tithes, inSobre), 'Diezmos sin sobre', { categoria: 'diezmos', ministerio: 'general', culto: 'dominical' }),
        row(offering, isEaster ? 'Ofrenda del Domingo de Resurrección' : 'Ofrenda general', { categoria: 'ofrendas', ministerio: 'general', culto: isEaster ? 'especial' : 'dominical', asistentes: attendance }),
        row(rng.rangeMinor(rd(900), rd(2_200), rd(5)), 'Ofrenda de la escuela dominical', { categoria: 'ofrendas', ministerio: 'ninos', culto: 'dominical', asistentes: rng.int(38, 62) }),
      ];
      if (rng.chance(0.95)) rows.push(row(rng.normalMinor(rd(5_500), rd(1_500), rd(5)), 'Ofrenda pro-templo', { categoria: 'ofrendas', fondo: 'construccion', ministerio: 'general', culto: 'dominical' }));
      if (date === nthWeekday(date, 0, 1)) {
        rows.push(row(rng.rangeMinor(rd(4_000), rd(8_000), rd(5)), 'Ofrenda misionera (primer domingo)', { categoria: 'ofrendas', fondo: 'misiones', ministerio: 'misiones', culto: 'dominical' }));
      }
      if (date === nthWeekday(date, 0, -1)) {
        rows.push(row(rng.rangeMinor(rd(1_500), rd(3_500), rd(5)), 'Ofrenda de la sociedad de damas', { categoria: 'ofrendas', ministerio: 'damas', culto: 'dominical' }));
      }
      // En diciembre se recoge aparte para las canastas navideñas.
      if (m === 12) {
        rows.push(row(rng.rangeMinor(rd(5_000), rd(9_000), rd(5)), 'Ofrenda para las canastas navideñas', { categoria: 'ofrendas', fondo: 'ayuda_social', ministerio: 'accion_social', culto: 'navidad' }));
      }
      // Inscripciones del retiro los dos domingos antes de Ramos.
      if (date === addDays(hw.palm, -7) || date === addDays(hw.palm, -14)) {
        const inscritos = rng.int(22, 34);
        rows.push(row(rd(1_500) * inscritos, 'Inscripciones del retiro de Semana Santa', { categoria: 'actividades', ministerio: 'general', culto: 'retiro', fecha_actividad: hw.thursday, asistentes: inscritos }));
      }
      if (isAnniversary) {
        const n = Number(date.slice(0, 4)) - FOUNDED;
        rows.push(row(rng.rangeMinor(rd(38_000), rd(52_000), rd(50)), `Ofrenda especial del ${n}.º aniversario`, { categoria: 'ofrendas', fondo: 'construccion', ministerio: 'general', culto: 'aniversario', fecha_actividad: date }));
      }
      // Día del Pastor: segundo domingo de octubre; se le entrega al día siguiente.
      if (m === 10 && date === nthWeekday(date, 0, 2)) {
        rows.push(row(rng.rangeMinor(rd(28_000), rd(40_000), rd(50)), 'Ofrenda de amor al pastor (Día del Pastor)', { categoria: 'ofrendas', ministerio: 'general', culto: 'especial' }));
      }
      const off = mismatch.has(date);
      const diff = off ? (rng.chance(0.5) ? 1 : -1) * rng.rangeMinor(rd(50), rd(300), rd(10)) : 0;
      const note = `diferencia de RD$ ${Money.format(Math.abs(diff), { locale: 'es-DO', currency: { code: 'DOP', minorDigits: 2 }, display: 'none' }).replace(/\.00$/, '')} con el acta de conteo`;
      capture(date, off ? `Conteo del culto dominical ${ddmm(date)} (${note})` : `Conteo del culto dominical ${ddmm(date)}`, rows, off ? { mismatchMinor: diff, mismatchNote: note } : {});
    }
    if (wd === 3) {
      const special = m === 12 && (dom === 24 || dom === 31);
      if (!special) {
        const rows: DemoRow[] = [
          row(rng.normalMinor(percentOf(percentOf(rd(8_000), season), titheDayPercent(date)), rd(1_800), rd(50)), 'Diezmos del culto de oración', { categoria: 'diezmos', ministerio: 'general', culto: 'oracion' }),
          row(rng.normalMinor(percentOf(rd(4_200), season), rd(900), rd(5)), 'Ofrenda del culto de oración', { categoria: 'ofrendas', ministerio: 'general', culto: 'oracion', asistentes: rng.int(58, 95) }),
        ];
        const label = `Conteo del culto de oración ${ddmm(date)}`;
        capture(date, label, rows);
        if (date === dupWednesday) {
          dupCapture = capture(date, label, rows.map((r) => ({ ...r, values: { ...r.values } })), { countsForBalance: false });
        }
      }
    }
    if (wd === 6) {
      const rows: DemoRow[] = [row(rng.rangeMinor(rd(1_200), rd(3_200), rd(5)), 'Ofrenda del culto de jóvenes', { categoria: 'ofrendas', ministerio: ministerio('jovenes', date), culto: 'jovenes', asistentes: rng.int(24, 55) })];
      // Inscripciones del campamento: los sábados de las seis semanas antes.
      if (compareIsoDate(date, addDays(camp, -42)) >= 0 && compareIsoDate(date, camp) < 0) {
        rows.push(row(rd(1_800) * rng.int(4, 8), 'Inscripciones del campamento de jóvenes', { categoria: 'actividades', ministerio: ministerio('jovenes', date), culto: 'campamento', fecha_actividad: camp }));
      }
      capture(date, `Conteo del culto de jóvenes ${ddmm(date)}`, rows);
    }
    if (date === hw.friday) {
      capture(date, `Conteo del culto de Viernes Santo ${ddmm(date)}`, [
        row(rng.rangeMinor(rd(6_000), rd(9_500), rd(5)), 'Ofrenda del culto de Viernes Santo', { categoria: 'ofrendas', ministerio: 'general', culto: 'especial', asistentes: rng.int(150, 190) }),
      ]);
    }
    if (m === 12 && dom === 24) {
      capture(date, `Conteo del culto de Nochebuena ${ddmm(date)}`, [
        row(rng.rangeMinor(rd(9_000), rd(14_000), rd(50)), 'Diezmos de Nochebuena', { categoria: 'diezmos', ministerio: 'general', culto: 'navidad' }),
        row(rng.rangeMinor(rd(16_000), rd(24_000), rd(5)), 'Ofrenda de Navidad', { categoria: 'ofrendas', ministerio: 'general', culto: 'navidad', asistentes: rng.int(260, 310) }),
      ]);
    }
    if (m === 12 && dom === 31) {
      capture(date, `Conteo de la vigilia de fin de año ${ddmm(date)}`, [
        row(rng.rangeMinor(rd(7_000), rd(12_000), rd(50)), 'Diezmos de la vigilia de fin de año', { categoria: 'diezmos', ministerio: 'general', culto: 'especial' }),
        row(rng.rangeMinor(rd(12_000), rd(18_000), rd(5)), 'Ofrenda de acción de gracias', { categoria: 'ofrendas', ministerio: 'general', culto: 'especial', asistentes: rng.int(180, 230) }),
      ]);
    }
    if (sale !== null) {
      const dish = sale === 'pasteles' ? 'Pasteles en hoja' : sale === 'habichuelas' ? 'Habichuelas con dulce' : 'Platos de locrio';
      const v = { categoria: 'actividades', fondo: 'construccion', ministerio: 'damas', culto: 'venta', fecha_actividad: date };
      const rows: DemoRow[] = [
        row(rng.rangeMinor(rd(14_000), rd(26_000), rd(25)), `${dish} (Venta de comida pro-templo)`, v),
        row(rng.rangeMinor(rd(3_000), rd(6_000), rd(25)), 'Jugos y refrescos', v),
        row(rng.rangeMinor(rd(2_500), rd(5_500), rd(25)), 'Postres y dulces', v),
      ];
      if (rng.chance(0.6)) rows.push(row(rng.rangeMinor(rd(4_000), rd(9_000), rd(25)), 'Rifa de una canasta', v));
      capture(date, `Venta de comida pro-templo ${ddmm(date)}`, rows);
    }

    // ── Ingresos en el banco y en la cuenta del fondo ──
    const quincena = (dom >= 15 && dom <= 17) || dom >= 30 || dom <= 2;
    if (rng.chance(quincena ? 0.7 : 0.15)) {
      const amount = roundToUnit(percentOf(rng.rangeMinor(rd(1_500), rd(12_000), rd(100)), season), rd(100));
      b.tx({ account: 'banco', kind: 'income', amountMinor: amount, date, description: 'Diezmo por transferencia', values: { categoria: 'diezmos', fondo: 'general', ministerio: 'general', contacto: 'miembros', metodo_pago: 'transferencia' } });
      addTo(titheByMonth, date, amount);
    }
    if (rng.chance(0.045)) {
      const anon = rng.chance(0.5);
      b.tx({
        account: 'fondo_construccion',
        kind: 'income',
        amountMinor: rng.rangeMinor(rd(5_000), rd(35_000), rd(500)),
        date,
        description: anon ? 'Donación anónima pro-templo' : 'Donación pro-templo por transferencia',
        values: { categoria: 'donaciones', fondo: 'construccion', ministerio: 'general', contacto: anon ? 'anonimo' : rng.pick(['miembros', 'comercio_amigo']), metodo_pago: 'transferencia', recibo: `D-${String((donacion += 1)).padStart(4, '0')}` },
      });
    }
    if (rng.chance(0.015)) {
      b.tx({ account: 'banco', kind: 'income', amountMinor: rng.rangeMinor(rd(3_000), rd(15_000), rd(500)), date, description: 'Donación para la ayuda social', values: { categoria: 'donaciones', fondo: 'ayuda_social', ministerio: 'accion_social', contacto: rng.pick(['anonimo', 'comercio_amigo']), metodo_pago: 'deposito' } });
    }
    if (date === lastDayOfMonth(date)) {
      b.tx({ account: 'fondo_construccion', kind: 'income', amountMinor: rng.rangeMinor(rd(250), rd(600), rd(5)), date, description: 'Intereses de la cuenta del fondo', values: { categoria: 'otros_ingresos', fondo: 'construccion', metodo_pago: 'transferencia' } });
    }

    // ── Gastos fijos del mes ──
    if (dom === 1) bank(date, rd(60_000), 'Alquiler del local', withRecibo({ categoria: 'alquiler', fondo: 'general', ministerio: 'general', contacto: 'arrendador' }, 1));
    if (dom === 3) bank(date, rd(3_500), 'Beca escolar de un estudiante de la comunidad', { categoria: 'ayuda_social', fondo: 'becas', ministerio: 'accion_social' });
    if (dom === 5) {
      const prev = prevMonth(date);
      const tithe = titheByMonth.get(prev) ?? rd(260_000);
      const send = roundToUnit(Money.add(percentOf(tithe, 10), missionsByMonth.get(prev) ?? rd(5_000)), rd(100));
      bank(date, send, 'Envío mensual a la obra misionera del Suroeste', withRecibo({ categoria: 'misiones', fondo: 'misiones', ministerio: 'misiones', contacto: 'obra_misionera' }, 0.9));
      bank(date, roundToUnit(percentOf(tithe, 5), rd(100)), 'Aporte mensual a la red de iglesias del sector', withRecibo({ categoria: 'aportes', fondo: 'general', ministerio: 'general', contacto: 'red_iglesias' }, 0.9));
    }
    if (dom === 7) {
      const summer = m >= 6 && m <= 9 ? 125 : 100;
      bank(date, roundToUnit(percentOf(rng.rangeMinor(rd(13_500), rd(18_500), rd(10)), summer), rd(10)), 'Factura de electricidad', withRecibo({ categoria: 'servicios_basicos', fondo: 'general', ministerio: 'general' }, 1));
    }
    if (dom === 9) petty(date, rng.rangeMinor(rd(1_150), rd(1_450), rd(5)), 'Factura del agua', withRecibo({ categoria: 'servicios_basicos', fondo: 'general', ministerio: 'general' }, 1));
    if (dom === 11) bank(date, rd(3_200), 'Internet del templo (transmisión de los cultos)', withRecibo({ categoria: 'servicios_basicos', fondo: 'general', ministerio: 'general' }, 1));
    if (dom === 12) petty(date, rng.rangeMinor(rd(1_800), rd(3_200), rd(25)), 'Artículos de limpieza del templo', withRecibo({ categoria: 'limpieza', fondo: 'general', ministerio: 'general' }));
    if (dom === 14) petty(date, rng.rangeMinor(rd(1_200), rd(2_800), rd(25)), 'Materiales de la escuela dominical', withRecibo({ categoria: 'materiales', fondo: 'general', ministerio: 'ninos', contacto: 'libreria' }));
    if (dom === 15 || date === dayIn(date, 30)) {
      bank(date, rd(42_500), `Sustento pastoral (${dom === 15 ? '1.ª' : '2.ª'} quincena)`, { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
    }
    if (date === dayIn(date, 30)) {
      bank(date, rd(24_000), 'Salario de la secretaria', { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
      bank(date, rd(17_000), 'Salario del conserje', { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
      bank(date, rd(10_000), 'Honorario del director de alabanza', { categoria: 'salarios', fondo: 'general', ministerio: 'alabanza' });
    }
    if (date === lastDayOfMonth(date)) bank(date, rng.rangeMinor(rd(180), rd(320), rd(5)), 'Comisiones bancarias', { categoria: 'comisiones', fondo: 'general', ministerio: 'general' });
    if ([1, 4, 7, 10].includes(m) && dom === 20) bank(date, rd(9_800), 'Lecciones de la escuela dominical (trimestre)', withRecibo({ categoria: 'materiales', fondo: 'general', ministerio: 'ninos', contacto: 'libreria' }, 1));
    if ([3, 6, 9, 12].includes(m) && dom === 22) cash(date, rd(4_500), 'Fumigación del local', withRecibo({ categoria: 'mantenimiento', fondo: 'general', ministerio: 'general', contacto: 'fumigadora' }));
    if (wd === 0 && date === nthWeekday(date, 0, 1)) petty(date, rng.rangeMinor(rd(450), rd(700), rd(5)), 'Pan y jugo para la Santa Cena', { categoria: 'materiales', fondo: 'general', ministerio: 'general', culto: 'dominical' });

    // ── Gastos variables ──
    if (rng.chance(0.17)) {
      const a = rng.pick(AYUDAS);
      const amount = rng.rangeMinor(rd(a.min), rd(a.max), rd(50));
      const v = { categoria: 'ayuda_social', fondo: 'ayuda_social', ministerio: 'accion_social' };
      if (amount <= rd(1_500)) petty(date, amount, a.d, v);
      else cash(date, amount, a.d, v);
    }
    if (rng.chance(0.05)) cash(date, rng.rangeMinor(rd(900), rd(2_800), rd(25)), 'Cuerdas, baquetas y baterías para los micrófonos', { categoria: 'sonido', fondo: 'general', ministerio: 'alabanza' });
    if (rng.chance(0.06)) petty(date, rng.rangeMinor(rd(300), rd(900), rd(25)), 'Pasajes para visitas a enfermos', { categoria: 'transporte', fondo: 'general', ministerio: 'general' });
    if (rng.chance(0.03)) cash(date, rng.rangeMinor(rd(800), rd(4_500), rd(50)), rng.pick(MANTENIMIENTO), withRecibo({ categoria: 'mantenimiento', fondo: 'general', ministerio: 'general' }));
    if (wd === 6 && rng.chance(0.3)) cash(date, rng.rangeMinor(rd(600), rd(1_400), rd(25)), 'Merienda del culto de jóvenes', { categoria: 'eventos', fondo: 'general', ministerio: ministerio('jovenes', date), culto: 'jovenes' });
    // Compras grandes de sonido que no son de todos los meses.
    if (date === dayIn(months[3] ?? anchor, 18)) bank(date, rd(14_500), 'Reparación de la consola de sonido', withRecibo({ categoria: 'sonido', fondo: 'general', ministerio: 'alabanza', contacto: 'sonido_armonia' }, 1));
    if (date === dayIn(months[6] ?? anchor, 16)) bank(date, rd(48_000), 'Teclado nuevo para la alabanza', withRecibo({ categoria: 'sonido', fondo: 'general', ministerio: 'alabanza', contacto: 'sonido_armonia' }, 1));
    if (date === dayIn(months[9] ?? anchor, 12)) bank(date, rd(26_000), 'Dos micrófonos inalámbricos', withRecibo({ categoria: 'sonido', fondo: 'general', ministerio: 'alabanza', contacto: 'sonido_armonia' }, 1));
    if (date === dayIn(months[10] ?? anchor, 8)) bank(date, rd(18_000), 'Pintura del salón de la escuela dominical', withRecibo({ categoria: 'mantenimiento', fondo: 'general', ministerio: 'ninos', contacto: 'ferreteria' }, 1));

    // ── Actividades y temporadas ──
    // Los ingredientes de cada venta de comida se compran el día antes.
    if (foodSale(addDays(date, 1)) !== null) {
      cash(date, rng.rangeMinor(rd(8_000), rd(12_000), rd(50)), 'Ingredientes para la Venta de comida pro-templo', { categoria: 'eventos', fondo: 'construccion', ministerio: 'damas', culto: 'venta', fecha_actividad: addDays(date, 1) });
    }
    if (date === hw.monday) bank(date, rd(52_000), 'Alquiler de la casa de retiro (retiro de Semana Santa)', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'general', culto: 'retiro', contacto: 'campamento', fecha_actividad: hw.thursday }, 1));
    if (date === hw.thursday) {
      bank(date, rng.rangeMinor(rd(28_000), rd(34_000), rd(50)), 'Comida del retiro de Semana Santa', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'general', culto: 'retiro', contacto: 'proveedor_ocasional', fecha_actividad: date }));
      bank(date, rd(16_000), 'Transporte del retiro de Semana Santa (dos autobuses)', withRecibo({ categoria: 'transporte', fondo: 'general', ministerio: 'general', culto: 'retiro', contacto: 'transporte', fecha_actividad: date }, 1));
    }
    if (date === addDays(camp, -14)) bank(date, rd(13_500), 'Camisetas del campamento de jóvenes', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: ministerio('jovenes', date), culto: 'campamento', fecha_actividad: camp }, 1));
    if (date === camp) {
      const v = { fondo: 'general', ministerio: 'jovenes', culto: 'campamento', fecha_actividad: camp };
      bank(date, rd(68_000), 'Alquiler del campamento de jóvenes', withRecibo({ ...v, categoria: 'eventos', contacto: 'campamento' }, 1));
      bank(date, rng.rangeMinor(rd(33_000), rd(39_000), rd(50)), 'Comida del campamento de jóvenes', withRecibo({ ...v, categoria: 'eventos' }));
      bank(date, rd(19_000), 'Transporte del campamento de jóvenes', withRecibo({ ...v, categoria: 'transporte', contacto: 'transporte' }, 1));
    }
    if (date === addDays(anniversary(date), -1)) cash(date, rd(9_000), 'Decoración del templo para el aniversario', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'general', culto: 'aniversario', fecha_actividad: addDays(date, 1) }));
    if (isAnniversary) {
      const v = { fondo: 'general', ministerio: 'general', culto: 'aniversario', fecha_actividad: date };
      bank(date, rng.rangeMinor(rd(35_000), rd(41_000), rd(50)), 'Almuerzo del aniversario', withRecibo({ ...v, categoria: 'eventos' }));
      bank(date, rd(12_000), 'Ofrenda al predicador invitado del aniversario', { ...v, categoria: 'eventos' });
      bank(date, rd(8_500), 'Alquiler de carpa y sillas para el aniversario', withRecibo({ ...v, categoria: 'eventos', contacto: 'proveedor_ocasional' }, 1));
    }
    if (m === 10 && wd === 1 && addDays(date, -1) === nthWeekday(date, 0, 2)) {
      const it = b.items.find((x) => x.t === 'capture' && x.date === addDays(date, -1));
      const gift = it?.t === 'capture' ? it.rows.find((r) => r.description.startsWith('Ofrenda de amor al pastor'))?.amountMinor : undefined;
      if (gift !== undefined) bank(date, gift, 'Entrega de la ofrenda de amor al pastor', { categoria: 'salarios', fondo: 'general', ministerio: 'general', culto: 'especial' });
    }
    if (m === 5 && date === addDays(nthWeekday(date, 0, -1), -1)) cash(date, rd(12_000), 'Regalos para las madres (Día de las Madres)', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'damas', culto: 'especial' }));
    if (m === 7 && date === addDays(nthWeekday(date, 0, -1), -1)) cash(date, rd(8_000), 'Desayuno de los caballeros (Día de los Padres)', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'caballeros', culto: 'especial' }));
    if (m === 8 && dom === 10) bank(date, rd(18_000), 'Útiles escolares para niños de la comunidad', withRecibo({ categoria: 'ayuda_social', fondo: 'ayuda_social', ministerio: 'ninos' }));
    if (m === 1 && date === nthWeekday(date, 6, 2)) bank(date, rd(15_000), 'Retiro de planificación de los líderes', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'general', culto: 'retiro', fecha_actividad: date }));
    if (m === 12) {
      if (dom === 13) bank(date, rd(14_000), 'Cantata de Navidad: vestuario y decoración', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'alabanza', culto: 'navidad', fecha_actividad: addDays(date, 7) }));
      if (dom === 18) {
        bank(date, rd(24_000), 'Regalía pascual de la secretaria', { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
        bank(date, rd(17_000), 'Regalía pascual del conserje', { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
        bank(date, rd(42_500), 'Aguinaldo navideño del pastor', { categoria: 'salarios', fondo: 'general', ministerio: 'general' });
      }
      if (dom === 20) bank(date, rd(2_000) * 40, 'Canastas navideñas para 40 familias de la comunidad', withRecibo({ categoria: 'ayuda_social', fondo: 'ayuda_social', ministerio: 'accion_social', culto: 'navidad' }, 1));
      if (dom === 21) bank(date, rd(24_000), 'Juguetes para los niños de la comunidad', withRecibo({ categoria: 'ayuda_social', fondo: 'ayuda_social', ministerio: 'ninos', culto: 'navidad' }));
      if (dom === 27) bank(date, rd(30_000), 'Cena de confraternidad navideña', withRecibo({ categoria: 'eventos', fondo: 'general', ministerio: 'general', culto: 'navidad', fecha_actividad: date }));
    }

    // ── La obra del templo: materiales cada mes y una etapa grande cada cuatro meses ──
    if (dom === 20 && b.balanceOf('fondo_construccion') > rd(140_000)) {
      b.tx({
        account: 'fondo_construccion',
        kind: 'expense',
        amountMinor: rng.rangeMinor(rd(25_000), rd(60_000), rd(500)),
        date,
        description: rng.pick(['Compra de blocks y cemento para la obra', 'Compra de varillas y alambre para la obra', 'Arena, grava y alquiler de mezcladora']),
        values: withRecibo({ categoria: 'construccion', fondo: 'construccion', ministerio: 'general', contacto: 'ferreteria', metodo_pago: 'cheque' }, 0.95),
      });
    }
    const stage = stageDays.indexOf(date);
    if (stage >= 0) {
      const room = b.balanceOf('fondo_construccion') - rd(80_000);
      if (room > rd(150_000)) {
        b.tx({
          account: 'fondo_construccion',
          kind: 'expense',
          amountMinor: roundToUnit(percentOf(room, 88), rd(5_000)),
          date,
          description: `Pago de la etapa ${stage + 1} de la obra del templo (${ETAPAS[stage] as string})`,
          values: { categoria: 'construccion', fondo: 'construccion', ministerio: 'general', contacto: 'constructora', metodo_pago: 'cheque', recibo: R() },
        });
      }
    }

    // ── Movimientos entre cuentas ──
    if (wd === 1 || wd === 4) {
      // El lunes se deposita lo pro-templo en la cuenta del fondo y el resto del conteo en el banco.
      const toFund = Math.min(proTemplo - (proTemplo % rd(100)), b.balanceOf('caja') - rd(1_000));
      if (wd === 1 && toFund >= rd(1_000)) {
        b.transfer({ from: 'caja', to: 'fondo_construccion', amountMinor: toFund, date, description: 'Depósito de lo pro-templo en la cuenta del fondo', values: { fondo: 'construccion' } });
        proTemplo = Money.sub(proTemplo, toFund);
      }
      const free = b.balanceOf('caja') - rd(6_000);
      const deposit = free - (free % rd(1_000));
      if (deposit >= rd(5_000)) {
        b.transfer({ from: 'caja', to: 'banco', amountMinor: deposit, date, description: wd === 1 ? 'Depósito del conteo del domingo' : 'Depósito del conteo del miércoles', values: { fondo: 'general' } });
      }
    }
    if ((dom === 2 || dom === 16) && b.balanceOf('caja_chica') < rd(4_000)) {
      const top = rd(6_000) - b.balanceOf('caja_chica');
      b.transfer({ from: 'banco', to: 'caja_chica', amountMinor: top - (top % rd(100)), date, description: 'Reposición de la caja chica', values: { fondo: 'general' } });
    }
    if (dom === 26) {
      // Lo que sobra en el banco por encima de la reserva (alquiler, sustento y salarios) pasa al fondo.
      const excess = b.balanceOf('banco') - rd(270_000);
      if (excess > rd(30_000)) {
        b.transfer({ from: 'banco', to: 'fondo_construccion', amountMinor: roundToUnit(percentOf(excess, 60), rd(5_000)), date, description: 'Traspaso del excedente al fondo de construcción', values: { fondo: 'construccion' } });
      }
    }
  }

  // ── El estado de cuenta del banco de un mes, importado desde Excel ──
  const im = months[3];
  if (im !== undefined) {
    b.importMonth({
      account: 'banco',
      from: im,
      to: lastDayOfMonth(im),
      importedOn: addDays(lastDayOfMonth(im), 6),
      label: `Estado de la cuenta bancaria, ${monthName(im)}`,
      fileName: `Estado cuenta iglesia ${monthName(im)}.xlsx`,
      preamble: ['Banco Comercial del Caribe', 'Cuenta corriente n.º 0456-7788-1 — Iglesia Camino de Luz', `Periodo: ${monthName(im)}`],
    });
  }
  b.reconcile(rng, ['banco', 'fondo_construccion'], 'conciliado', 10, 0.85);

  // ── Historia ──
  const taken = new Set<string>();
  // Un diezmo por transferencia anotado dos veces: la copia sale con su aviso y luego se anula.
  const tithe = b.pickTx(rng, 1, (it) => it.description === 'Diezmo por transferencia', taken)[0];
  if (tithe) {
    const copy = b.duplicate(tithe, 0);
    if (copy !== null) {
      taken.add(copy);
      b.step({ t: 'void', at: addDays(tithe.date, 3), ref: copy, reason: 'Registrado dos veces' });
    }
  }
  // Anulados: solo gastos variables (anular una entrada podría dejar la caja corta más adelante, y anular un
  // salario o el alquiler dejaría un mes sin pagar). Cada motivo, con un movimiento al que le cuadre.
  const variable = (it: { kind: string; values: DemoValues }): boolean =>
    it.kind === 'expense' && ['ayuda_social', 'transporte', 'sonido', 'mantenimiento', 'eventos', 'limpieza', 'materiales'].includes(String(it.values['categoria'])) && it.values['fondo'] !== 'construccion';
  const voidFilters: Array<(it: Extract<DemoPlan['items'][number], { t: 'tx' }>) => boolean> = [
    (it) => variable(it) && it.account !== 'banco',
    (it) => variable(it),
    (it) => variable(it) && it.account === 'caja' && it.amountMinor <= rd(3_000),
    (it) => variable(it) && it.account === 'banco',
  ];
  const voids = voidFilters.flatMap((f, i) => b.pickTx(rng, 1, f, taken).map((it) => ({ it, reason: VOID_REASONS[i] as string })));
  for (const { it, reason } of voids) b.step({ t: 'void', at: addDays(it.date, rng.int(1, 4)), ref: it.ref as string, reason });
  // La transferencia que parecía no haber salido sí salió: se restaura una semana después.
  const restored = voids.find((v) => v.reason === VOID_REASONS[3])?.it;
  if (restored) b.step({ t: 'restore', at: addDays(restored.date, 7), ref: restored.ref as string });

  // Ediciones (montos solo a la baja: nunca dejan una cuenta corta), cada una sobre un gasto al que le cuadre.
  const prevMonthName = (date: IsoDate): string => monthName(addDays(`${date.slice(0, 8)}01`, -1));
  const editKinds = [
    {
      // Recibo que llegó después: gasto del banco que no lo tenía (ni salarios ni ayudas, que no llevan factura).
      filter: (it: Extract<DemoPlan['items'][number], { t: 'tx' }>) =>
        it.account === 'banco' && it.kind === 'expense' && it.values['recibo'] === undefined && !['salarios', 'ayuda_social', 'comisiones'].includes(String(it.values['categoria'])),
      patch: () => ({ values: { recibo: R() }, notes: 'Recibo entregado después' }),
    },
    {
      // Las visitas a enfermos son del ministerio de acción social, no de la administración.
      filter: (it: Extract<DemoPlan['items'][number], { t: 'tx' }>) => it.description === 'Pasajes para visitas a enfermos',
      patch: () => ({ values: { ministerio: 'accion_social' }, notes: 'Las visitas las organiza el ministerio de acción social' }),
    },
    {
      filter: (it: Extract<DemoPlan['items'][number], { t: 'tx' }>) =>
        it.account === 'banco' && it.kind === 'expense' && ['materiales', 'eventos', 'sonido', 'mantenimiento'].includes(String(it.values['categoria'])),
      patch: (it: { amountMinor: Minor }) => ({ amountMinor: Money.sub(it.amountMinor, rd(100)), notes: 'Corregido con la factura' }),
    },
    {
      filter: (it: Extract<DemoPlan['items'][number], { t: 'tx' }>) => it.description === 'Factura de electricidad',
      patch: (it: { date: IsoDate }) => ({ description: `Factura de electricidad de ${prevMonthName(it.date)}` }),
    },
  ];
  for (let i = 0; i < 8; i += 1) {
    const kind = editKinds[i % 4];
    const it = kind === undefined ? undefined : b.pickTx(rng, 1, kind.filter, taken)[0];
    if (kind === undefined || it === undefined) continue;
    b.step({ t: 'edit', at: addDays(it.date, rng.int(1, 5)), ref: it.ref as string, patch: kind.patch(it) });
  }
  // Tres compras a proveedores con historial largo: descuento, luego recibo y cheque, luego la nota de la directiva.
  const longEdits = b.pickTx(
    rng,
    3,
    (it) => it.account === 'banco' && it.kind === 'expense' && it.amountMinor > rd(5_000) && it.values['contacto'] !== undefined && ['materiales', 'eventos', 'sonido', 'mantenimiento', 'transporte'].includes(String(it.values['categoria'])),
    taken,
  );
  for (const it of longEdits) {
    const ref = it.ref as string;
    b.step({ t: 'edit', at: addDays(it.date, 1), ref, patch: { amountMinor: Money.sub(it.amountMinor, rd(200)), notes: 'Descuento del proveedor' } });
    b.step({ t: 'edit', at: addDays(it.date, 3), ref, patch: { values: { recibo: R(), metodo_pago: 'cheque' } } });
    b.step({ t: 'edit', at: addDays(it.date, 5), ref, patch: { notes: 'Descuento del proveedor; aprobado por la directiva en la reunión del mes' } });
  }
  if (dupCapture !== null && dupWednesday !== undefined) b.step({ t: 'void_batch', at: addDays(dupWednesday, 1), ref: dupCapture, reason: 'Conteo anotado dos veces' });
  b.step({ t: 'merge_options', at: mergeAt, field: 'ministerio', source: 'juvenil_dup', target: 'jovenes' });
  b.step({ t: 'rename_option', at: months[6] ?? start, field: 'contacto', option: 'sonido_armonia', label: 'Sonido y Luces Armonía, SRL' });

  return sortPlan({
    profile: 'iglesia',
    templateId: 'organizacion',
    workspace: { name: 'Iglesia Camino de Luz', ownerName: 'Iglesia Camino de Luz' },
    start,
    anchor,
    openings,
    extraAccounts: [{ key: 'fondo_construccion', name: 'Fondo de construcción', type: 'savings', icon: 'PiggyBank', opening: fondoOpening }],
    extraFields: [
      { key: 'ministerio', label: 'Ministerio', type: 'list', role: 'cost_center', options: MINISTERIOS.map((x) => ({ key: x.key, label: x.label })) },
      { key: 'culto', label: 'Culto o actividad', type: 'list', options: CULTOS.map((x) => ({ key: x.key, label: x.label })) },
    ],
    extraOptions: {
      contacto: CONTACTOS.map((c) => ({ key: c.key, label: c.label, appliesTo: c.appliesTo })),
      categoria: [
        { key: 'misiones', label: 'Envíos a misiones', appliesTo: 'out' },
        { key: 'aportes', label: 'Aportes a la red de iglesias', appliesTo: 'out' },
        { key: 'sonido', label: 'Sonido e instrumentos', appliesTo: 'out' },
        { key: 'limpieza', label: 'Limpieza del templo', appliesTo: 'out' },
      ],
    },
    items: b.items,
    steps: b.steps,
    views: [
      {
        name: 'Diezmos y ofrendas por mes',
        pinned: true,
        recipe: {
          v: 1,
          kind: 'summary',
          filter: { period: { preset: 'last_12_months' }, kinds: ['income'], fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['diezmos', 'ofrendas'] }] },
          groupBy: { by: 'period', unit: 'month' },
          split: { by: 'field', fieldId: 'categoria' },
          measure: 'in',
          chart: 'bars',
        },
      },
      {
        name: 'Gastos por ministerio',
        recipe: { v: 1, kind: 'summary', filter: { period: { preset: 'this_year' }, kinds: ['expense'] }, groupBy: { by: 'field', fieldId: 'ministerio' }, measure: 'out', chart: 'donut' },
      },
      {
        name: 'Ayudas sociales del año',
        recipe: { v: 1, kind: 'filter', filter: { period: { preset: 'this_year' }, fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['ayuda_social'] }] }, sort: { by: 'date', dir: 'desc' } },
      },
      {
        name: 'Ofrendas pro-templo y donaciones',
        recipe: { v: 1, kind: 'filter', filter: { kinds: ['income'], fields: [{ fieldId: 'fondo', op: 'any_of', optionIds: ['construccion'] }] }, sort: { by: 'date', dir: 'desc' } },
      },
      {
        name: 'Informe mensual a la directiva',
        recipe: {
          v: 1,
          kind: 'report',
          form: 'detailed',
          filter: { period: { preset: 'last_month' } },
          sections: ['header', 'statement', 'by_account', 'by_field', 'movements', 'voided', 'signature'],
          groupByFieldIds: ['ministerio', 'categoria'],
          columns: ['date', 'seq', 'description', 'ministerio', 'categoria', 'recibo', 'amount'],
          includeVoided: true,
          signature: true,
        },
      },
    ],
    backupVerifiedDaysAgo: 41,
  });
}
