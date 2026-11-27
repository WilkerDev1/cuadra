// Datos de ejemplo de la galería (rotulados «Ejemplo» en pantalla). Montos en unidad menor.
import type { Field } from '../../../core/types';
import type { BarDatum, DayFlow, LinePoint } from '../../../ui';

export const TODAY = '2026-11-26';

export const ROWS = [
  { id: 't1', date: '2026-11-24', seq: 142, title: 'Compra de cemento', category: 'Materiales', account: 'Caja', kind: 'expense' as const, minor: 185000, running: 1240000 },
  { id: 't2', date: '2026-11-24', seq: 141, title: 'Ventas de la mañana', category: 'Ventas', account: 'Caja', kind: 'income' as const, minor: 520000, running: 1425000 },
  { id: 't3', date: '2026-11-24', seq: 140, title: 'Depósito al banco', category: 'Transferencia', account: 'Caja → Banco', kind: 'transfer' as const, minor: 300000, running: 905000 },
  { id: 't4', date: '2026-11-23', seq: 139, title: 'Electricidad de octubre con recargo por mora', category: 'Servicios', account: 'Banco', kind: 'expense' as const, minor: 935000, running: 1205000, voided: true },
  { id: 't5', date: '2026-11-23', seq: 138, title: 'Cobro factura B0100000231', category: 'Ventas', account: 'Banco', kind: 'income' as const, minor: 4820050, running: 2140000 },
];

function seededFlows(): DayFlow[] {
  let s = 20261126;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  return Array.from({ length: 26 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    const weekend = i % 7 === 5;
    return {
      date: `2026-11-${day}`,
      inMinor: Math.round((18000 + rnd() * 26000) * (weekend ? 1.4 : 1)) * 100,
      outMinor: Math.round(rnd() < 0.25 ? 30000 + rnd() * 25000 : 4000 + rnd() * 16000) * 100,
    };
  });
}
export const FLOWS: DayFlow[] = seededFlows();

export const BARS: BarDatum[] = [
  { id: 'm', label: 'Mercancía', minor: 18450000, kind: 'out' },
  { id: 'n', label: 'Nómina', minor: 3500000, kind: 'out' },
  { id: 'a', label: 'Alquiler', minor: 3500000, kind: 'out' },
  { id: 's', label: 'Servicios', minor: 1180000, kind: 'out' },
  { id: 'i', label: 'Impuestos', minor: 960000, kind: 'out' },
];

export const LINE: LinePoint[] = ['dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov'].map((label, i) => ({
  label,
  minor: (3200000 + i * 420000 + (i % 3) * 610000 - (i === 7 ? 1800000 : 0)) * 1,
}));

export const SPARK = [9, 9.4, 9.1, 9.8, 10.2, 10, 10.9, 11.3, 11, 11.6, 12.1, 11.8, 12.4].map((v) => Math.round(v * 100000));

const base = { workspaceId: 'w', appliesTo: 'both' as const, showInList: true, active: true, deactivatedAt: null };
const opt = (id: string, label: string, active = true) => ({ id, fieldId: 'f-cat', key: null, label, color: null, appliesTo: 'both' as const, sortOrder: 0, active, mergedIntoId: null });

export const FIELDS: Field[] = [
  { ...base, id: 'f-cat', key: 'categoria', label: 'Categoría', type: 'list', role: 'category', sortOrder: 1, options: [opt('o1', 'Materiales'), opt('o2', 'Servicios'), opt('o3', 'Nómina'), opt('o4', 'Varios', false)] },
  { ...base, id: 'f-ncf', key: 'ncf', label: 'NCF', type: 'text', role: 'reference', sortOrder: 2, options: [] },
  { ...base, id: 'f-qty', key: 'cantidad', label: 'Cantidad', type: 'number', role: null, sortOrder: 3, options: [] },
  { ...base, id: 'f-inv', key: 'fecha_factura', label: 'Fecha de factura', type: 'date', role: null, sortOrder: 4, options: [] },
  { ...base, id: 'f-rec', key: 'conciliado', label: 'Conciliado', type: 'bool', role: 'reconciled', sortOrder: 5, options: [] },
];
