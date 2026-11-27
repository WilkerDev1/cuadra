// Estado y reglas puras del formulario de Nuevo movimiento / editar (DESIGN §10.6). Nada de React aquí: el
// componente guarda un `EntryState` y estas funciones deciden qué se envía al núcleo.
import type {
  AccountWithBalance,
  Field,
  FieldValue,
  FieldValues,
  Id,
  IsoDate,
  Minor,
  Transaction,
  TxDraft,
  TxPatch,
} from '../../../core';
import { normalizeSearch } from '../../../core';

export type EntryKind = 'income' | 'expense';

export interface EntryState {
  kind: EntryKind;
  accountId: Id | null;
  /** Expresión canónica del monto (`1500+350`). */
  expr: string;
  date: IsoDate;
  description: string;
  notes: string;
  values: FieldValues;
}

// ── Parámetros de la ruta ─────────────────────────────────────────────────────────────

export interface EntryParams {
  kind: EntryKind | 'transfer' | null;
  accountId: Id | null;
  /** `desde`: duplicar este movimiento. */
  fromTxId: Id | null;
  /** `editar`: editar este movimiento. */
  editId: Id | null;
}

const KIND_PARAM: Record<string, EntryKind | 'transfer'> = {
  entrada: 'income',
  salida: 'expense',
  transferencia: 'transfer',
  income: 'income',
  expense: 'expense',
  transfer: 'transfer',
};

const nonEmpty = (v: string | null): string | null => (v === null || v.trim() === '' ? null : v.trim());

/** `?tipo=entrada|salida&cuenta=&desde=&editar=` → parámetros tipados. Valores desconocidos se ignoran. */
export function parseEntryParams(search: URLSearchParams): EntryParams {
  const tipo = nonEmpty(search.get('tipo'));
  return {
    kind: tipo === null ? null : (KIND_PARAM[tipo.toLowerCase()] ?? null),
    accountId: nonEmpty(search.get('cuenta')),
    fromTxId: nonEmpty(search.get('desde')),
    editId: nonEmpty(search.get('editar')),
  };
}

/** Tipo → valor de `?tipo=`. */
export function kindParam(kind: EntryKind | 'transfer'): string {
  return kind === 'income' ? 'entrada' : kind === 'expense' ? 'salida' : 'transferencia';
}

// ── Cuentas ───────────────────────────────────────────────────────────────────────────

/** Primera cuenta activa entre las preferidas (por orden), o la primera activa. */
export function pickAccount(accounts: readonly AccountWithBalance[], preferred: ReadonlyArray<Id | null | undefined>): Id | null {
  const active = accounts.filter((a) => a.archivedAt === null);
  for (const id of preferred) {
    if (id === null || id === undefined) continue;
    if (active.some((a) => a.id === id)) return id;
  }
  return active[0]?.id ?? null;
}

// ── Campos ────────────────────────────────────────────────────────────────────────────

/** El campo de categoría (rol `category`, tipo lista) si el espacio lo tiene. */
export function categoryField<F extends Field>(fields: readonly F[]): F | undefined {
  return fields.find((f) => f.role === 'category' && f.type === 'list' && f.active);
}

export function fieldValueEquals(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'list' && b.type === 'list') return a.optionId === b.optionId;
  return 'value' in a && 'value' in b && a.value === b.value;
}

/** Solo los valores de campos que el formulario muestra para este tipo (el resto se descarta al cambiar de tipo). */
export function keepSchemaValues(values: FieldValues, fields: readonly Field[]): FieldValues {
  const ids = new Set(fields.map((f) => f.id));
  const out: FieldValues = {};
  for (const [id, v] of Object.entries(values)) if (ids.has(id)) out[id] = v;
  return out;
}

/** Concepto efectivo: el escrito o, si está vacío, el nombre de la categoría elegida (anotar en tres toques). */
export function resolveDescription(description: string, values: FieldValues, fields: readonly Field[]): string {
  const typed = description.trim();
  if (typed !== '') return typed;
  const cat = categoryField(fields);
  const v = cat === undefined ? undefined : values[cat.id];
  if (cat === undefined || v?.type !== 'list') return '';
  return cat.options.find((o) => o.id === v.optionId)?.label ?? '';
}

// ── Validación y borradores ───────────────────────────────────────────────────────────

export type EntryError = 'amount' | 'account' | 'description';

export function validateEntry(state: EntryState, minor: Minor | null, fields: readonly Field[]): EntryError[] {
  const errors: EntryError[] = [];
  if (minor === null || minor <= 0) errors.push('amount');
  if (state.accountId === null) errors.push('account');
  if (resolveDescription(state.description, state.values, fields) === '') errors.push('description');
  return errors;
}

/** Borrador para `transactions.create` / `check`. `null` si falta cuenta o monto. */
export function buildTxDraft(state: EntryState, minor: Minor | null, fields: readonly Field[]): TxDraft | null {
  if (state.accountId === null || minor === null || minor <= 0) return null;
  const notes = state.notes.trim();
  const values = keepSchemaValues(state.values, fields);
  return {
    accountId: state.accountId,
    kind: state.kind,
    amountMinor: minor,
    date: state.date,
    description: resolveDescription(state.description, state.values, fields),
    ...(notes === '' ? {} : { notes }),
    ...(Object.keys(values).length === 0 ? {} : { values }),
  };
}

/**
 * Valores que dejan de aplicar al cambiar de tipo al editar (`fromFields`: formulario del tipo original;
 * `toFields`: del tipo nuevo): un campo que solo existe para el tipo original, o una opción de lista que solo aplica
 * a él (Categoría «Ventas» en una salida). El formulario nuevo no los muestra, así que no deben quedarse ocultos.
 * Solo cuenta lo que el formulario original sí mostraba: opciones o campos ya desactivados siguen intactos.
 */
export function staleValues(
  values: FieldValues,
  fromFields: readonly Field[],
  toFields: readonly Field[],
): Array<{ field: Field; label: string }> {
  const out: Array<{ field: Field; label: string }> = [];
  for (const from of fromFields) {
    const v = values[from.id];
    if (v === undefined) continue;
    const to = toFields.find((f) => f.id === from.id);
    if (v.type === 'list') {
      const option = from.options.find((o) => o.id === v.optionId);
      if (option === undefined) continue; // opción inactiva o fusionada: no es de este cambio
      if (to === undefined || !to.options.some((o) => o.id === v.optionId)) out.push({ field: from, label: option.label });
    } else if (to === undefined) {
      out.push({ field: from, label: v.type === 'bool' ? '' : String(v.value) });
    }
  }
  return out;
}

/**
 * Parche mínimo para `transactions.update`: solo lo que cambió (valores vaciados → `null`). Si el tipo cambia y se
 * da el formulario del tipo original, los valores que ya no aplican se vacían (ver `staleValues`).
 */
export function buildPatch(
  original: Transaction,
  state: EntryState,
  minor: Minor,
  fields: readonly Field[],
  fromFields?: readonly Field[],
): TxPatch {
  const patch: TxPatch = {};
  if ((original.kind === 'income' || original.kind === 'expense') && state.kind !== original.kind) patch.kind = state.kind;
  const stale = patch.kind !== undefined && fromFields !== undefined ? staleValues(state.values, fromFields, fields) : [];
  const current: FieldValues = { ...state.values };
  for (const s of stale) delete current[s.field.id];
  if (minor !== original.amountMinor) patch.amountMinor = minor;
  if (state.date !== original.date) patch.date = state.date;
  const description = resolveDescription(state.description, current, fields);
  if (description !== original.description) patch.description = description;
  if (state.notes.trim() !== original.notes) patch.notes = state.notes.trim();
  const shown = new Set([...fields.map((f) => f.id), ...stale.map((s) => s.field.id)]);
  const values: Record<Id, FieldValue | null> = {};
  for (const id of new Set([...Object.keys(original.values), ...Object.keys(state.values)])) {
    if (!shown.has(id)) continue; // campos que el formulario no muestra (inactivos, de otro tipo): intactos
    const before = original.values[id];
    const after = current[id];
    if (fieldValueEquals(before, after)) continue;
    values[id] = after ?? null;
  }
  if (Object.keys(values).length > 0) patch.values = values;
  return patch;
}

export function isEmptyPatch(patch: TxPatch): boolean {
  return Object.keys(patch).length === 0;
}

/** ¿Hay algo que perder si se cierra la hoja? */
export function isDirty(initial: EntryState, current: EntryState): boolean {
  if (initial.expr !== current.expr || initial.description.trim() !== current.description.trim()) return true;
  if (initial.notes.trim() !== current.notes.trim() || initial.kind !== current.kind) return true;
  if (initial.accountId !== current.accountId || initial.date !== current.date) return true;
  const ids = new Set([...Object.keys(initial.values), ...Object.keys(current.values)]);
  for (const id of ids) if (!fieldValueEquals(initial.values[id], current.values[id])) return true;
  return false;
}

/** Tras «Guardar y otro»: se vacían monto, concepto y notas; cuenta, fecha, tipo y categoría se quedan (Ráfaga). */
export function nextEntry(state: EntryState): EntryState {
  return { ...state, expr: '', description: '', notes: '' };
}

// ── Sugerencias ───────────────────────────────────────────────────────────────────────

export interface Suggestion {
  description: string;
  uses: number;
  lastValues: FieldValues;
}

/** Elegir una sugerencia: pone el concepto y completa SOLO los campos vacíos con los últimos valores usados. */
export function applySuggestion(state: EntryState, s: Suggestion, fields: readonly Field[]): EntryState {
  const values: FieldValues = { ...state.values };
  for (const [id, v] of Object.entries(keepSchemaValues(s.lastValues, fields))) {
    if (values[id] === undefined) values[id] = v;
  }
  return { ...state, description: s.description, values };
}

/** Sugerencias que vale la pena mostrar: distintas de lo ya escrito, sin repetir y como mucho `limit`. */
export function visibleSuggestions(list: readonly Suggestion[], typed: string, limit = 3): Suggestion[] {
  const t = normalizeSearch(typed);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of list) {
    const k = normalizeSearch(s.description);
    if (k === t || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Categorías frecuentes ─────────────────────────────────────────────────────────────

/** Las `n` opciones más usadas (por número de movimientos) y, si faltan, las primeras de la lista. */
export function topOptions<O extends { id: Id }>(
  options: readonly O[],
  counts: ReadonlyArray<{ key: string | null; count: number }>,
  n = 6,
): O[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const ranked = [...counts]
    .filter((c) => c.key !== null && byId.has(c.key) && c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((c) => byId.get(c.key as Id) as O);
  const out = ranked.slice(0, n);
  for (const o of options) {
    if (out.length >= n) break;
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

// ── Prefill ───────────────────────────────────────────────────────────────────────────

export function stateFromTransaction(tx: Transaction, expr: string): EntryState {
  return {
    kind: tx.kind === 'income' ? 'income' : 'expense',
    accountId: tx.accountId,
    expr,
    date: tx.date,
    description: tx.description,
    notes: tx.notes,
    values: { ...tx.values },
  };
}
