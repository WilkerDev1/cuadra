// Compilador de filtros (ARCHITECTURE.md 3.4): TxFilter → fragmento WHERE con parámetros con nombre.
// Todos los criterios se combinan con AND (F-62). Los valores siempre van como parámetros; el único texto
// interpolado es el alias de la tabla, que se valida.
//
// Parámetros: el SQL usa `:f0`, `:f1`…; el objeto `params` usa las claves sin prefijo ('f0'), que es lo
// que aceptan los adaptadores (node:sqlite y sqlite-wasm aceptan ambas formas).
import type { Clock, SqlValue } from '../ports';
import { resolvePeriod } from '../recipes';
import { escapeLike, searchTerms } from '../text';
import type { FieldCondition, Id, TxFilter } from '../types';

export interface CompiledFilter {
  where: string;
  params: Record<string, SqlValue>;
}

export interface CompileFilterContext {
  workspaceId: Id;
  clock: Clock;
  /** Alias de la tabla transactions en la consulta (por defecto 't'). */
  alias?: string;
  /** Prefijo de los nombres de parámetro (por defecto 'f'), para combinar dos filtros en una consulta. */
  paramPrefix?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Params {
  readonly values: Record<string, SqlValue> = {};
  private n = 0;
  constructor(private readonly prefix: string) {}
  /** Registra un valor y devuelve su marcador (':f3'). */
  add(value: SqlValue): string {
    const name = `${this.prefix}${this.n++}`;
    this.values[name] = value;
    return `:${name}`;
  }
  list(values: readonly SqlValue[]): string {
    return values.map((v) => this.add(v)).join(', ');
  }
}

function fieldCondition(cond: FieldCondition, t: string, p: Params): string | null {
  // Condiciones vacías no restringen ni registran parámetros (node:sqlite rechaza parámetros sobrantes).
  if (cond.op === 'any_of' && cond.optionIds.length === 0) return null;
  if (cond.op === 'contains' && cond.value.trim() === '') return null;
  const field = p.add(cond.fieldId);
  const value = (extra: string) =>
    `EXISTS (SELECT 1 FROM transaction_field_values v WHERE v.transaction_id = ${t}.id AND v.field_id = ${field}${extra})`;
  switch (cond.op) {
    case 'any_of':
      return value(` AND v.value_option_id IN (${p.list(cond.optionIds)})`);
    case 'empty':
      return `NOT ${value('')}`;
    case 'not_empty':
      return value('');
    case 'is':
      // Sí/no: sin valor cuenta como "No" (F-65).
      return cond.value ? value(' AND v.value_bool = 1') : `NOT ${value(' AND v.value_bool = 1')}`;
    case 'contains': {
      const text = cond.value.trim();
      return value(` AND v.value_text LIKE ${p.add(`%${escapeLike(text)}%`)} ESCAPE '\\'`);
    }
    case 'between': {
      const parts: string[] = [];
      if (cond.min !== undefined) parts.push(` AND v.value_number >= ${p.add(cond.min)}`);
      if (cond.max !== undefined) parts.push(` AND v.value_number <= ${p.add(cond.max)}`);
      return parts.length === 0 ? value('') : value(parts.join(''));
    }
    case 'date_between': {
      const parts: string[] = [];
      if (cond.from !== undefined) parts.push(` AND v.value_date >= ${p.add(cond.from)}`);
      if (cond.to !== undefined) parts.push(` AND v.value_date <= ${p.add(cond.to)}`);
      return parts.length === 0 ? value('') : value(parts.join(''));
    }
  }
}

/**
 * Compila un filtro. Siempre incluye el espacio; el estado por defecto es 'active'.
 * Listas vacías (accountIds: [], kinds: [], optionIds: []) significan "sin restricción" (chip limpio).
 */
export function compileFilter(filter: TxFilter, ctx: CompileFilterContext): CompiledFilter {
  const t = ctx.alias ?? 't';
  const prefix = ctx.paramPrefix ?? 'f';
  if (!IDENT.test(t)) throw new RangeError(`alias inválido: ${t}`);
  if (!IDENT.test(prefix)) throw new RangeError(`prefijo inválido: ${prefix}`);
  const p = new Params(prefix);
  const where: string[] = [`${t}.workspace_id = ${p.add(ctx.workspaceId)}`];

  const status = filter.status ?? 'active';
  if (status !== 'all') where.push(`${t}.status = ${p.add(status)}`);

  const period = resolvePeriod(filter.period, ctx.clock);
  if (period.from !== null) where.push(`${t}.date >= ${p.add(period.from)}`);
  if (period.to !== null) where.push(`${t}.date <= ${p.add(period.to)}`);

  if (filter.accountIds && filter.accountIds.length > 0) {
    where.push(`${t}.account_id IN (${p.list(filter.accountIds)})`);
  }
  if (filter.kinds && filter.kinds.length > 0) where.push(`${t}.kind IN (${p.list(filter.kinds)})`);
  if (filter.amount?.min !== undefined) where.push(`${t}.amount_minor >= ${p.add(filter.amount.min)}`);
  if (filter.amount?.max !== undefined) where.push(`${t}.amount_minor <= ${p.add(filter.amount.max)}`);

  for (const term of searchTerms(filter.text ?? '')) {
    where.push(`${t}.search_text LIKE ${p.add(`%${escapeLike(term)}%`)} ESCAPE '\\'`);
  }
  if (filter.batchId !== undefined) where.push(`${t}.batch_id = ${p.add(filter.batchId)}`);

  for (const cond of filter.fields ?? []) {
    const sql = fieldCondition(cond, t, p);
    if (sql !== null) where.push(sql);
  }
  return { where: where.join(' AND '), params: p.values };
}
