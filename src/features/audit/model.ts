// Historial general: lógica pura (filtros ⇄ URL, agrupar por día, texto legible de cada cambio, enlaces).
import { isIsoDate, presetRange, toIsoDate } from '../../core';
import type { AuditAction, AuditEntry, DateRange, Field, Id, IsoDate, Minor, PeriodPreset, TxKind } from '../../core';
import { PERIOD_PRESETS } from '../../core';
import { dayDiff } from '../../i18n/format';

// ── Filtros ─────────────────────────────────────────────────────────────────────────────

/** Grupos de acciones que ofrece el filtro (varias acciones del núcleo se juntan en un solo concepto). */
export const ACTION_GROUPS = {
  record: ['create', 'batch_create', 'import'],
  edit: ['edit', 'merge'],
  void: ['void', 'batch_void'],
  restore: ['restore', 'batch_restore'],
  structure: ['config', 'archive', 'unarchive', 'template_apply'],
  system: ['demo_seed', 'backup_restore', 'workspace_import'],
} as const satisfies Record<string, readonly AuditAction[]>;
export type ActionGroup = keyof typeof ACTION_GROUPS;
export const ACTION_GROUP_KEYS = Object.keys(ACTION_GROUPS) as ActionGroup[];

/** Tipos de elemento que escribe el núcleo en el historial. */
export const ENTITY_TYPES = ['transaction', 'transfer', 'batch', 'account', 'field', 'option', 'view', 'workspace', 'settings'] as const;
export type EntityKey = (typeof ENTITY_TYPES)[number];

export interface AuditFilters {
  period: DateRange;
  accountId: Id | null;
  group: ActionGroup | null;
  entity: EntityKey | null;
}

export const NO_FILTERS: AuditFilters = { period: { preset: 'all' }, accountId: null, group: null, entity: null };

/** Periodos del selector del historial. */
export const AUDIT_PERIODS: readonly PeriodPreset[] = ['today', 'last_30_days', 'this_month', 'last_month', 'this_year', 'all'];

export function isFiltered(f: AuditFilters): boolean {
  return !('preset' in f.period && f.period.preset === 'all') || f.accountId !== null || f.group !== null || f.entity !== null;
}

export function filtersFromParams(p: URLSearchParams): AuditFilters {
  const f: AuditFilters = { ...NO_FILTERS };
  const preset = p.get('periodo');
  const from = p.get('desde');
  const to = p.get('hasta');
  if (preset !== null && (PERIOD_PRESETS as readonly string[]).includes(preset)) f.period = { preset: preset as PeriodPreset };
  else if ((from !== null && isIsoDate(from)) || (to !== null && isIsoDate(to))) {
    f.period = {
      ...(from !== null && isIsoDate(from) ? { from } : {}),
      ...(to !== null && isIsoDate(to) ? { to } : {}),
    };
  }
  const account = p.get('cuenta');
  if (account !== null && account !== '') f.accountId = account;
  const group = p.get('accion');
  if (group !== null && (ACTION_GROUP_KEYS as string[]).includes(group)) f.group = group as ActionGroup;
  const entity = p.get('elemento');
  if (entity !== null && (ENTITY_TYPES as readonly string[]).includes(entity)) f.entity = entity as EntityKey;
  return f;
}

export function filtersToParams(f: AuditFilters): URLSearchParams {
  const p = new URLSearchParams();
  if ('preset' in f.period) {
    if (f.period.preset !== 'all') p.set('periodo', f.period.preset);
  } else {
    if (f.period.from !== undefined) p.set('desde', f.period.from);
    if (f.period.to !== undefined) p.set('hasta', f.period.to);
  }
  if (f.accountId !== null) p.set('cuenta', f.accountId);
  if (f.group !== null) p.set('accion', f.group);
  if (f.entity !== null) p.set('elemento', f.entity);
  return p;
}

export interface AuditQuery {
  from?: IsoDate;
  to?: IsoDate;
  accountId?: Id;
  actions?: AuditAction[];
  entityType?: string;
}

/** Filtros → entrada de `audit.list` (el periodo preestablecido se resuelve contra `today`). */
export function toQuery(f: AuditFilters, today: IsoDate): AuditQuery {
  const range = 'preset' in f.period ? presetRange(f.period.preset, today) : { from: f.period.from ?? null, to: f.period.to ?? null };
  return {
    ...(range.from === null ? {} : { from: range.from }),
    ...(range.to === null ? {} : { to: range.to }),
    ...(f.accountId === null ? {} : { accountId: f.accountId }),
    ...(f.group === null ? {} : { actions: [...ACTION_GROUPS[f.group]] }),
    ...(f.entity === null ? {} : { entityType: f.entity }),
  };
}

// ── Agrupar por día ─────────────────────────────────────────────────────────────────────

export interface DayGroup {
  day: IsoDate;
  entries: AuditEntry[];
}

/** Día de calendario local de una marca de tiempo UTC. */
export const localDay = (at: string): IsoDate => toIsoDate(new Date(at));

/** Agrupa (en el mismo orden, de lo más reciente a lo más antiguo) por día local. */
export function groupByDay(entries: readonly AuditEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of entries) {
    const day = localDay(e.at);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}

/** Une páginas sin repetir ids (una página nueva puede solaparse si llegó una acción entre dos lecturas). */
export function mergePages(pages: ReadonlyArray<{ items: AuditEntry[] }>): AuditEntry[] {
  const seen = new Set<string>();
  const out: AuditEntry[] = [];
  for (const page of pages) {
    for (const e of page.items) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

// ── Qué dice cada entrada ───────────────────────────────────────────────────────────────

/** Solo parámetros que el texto puede interpolar (el resto, objetos o booleanos, no). */
export function textParams(params: AuditEntry['params']): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

/**
 * Monto que acompaña a la entrada: el del movimiento o el total de un lote de un solo sentido. Un lote sin sentido
 * (datos de ejemplo, importaciones mixtas) suma entradas y salidas: ese total no significa nada y no se muestra.
 */
export function entryAmount(e: AuditEntry): { minor: Minor; kind: TxKind | undefined } | null {
  const p = e.params ?? {};
  const kindParam = p['kind'];
  const kind = kindParam === 'income' || kindParam === 'expense' || kindParam === 'transfer' || kindParam === 'opening' ? kindParam : undefined;
  const single = typeof p['amountMinor'] === 'number' ? p['amountMinor'] : null;
  const total = typeof p['sumMinor'] === 'number' && kind !== undefined ? p['sumMinor'] : null;
  const minor = single ?? total;
  if (minor === null || !Number.isSafeInteger(minor)) return null;
  return { minor, kind };
}

/** Clave del rótulo de la acción: «Anotado» es solo de movimientos; crear una vista, un campo o una cuenta es «Creación». */
export function actionLabelKey(e: Pick<AuditEntry, 'action' | 'entityType'>): string {
  const recorded = e.entityType === 'transaction' || e.entityType === 'transfer' || e.entityType === 'batch' || e.entityType === null;
  return e.action === 'create' && !recorded ? 'action.created' : `action.${e.action}`;
}

/** Cabecera de un día: «Hoy», «Ayer» o el día de la semana; la fecha completa va aparte, una sola vez. */
export function dayHeading(day: IsoDate, today: IsoDate): string {
  const diff = dayDiff(day, today);
  if (diff === 0) return 'Hoy';
  if (diff === -1) return 'Ayer';
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('es-DO', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export type LinkKind = 'transaction' | 'transfer' | 'batch' | 'account';

/** A qué pantalla lleva la entrada (movimiento, lote o cuenta); `null` si no hay a dónde. */
export function entryTarget(e: AuditEntry, wsId: Id): { to: string; kind: LinkKind } | null {
  const base = `/e/${wsId}`;
  switch (e.entityType) {
    case 'transaction':
      return e.entityId === null ? null : { to: `${base}/movimientos/${e.entityId}`, kind: 'transaction' };
    case 'transfer': {
      const side = e.changes.find((c) => c.entityId !== null)?.entityId ?? null;
      return side === null ? null : { to: `${base}/movimientos/${side}`, kind: 'transfer' };
    }
    case 'batch': {
      const id = e.batchId ?? e.entityId;
      return id === null ? null : { to: `${base}/lotes/${id}`, kind: 'batch' };
    }
    case 'account':
      return e.entityId === null ? null : { to: `${base}/cuentas/${e.entityId}`, kind: 'account' };
    default:
      return null;
  }
}

export interface ChangeLine {
  /** Qué cambió: «Monto», «Categoría». */
  label: string;
  old: string | null;
  new: string | null;
  /** Texto largo de una sola pieza (notas, concepto): se muestra en línea aparte. */
  path: string;
}

export interface ChangeContext {
  t: (key: string, params?: Record<string, string | number>) => string;
  formatMoney: (minor: Minor) => string;
  formatDate: (iso: IsoDate) => string;
  fields: readonly Field[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fieldValueText(v: unknown, field: Field | undefined, ctx: ChangeContext): string | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return String(v);
  switch (v['type']) {
    case 'list': {
      const id = v['optionId'];
      return field?.options.find((o) => o.id === id)?.label ?? null;
    }
    case 'bool':
      return ctx.t(v['value'] === true ? 'auditlog.value.yes' : 'auditlog.value.no');
    case 'date':
      return typeof v['value'] === 'string' && isIsoDate(v['value']) ? ctx.formatDate(v['value']) : String(v['value']);
    default:
      return v['value'] === undefined || v['value'] === null ? null : String(v['value']);
  }
}

function plain(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Un cambio como línea legible: «Monto  RD$1,500.00 → RD$1,850.00». Devuelve `null` para lo que no se muestra
 * (la instantánea `*` de un alta, ya resumida en el mensaje).
 */
export function describeChange(c: AuditEntry['changes'][number], ctx: ChangeContext): ChangeLine | null {
  if (c.path === '*') return null;
  const known = (label: string, map: (v: unknown) => string | null): ChangeLine => ({ label, old: map(c.old), new: map(c.new), path: c.path });
  switch (c.path) {
    case 'amount_minor':
      return known(ctx.t('auditlog.path.amount_minor'), (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? ctx.formatMoney(v) : plain(v)));
    case 'date':
      return known(ctx.t('auditlog.path.date'), (v) => (typeof v === 'string' && isIsoDate(v) ? ctx.formatDate(v) : plain(v)));
    case 'kind':
      return known(ctx.t('auditlog.path.kind'), (v) => (typeof v === 'string' ? ctx.t(`ui.kind.${v}`) : plain(v)));
    case 'direction':
      return known(ctx.t('auditlog.path.direction'), (v) => (v === 'in' || v === 'out' ? ctx.t(`auditlog.value.${v}`) : plain(v)));
    case 'status':
      return known(ctx.t('auditlog.path.status'), (v) => (v === 'active' || v === 'voided' ? ctx.t(`auditlog.value.${v}`) : plain(v)));
    case 'description':
    case 'notes':
    case 'void_reason':
      return known(ctx.t(`auditlog.path.${c.path}`), plain);
    default:
      break;
  }
  if (c.path.startsWith('field:')) {
    const field = ctx.fields.find((f) => f.id === c.path.slice('field:'.length));
    return known(field?.label ?? ctx.t('auditlog.path.field'), (v) => fieldValueText(v, field, ctx));
  }
  // Estructuras (recetas de vistas, plantillas): no se enseñan como texto; el mensaje ya dice qué se guardó.
  if (typeof c.old === 'object' && c.old !== null) return null;
  if (typeof c.new === 'object' && c.new !== null) return null;
  return known(c.path, plain);
}

/** Acciones cuyo detalle por fila no se enseña (están resumidas en el mensaje y pueden ser cientos). */
const SUMMARY_ONLY: readonly AuditAction[] = ['batch_create', 'batch_void', 'batch_restore', 'import', 'demo_seed', 'template_apply', 'backup_restore', 'workspace_import'];

/**
 * Líneas de detalle de una entrada: en ediciones, cada valor que cambió; en anulaciones, solo el motivo
 * (el estado ya lo dice el mensaje). Las acciones de lote no listan filas.
 */
export function changeLines(e: AuditEntry, ctx: ChangeContext): ChangeLine[] {
  if (SUMMARY_ONLY.includes(e.action)) return [];
  const lines: ChangeLine[] = [];
  for (const c of e.changes) {
    if (e.action === 'void' || e.action === 'restore') {
      if (c.path !== 'void_reason') continue;
      if (e.action === 'restore') continue;
    } else if (e.action === 'create') continue;
    const line = describeChange(c, ctx);
    if (line !== null && (line.old !== null || line.new !== null)) lines.push(line);
  }
  return lines;
}
