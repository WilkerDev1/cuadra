// Generador determinista de datos de ejemplo (ARCHITECTURE.md 6). Sin DOM ni E/S: devuelve un plan puro
// que services/demo.ts traduce a ids y escribe.
import { isIsoDate } from '../dates';
import { DomainError } from '../errors';
import { planColmado } from './colmado';
import { planDespacho } from './despacho';
import { planPersonal } from './personal';
import { DEMO_MONTHS, DEMO_SEED, type DemoPlan, type DemoProfileId, type PlanOptions } from './plan';

export * from './plan';
export { createRng, mulberry32, percentOf, roundToUnit, type Rng } from './prng';

export interface DemoProfile {
  id: DemoProfileId;
  name: string;
  description: string;
  templateId: DemoPlan['templateId'];
}

export const DEMO_PROFILES: readonly DemoProfile[] = Object.freeze([
  {
    id: 'colmado',
    name: 'Colmado La Esquina',
    description: 'Un colmado de barrio: ventas diarias por lotes con total de control, compras a distribuidoras, nómina quincenal, depósitos al banco y tarjeta de crédito.',
    templateId: 'negocio',
  },
  {
    id: 'despacho',
    name: 'Estudio Creativo Brisa, SRL',
    description: 'El cliente de un contador independiente: facturas por cliente con NCF e ITBIS, pagos a proveedores, caja chica y un extracto del banco importado desde Excel.',
    templateId: 'despacho',
  },
  {
    id: 'personal',
    name: 'Mis finanzas',
    description: 'Finanzas personales: salario quincenal, gastos por categoría, ahorro por transferencias, tarjeta de crédito y un viaje anotado de una vez.',
    templateId: 'personal',
  },
]);

export const isDemoProfileId = (x: unknown): x is DemoProfileId => DEMO_PROFILES.some((p) => p.id === x);

/** Plan completo de un perfil: misma semilla y misma ancla → mismo plan. */
export function planDemo(profile: DemoProfileId, opts: Partial<PlanOptions> & { anchor: string }): DemoPlan {
  if (!isDemoProfileId(profile)) throw new DomainError('not_found', { entity: 'demo_profile', profile });
  if (!isIsoDate(opts.anchor)) throw new DomainError('invalid_date', { date: opts.anchor });
  const months = opts.months ?? DEMO_MONTHS;
  if (!Number.isInteger(months) || months < 2 || months > 36) throw new RangeError(`meses de demo inválidos: ${months}`);
  const full: PlanOptions = { seed: opts.seed ?? DEMO_SEED, anchor: opts.anchor, months };
  switch (profile) {
    case 'colmado':
      return planColmado(full);
    case 'despacho':
      return planDespacho(full);
    case 'personal':
      return planPersonal(full);
  }
}
