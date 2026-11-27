// Historial de un movimiento en lenguaje llano (DESIGN §10.10): «Monto ~~RD$1,500.00~~ → RD$1,850.00».
import type { AuditEntry, Field, FieldValue, Minor } from '../../../core';

export interface ChangeLine {
  /** Clave del rótulo: `amount`, `date`, … o `field` (entonces `fieldLabel`). */
  labelKey: string;
  fieldLabel?: string;
  old: string | null;
  new: string | null;
}

export interface HistoryCtx {
  money: (minor: Minor) => string;
  date: (iso: string) => string;
  fields: readonly Field[];
  /** Textos de valores fijos: tipo, estado, sí/no, vacío. */
  t: (key: string) => string;
}

const PATH_LABEL: Record<string, string> = {
  amount_minor: 'amount',
  date: 'date',
  description: 'description',
  notes: 'notes',
  status: 'status',
  void_reason: 'voidReason',
  kind: 'kind',
  direction: 'kind',
};

function isFieldValue(v: unknown): v is FieldValue {
  return typeof v === 'object' && v !== null && 'type' in v;
}

export function formatFieldValue(value: unknown, field: Field | undefined, ctx: HistoryCtx): string | null {
  if (value === null || value === undefined) return null;
  if (!isFieldValue(value)) return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  switch (value.type) {
    case 'text':
      return value.value === '' ? null : value.value;
    case 'number':
      return String(value.value);
    case 'date':
      return ctx.date(value.value);
    case 'bool':
      return ctx.t(value.value ? 'ledger.value.yes' : 'ledger.value.no');
    case 'list': {
      const opt = field?.options.find((o) => o.id === value.optionId);
      return opt?.label ?? ctx.t('ledger.value.unknownOption');
    }
  }
}

function formatValue(path: string, value: unknown, ctx: HistoryCtx): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (path) {
    case 'amount_minor':
      return typeof value === 'number' ? ctx.money(value) : null;
    case 'date':
      return typeof value === 'string' ? ctx.date(value) : null;
    case 'status':
      return ctx.t(`ledger.status.${String(value)}`);
    case 'kind':
      return ctx.t(`ledger.kind.${String(value)}`);
    case 'direction':
      return ctx.t(`ledger.direction.${String(value)}`);
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  }
}

/**
 * Líneas legibles de una entrada. La línea `*` (instantánea del alta) no se desglosa. En transferencias, las
 * líneas repetidas de los dos lados (mismo campo, mismo antes y después) salen una vez.
 */
export function changeLines(entry: AuditEntry, ctx: HistoryCtx): ChangeLine[] {
  const byId = new Map(ctx.fields.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: ChangeLine[] = [];
  for (const c of entry.changes) {
    if (c.path === '*') continue;
    const sig = JSON.stringify([c.path, c.old, c.new]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (c.path.startsWith('field:')) {
      const field = byId.get(c.path.slice('field:'.length));
      out.push({
        labelKey: 'field',
        fieldLabel: field?.label ?? ctx.t('ledger.value.unknownField'),
        old: formatFieldValue(c.old, field, ctx),
        new: formatFieldValue(c.new, field, ctx),
      });
      continue;
    }
    const labelKey = PATH_LABEL[c.path];
    if (labelKey === undefined) continue;
    out.push({ labelKey, old: formatValue(c.path, c.old, ctx), new: formatValue(c.path, c.new, ctx) });
  }
  return out;
}

/** Rótulo corto de la acción: «Anotado», «Editado», «Anulado»… */
export function actionKey(entry: AuditEntry): string {
  switch (entry.action) {
    case 'create':
    case 'batch_create':
    case 'import':
    case 'demo_seed':
    case 'template_apply':
      return 'ledger.action.create';
    case 'edit':
      return 'ledger.action.edit';
    case 'void':
    case 'batch_void':
      return 'ledger.action.void';
    case 'restore':
    case 'batch_restore':
      return 'ledger.action.restore';
    default:
      return 'ledger.action.other';
  }
}
