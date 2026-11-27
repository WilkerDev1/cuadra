// Campos y opciones (ARCHITECTURE.md 3.5, F-25…F-36). Cinco tipos (texto, número, fecha, lista, sí/no) que
// aparecen solos en el formulario, los filtros y las agrupaciones. Se desactivan en vez de borrarse; solo
// se borra lo que nunca se usó (ni siquiera en un anulado). El tipo no cambia nunca (F-31).
import { DomainError } from '../errors';
import type { SqlExecutor } from '../ports';
import {
  insertSql,
  recordValues,
  selectColumns,
  toField,
  toFieldOption,
  type FieldOptionRecord,
  type FieldRecord,
} from '../sql/rows';
import { editDistance, normalizeSearch } from '../text';
import type { AppliesTo, Field, FieldOption, FieldRole, FieldType, Id, Mutation } from '../types';
import { mutate, readTx, type CoreDeps, type UowCtx } from '../uow';
import { requireWorkspace } from './workspaces';
import { assertMaxLength, MAX_LABEL_LENGTH } from './validation';

export interface FormSchema {
  // F-25: lo que el formulario pinta, ya ordenado
  fields: Array<Field & { options: FieldOption[] /* solo activas y aplicables al tipo */ }>;
}

export interface FieldsService {
  list(workspaceId: Id, opts?: { includeInactive?: boolean }): Promise<Field[]>;
  formSchema(workspaceId: Id, kind: 'income' | 'expense' | 'transfer'): Promise<FormSchema>;
  /** Campos disponibles para filtrar/agrupar: incluye inactivos (marcados) para lo histórico. */
  dimensions(workspaceId: Id): Promise<Array<Field & { groupable: boolean; filterable: boolean }>>;
  create(input: {
    workspaceId: Id;
    label: string;
    type: FieldType;
    key?: string;
    role?: FieldRole;
    appliesTo?: AppliesTo;
    showInList?: boolean;
    options?: Array<{ label: string; color?: string; appliesTo?: AppliesTo }>;
  }): Promise<Mutation<Field>>;
  /** El tipo NO está en el parche (F-31). */
  update(id: Id, patch: Partial<Pick<Field, 'label' | 'role' | 'appliesTo' | 'showInList'>>): Promise<Mutation<Field>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  deactivate(id: Id): Promise<Mutation<Field>>;
  reactivate(id: Id): Promise<Mutation<Field>>;
  usage(id: Id): Promise<{ total: number; active: number; voided: number }>;
  /** Solo si usage.total === 0 (incluye anulados) → si no, 'field_in_use'. */
  delete(id: Id): Promise<void>;

  addOption(fieldId: Id, input: { label: string; color?: string; appliesTo?: AppliesTo }): Promise<Mutation<FieldOption>>;
  updateOption(
    optionId: Id,
    patch: Partial<Pick<FieldOption, 'label' | 'color' | 'appliesTo'>>,
  ): Promise<Mutation<FieldOption>>;
  reorderOptions(fieldId: Id, ids: Id[]): Promise<void>;
  deactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  reactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  deleteOption(optionId: Id): Promise<void>; // solo nunca usada
  /** Opciones parecidas al escribir (F-35 resuelto como "punto medio"): sin tildes, distancia ≤ 2. */
  similarOptions(fieldId: Id, label: string): Promise<FieldOption[]>;
  /** F-36: mueve valores al destino, desactiva el origen con merged_into_id, una acción de historial. */
  mergeOptions(sourceId: Id, targetId: Id): Promise<Mutation<{ movedCount: number }>>;
}

export const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'date', 'list', 'bool'];
export const FIELD_ROLES: readonly FieldRole[] = [
  'category',
  'contact',
  'fund',
  'cost_center',
  'payment_method',
  'reference',
  'reconciled',
];
const APPLIES: readonly AppliesTo[] = ['both', 'in', 'out'];
/** Misma regla que el CHECK de fields.key. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// ── Ayudas internas (las reutilizan plantillas) ──────────────────────────────────────

/** Etiqueta comparable: sin tildes ni mayúsculas ("Café" = "cafe"). */
export const labelKey = (label: string): string => normalizeSearch(label);

/** "Fecha de factura" → "fecha_de_factura". */
export function slugKey(label: string, fallback: string): string {
  const slug = labelKey(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (slug === '') return fallback;
  return /^[a-z]/.test(slug) ? slug : `${fallback}_${slug}`;
}

export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function cleanLabel(label: unknown): string {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (trimmed === '') throw new DomainError('name_required', { field: 'label' });
  assertMaxLength(trimmed, MAX_LABEL_LENGTH, 'label');
  return trimmed;
}

function assertOneOf<T extends string>(values: readonly T[], value: unknown, what: string): asserts value is T {
  if (!values.includes(value as T)) throw new RangeError(`${what} inválido: ${String(value)}`);
}

export async function requireField(tx: SqlExecutor, id: Id): Promise<FieldRecord> {
  const r = await tx.get<FieldRecord>(`SELECT ${selectColumns('fields')} FROM fields WHERE id = ?`, [id]);
  if (r === undefined) throw new DomainError('not_found', { entity: 'field', id });
  return r;
}

async function requireOption(tx: SqlExecutor, id: Id): Promise<FieldOptionRecord> {
  const r = await tx.get<FieldOptionRecord>(`SELECT ${selectColumns('field_options')} FROM field_options WHERE id = ?`, [id]);
  if (r === undefined) throw new DomainError('not_found', { entity: 'option', id });
  return r;
}

async function loadFields(tx: SqlExecutor, workspaceId: Id, includeInactive: boolean): Promise<Field[]> {
  const fields = await tx.all<FieldRecord>(
    `SELECT ${selectColumns('fields')} FROM fields WHERE workspace_id = ?
     ${includeInactive ? '' : 'AND deactivated_at IS NULL'} ORDER BY sort_order, created_at, id`,
    [workspaceId],
  );
  if (fields.length === 0) return [];
  const options = await tx.all<FieldOptionRecord>(
    `SELECT ${selectColumns('field_options', 'o')} FROM field_options o JOIN fields f ON f.id = o.field_id
     WHERE f.workspace_id = ? ORDER BY o.sort_order, o.created_at, o.id`,
    [workspaceId],
  );
  return fields.map((f) => toField(f, options));
}

async function loadField(tx: SqlExecutor, id: Id): Promise<Field> {
  const record = await requireField(tx, id);
  const options = await tx.all<FieldOptionRecord>(
    `SELECT ${selectColumns('field_options')} FROM field_options WHERE field_id = ? ORDER BY sort_order, created_at, id`,
    [id],
  );
  return toField(record, options);
}

async function assertFieldLabelFree(tx: SqlExecutor, workspaceId: Id, label: string, exceptId: Id | null): Promise<void> {
  const rows = await tx.all<{ id: string; label: string }>(
    'SELECT id, label FROM fields WHERE workspace_id = ? AND deactivated_at IS NULL',
    [workspaceId],
  );
  const wanted = labelKey(label);
  const clash = rows.find((r) => r.id !== exceptId && labelKey(r.label) === wanted);
  if (clash) throw new DomainError('duplicate_label', { entity: 'field', label, existingId: clash.id });
}

async function assertOptionLabelFree(tx: SqlExecutor, fieldId: Id, label: string, exceptId: Id | null): Promise<void> {
  const rows = await tx.all<{ id: string; label: string }>(
    'SELECT id, label FROM field_options WHERE field_id = ? AND deactivated_at IS NULL',
    [fieldId],
  );
  const wanted = labelKey(label);
  const clash = rows.find((r) => r.id !== exceptId && labelKey(r.label) === wanted);
  if (clash) throw new DomainError('duplicate_label', { entity: 'option', label, existingId: clash.id });
}

export interface NewOption {
  key?: string | null;
  label: string;
  color?: string | null;
  appliesTo?: AppliesTo;
}

/** Inserta opciones de un campo de lista (sin historial). Valida etiquetas y claves únicas. */
export async function insertOptionsTx(
  ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids'>,
  fieldId: Id,
  options: readonly NewOption[],
): Promise<FieldOptionRecord[]> {
  if (options.length === 0) return [];
  const existing = await ctx.tx.all<{ key: string | null; label: string; deactivated_at: string | null; sort_order: number }>(
    'SELECT key, label, deactivated_at, sort_order FROM field_options WHERE field_id = ?',
    [fieldId],
  );
  const activeLabels = new Set(existing.filter((o) => o.deactivated_at === null).map((o) => labelKey(o.label)));
  const keys = new Set(existing.map((o) => o.key).filter((k): k is string => k !== null));
  let order = existing.reduce((m, o) => Math.max(m, Number(o.sort_order) + 1), 0);
  const now = ctx.clock.now().toISOString();
  const records: FieldOptionRecord[] = [];
  for (const o of options) {
    const label = cleanLabel(o.label);
    const lk = labelKey(label);
    if (activeLabels.has(lk)) throw new DomainError('duplicate_label', { entity: 'option', label });
    activeLabels.add(lk);
    const appliesTo = o.appliesTo ?? 'both';
    assertOneOf(APPLIES, appliesTo, 'appliesTo');
    let key: string;
    if (o.key !== undefined && o.key !== null) {
      if (!FIELD_KEY_PATTERN.test(o.key)) throw new RangeError(`clave de opción inválida: ${o.key}`);
      if (keys.has(o.key)) throw new DomainError('duplicate_label', { entity: 'option', key: o.key });
      key = o.key;
    } else {
      key = uniqueKey(slugKey(label, 'opcion'), keys);
    }
    keys.add(key);
    records.push({
      id: ctx.ids.next(),
      field_id: fieldId,
      key,
      label,
      color: o.color ?? null,
      applies_to: appliesTo,
      sort_order: order++,
      deactivated_at: null,
      merged_into_id: null,
      created_at: now,
      updated_at: now,
    });
  }
  await ctx.tx.runMany(
    insertSql('field_options'),
    records.map((r) => recordValues('field_options', r)),
  );
  return records;
}

export interface NewField {
  workspaceId: Id;
  label: string;
  type: FieldType;
  key?: string;
  role?: FieldRole | null;
  appliesTo?: AppliesTo;
  showInList?: boolean;
  options?: readonly NewOption[];
}

/** Inserta un campo (y sus opciones) dentro de la transacción del llamador, sin historial. */
export async function insertFieldTx(ctx: Pick<UowCtx, 'tx' | 'clock' | 'ids'>, input: NewField): Promise<Field> {
  const label = cleanLabel(input.label);
  assertOneOf(FIELD_TYPES, input.type, 'tipo de campo');
  if (input.role !== undefined && input.role !== null) assertOneOf(FIELD_ROLES, input.role, 'papel de campo');
  const appliesTo = input.appliesTo ?? 'both';
  assertOneOf(APPLIES, appliesTo, 'appliesTo');
  if (input.options !== undefined && input.options.length > 0 && input.type !== 'list') {
    throw new DomainError('options_require_list_field', { type: input.type });
  }
  await assertFieldLabelFree(ctx.tx, input.workspaceId, label, null);
  const rows = await ctx.tx.all<{ key: string; sort_order: number }>('SELECT key, sort_order FROM fields WHERE workspace_id = ?', [
    input.workspaceId,
  ]);
  const keys = new Set(rows.map((r) => r.key));
  let key: string;
  if (input.key !== undefined) {
    if (!FIELD_KEY_PATTERN.test(input.key)) throw new RangeError(`clave de campo inválida: ${input.key}`);
    if (keys.has(input.key)) throw new DomainError('duplicate_label', { entity: 'field', key: input.key });
    key = input.key;
  } else {
    key = uniqueKey(slugKey(label, 'campo'), keys);
  }
  const now = ctx.clock.now().toISOString();
  const record: FieldRecord = {
    id: ctx.ids.next(),
    workspace_id: input.workspaceId,
    key,
    label,
    type: input.type,
    role: input.role ?? null,
    applies_to: appliesTo,
    sort_order: rows.reduce((m, r) => Math.max(m, Number(r.sort_order) + 1), 0),
    show_in_list: input.showInList ? 1 : 0,
    deactivated_at: null,
    created_at: now,
    updated_at: now,
  };
  await ctx.tx.run(insertSql('fields'), recordValues('fields', record));
  const options = await insertOptionsTx(ctx, record.id, input.options ?? []);
  return toField(record, options);
}

/** Instantánea de un campo para el historial ('*'). */
export function fieldSnapshot(f: Field): Record<string, unknown> {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    role: f.role,
    appliesTo: f.appliesTo,
    showInList: f.showInList,
    options: f.options.map((o) => ({ id: o.id, label: o.label, appliesTo: o.appliesTo })),
  };
}

const appliesToKind = (appliesTo: AppliesTo, kind: 'income' | 'expense' | 'transfer'): boolean =>
  appliesTo === 'both' || (kind === 'income' && appliesTo === 'in') || (kind === 'expense' && appliesTo === 'out');

/** Umbral de parecido: etiquetas cortas admiten menos errores ("gas" no se parece a "agua"). */
const similarityThreshold = (length: number): number => Math.min(2, Math.floor(length / 3));

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createFieldsService(deps: CoreDeps): FieldsService {
  type Change = { entityId?: Id; path: string; old?: unknown; new?: unknown };

  async function audit(
    ctx: UowCtx,
    workspaceId: Id,
    entry: {
      action: 'create' | 'edit' | 'config' | 'merge';
      entityType: 'field' | 'option';
      entityId: Id;
      message: string;
      params: Record<string, unknown>;
      changes: Change[];
    },
  ): Promise<void> {
    await ctx.audit.record(ctx.tx, {
      workspaceId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      accountId: null,
      batchId: null,
      message: entry.message,
      params: entry.params,
      changes: entry.changes.map((c) => ({ entityId: entry.entityId, ...c })),
    });
  }

  async function workspaceOfField(fieldId: Id): Promise<Id> {
    return (await readTx(deps, (tx) => requireField(tx, fieldId))).workspace_id;
  }

  async function workspaceOfOption(optionId: Id): Promise<Id> {
    return readTx(deps, async (tx) => {
      const option = await requireOption(tx, optionId);
      return (await requireField(tx, option.field_id)).workspace_id;
    });
  }

  async function setFieldActive(id: Id, active: boolean): Promise<Mutation<Field>> {
    const workspaceId = await workspaceOfField(id);
    return mutate(deps, workspaceId, active ? 'field.reactivate' : 'field.deactivate', async (ctx) => {
      const current = await requireField(ctx.tx, id);
      if ((current.deactivated_at === null) === active) return loadField(ctx.tx, id);
      if (active) await assertFieldLabelFree(ctx.tx, workspaceId, current.label, id);
      const now = ctx.clock.now().toISOString();
      const deactivatedAt = active ? null : now;
      await ctx.tx.run('UPDATE fields SET deactivated_at = ?, updated_at = ? WHERE id = ?', [deactivatedAt, now, id]);
      await audit(ctx, workspaceId, {
        action: 'config',
        entityType: 'field',
        entityId: id,
        message: active ? 'audit.field.reactivate' : 'audit.field.deactivate',
        params: { label: current.label },
        changes: [{ path: 'active', old: !active, new: active }],
      });
      ctx.touch('fields');
      return loadField(ctx.tx, id);
    });
  }

  async function setOptionActive(optionId: Id, active: boolean): Promise<Mutation<FieldOption>> {
    const workspaceId = await workspaceOfOption(optionId);
    return mutate(deps, workspaceId, active ? 'option.reactivate' : 'option.deactivate', async (ctx) => {
      const current = await requireOption(ctx.tx, optionId);
      if ((current.deactivated_at === null) === active) return toFieldOption(current);
      if (active) await assertOptionLabelFree(ctx.tx, current.field_id, current.label, optionId);
      const now = ctx.clock.now().toISOString();
      const next: FieldOptionRecord = {
        ...current,
        deactivated_at: active ? null : now,
        merged_into_id: active ? null : current.merged_into_id,
        updated_at: now,
      };
      await ctx.tx.run('UPDATE field_options SET deactivated_at = ?, merged_into_id = ?, updated_at = ? WHERE id = ?', [
        next.deactivated_at,
        next.merged_into_id,
        now,
        optionId,
      ]);
      const changes: Change[] = [{ path: 'active', old: !active, new: active }];
      if (current.merged_into_id !== next.merged_into_id) {
        changes.push({ path: 'merged_into_id', old: current.merged_into_id, new: null });
      }
      await audit(ctx, workspaceId, {
        action: 'config',
        entityType: 'option',
        entityId: optionId,
        message: active ? 'audit.option.reactivate' : 'audit.option.deactivate',
        params: { label: current.label, fieldId: current.field_id },
        changes,
      });
      ctx.touch('field_options');
      return toFieldOption(next);
    });
  }

  async function optionUsage(tx: SqlExecutor, optionId: Id): Promise<number> {
    const r = await tx.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM transaction_field_values WHERE value_option_id = :id)
            + (SELECT COUNT(*) FROM field_options WHERE merged_into_id = :id) AS n`,
      { id: optionId },
    );
    return r?.n ?? 0;
  }

  const list: FieldsService['list'] = (workspaceId, opts = {}) =>
    readTx(deps, async (tx) => {
      await requireWorkspace(tx, workspaceId);
      return loadFields(tx, workspaceId, opts.includeInactive ?? false);
    });

  return {
    list,

    async formSchema(workspaceId, kind) {
      const fields = await list(workspaceId);
      return {
        fields: fields
          .filter((f) => appliesToKind(f.appliesTo, kind))
          .map((f) => ({ ...f, options: f.options.filter((o) => o.active && appliesToKind(o.appliesTo, kind)) })),
      };
    },

    async dimensions(workspaceId) {
      const fields = await list(workspaceId, { includeInactive: true });
      return fields.map((f) => ({ ...f, groupable: f.type !== 'number', filterable: true }));
    },

    async create(input) {
      return mutate(deps, input.workspaceId, 'field.create', async (ctx) => {
        const ws = await requireWorkspace(ctx.tx, input.workspaceId);
        if (ws.archived_at !== null) throw new DomainError('workspace_archived', { workspaceId: ws.id });
        const field = await insertFieldTx(ctx, {
          workspaceId: ws.id,
          label: input.label,
          type: input.type,
          ...(input.key !== undefined ? { key: input.key } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.appliesTo !== undefined ? { appliesTo: input.appliesTo } : {}),
          ...(input.showInList !== undefined ? { showInList: input.showInList } : {}),
          ...(input.options !== undefined ? { options: input.options } : {}),
        });
        await audit(ctx, ws.id, {
          action: 'create',
          entityType: 'field',
          entityId: field.id,
          message: 'audit.field.create',
          params: { label: field.label, type: field.type },
          changes: [{ path: '*', new: fieldSnapshot(field) }],
        });
        ctx.touch('fields');
        if (field.options.length > 0) ctx.touch('field_options');
        return field;
      });
    },

    async update(id, patch) {
      if (Object.hasOwn(patch, 'type')) throw new DomainError('field_type_immutable', { fieldId: id });
      const workspaceId = await workspaceOfField(id);
      return mutate(deps, workspaceId, 'field.update', async (ctx) => {
        const current = await requireField(ctx.tx, id);
        const next: FieldRecord = { ...current };
        if (patch.label !== undefined) next.label = cleanLabel(patch.label);
        if (patch.role !== undefined) {
          if (patch.role !== null) assertOneOf(FIELD_ROLES, patch.role, 'papel de campo');
          next.role = patch.role;
        }
        if (patch.appliesTo !== undefined) {
          assertOneOf(APPLIES, patch.appliesTo, 'appliesTo');
          next.applies_to = patch.appliesTo;
        }
        if (patch.showInList !== undefined) next.show_in_list = patch.showInList ? 1 : 0;
        const columns = [
          ['label', 'label'],
          ['role', 'role'],
          ['applies_to', 'appliesTo'],
          ['show_in_list', 'showInList'],
        ] as const;
        const changes: Change[] = columns
          .filter(([col]) => next[col] !== current[col])
          .map(([col, path]) => ({
            path,
            old: col === 'show_in_list' ? current[col] === 1 : current[col],
            new: col === 'show_in_list' ? next[col] === 1 : next[col],
          }));
        if (changes.length === 0) return loadField(ctx.tx, id);
        if (next.label !== current.label && current.deactivated_at === null) {
          await assertFieldLabelFree(ctx.tx, workspaceId, next.label, id);
        }
        next.updated_at = ctx.clock.now().toISOString();
        await ctx.tx.run('UPDATE fields SET label = ?, role = ?, applies_to = ?, show_in_list = ?, updated_at = ? WHERE id = ?', [
          next.label,
          next.role,
          next.applies_to,
          next.show_in_list,
          next.updated_at,
          id,
        ]);
        const renamed = next.label !== current.label;
        await audit(ctx, workspaceId, {
          action: 'edit',
          entityType: 'field',
          entityId: id,
          message: renamed ? 'audit.field.rename' : 'audit.field.edit',
          params: { label: next.label, ...(renamed ? { oldLabel: current.label } : {}) },
          changes,
        });
        ctx.touch('fields');
        return loadField(ctx.tx, id);
      });
    },

    async reorder(workspaceId, ids) {
      await mutate(deps, workspaceId, 'field.reorder', async (ctx) => {
        await requireWorkspace(ctx.tx, workspaceId);
        const rows = await ctx.tx.all<{ id: string }>('SELECT id FROM fields WHERE workspace_id = ?', [workspaceId]);
        const known = new Set(rows.map((r) => r.id));
        const unknown = ids.find((id) => !known.has(id));
        if (unknown !== undefined) throw new DomainError('not_found', { entity: 'field', id: unknown });
        if (new Set(ids).size !== ids.length) throw new RangeError('ids repetidos al ordenar campos');
        await ctx.tx.runMany(
          'UPDATE fields SET sort_order = ? WHERE id = ? AND sort_order <> ?',
          ids.map((id, i) => [i, id, i]),
        );
        ctx.touch('fields');
      });
    },

    deactivate: (id) => setFieldActive(id, false),
    reactivate: (id) => setFieldActive(id, true),

    async usage(id) {
      return readTx(deps, async (tx) => {
        await requireField(tx, id);
        const r = await tx.get<{ total: number; active: number; voided: number }>(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END), 0) AS active,
                  COALESCE(SUM(CASE WHEN t.status = 'voided' THEN 1 ELSE 0 END), 0) AS voided
           FROM transaction_field_values v JOIN transactions t ON t.id = v.transaction_id
           WHERE v.field_id = ?`,
          [id],
        );
        return { total: Number(r?.total ?? 0), active: Number(r?.active ?? 0), voided: Number(r?.voided ?? 0) };
      });
    },

    async delete(id) {
      const workspaceId = await workspaceOfField(id);
      await mutate(deps, workspaceId, 'field.delete', async (ctx) => {
        const field = await loadField(ctx.tx, id);
        const used = await ctx.tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM transaction_field_values WHERE field_id = ?', [id]);
        if ((used?.n ?? 0) > 0) throw new DomainError('field_in_use', { fieldId: id, count: used?.n });
        await ctx.tx.run('UPDATE field_options SET merged_into_id = NULL WHERE field_id = ?', [id]);
        await ctx.tx.run('DELETE FROM field_options WHERE field_id = ?', [id]);
        await ctx.tx.run('DELETE FROM fields WHERE id = ?', [id]);
        await audit(ctx, workspaceId, {
          action: 'config',
          entityType: 'field',
          entityId: id,
          message: 'audit.field.delete',
          params: { label: field.label, type: field.type },
          changes: [{ path: '*', old: fieldSnapshot(field) }],
        });
        ctx.touch('fields', 'field_options');
      });
    },

    async addOption(fieldId, input) {
      const workspaceId = await workspaceOfField(fieldId);
      return mutate(deps, workspaceId, 'option.create', async (ctx) => {
        const field = await requireField(ctx.tx, fieldId);
        if (field.type !== 'list') throw new DomainError('options_require_list_field', { fieldId, type: field.type });
        const [record] = await insertOptionsTx(ctx, fieldId, [
          {
            label: input.label,
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.appliesTo !== undefined ? { appliesTo: input.appliesTo } : {}),
          },
        ]);
        if (record === undefined) throw new DomainError('name_required', { field: 'label' });
        await audit(ctx, workspaceId, {
          action: 'create',
          entityType: 'option',
          entityId: record.id,
          message: 'audit.option.create',
          params: { label: record.label, fieldId, fieldLabel: field.label },
          changes: [{ path: '*', new: { fieldId, label: record.label, color: record.color, appliesTo: record.applies_to } }],
        });
        ctx.touch('field_options');
        return toFieldOption(record);
      });
    },

    async updateOption(optionId, patch) {
      const workspaceId = await workspaceOfOption(optionId);
      return mutate(deps, workspaceId, 'option.update', async (ctx) => {
        const current = await requireOption(ctx.tx, optionId);
        const next: FieldOptionRecord = { ...current };
        if (patch.label !== undefined) next.label = cleanLabel(patch.label);
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.appliesTo !== undefined) {
          assertOneOf(APPLIES, patch.appliesTo, 'appliesTo');
          next.applies_to = patch.appliesTo;
        }
        const columns = [
          ['label', 'label'],
          ['color', 'color'],
          ['applies_to', 'appliesTo'],
        ] as const;
        const changes: Change[] = columns
          .filter(([col]) => next[col] !== current[col])
          .map(([col, path]) => ({ path, old: current[col], new: next[col] }));
        if (changes.length === 0) return toFieldOption(current);
        if (next.label !== current.label && current.deactivated_at === null) {
          await assertOptionLabelFree(ctx.tx, current.field_id, next.label, optionId);
        }
        next.updated_at = ctx.clock.now().toISOString();
        await ctx.tx.run('UPDATE field_options SET label = ?, color = ?, applies_to = ?, updated_at = ? WHERE id = ?', [
          next.label,
          next.color,
          next.applies_to,
          next.updated_at,
          optionId,
        ]);
        const renamed = next.label !== current.label;
        await audit(ctx, workspaceId, {
          action: 'edit',
          entityType: 'option',
          entityId: optionId,
          message: renamed ? 'audit.option.rename' : 'audit.option.edit',
          params: { label: next.label, fieldId: current.field_id, ...(renamed ? { oldLabel: current.label } : {}) },
          changes,
        });
        ctx.touch('field_options');
        return toFieldOption(next);
      });
    },

    async reorderOptions(fieldId, ids) {
      const workspaceId = await workspaceOfField(fieldId);
      await mutate(deps, workspaceId, 'option.reorder', async (ctx) => {
        const rows = await ctx.tx.all<{ id: string }>('SELECT id FROM field_options WHERE field_id = ?', [fieldId]);
        const known = new Set(rows.map((r) => r.id));
        const unknown = ids.find((id) => !known.has(id));
        if (unknown !== undefined) throw new DomainError('not_found', { entity: 'option', id: unknown });
        if (new Set(ids).size !== ids.length) throw new RangeError('ids repetidos al ordenar opciones');
        await ctx.tx.runMany(
          'UPDATE field_options SET sort_order = ? WHERE id = ? AND sort_order <> ?',
          ids.map((id, i) => [i, id, i]),
        );
        ctx.touch('field_options');
      });
    },

    deactivateOption: (optionId) => setOptionActive(optionId, false),
    reactivateOption: (optionId) => setOptionActive(optionId, true),

    async deleteOption(optionId) {
      const workspaceId = await workspaceOfOption(optionId);
      await mutate(deps, workspaceId, 'option.delete', async (ctx) => {
        const current = await requireOption(ctx.tx, optionId);
        const uses = await optionUsage(ctx.tx, optionId);
        if (uses > 0) throw new DomainError('option_in_use', { optionId, count: uses });
        // Una opción fusionada sí se usó (sus valores viven ahora en el destino): queda como rastro.
        if (current.merged_into_id !== null) {
          throw new DomainError('option_in_use', { optionId, mergedIntoId: current.merged_into_id });
        }
        await ctx.tx.run('DELETE FROM field_options WHERE id = ?', [optionId]);
        await audit(ctx, workspaceId, {
          action: 'config',
          entityType: 'option',
          entityId: optionId,
          message: 'audit.option.delete',
          params: { label: current.label, fieldId: current.field_id },
          changes: [{ path: '*', old: { fieldId: current.field_id, label: current.label } }],
        });
        ctx.touch('field_options');
      });
    },

    async similarOptions(fieldId, label) {
      const wanted = labelKey(label);
      if (wanted === '') return [];
      const options = await readTx(deps, async (tx) => {
        await requireField(tx, fieldId);
        return tx.all<FieldOptionRecord>(
          `SELECT ${selectColumns('field_options')} FROM field_options
           WHERE field_id = ? AND deactivated_at IS NULL ORDER BY sort_order, created_at, id`,
          [fieldId],
        );
      });
      const threshold = similarityThreshold(wanted.length);
      return options
        .map((o) => {
          const candidate = labelKey(o.label);
          let score: number | null = null;
          if (candidate === wanted) score = 0;
          else if (wanted.length >= 3 && candidate.startsWith(wanted)) score = 0.5;
          else {
            const d = editDistance(candidate, wanted);
            if (d <= threshold) score = d;
          }
          return { option: o, score };
        })
        .filter((x): x is { option: FieldOptionRecord; score: number } => x.score !== null)
        .sort((a, b) => a.score - b.score)
        .map((x) => toFieldOption(x.option));
    },

    async mergeOptions(sourceId, targetId) {
      if (sourceId === targetId) throw new DomainError('merge_same_option', { optionId: sourceId });
      const workspaceId = await workspaceOfOption(sourceId);
      return mutate(deps, workspaceId, 'option.merge', async (ctx) => {
        const source = await requireOption(ctx.tx, sourceId);
        const target = await requireOption(ctx.tx, targetId);
        if (source.field_id !== target.field_id) {
          throw new DomainError('merge_different_field', { sourceId, targetId });
        }
        if (target.deactivated_at !== null) throw new DomainError('option_inactive', { optionId: targetId });
        const moved = await ctx.tx.all<{ transaction_id: string }>(
          'SELECT transaction_id FROM transaction_field_values WHERE value_option_id = ? ORDER BY transaction_id',
          [sourceId],
        );
        const now = ctx.clock.now().toISOString();
        await ctx.tx.run('UPDATE transaction_field_values SET value_option_id = ? WHERE value_option_id = ?', [targetId, sourceId]);
        // Lo que antes se fusionó en el origen apunta ahora al destino (sin cadenas).
        await ctx.tx.run('UPDATE field_options SET merged_into_id = ?, updated_at = ? WHERE merged_into_id = ?', [
          targetId,
          now,
          sourceId,
        ]);
        await ctx.tx.run('UPDATE field_options SET deactivated_at = ?, merged_into_id = ?, updated_at = ? WHERE id = ?', [
          source.deactivated_at ?? now,
          targetId,
          now,
          sourceId,
        ]);
        const fieldPath = `field:${source.field_id}`;
        await audit(ctx, workspaceId, {
          action: 'merge',
          entityType: 'option',
          entityId: sourceId,
          message: 'audit.option.merge',
          params: {
            fieldId: source.field_id,
            sourceLabel: source.label,
            targetId,
            targetLabel: target.label,
            movedCount: moved.length,
          },
          changes: [
            { path: 'merged_into_id', old: source.merged_into_id, new: targetId },
            // Una línea por movimiento afectado: su historial muestra el cambio de valor.
            ...moved.map((m) => ({ entityId: m.transaction_id, path: fieldPath, old: sourceId, new: targetId })),
          ],
        });
        ctx.touch('field_options');
        if (moved.length > 0) ctx.touch('transaction_field_values');
        return { movedCount: moved.length };
      });
    },
  };
}
