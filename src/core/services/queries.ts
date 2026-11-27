// Consultas (ARCHITECTURE.md 2.3, 3.5): listados paginados con saldo corrido, totales, saldos, series,
// resúmenes agrupados, datos del inicio y el panel de escritorio.
//
// Reglas que se cumplen aquí:
// - Solo lectura: nada pasa por `mutate`, no hay historial ni eventos.
// - Dinero en enteros de unidad menor de principio a fin (SUM de SQLite sobre INTEGER); cualquier suma que
//   saliera de los enteros seguros lanza RangeError en vez de redondear.
// - Entradas/salidas solo cuentan income/expense; transferencias y saldos iniciales van en sus líneas (I-3).
// - Anulados fuera de saldos, totales, gráficas y resúmenes (I-8); los listados los muestran si se piden.
// - Pocas sentencias por llamada: cada una cruza postMessage hasta el worker en la web. Los listados piden la
//   página, sus valores, la contrapartida y el saldo corrido en UNA sentencia; el panel entero son seis.
import {
  addDays,
  addMonths,
  dayLabel,
  diffDays,
  enumeratePeriodKeys,
  isIsoDate,
  monthKey,
  monthLabel,
  monthRange,
  periodKey,
  systemClock,
  toIsoDate,
  type PeriodUnit,
} from '../dates';
import { DomainError } from '../errors';
import type { Clock, SqlExecutor, SqlValue } from '../ports';
import { describeFilter, isFiltered, parseViewRecipe, resolvePeriod, validateRecipe } from '../recipes';
import { compileFilter, type CompiledFilter } from '../sql/filter';
import {
  COLUMNS,
  toAccount,
  toBatch,
  toField,
  toFieldValue,
  toTransaction,
  toWorkspace,
  type AccountRecord,
  type BatchRecord,
  type FieldOptionRecord,
  type FieldRecord,
  type FieldValueRecord,
  type TransactionRecord,
  type WorkspaceRecord,
} from '../sql/rows';
import type {
  Account,
  AccountWithBalance,
  Batch,
  Currency,
  DateRange,
  Field,
  FieldCondition,
  FieldType,
  FieldValues,
  GroupBy,
  Id,
  IsoDate,
  Minor,
  Page,
  SummaryGroup,
  SummaryResult,
  Timestamp,
  Totals,
  Transaction,
  TransactionRow,
  TxFilter,
  TxKind,
  TxSort,
  Warning,
  Workspace,
} from '../types';
import type { CoreDeps } from '../uow';
import { readTx } from '../uow';
import { DUPLICATE_WINDOW_DAYS, similarDescriptions } from './validation';

/** Días hacia atrás en que el panel busca posibles duplicados. */
export const DASHBOARD_DUPLICATE_DAYS = 90;
/** Máximo de puntos de la serie diaria del panel. */
export const DASHBOARD_DAILY_MAX = 1_100;

export type { Page, SummaryGroup, SummaryResult, Totals } from '../types';

export interface HomeData {
  totalBalanceMinor: Minor;
  month: Totals;
  previousMonth: Totals;
  monthly: Array<{ key: string; inMinor: Minor; outMinor: Minor }>; // últimos 12 meses
  negativeAccounts: AccountWithBalance[];
  isEmpty: boolean;
  backup: { lastVerifiedAt: Timestamp | null; reminderDays: number; overdue: boolean };
}

// ── Panel de escritorio (amplía la interfaz de 1B: ver informe de 2C) ───────────────

export interface DashboardOptions {
  /** Periodo protagonista (KPIs, reparto, top). Por defecto este mes. */
  period?: DateRange;
  /** Meses de la serie de flujo y de saldo, terminando en el mes del periodo (1–60, por defecto 12). */
  months?: number;
  /** Paso de la serie de saldo (sparklines). Por defecto 'week'. */
  seriesUnit?: 'day' | 'week' | 'month';
  /** Dimensión del reparto. Por defecto: el campo con rol categoría, si no la primera lista, si no la cuenta. */
  breakdown?: GroupBy;
  /** Medida con la que se ordena el reparto. Por defecto 'out'. */
  measure?: 'in' | 'out' | 'net';
  /** Tamaño de los top de categorías y contactos (1–50, por defecto 5). */
  topLimit?: number;
  /** Últimos movimientos (0–50, por defecto 8). */
  recentLimit?: number;
}

export interface DashboardRange {
  from: IsoDate | null;
  to: IsoDate | null;
  label: string;
  totals: Totals;
}

export interface DashboardBreakdownGroup {
  key: string | null;
  label: string;
  color: string | null;
  inactive: boolean;
  current: { inMinor: Minor; outMinor: Minor; netMinor: Minor; count: number };
  previous: { inMinor: Minor; outMinor: Minor; netMinor: Minor; count: number } | null;
}

export interface DashboardTopItem {
  key: string;
  label: string;
  color: string | null;
  inactive: boolean;
  minor: Minor;
  count: number;
}

export interface DashboardData {
  currency: Currency;
  today: IsoDate;
  isEmpty: boolean;
  /** Saldo de todo el espacio (todas las cuentas, todo lo activo) y su cambio dentro del periodo. */
  balance: { totalMinor: Minor; periodChangeMinor: Minor };
  period: DashboardRange;
  /** Periodo anterior equivalente (mes → mes anterior, trimestre → trimestre anterior, n días → n días antes). */
  previousPeriod: DashboardRange | null;
  /** Flujo mensual (entradas, salidas, neto) de los últimos `months` meses; huecos en cero. */
  flow: Array<{ key: string; label: string; inMinor: Minor; outMinor: Minor; netMinor: Minor; count: number }>;
  /** Saldo al cierre de cada paso. `byAccount` incluye todas las cuentas (también archivadas). */
  series: { unit: 'day' | 'week' | 'month'; keys: string[]; totalMinor: Minor[]; byAccount: Record<Id, Minor[]> };
  /**
   * Un punto por día del periodo, hasta hoy o, si hay movimientos con fecha posterior, hasta el último de ellos
   * (sin pasar del fin del periodo): entradas y salidas del día y saldo total del espacio al cierre. Así sus
   * sumas son las de `period.totals`. Vacío si el espacio no tiene movimientos; como mucho 1 100 días (los
   * últimos), así "todo" no crece sin límite.
   */
  daily: Array<{ date: IsoDate; inMinor: Minor; outMinor: Minor; netMinor: Minor; balanceMinor: Minor; count: number }>;
  /** Saldo total al cierre del día anterior al primer punto de `daily` (de donde arranca la línea); 0 sin datos. */
  dailyOpeningMinor: Minor;
  /**
   * Saldo total al cierre de cada día del periodo anterior equivalente, con su apertura: la línea tenue de
   * comparación del panel. `null` sin periodo anterior o sin movimientos. Mismo tope de días que `daily`.
   */
  previousDaily: { openingMinor: Minor; balances: Array<{ date: IsoDate; balanceMinor: Minor }> } | null;
  /** Cuentas no archivadas con su saldo, en orden manual. */
  accounts: AccountWithBalance[];
  breakdown: {
    groupBy: GroupBy;
    field: { id: Id; label: string } | null;
    measure: 'in' | 'out' | 'net';
    groups: DashboardBreakdownGroup[];
  };
  top: Array<{
    role: 'category' | 'contact';
    field: { id: Id; label: string };
    byOut: DashboardTopItem[];
    byIn: DashboardTopItem[];
  }>;
  attention: {
    negativeAccounts: AccountWithBalance[];
    unbalancedBatches: Array<{ batch: Batch; sumMinor: Minor; differenceMinor: Minor }>;
    /**
     * Posibles duplicados de los últimos `days` días (misma regla que el aviso possible_duplicate: misma
     * cuenta, sentido y monto, a ≤ 3 días y descripción parecida; solo entradas y salidas activas). `items`:
     * la copia (la más reciente) y el original, como mucho 20, de lo más nuevo a lo más viejo.
     */
    possibleDuplicates: { count: number; days: number; items: Array<{ transactionId: Id; duplicateOfId: Id }> };
    backup: { lastVerifiedAt: Timestamp | null; daysSince: number | null; reminderDays: number; overdue: boolean };
  };
  recent: TransactionRow[];
  warnings: Warning[];
}

export interface QueriesService {
  listTransactions(
    workspaceId: Id,
    input: { filter: TxFilter; sort?: TxSort; limit?: number; cursor?: string },
  ): Promise<Page<TransactionRow> & { totals: Totals }>; // totales del conjunto filtrado completo
  /** Agrupado por día con subtotal diario, para la lista móvil. */
  listByDay(
    workspaceId: Id,
    input: { filter: TxFilter; limit?: number; cursor?: string },
  ): Promise<Page<{ date: IsoDate; inMinor: Minor; outMinor: Minor; items: TransactionRow[] }>>;
  totals(workspaceId: Id, filter: TxFilter): Promise<Totals>;
  balances(workspaceId: Id, opts?: { asOf?: IsoDate }): Promise<{ byAccount: Record<Id, Minor>; totalMinor: Minor }>;
  /** Serie de saldo diario/mensual (gráfica de línea). */
  balanceSeries(
    workspaceId: Id,
    input: { accountIds?: Id[]; period: DateRange; unit: 'day' | 'month' },
  ): Promise<Array<{ key: string; balanceMinor: Minor }>>;
  summarize(workspaceId: Id, input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy }): Promise<SummaryResult>;
  /** P-03 en una llamada. */
  home(workspaceId: Id, input?: { month?: string /* 'YYYY-MM' */ }): Promise<HomeData>;
  /** Panel de escritorio completo en una llamada (seis sentencias en una transacción de lectura). */
  dashboard(workspaceId: Id, opts?: DashboardOptions): Promise<DashboardData>;
}

// ═════════════════════════════ Ayudas internas (también las usa reports.ts) ═════════════════════════════

/** Monto con signo de una fila (`t` = alias). */
export const signedSql = (t = 't') => `CASE ${t}.direction WHEN 'in' THEN ${t}.amount_minor ELSE -${t}.amount_minor END`;

/** Entero seguro desde una celda SQL (NULL → 0). Nunca redondea: fuera de rango lanza. */
export function minorOf(v: SqlValue | undefined): Minor {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`suma fuera de los enteros seguros: ${String(v)}`);
  return n;
}
const intOf = (v: SqlValue | undefined): number => (v === null || v === undefined ? 0 : Number(v));

export function emptyTotals(): Totals {
  return {
    inMinor: 0,
    outMinor: 0,
    netMinor: 0,
    transfersInMinor: 0,
    transfersOutMinor: 0,
    openingsMinor: 0,
    count: 0,
    voidedCount: 0,
  };
}

export function addTotals(a: Totals, b: Totals): Totals {
  const add = (x: number, y: number) => {
    const r = x + y;
    if (!Number.isSafeInteger(r)) throw new RangeError('suma fuera de los enteros seguros');
    return r;
  };
  return {
    inMinor: add(a.inMinor, b.inMinor),
    outMinor: add(a.outMinor, b.outMinor),
    netMinor: add(a.netMinor, b.netMinor),
    transfersInMinor: add(a.transfersInMinor, b.transfersInMinor),
    transfersOutMinor: add(a.transfersOutMinor, b.transfersOutMinor),
    openingsMinor: add(a.openingsMinor, b.openingsMinor),
    count: a.count + b.count,
    voidedCount: a.voidedCount + b.voidedCount,
  };
}

/**
 * Columnas de totales (canónicas de 2.3). Los montos solo suman los activos del conjunto pedido (con
 * status 'voided' son cero: un anulado nunca suma, I-8). `count` cuenta las filas del conjunto pedido
 * (según el estado del filtro: activos por defecto) y `voidedCount` los anulados que cumplen el resto del
 * filtro, para que la UI pueda decir "3 anulados ocultos".
 */
function totalsColumns(t: string, status: TxFilter['status']): string {
  const active = status === 'voided' ? '0' : `${t}.status = 'active'`;
  const counted = status === 'all' ? '1' : status === 'voided' ? `${t}.status = 'voided'` : active;
  return [
    `SUM(CASE WHEN ${active} AND ${t}.kind = 'income' THEN ${t}.amount_minor ELSE 0 END) AS in_minor`,
    `SUM(CASE WHEN ${active} AND ${t}.kind = 'expense' THEN ${t}.amount_minor ELSE 0 END) AS out_minor`,
    `SUM(CASE WHEN ${active} AND ${t}.kind = 'transfer' AND ${t}.direction = 'in' THEN ${t}.amount_minor ELSE 0 END) AS tin_minor`,
    `SUM(CASE WHEN ${active} AND ${t}.kind = 'transfer' AND ${t}.direction = 'out' THEN ${t}.amount_minor ELSE 0 END) AS tout_minor`,
    `SUM(CASE WHEN ${active} AND ${t}.kind = 'opening' THEN ${signedSql(t)} ELSE 0 END) AS open_minor`,
    `SUM(CASE WHEN ${counted} THEN 1 ELSE 0 END) AS cnt`,
    `SUM(CASE WHEN ${t}.status = 'voided' THEN 1 ELSE 0 END) AS vcnt`,
  ].join(', ');
}

function totalsFromRow(r: Record<string, SqlValue> | undefined): Totals {
  if (r === undefined) return emptyTotals();
  const inMinor = minorOf(r['in_minor']);
  const outMinor = minorOf(r['out_minor']);
  return {
    inMinor,
    outMinor,
    netMinor: minorOf(inMinor - outMinor),
    transfersInMinor: minorOf(r['tin_minor']),
    transfersOutMinor: minorOf(r['tout_minor']),
    openingsMinor: minorOf(r['open_minor']),
    count: intOf(r['cnt']),
    voidedCount: intOf(r['vcnt']),
  };
}

/** Forma del filtro (fechas reales, montos enteros, operadores conocidos) → copia; si no, invalid_recipe. */
export function checkFilter(filter: unknown): TxFilter {
  const parsed = parseViewRecipe({ v: 1, kind: 'filter', filter: filter ?? {} });
  if (!parsed.ok) throw new DomainError('invalid_recipe', { path: parsed.error });
  return parsed.value.filter;
}

function checkDate(value: unknown, name: string): IsoDate {
  if (!isIsoDate(value)) throw new DomainError('invalid_date', { [name]: value });
  return value;
}

function clampInt(value: number | undefined, def: number, min: number, max: number): number {
  if (value === undefined) return def;
  if (!Number.isInteger(value)) throw new RangeError(`se esperaba un entero: ${String(value)}`);
  return Math.min(max, Math.max(min, value));
}

/** Sin `period` ni `status` (para recomponerlos). */
export function withoutPeriod(filter: TxFilter): TxFilter {
  const copy: TxFilter = { ...filter };
  delete copy.period;
  return copy;
}

export function withStatus(filter: TxFilter, status: 'active' | 'voided' | 'all'): TxFilter {
  return { ...filter, status };
}

/** Una sola cuenta en el filtro → hay saldo corrido. */
export function singleAccountOf(filter: TxFilter): Id | null {
  return filter.accountIds?.length === 1 ? (filter.accountIds[0] ?? null) : null;
}

// ── Contexto del espacio en UNA sentencia ────────────────────────────────────────────

export interface AccountStats {
  balanceMinor: Minor;
  lastMovementDate: IsoDate | null;
  openingTransactionId: Id | null;
}

export interface WsContext {
  workspace: Workspace;
  accounts: Account[];
  fields: Field[];
  settings: Record<string, unknown>;
  /** Saldo inicial de cada cuenta (cualquier estado): cuenta → id del movimiento. */
  openings: Map<Id, Id>;
  /** Lotes con total de control que no cuadran (o con descuadre aceptado) y aún tienen activos. */
  unbalanced: Array<{ batch: Batch; sumMinor: Minor; differenceMinor: Minor }>;
}

const jsonObject = (cols: readonly string[], alias: string) =>
  `json_object(${cols.map((c) => `'${c}', ${alias}.${c}`).join(', ')})`;

/**
 * Lee espacio, cuentas, campos con opciones y, si se piden, ajustes y lotes descuadrados.
 * Lanza not_found si el espacio no existe.
 */
export async function loadContext(
  exec: SqlExecutor,
  workspaceId: Id,
  opts: { settings?: string[]; unbalanced?: boolean } = {},
): Promise<WsContext> {
  const params: Record<string, SqlValue> = { ws: workspaceId };
  const extra: string[] = [];
  if (opts.settings && opts.settings.length > 0) {
    const names = opts.settings.map((key, i) => {
      params[`sk${i}`] = key;
      return `:sk${i}`;
    });
    extra.push(
      `(SELECT json_group_object(s.key, json(s.value)) FROM settings s WHERE s.scope_id = '' AND s.key IN (${names.join(', ')})) AS settings_json`,
    );
  }
  if (opts.unbalanced) {
    extra.push(
      `(SELECT json_group_array(json_array(${jsonObject(COLUMNS.batches, 'y')}, y.s, y.ac, y.vc, y.rc)) FROM (
         SELECT b.*, COALESCE(SUM(CASE WHEN t.status = 'active' THEN t.amount_minor END), 0) AS s,
                SUM(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END) AS ac,
                SUM(CASE WHEN t.status = 'voided' THEN 1 ELSE 0 END) AS vc,
                SUM(CASE WHEN t.status = 'voided' AND t.voided_with_batch = 1 THEN 1 ELSE 0 END) AS rc
         FROM batches b JOIN transactions t ON t.batch_id = b.id
         WHERE b.workspace_id = w.id AND b.control_total_minor IS NOT NULL
         GROUP BY b.id
         HAVING ac > 0 AND (s <> b.control_total_minor OR b.control_mismatch_accepted = 1)) y) AS unbalanced_json`,
    );
  }
  const sql = `SELECT w.*,
      (SELECT json_group_array(${jsonObject(COLUMNS.accounts, 'a')}) FROM accounts a WHERE a.workspace_id = w.id) AS accounts_json,
      (SELECT json_group_array(${jsonObject(COLUMNS.fields, 'f')}) FROM fields f WHERE f.workspace_id = w.id) AS fields_json,
      (SELECT json_group_array(${jsonObject(COLUMNS.field_options, 'o')}) FROM field_options o
         WHERE o.field_id IN (SELECT id FROM fields WHERE workspace_id = w.id)) AS options_json,
      (SELECT json_group_array(json_array(x.account_id, x.id)) FROM transactions x
         WHERE x.kind = 'opening' AND x.account_id IN (SELECT id FROM accounts WHERE workspace_id = w.id)) AS openings_json
      ${extra.map((e) => `, ${e}`).join('')}
    FROM workspaces w WHERE w.id = :ws`;
  const row = await exec.get(sql, params);
  if (row === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });

  const parse = <T>(v: SqlValue | undefined, fallback: T): T =>
    typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  const accounts = parse<AccountRecord[]>(row['accounts_json'], [])
    .map(toAccount)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es') || (a.id < b.id ? -1 : 1));
  const options = parse<FieldOptionRecord[]>(row['options_json'], []);
  const fields = parse<FieldRecord[]>(row['fields_json'], [])
    .map((f) => toField(f, options))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));
  const unbalanced = parse<Array<[BatchRecord, number, number, number, number]>>(row['unbalanced_json'], []).map(
    ([b, s, ac, vc, rc]) => {
      const batch = toBatch({ ...b, active_count: ac, voided_count: vc, restorable_count: rc });
      const sumMinor = minorOf(s);
      return { batch, sumMinor, differenceMinor: minorOf(sumMinor - (batch.controlTotalMinor ?? 0)) };
    },
  );
  return {
    workspace: toWorkspace(row as unknown as WorkspaceRecord),
    accounts,
    fields,
    settings: parse<Record<string, unknown>>(row['settings_json'], {}),
    openings: new Map(parse<Array<[Id, Id]>>(row['openings_json'], [])),
    unbalanced,
  };
}

export function withBalance(account: Account, stats: AccountStats | undefined): AccountWithBalance {
  const balanceMinor = stats?.balanceMinor ?? 0;
  return {
    ...account,
    balanceMinor,
    lastMovementDate: stats?.lastMovementDate ?? null,
    isNegative: balanceMinor < 0,
    openingTransactionId: stats?.openingTransactionId ?? null,
  };
}

async function assertWorkspace(exec: SqlExecutor, workspaceId: Id): Promise<void> {
  const row = await exec.get('SELECT 1 AS ok FROM workspaces WHERE id = ?', [workspaceId]);
  if (row === undefined) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
}

// ── Filas de movimiento con valores, contrapartida y saldo corrido en UNA sentencia ──

interface OrderSpec {
  columns: string[]; // columnas de transactions, sin alias
  dir: 'asc' | 'desc';
}

/** Orden total y estable para cada TxSort. Con una sola cuenta, el empate por fecha es seq (orden del saldo). */
export function orderFor(sort: TxSort, single: boolean): OrderSpec {
  switch (sort.by) {
    case 'date':
      return { columns: single ? ['date', 'seq'] : ['date', 'recorded_at', 'id'], dir: sort.dir };
    case 'amount':
      return { columns: ['amount_minor', 'date', 'id'], dir: sort.dir };
    case 'recorded_at':
      return { columns: ['recorded_at', 'id'], dir: sort.dir };
    case 'seq':
      return { columns: single ? ['seq'] : ['seq', 'id'], dir: sort.dir };
  }
}

const orderBy = (o: OrderSpec, alias: string) => o.columns.map((c) => `${alias}.${c} ${o.dir.toUpperCase()}`).join(', ');

export interface RowQuery {
  where: string;
  params: Record<string, SqlValue>;
  order: OrderSpec;
  /** Valores del último elemento de la página anterior (en el orden de `order.columns`). */
  after?: readonly SqlValue[] | null;
  limit?: number | null;
  /** Calcula `running_minor` sobre TODA la cuenta (activos), en orden fecha + seq (2.3). */
  runningAccountId?: Id | null;
}

type RowRecord = TransactionRecord & { vals: string; cp: string | null; running_minor: number | null };

export async function selectRows(exec: SqlExecutor, q: RowQuery): Promise<TransactionRow[]> {
  const params: Record<string, SqlValue> = { ...q.params };
  let where = q.where;
  if (q.after && q.after.length > 0) {
    const marks = q.after.map((v, i) => {
      params[`k${i}`] = v;
      return `:k${i}`;
    });
    const cols = q.order.columns.map((c) => `t.${c}`);
    where += ` AND (${cols.join(', ')}) ${q.order.dir === 'desc' ? '<' : '>'} (${marks.join(', ')})`;
  }
  let limit = '';
  if (q.limit !== undefined && q.limit !== null) {
    params['lim'] = q.limit;
    limit = ' LIMIT :lim';
  }
  let runningCol = 'NULL AS running_minor';
  let runningJoin = '';
  if (q.runningAccountId) {
    params['racc'] = q.runningAccountId;
    runningCol = 'r.running_minor';
    runningJoin = `LEFT JOIN (
        SELECT x.id, SUM(CASE WHEN x.status = 'active' THEN ${signedSql('x')} ELSE 0 END)
               OVER (ORDER BY x.date, x.seq ROWS UNBOUNDED PRECEDING) AS running_minor
        FROM transactions x
        WHERE x.account_id = :racc AND x.date <= (SELECT MAX(date) FROM page)
      ) r ON r.id = p.id`;
  }
  const sql = `WITH page AS (
      SELECT t.* FROM transactions t WHERE ${where} ORDER BY ${orderBy(q.order, 't')}${limit}
    )
    SELECT p.*,
      (SELECT json_group_array(json_array(v.field_id, v.value_text, v.value_number, v.value_date, v.value_option_id, v.value_bool))
         FROM transaction_field_values v WHERE v.transaction_id = p.id) AS vals,
      (SELECT json_array(o.account_id, o.id, o.seq) FROM transactions o
         WHERE p.transfer_group_id IS NOT NULL AND o.transfer_group_id = p.transfer_group_id AND o.id <> p.id) AS cp,
      ${runningCol}
    FROM page p ${runningJoin}
    ORDER BY ${orderBy(q.order, 'p')}`;
  const rows = await exec.all<RowRecord>(sql, params);
  return rows.map(rowFromRecord);
}

function rowFromRecord(r: RowRecord): TransactionRow {
  const values: FieldValues = {};
  for (const [field_id, value_text, value_number, value_date, value_option_id, value_bool] of JSON.parse(r.vals) as Array<
    [Id, string | null, number | null, string | null, Id | null, number | null]
  >) {
    const rec: FieldValueRecord = {
      transaction_id: r.id,
      field_id,
      value_text,
      value_number,
      value_date,
      value_option_id,
      value_bool,
    };
    values[field_id] = toFieldValue(rec);
  }
  let counterpart: Transaction['counterpart'] = null;
  if (r.cp !== null) {
    const [accountId, transactionId, seq] = JSON.parse(r.cp) as [Id, Id, number];
    counterpart = { accountId, transactionId, seq };
  }
  const tx = toTransaction(r, values, counterpart);
  return { ...tx, runningMinor: r.running_minor === null ? null : minorOf(r.running_minor) };
}

// ── Cursor (keyset) ──────────────────────────────────────────────────────────────────

function encodeCursor(sig: string, values: readonly SqlValue[]): string {
  return btoa(JSON.stringify({ s: sig, k: values })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string | undefined, sig: string, size: number): SqlValue[] | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { s?: unknown; k?: unknown };
    if (
      parsed.s === sig &&
      Array.isArray(parsed.k) &&
      parsed.k.length === size &&
      parsed.k.every((v) => typeof v === 'string' || typeof v === 'number')
    ) {
      return parsed.k as SqlValue[];
    }
  } catch {
    // cae al error de abajo
  }
  throw new DomainError('invalid_recipe', { path: 'cursor' });
}

const cursorValues = (row: TransactionRow, order: OrderSpec): SqlValue[] =>
  order.columns.map((c) => {
    switch (c) {
      case 'date':
        return row.date;
      case 'seq':
        return row.seq;
      case 'recorded_at':
        return row.recordedAt;
      case 'amount_minor':
        return row.amountMinor;
      default:
        return row.id;
    }
  });

const SORTS = new Set(['date', 'amount', 'recorded_at', 'seq']);
function checkSort(sort: TxSort | undefined): TxSort {
  const s = sort ?? { by: 'date', dir: 'desc' };
  if (!SORTS.has(s.by) || (s.dir !== 'asc' && s.dir !== 'desc')) {
    throw new DomainError('invalid_recipe', { path: 'sort' });
  }
  return s;
}

// ── Totales ──────────────────────────────────────────────────────────────────────────

/** Totales del filtro (una sentencia). Comprueba además que el espacio exista. */
export async function queryTotals(
  exec: SqlExecutor,
  workspaceId: Id,
  filter: TxFilter,
  clock: Clock,
): Promise<Totals> {
  const compiled = compileFilter(withStatus(filter, 'all'), { workspaceId, clock });
  const row = await exec.get(
    `SELECT ${totalsColumns('t', filter.status ?? 'active')},
       (SELECT COUNT(*) FROM workspaces WHERE id = :ws) AS ws_exists
     FROM transactions t WHERE ${compiled.where}`,
    { ...compiled.params, ws: workspaceId },
  );
  if (intOf(row?.['ws_exists']) === 0) throw new DomainError('not_found', { entity: 'workspace', id: workspaceId });
  return totalsFromRow(row);
}

// ── Dimensiones de agrupación ───────────────────────────────────────────────────────

interface GroupMeta {
  label: string;
  color: string | null;
  inactive: boolean;
}
interface Agg {
  inMinor: Minor;
  outMinor: Minor;
  count: number;
}

export interface Dimension {
  groupBy: GroupBy;
  join: string;
  expr: string;
  params: Record<string, SqlValue>;
  /** Clave final desde la cruda de SQL (la semana se pliega aquí). */
  key(raw: SqlValue | undefined): string | null;
  meta(key: string | null): GroupMeta;
  /** Claves en orden de presentación, incluidas las de relleno. */
  order(present: Map<string | null, Agg>): Array<string | null>;
}

const NO_VALUE = 'Sin valor';
const KIND_LABELS: Record<TxKind, string> = {
  income: 'Entrada',
  expense: 'Salida',
  transfer: 'Transferencia',
  opening: 'Saldo inicial',
};

/** Primer día del periodo de una clave. */
export function periodKeyStart(key: string, unit: PeriodUnit): IsoDate {
  switch (unit) {
    case 'day':
    case 'week':
      return key;
    case 'month':
      return `${key}-01`;
    case 'quarter': {
      const q = Number(key.slice(6));
      return `${key.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${key}-01-01`;
  }
}

/** Último día del periodo de una clave. */
export function periodKeyEnd(key: string, unit: PeriodUnit): IsoDate {
  const start = periodKeyStart(key, unit);
  switch (unit) {
    case 'day':
      return start;
    case 'week':
      return addDays(start, 6);
    case 'month':
      return monthRange(key).to;
    case 'quarter':
      return addDays(addMonths(start, 3), -1);
    case 'year':
      return `${key}-12-31`;
  }
}

export function periodKeyLabel(key: string, unit: PeriodUnit): string {
  switch (unit) {
    case 'day':
      return dayLabel(key);
    case 'week':
      return `Semana del ${dayLabel(key)}`;
    case 'month':
      return monthLabel(key);
    case 'quarter':
      return `T${key.slice(6)} ${key.slice(0, 4)}`;
    case 'year':
      return key;
  }
}

const byTotalDesc = (present: Map<string | null, Agg>) => (a: string | null, b: string | null) => {
  const x = present.get(a);
  const y = present.get(b);
  return (y ? y.inMinor + y.outMinor : 0) - (x ? x.inMinor + x.outMinor : 0);
};
const nullLast = (keys: Array<string | null>) => [...keys.filter((k) => k !== null), ...keys.filter((k) => k === null)];

export function buildDimension(
  g: GroupBy,
  ctx: { accounts: Account[]; fields: Field[]; range: { from: IsoDate | null; to: IsoDate | null }; kinds?: TxKind[]; locale: string },
  alias: string,
): Dimension {
  switch (g.by) {
    case 'period': {
      const unit = g.unit;
      const expr =
        unit === 'month'
          ? 'substr(t.date, 1, 7)'
          : unit === 'year'
            ? 'substr(t.date, 1, 4)'
            : unit === 'quarter'
              ? "substr(t.date, 1, 4) || '-Q' || ((CAST(substr(t.date, 6, 2) AS INTEGER) + 2) / 3)"
              : 't.date';
      return {
        groupBy: g,
        join: '',
        expr,
        params: {},
        key: (raw) => (unit === 'week' ? periodKey(String(raw), 'week') : String(raw)),
        meta: (key) => ({ label: key === null ? NO_VALUE : periodKeyLabel(key, unit), color: null, inactive: false }),
        order(present) {
          const keys = [...present.keys()].filter((k): k is string => k !== null).sort();
          const from = ctx.range.from ?? (keys[0] !== undefined ? periodKeyStart(keys[0], unit) : null);
          const last = keys.at(-1);
          const to = ctx.range.to ?? (last !== undefined ? periodKeyEnd(last, unit) : null);
          const filled = from !== null && to !== null ? enumeratePeriodKeys(from, to, unit) : [];
          return [...new Set([...filled, ...keys])].sort();
        },
      };
    }
    case 'account': {
      const byId = new Map(ctx.accounts.map((a) => [a.id, a]));
      return {
        groupBy: g,
        join: '',
        expr: 't.account_id',
        params: {},
        key: (raw) => (raw === null || raw === undefined ? null : String(raw)),
        meta: (key) => {
          const a = key === null ? undefined : byId.get(key);
          return { label: a?.name ?? '(cuenta desconocida)', color: a?.color ?? null, inactive: a?.archivedAt != null };
        },
        order: (present) => {
          const known = ctx.accounts.map((a) => a.id).filter((id) => present.has(id));
          const rest = [...present.keys()].filter((k) => k !== null && !byId.has(k));
          return [...known, ...rest];
        },
      };
    }
    case 'kind': {
      const allowed = (['income', 'expense'] as const).filter((k) => !ctx.kinds?.length || ctx.kinds.includes(k));
      return {
        groupBy: g,
        join: '',
        expr: 't.kind',
        params: {},
        key: (raw) => String(raw),
        meta: (key) => ({ label: KIND_LABELS[key as TxKind] ?? String(key), color: null, inactive: false }),
        order: (present) => [...new Set([...allowed, ...[...present.keys()].filter((k): k is string => k !== null)])],
      };
    }
    case 'field': {
      const field = ctx.fields.find((f) => f.id === g.fieldId);
      const p = `${alias}f`;
      const join = `LEFT JOIN transaction_field_values ${alias} ON ${alias}.transaction_id = t.id AND ${alias}.field_id = :${p}`;
      const params = { [p]: g.fieldId };
      const type = field?.type ?? 'text';
      switch (type) {
        case 'list': {
          const options = field?.options ?? [];
          const byId = new Map(options.map((o) => [o.id, o]));
          return {
            groupBy: g,
            join,
            expr: `${alias}.value_option_id`,
            params,
            key: (raw) => (raw === null || raw === undefined ? null : String(raw)),
            meta: (key) => {
              if (key === null) return { label: NO_VALUE, color: null, inactive: false };
              const o = byId.get(key);
              return { label: o?.label ?? '(opción desconocida)', color: o?.color ?? null, inactive: o ? !o.active : true };
            },
            order: (present) => {
              const known = options.map((o) => o.id).filter((id) => present.has(id));
              const rest = [...present.keys()].filter((k) => k !== null && !byId.has(k)) as string[];
              return [...known, ...rest, ...(present.has(null) ? [null] : [])];
            },
          };
        }
        case 'bool':
          // Sí/no: sin valor cuenta como "No" (F-65), igual que el filtro, para que el clic abra lo mismo.
          return {
            groupBy: g,
            join,
            expr: `CASE WHEN ${alias}.value_bool = 1 THEN 'true' ELSE 'false' END`,
            params,
            key: (raw) => String(raw),
            meta: (key) => ({ label: key === 'true' ? 'Sí' : 'No', color: null, inactive: false }),
            order: () => ['true', 'false'], // dominio fijo: siempre los dos, en cero si no hay
          };
        case 'number': {
          const fmt = new Intl.NumberFormat(ctx.locale);
          return {
            groupBy: g,
            join,
            expr: `${alias}.value_number`,
            params,
            key: (raw) => (raw === null || raw === undefined ? null : String(raw)),
            meta: (key) => ({ label: key === null ? NO_VALUE : fmt.format(Number(key)), color: null, inactive: false }),
            order: (present) =>
              nullLast([...present.keys()].sort((a, b) => (a === null || b === null ? 0 : Number(a) - Number(b)))),
          };
        }
        case 'date':
          return {
            groupBy: g,
            join,
            expr: `substr(${alias}.value_date, 1, 7)`,
            params,
            key: (raw) => (raw === null || raw === undefined ? null : String(raw)),
            meta: (key) => ({ label: key === null ? NO_VALUE : monthLabel(key), color: null, inactive: false }),
            order: (present) => nullLast([...present.keys()].sort()),
          };
        case 'text':
          return {
            groupBy: g,
            join,
            expr: `${alias}.value_text`,
            params,
            key: (raw) => (raw === null || raw === undefined ? null : String(raw)),
            meta: (key) => ({ label: key ?? NO_VALUE, color: null, inactive: false }),
            order: (present) =>
              nullLast(
                [...present.keys()].sort(
                  (a, b) => byTotalDesc(present)(a, b) || String(a).localeCompare(String(b), 'es'),
                ),
              ),
          };
      }
    }
  }
}

function toGroup(key: string | null, meta: GroupMeta, agg: Agg | undefined): SummaryGroup {
  const inMinor = agg?.inMinor ?? 0;
  const outMinor = agg?.outMinor ?? 0;
  return {
    key,
    label: meta.label,
    color: meta.color,
    inactive: meta.inactive,
    inMinor,
    outMinor,
    netMinor: minorOf(inMinor - outMinor),
    count: agg?.count ?? 0,
  };
}

/**
 * Agrupa los movimientos activos income/expense del filtro por una o dos dimensiones (una sentencia).
 * La suma de los grupos coincide con totals.inMinor/outMinor del mismo filtro (I-13).
 */
export async function queryGroups(
  exec: SqlExecutor,
  input: {
    workspaceId: Id;
    filter: TxFilter;
    clock: Clock;
    first: Dimension;
    second?: Dimension | undefined;
  },
): Promise<SummaryGroup[]> {
  const compiled = compileFilter(withStatus(input.filter, 'active'), { workspaceId: input.workspaceId, clock: input.clock });
  const d1 = input.first;
  const d2 = input.second;
  const sql = `SELECT ${d1.expr} AS k1${d2 ? `, ${d2.expr} AS k2` : ''},
      SUM(CASE WHEN t.kind = 'income' THEN t.amount_minor ELSE 0 END) AS i,
      SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS o,
      COUNT(*) AS c
    FROM transactions t ${d1.join} ${d2?.join ?? ''}
    WHERE ${compiled.where} AND t.kind IN ('income', 'expense')
    GROUP BY k1${d2 ? ', k2' : ''}`;
  const rows = await exec.all(sql, { ...compiled.params, ...d1.params, ...(d2?.params ?? {}) });

  const top = new Map<string | null, Agg & { sub: Map<string | null, Agg> }>();
  const bump = (agg: Agg, r: Record<string, SqlValue>) => {
    agg.inMinor = minorOf(agg.inMinor + minorOf(r['i']));
    agg.outMinor = minorOf(agg.outMinor + minorOf(r['o']));
    agg.count += intOf(r['c']);
  };
  for (const r of rows) {
    const k1 = d1.key(r['k1']);
    let a = top.get(k1);
    if (a === undefined) {
      a = { inMinor: 0, outMinor: 0, count: 0, sub: new Map() };
      top.set(k1, a);
    }
    bump(a, r);
    if (d2) {
      const k2 = d2.key(r['k2']);
      let s = a.sub.get(k2);
      if (s === undefined) {
        s = { inMinor: 0, outMinor: 0, count: 0 };
        a.sub.set(k2, s);
      }
      bump(s, r);
    }
  }
  return d1.order(top).map((k1) => {
    const agg = top.get(k1);
    const group = toGroup(k1, d1.meta(k1), agg);
    if (d2) {
      const sub = agg?.sub ?? new Map<string | null, Agg>();
      group.split = d2.order(sub).map((k2) => toGroup(k2, d2.meta(k2), sub.get(k2)));
    }
    return group;
  });
}

// ── Resumen (también lo usan los informes) ───────────────────────────────────────────

export async function summarizeWith(
  exec: SqlExecutor,
  deps: Pick<CoreDeps, 'clock' | 'locale'>,
  ctx: WsContext,
  input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy | undefined },
): Promise<SummaryResult> {
  const workspaceId = ctx.workspace.id;
  const recipe = {
    v: 1 as const,
    kind: 'summary' as const,
    filter: input.filter,
    groupBy: input.groupBy,
    measure: 'both' as const,
    chart: 'table' as const,
    ...(input.split ? { split: input.split } : {}),
  };
  const shape = parseViewRecipe(recipe);
  if (!shape.ok) throw new DomainError('invalid_recipe', { path: shape.error });
  const validated = validateRecipe(shape.value as typeof recipe, ctx.fields);
  const filter = validated.recipe.filter;
  const period = resolvePeriod(filter.period, deps.clock);
  const dimCtx = { accounts: ctx.accounts, fields: ctx.fields, range: period, locale: deps.locale, ...(filter.kinds ? { kinds: filter.kinds } : {}) };
  const first = buildDimension(validated.recipe.groupBy, dimCtx, 'g1');
  const second = validated.recipe.split ? buildDimension(validated.recipe.split, dimCtx, 'g2') : undefined;
  const groups = await queryGroups(exec, { workspaceId, filter, clock: deps.clock, first, second });
  const totals = await queryTotals(exec, workspaceId, withStatus(filter, 'active'), deps.clock);
  return {
    groups,
    totals,
    period,
    filtered: isFiltered(filter),
    filterDescription: describeFilter(filter, {
      fields: ctx.fields,
      accounts: ctx.accounts,
      currency: ctx.workspace.currency,
      locale: deps.locale,
    }),
    warnings: validated.warnings,
  };
}

// ── Periodos relativos ───────────────────────────────────────────────────────────────

/**
 * Periodo anterior equivalente: si el rango son meses completos, los mismos meses justo antes
 * (mes → mes anterior, trimestre → trimestre anterior, año → año anterior); si no, el mismo número de días
 * justo antes. Sin límites (todo el historial) no hay periodo anterior.
 */
export function previousRange(from: IsoDate | null, to: IsoDate | null): { from: IsoDate; to: IsoDate } | null {
  if (from === null || to === null || from > to) return null;
  const wholeMonths = from.endsWith('-01') && monthRange(monthKey(to)).to === to;
  if (wholeMonths) {
    const months =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
    return { from: addMonths(from, -months), to: addDays(from, -1) };
  }
  const len = diffDays(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

/**
 * Filtro que abre los movimientos de un grupo de un resumen (clic en barra o categoría): el filtro original
 * más el criterio del grupo, limitado a entradas y salidas (los grupos solo cuentan esas). Con `fieldType`
 * la condición de campo es exacta; sin él se deduce de la clave. El texto libre usa "contiene" (aproximado).
 */
export function groupFilter(
  filter: TxFilter,
  groupBy: GroupBy,
  key: string | null,
  opts: { clock?: Clock; fieldType?: FieldType } = {},
): TxFilter {
  const out: TxFilter = structuredClone(filter);
  const flows = (out.kinds ?? []).filter((k) => k === 'income' || k === 'expense');
  out.kinds = flows.length > 0 ? flows : ['income', 'expense'];
  const addField = (cond: FieldCondition) => {
    out.fields = [...(out.fields ?? []), cond];
  };
  switch (groupBy.by) {
    case 'period': {
      if (key === null) return out;
      const base = resolvePeriod(filter.period, opts.clock ?? systemClock);
      const start = periodKeyStart(key, groupBy.unit);
      const end = periodKeyEnd(key, groupBy.unit);
      out.period = {
        from: base.from !== null && base.from > start ? base.from : start,
        to: base.to !== null && base.to < end ? base.to : end,
      };
      return out;
    }
    case 'account':
      if (key !== null) out.accountIds = [key];
      return out;
    case 'kind':
      if (key === 'income' || key === 'expense') out.kinds = [key];
      return out;
    case 'field': {
      const fieldId = groupBy.fieldId;
      if (key === null) {
        addField({ fieldId, op: 'empty' });
        return out;
      }
      const type: FieldType =
        opts.fieldType ??
        (key === 'true' || key === 'false'
          ? 'bool'
          : /^\d{4}-\d{2}$/.test(key)
            ? 'date'
            : /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(key)
              ? 'number'
              : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
                ? 'list'
                : 'text');
      switch (type) {
        case 'bool':
          addField({ fieldId, op: 'is', value: key === 'true' });
          break;
        case 'date': {
          const r = monthRange(key);
          addField({ fieldId, op: 'date_between', from: r.from, to: r.to });
          break;
        }
        case 'number':
          addField({ fieldId, op: 'between', min: Number(key), max: Number(key) });
          break;
        case 'list':
          addField({ fieldId, op: 'any_of', optionIds: [key] });
          break;
        case 'text':
          addField({ fieldId, op: 'contains', value: key });
          break;
      }
      return out;
    }
  }
}

// ── Respaldo (lo que dice settings) ─────────────────────────────────────────────────

const BACKUP_KEYS = ['backup.lastVerifiedAt', 'backup.reminderDays'];

function backupState(settings: Record<string, unknown>, isEmpty: boolean, clock: Clock) {
  const raw = settings['backup.lastVerifiedAt'];
  const lastVerifiedAt = typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? raw : null;
  const days = settings['backup.reminderDays'];
  const reminderDays = typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : 30;
  const daysSince = lastVerifiedAt === null ? null : Math.max(0, diffDays(toIsoDate(new Date(lastVerifiedAt)), clock.today()));
  const overdue = !isEmpty && (daysSince === null || daysSince > reminderDays);
  return { lastVerifiedAt, reminderDays, daysSince, overdue };
}

// ── Cubo diario por cuenta (panel e inicio) ─────────────────────────────────────────

interface CubeCell {
  accountId: Id;
  date: IsoDate;
  /** Totales de ese día y cuenta (montos solo de activos; count = activos; voidedCount = anulados). */
  totals: Totals;
  /** Suma con signo de los activos (mueve el saldo). */
  signedMinor: Minor;
  inCount: number;
  outCount: number;
}

/**
 * Un solo recorrido de los movimientos del espacio agrupado por cuenta y día (índice tx_ws_date). A escala
 * real son unos pocos miles de celdas, de las que salen saldos, flujo, totales por periodo y series.
 */
async function queryCube(exec: SqlExecutor, workspaceId: Id): Promise<CubeCell[]> {
  // Columnas mínimas (cada CASE se evalúa por fila): el saldo con signo sale de las demás.
  const rows = await exec.all(
    `SELECT t.account_id AS a, t.date AS d, ${totalsColumns('t', 'active')},
       SUM(CASE WHEN t.status = 'active' AND t.kind = 'income' THEN 1 ELSE 0 END) AS ci,
       SUM(CASE WHEN t.status = 'active' AND t.kind = 'expense' THEN 1 ELSE 0 END) AS co
     FROM transactions t WHERE t.workspace_id = :ws GROUP BY t.account_id, t.date`,
    { ws: workspaceId },
  );
  return rows.map((r) => {
    const totals = totalsFromRow(r);
    return {
      accountId: String(r['a']),
      date: String(r['d']),
      totals,
      signedMinor: minorOf(
        totals.inMinor - totals.outMinor + totals.transfersInMinor - totals.transfersOutMinor + totals.openingsMinor,
      ),
      inCount: intOf(r['ci']),
      outCount: intOf(r['co']),
    };
  });
}

/**
 * Un punto por día de [from, to] desde el cubo: entradas, salidas, movimientos y saldo total al cierre, más el
 * saldo al cierre del día anterior. Como mucho `DASHBOARD_DAILY_MAX` días (los últimos).
 */
function dailyCloses(
  cube: readonly CubeCell[],
  from: IsoDate,
  to: IsoDate,
): { openingMinor: Minor; days: DashboardData['daily'] } {
  let dayFrom = from;
  if (diffDays(dayFrom, to) >= DASHBOARD_DAILY_MAX) dayFrom = addDays(to, -(DASHBOARD_DAILY_MAX - 1));
  let run = 0;
  const byDay = new Map<IsoDate, { i: Minor; o: Minor; s: Minor; n: number }>();
  for (const c of cube) {
    if (c.date < dayFrom) run = minorOf(run + c.signedMinor);
    else if (c.date <= to) {
      const e = byDay.get(c.date) ?? { i: 0, o: 0, s: 0, n: 0 };
      e.i = minorOf(e.i + c.totals.inMinor);
      e.o = minorOf(e.o + c.totals.outMinor);
      e.s = minorOf(e.s + c.signedMinor);
      e.n += c.inCount + c.outCount;
      byDay.set(c.date, e);
    }
  }
  const openingMinor = run;
  const days: DashboardData['daily'] = [];
  for (let d = dayFrom; d <= to; d = addDays(d, 1)) {
    const e = byDay.get(d);
    if (e !== undefined) run = minorOf(run + e.s);
    const i = e?.i ?? 0;
    const o = e?.o ?? 0;
    days.push({ date: d, inMinor: i, outMinor: o, netMinor: minorOf(i - o), balanceMinor: run, count: e?.n ?? 0 });
  }
  return { openingMinor, days };
}

/** Saldo y último movimiento activo por cuenta desde el cubo; el saldo inicial, del contexto. */
function statsFromCube(cube: readonly CubeCell[], openings: ReadonlyMap<Id, Id>): Map<Id, AccountStats> {
  const out = new Map<Id, AccountStats>();
  for (const c of cube) {
    const s = out.get(c.accountId) ?? {
      balanceMinor: 0,
      lastMovementDate: null,
      openingTransactionId: openings.get(c.accountId) ?? null,
    };
    s.balanceMinor = minorOf(s.balanceMinor + c.signedMinor);
    if (c.totals.count > 0 && (s.lastMovementDate === null || c.date > s.lastMovementDate)) s.lastMovementDate = c.date;
    out.set(c.accountId, s);
  }
  return out;
}

// ═════════════════════════════════════════ Servicio ═════════════════════════════════════════

export function createQueriesService(deps: CoreDeps): QueriesService {
  const { driver, clock } = deps;

  // Totales del filtro completo para listTransactions. La primera página siempre los calcula; las siguientes
  // (con cursor: scroll infinito, exportar «Todo» en páginas de 500) reutilizan los de la primera si el filtro
  // resuelto es el mismo y la base no ha cambiado (`total_changes()` de la única conexión: ADR-9). Así no se
  // repite en cada página un agregado sobre todo el filtro que, con el driver en serie, frena lo demás.
  let totalsMemo: { key: string; changes: number; totals: Totals } | null = null;
  async function pageTotals(workspaceId: Id, filter: TxFilter, compiled: CompiledFilter, continuation: boolean): Promise<Totals> {
    const key = JSON.stringify([workspaceId, filter.status ?? 'active', compiled.where, compiled.params]);
    const changes = intOf((await driver.get('SELECT total_changes() AS n'))?.['n']);
    if (continuation && totalsMemo !== null && totalsMemo.key === key && totalsMemo.changes === changes) {
      return { ...totalsMemo.totals };
    }
    const totals = await queryTotals(driver, workspaceId, filter, clock);
    totalsMemo = { key, changes, totals: { ...totals } };
    return totals;
  }

  async function listTransactions(
    workspaceId: Id,
    input: { filter: TxFilter; sort?: TxSort; limit?: number; cursor?: string },
  ): Promise<Page<TransactionRow> & { totals: Totals }> {
    const filter = checkFilter(input.filter);
    const sort = checkSort(input.sort);
    const limit = clampInt(input.limit, 50, 1, 500);
    const single = singleAccountOf(filter);
    const order = orderFor(sort, single !== null);
    const sig = `${sort.by}:${sort.dir}:${single !== null ? 1 : 0}`;
    const after = decodeCursor(input.cursor, sig, order.columns.length);
    const compiled = compileFilter(filter, { workspaceId, clock });
    const totals = await pageTotals(workspaceId, filter, compiled, after !== null);
    const rows = await selectRows(driver, {
      ...compiled,
      order,
      after,
      limit: limit + 1,
      runningAccountId: single,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor(sig, cursorValues(last, order)) : null,
      totals,
    };
  }

  async function listByDay(
    workspaceId: Id,
    input: { filter: TxFilter; limit?: number; cursor?: string },
  ): Promise<Page<{ date: IsoDate; inMinor: Minor; outMinor: Minor; items: TransactionRow[] }>> {
    const filter = checkFilter(input.filter);
    const limit = clampInt(input.limit, 100, 1, 1000);
    const single = singleAccountOf(filter);
    const order = orderFor({ by: 'date', dir: 'desc' }, single !== null);
    const sig = `day:${single !== null ? 1 : 0}`;
    const after = decodeCursor(input.cursor, sig, order.columns.length);
    const compiled = compileFilter(filter, { workspaceId, clock });
    const rows = await selectRows(driver, { ...compiled, order, after, limit: limit + 1, runningAccountId: single });
    const items = rows.slice(0, limit);
    if (items.length === 0) {
      await assertWorkspace(driver, workspaceId);
      return { items: [], nextCursor: null };
    }
    // Subtotal del día COMPLETO (aunque la página corte el día): activos income/expense del filtro.
    const dates = [...new Set(items.map((r) => r.date))];
    const sub = compileFilter(withStatus(filter, 'active'), { workspaceId, clock });
    const marks = dates.map((d, i) => {
      sub.params[`d${i}`] = d;
      return `:d${i}`;
    });
    const sums = await driver.all(
      `SELECT t.date AS date,
         SUM(CASE WHEN t.kind = 'income' THEN t.amount_minor ELSE 0 END) AS i,
         SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS o
       FROM transactions t WHERE ${sub.where} AND t.date IN (${marks.join(', ')}) GROUP BY t.date`,
      sub.params,
    );
    const byDate = new Map(sums.map((r) => [String(r['date']), r]));
    const days: Array<{ date: IsoDate; inMinor: Minor; outMinor: Minor; items: TransactionRow[] }> = [];
    for (const row of items) {
      let day = days.at(-1);
      if (day?.date !== row.date) {
        const s = byDate.get(row.date);
        day = { date: row.date, inMinor: minorOf(s?.['i']), outMinor: minorOf(s?.['o']), items: [] };
        days.push(day);
      }
      day.items.push(row);
    }
    const last = items.at(-1);
    return {
      items: days,
      nextCursor: rows.length > limit && last ? encodeCursor(sig, cursorValues(last, order)) : null,
    };
  }

  async function balances(
    workspaceId: Id,
    opts: { asOf?: IsoDate } = {},
  ): Promise<{ byAccount: Record<Id, Minor>; totalMinor: Minor }> {
    const asOf = opts.asOf === undefined ? null : checkDate(opts.asOf, 'asOf');
    const rows = await driver.all(
      `SELECT a.id AS id, COALESCE(SUM(${signedSql('t')}), 0) AS bal
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id AND t.status = 'active'${asOf !== null ? ' AND t.date <= :asof' : ''}
       WHERE a.workspace_id = :ws GROUP BY a.id`,
      asOf !== null ? { ws: workspaceId, asof: asOf } : { ws: workspaceId },
    );
    if (rows.length === 0) await assertWorkspace(driver, workspaceId);
    const byAccount: Record<Id, Minor> = {};
    let totalMinor = 0;
    for (const r of rows) {
      const bal = minorOf(r['bal']);
      byAccount[String(r['id'])] = bal;
      totalMinor = minorOf(totalMinor + bal);
    }
    return { byAccount, totalMinor };
  }

  async function balanceSeries(
    workspaceId: Id,
    input: { accountIds?: Id[]; period: DateRange; unit: 'day' | 'month' },
  ): Promise<Array<{ key: string; balanceMinor: Minor }>> {
    const shape = checkFilter({ period: input.period, ...(input.accountIds ? { accountIds: input.accountIds } : {}) });
    if (input.unit !== 'day' && input.unit !== 'month') throw new DomainError('invalid_recipe', { path: 'unit' });
    const range = resolvePeriod(shape.period, clock);
    const params: Record<string, SqlValue> = { ws: workspaceId };
    const conds = ["t.workspace_id = :ws", "t.status = 'active'"];
    if (shape.accountIds && shape.accountIds.length > 0) {
      conds.push(
        `t.account_id IN (${shape.accountIds
          .map((id, i) => {
            params[`a${i}`] = id;
            return `:a${i}`;
          })
          .join(', ')})`,
      );
    }
    if (range.to !== null) {
      params['to'] = range.to;
      conds.push('t.date <= :to');
    }
    const keyExpr = input.unit === 'month' ? 'substr(t.date, 1, 7)' : 't.date';
    let kExpr = keyExpr;
    if (range.from !== null) {
      params['from'] = range.from;
      kExpr = `CASE WHEN t.date < :from THEN '' ELSE ${keyExpr} END`;
    }
    const rows = await driver.all(
      `SELECT ${kExpr} AS k, SUM(${signedSql('t')}) AS d, MIN(t.date) AS mn, MAX(t.date) AS mx
       FROM transactions t WHERE ${conds.join(' AND ')} GROUP BY k`,
      params,
    );
    if (rows.length === 0) await assertWorkspace(driver, workspaceId);
    let pre = 0;
    const deltas = new Map<string, Minor>();
    let minDate: IsoDate | null = null;
    let maxDate: IsoDate | null = null;
    for (const r of rows) {
      const k = String(r['k']);
      if (k === '') {
        pre = minorOf(r['d']);
        continue;
      }
      deltas.set(k, minorOf(r['d']));
      const mn = String(r['mn']);
      const mx = String(r['mx']);
      if (minDate === null || mn < minDate) minDate = mn;
      if (maxDate === null || mx > maxDate) maxDate = mx;
    }
    const from = range.from ?? minDate;
    if (from === null) return [];
    const today = clock.today();
    const to = range.to ?? (maxDate !== null && maxDate > today ? maxDate : today);
    let running = pre;
    return enumeratePeriodKeys(from, to, input.unit).map((key) => {
      running = minorOf(running + (deltas.get(key) ?? 0));
      return { key, balanceMinor: running };
    });
  }

  async function summarize(
    workspaceId: Id,
    input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy },
  ): Promise<SummaryResult> {
    return readTx(deps, async (tx) => {
      const ctx = await loadContext(tx, workspaceId);
      return summarizeWith(tx, deps, ctx, input);
    });
  }

  async function home(workspaceId: Id, input: { month?: string } = {}): Promise<HomeData> {
    const month = input.month ?? monthKey(clock.today());
    if (!/^\d{4}-\d{2}$/.test(month) || !isIsoDate(`${month}-01`)) {
      throw new DomainError('invalid_date', { month });
    }
    return readTx(deps, async (tx) => {
      // Dos sentencias: contexto + cubo diario (un solo recorrido de los movimientos).
      const ctx = await loadContext(tx, workspaceId, { settings: BACKUP_KEYS });
      const cube = await queryCube(tx, workspaceId);
      const stats = statsFromCube(cube, ctx.openings);
      const first = addMonths(`${month}-01`, -11);
      const last = monthRange(month).to;
      const byMonth = new Map<string, Totals>();
      for (const c of cube) {
        if (c.date < first || c.date > last) continue;
        const m = monthKey(c.date);
        byMonth.set(m, addTotals(byMonth.get(m) ?? emptyTotals(), c.totals));
      }
      const previous = monthKey(addMonths(`${month}-01`, -1));
      const accounts = ctx.accounts.map((a) => withBalance(a, stats.get(a.id)));
      const isEmpty = cube.length === 0;
      const backup = backupState(ctx.settings, isEmpty, clock);
      return {
        totalBalanceMinor: accounts.reduce((s, a) => minorOf(s + a.balanceMinor), 0),
        month: byMonth.get(month) ?? emptyTotals(),
        previousMonth: byMonth.get(previous) ?? emptyTotals(),
        monthly: enumeratePeriodKeys(first, last, 'month').map((key) => {
          const t = byMonth.get(key);
          return { key, inMinor: t?.inMinor ?? 0, outMinor: t?.outMinor ?? 0 };
        }),
        negativeAccounts: accounts.filter((a) => a.isNegative && a.archivedAt === null),
        isEmpty,
        backup: { lastVerifiedAt: backup.lastVerifiedAt, reminderDays: backup.reminderDays, overdue: backup.overdue },
      };
    });
  }

  async function dashboard(workspaceId: Id, opts: DashboardOptions = {}): Promise<DashboardData> {
    const shape = checkFilter({ period: opts.period ?? { preset: 'this_month' } });
    const months = clampInt(opts.months, 12, 1, 60);
    const topLimit = clampInt(opts.topLimit, 5, 1, 50);
    const recentLimit = clampInt(opts.recentLimit, 8, 0, 50);
    const seriesUnit = opts.seriesUnit ?? 'week';
    if (!['day', 'week', 'month'].includes(seriesUnit)) throw new DomainError('invalid_recipe', { path: 'seriesUnit' });
    const measure = opts.measure ?? 'out';
    if (!['in', 'out', 'net'].includes(measure)) throw new DomainError('invalid_recipe', { path: 'measure' });
    const today = clock.today();
    const period = resolvePeriod(shape.period, clock);
    const prev = previousRange(period.from, period.to);

    // Ancla de las series: fin del periodo si ya pasó; si no, hoy.
    const anchor = period.to !== null && period.to < today ? period.to : today;
    const flowFrom = addMonths(`${monthKey(anchor)}-01`, -(months - 1));
    const flowTo = monthRange(monthKey(anchor)).to;
    const flowKeys = enumeratePeriodKeys(flowFrom, flowTo, 'month');
    const within = (d: IsoDate, from: IsoDate | null, to: IsoDate | null) =>
      (from === null || d >= from) && (to === null || d <= to);
    const bucketOf = (d: IsoDate): 0 | 1 | 2 =>
      within(d, period.from, period.to) ? 1 : prev !== null && within(d, prev.from, prev.to) ? 2 : 0;

    return readTx(deps, async (tx) => {
      // 1 · Contexto, ajustes de respaldo y lotes descuadrados.
      const ctx = await loadContext(tx, workspaceId, { settings: BACKUP_KEYS, unbalanced: true });
      const warnings: Warning[] = [];

      // 2 · Cubo diario por cuenta: saldos, flujo mensual, totales de los periodos, series y repartos
      //     que no son de campo salen de este único recorrido.
      const cube = await queryCube(tx, workspaceId);
      const stats = statsFromCube(cube, ctx.openings);
      const flowByMonth = new Map<string, Totals>();
      let curTotals = emptyTotals();
      let prevTotals = emptyTotals();
      const seriesKeys = enumeratePeriodKeys(flowFrom, anchor, seriesUnit);
      const keyIndex = new Map(seriesKeys.map((k, i) => [k, i]));
      const perAccount = new Map<Id, { pre: Minor; deltas: Minor[] }>();
      for (const a of ctx.accounts) perAccount.set(a.id, { pre: 0, deltas: seriesKeys.map(() => 0) });
      for (const c of cube) {
        if (c.date >= flowFrom && c.date <= flowTo) {
          const m = monthKey(c.date);
          flowByMonth.set(m, addTotals(flowByMonth.get(m) ?? emptyTotals(), c.totals));
        }
        const b = bucketOf(c.date);
        if (b === 1) curTotals = addTotals(curTotals, c.totals);
        else if (b === 2) prevTotals = addTotals(prevTotals, c.totals);
        if (c.date > anchor) continue;
        let s = perAccount.get(c.accountId);
        if (s === undefined) {
          s = { pre: 0, deltas: seriesKeys.map(() => 0) };
          perAccount.set(c.accountId, s);
        }
        if (c.date < flowFrom) {
          s.pre = minorOf(s.pre + c.signedMinor);
          continue;
        }
        const idx = keyIndex.get(periodKey(c.date, seriesUnit));
        if (idx !== undefined) s.deltas[idx] = minorOf((s.deltas[idx] ?? 0) + c.signedMinor);
      }
      const byAccountSeries: Record<Id, Minor[]> = {};
      const totalSeries = seriesKeys.map(() => 0);
      for (const [id, s] of perAccount) {
        let run = s.pre;
        byAccountSeries[id] = s.deltas.map((d, i) => {
          run = minorOf(run + d);
          totalSeries[i] = minorOf((totalSeries[i] ?? 0) + run);
          return run;
        });
      }

      // 3 · Reparto (periodo actual frente al anterior) y top de categorías y contactos.
      const breakdownBy = pickBreakdown(opts.breakdown, ctx.fields, warnings);
      const dimCtx = { accounts: ctx.accounts, fields: ctx.fields, range: period, locale: deps.locale };
      const dim = buildDimension(breakdownBy, dimCtx, 'g0');
      const cur = new Map<string | null, Agg>();
      const old = new Map<string | null, Agg>();
      const bump = (target: Map<string | null, Agg>, k: string | null, i: Minor, o: Minor, n: number) => {
        if (i === 0 && o === 0 && n === 0) return;
        const a = target.get(k) ?? { inMinor: 0, outMinor: 0, count: 0 };
        a.inMinor = minorOf(a.inMinor + i);
        a.outMinor = minorOf(a.outMinor + o);
        a.count += n;
        target.set(k, a);
      };
      if (breakdownBy.by !== 'field') {
        for (const c of cube) {
          const b = bucketOf(c.date);
          if (b === 0) continue;
          const target = b === 1 ? cur : old;
          if (breakdownBy.by === 'kind') {
            bump(target, 'income', c.totals.inMinor, 0, c.inCount);
            bump(target, 'expense', 0, c.totals.outMinor, c.outCount);
          } else {
            const k = breakdownBy.by === 'account' ? c.accountId : periodKey(c.date, breakdownBy.unit);
            bump(target, k, c.totals.inMinor, c.totals.outMinor, c.inCount + c.outCount);
          }
        }
      }
      const listFields = ctx.fields.filter((f) => f.type === 'list');
      const roleFields = (['category', 'contact'] as const)
        .map((role) => ({ role, field: listFields.find((f) => f.active && f.role === role) }))
        .filter((x): x is { role: 'category' | 'contact'; field: Field } => x.field !== undefined);
      // Una sentencia para todos los campos: el del reparto y los de rol, cada uno con su LEFT JOIN.
      const joined: Array<{ alias: string; dim: Dimension }> = [];
      if (breakdownBy.by === 'field') joined.push({ alias: 'k0', dim });
      const roleAlias = new Map<Id, string>();
      for (const [i, { field }] of roleFields.entries()) {
        if (breakdownBy.by === 'field' && breakdownBy.fieldId === field.id) {
          roleAlias.set(field.id, 'k0');
          continue;
        }
        const alias = `k${i + 1}`;
        joined.push({ alias, dim: buildDimension({ by: 'field', fieldId: field.id }, dimCtx, `g${i + 1}`) });
        roleAlias.set(field.id, alias);
      }
      const topRows: Array<Record<string, SqlValue>> = [];
      if (joined.length > 0) {
        const p: Record<string, SqlValue> = { ws: workspaceId };
        const between = (from: IsoDate | null, to: IsoDate | null, name: string) => {
          const parts: string[] = [];
          if (from !== null) {
            p[`${name}f`] = from;
            parts.push(`t.date >= :${name}f`);
          }
          if (to !== null) {
            p[`${name}t`] = to;
            parts.push(`t.date <= :${name}t`);
          }
          return parts.length === 0 ? '1' : parts.join(' AND ');
        };
        const inCur = between(period.from, period.to, 'c');
        // El periodo anterior solo hace falta si el reparto es de campo.
        const inPrev = prev && breakdownBy.by === 'field' ? between(prev.from, prev.to, 'p') : '0';
        for (const j of joined) Object.assign(p, j.dim.params);
        const rows = await tx.all(
          `SELECT CASE WHEN ${inCur} THEN 1 ELSE 2 END AS b,
             ${joined.map((j) => `${j.dim.expr} AS ${j.alias}`).join(', ')},
             SUM(CASE WHEN t.kind = 'income' THEN t.amount_minor ELSE 0 END) AS i,
             SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS o,
             SUM(CASE WHEN t.kind = 'income' THEN 1 ELSE 0 END) AS ci,
             SUM(CASE WHEN t.kind = 'expense' THEN 1 ELSE 0 END) AS co
           FROM transactions t ${joined.map((j) => j.dim.join).join(' ')}
           WHERE t.workspace_id = :ws AND t.status = 'active' AND t.kind IN ('income', 'expense')
             AND ((${inCur}) OR (${inPrev}))
           GROUP BY b, ${joined.map((j) => j.alias).join(', ')}`,
          p,
        );
        topRows.push(...rows);
        if (breakdownBy.by === 'field') {
          for (const r of rows) {
            bump(
              intOf(r['b']) === 1 ? cur : old,
              dim.key(r['k0']),
              minorOf(r['i']),
              minorOf(r['o']),
              intOf(r['ci']) + intOf(r['co']),
            );
          }
        }
      }
      const value = (a: Agg | undefined) =>
        a === undefined ? 0 : measure === 'in' ? a.inMinor : measure === 'out' ? a.outMinor : a.inMinor - a.outMinor;
      const union = new Map<string | null, Agg>([...old, ...cur]);
      let breakdownKeys = dim.order(union).filter((k) => union.has(k) || breakdownBy.by === 'period');
      if (breakdownBy.by !== 'period') {
        breakdownKeys = [...breakdownKeys].sort((a, b) => {
          if (a === null) return 1;
          if (b === null) return -1;
          return value(cur.get(b)) - value(cur.get(a)) || value(old.get(b)) - value(old.get(a));
        });
      }
      const stat = (a: Agg | undefined) => ({
        inMinor: a?.inMinor ?? 0,
        outMinor: a?.outMinor ?? 0,
        netMinor: minorOf((a?.inMinor ?? 0) - (a?.outMinor ?? 0)),
        count: a?.count ?? 0,
      });
      const breakdownField =
        breakdownBy.by === 'field' ? (ctx.fields.find((f) => f.id === breakdownBy.fieldId) ?? null) : null;

      const top: DashboardData['top'] = roleFields.map(({ role, field }) => {
        const alias = roleAlias.get(field.id) as string;
        const options = new Map(field.options.map((o) => [o.id, o]));
        const sums = new Map<string, { i: Minor; o: Minor; ci: number; co: number }>();
        for (const r of topRows) {
          if (intOf(r['b']) !== 1) continue;
          const k = r[alias];
          if (k === null || k === undefined) continue;
          const key = String(k);
          const s = sums.get(key) ?? { i: 0, o: 0, ci: 0, co: 0 };
          s.i = minorOf(s.i + minorOf(r['i']));
          s.o = minorOf(s.o + minorOf(r['o']));
          s.ci += intOf(r['ci']);
          s.co += intOf(r['co']);
          sums.set(key, s);
        }
        const pick = (side: 'i' | 'o'): DashboardTopItem[] =>
          [...sums.entries()]
            .filter(([, s]) => s[side] > 0)
            .map(([key, s]) => {
              const o = options.get(key);
              return {
                key,
                label: o?.label ?? '(opción desconocida)',
                color: o?.color ?? null,
                inactive: o ? !o.active : true,
                minor: s[side],
                count: side === 'i' ? s.ci : s.co,
              };
            })
            .sort((a, b) => b.minor - a.minor || a.label.localeCompare(b.label, 'es'))
            .slice(0, topLimit);
        return { role, field: { id: field.id, label: field.label }, byOut: pick('o'), byIn: pick('i') };
      });

      // 4 · Últimos movimientos activos.
      const recent =
        recentLimit === 0
          ? []
          : await selectRows(tx, {
              where: "t.workspace_id = :ws AND t.status = 'active'",
              params: { ws: workspaceId },
              order: orderFor({ by: 'date', dir: 'desc' }, false),
              limit: recentLimit,
            });

      // 5 · Posibles duplicados recientes (candidatos por SQL, descripción parecida en JS como en check()).
      const dupSince = addDays(today, -(DASHBOARD_DUPLICATE_DAYS - 1));
      // Primero la ventana (una pasada por tx_ws_status) y, de ella, solo las filas cuyo monto se repite en la
      // misma cuenta, sentido y tipo; el cruce por fechas se hace sobre esas pocas. Mismo resultado que cruzar
      // cada movimiento con su cuenta, unas 4 veces más rápido con 20 000 movimientos.
      const dupRows = await tx.all<{ x: string; y: string; dx: string; dy: string }>(
        `WITH w AS MATERIALIZED (
             SELECT id, account_id, direction, kind, amount_minor, date, seq, description FROM transactions
              WHERE workspace_id = :ws AND status = 'active' AND kind IN ('income', 'expense')
                AND date BETWEEN date(:since, '-${DUPLICATE_WINDOW_DAYS} days') AND :today),
           k AS (SELECT account_id, direction, kind, amount_minor FROM w
                  GROUP BY account_id, direction, kind, amount_minor HAVING COUNT(*) > 1),
           c AS MATERIALIZED (SELECT w.* FROM w JOIN k ON k.account_id = w.account_id AND k.direction = w.direction
                  AND k.kind = w.kind AND k.amount_minor = w.amount_minor)
         SELECT x.id AS x, y.id AS y, x.description AS dx, y.description AS dy
           FROM c y JOIN c x
             ON x.account_id = y.account_id AND x.direction = y.direction AND x.amount_minor = y.amount_minor
            AND x.kind = y.kind
            AND x.date BETWEEN date(y.date, '-${DUPLICATE_WINDOW_DAYS} days') AND y.date
            AND (x.date < y.date OR x.seq < y.seq)
          WHERE y.date BETWEEN :since AND :today
          ORDER BY y.date DESC, y.seq DESC, x.date DESC, x.seq DESC`,
        { ws: workspaceId, since: dupSince, today },
      );
      const dupItems: Array<{ transactionId: Id; duplicateOfId: Id }> = [];
      const dupSeen = new Set<Id>();
      for (const r of dupRows) {
        if (dupSeen.has(r.y) || !similarDescriptions(r.dx, r.dy)) continue;
        dupSeen.add(r.y);
        dupItems.push({ transactionId: r.y, duplicateOfId: r.x });
      }

      // 6 · Serie diaria del periodo y del anterior equivalente (de los mismos datos del cubo).
      let daily: DashboardData['daily'] = [];
      let dailyOpeningMinor: Minor = 0;
      let previousDaily: DashboardData['previousDaily'] = null;
      if (cube.length > 0) {
        const firstDate = cube.reduce((m, c) => (c.date < m ? c.date : m), cube[0]!.date);
        const lastDate = cube.reduce((m, c) => (c.date > m ? c.date : m), cube[0]!.date);
        // Hasta hoy o, si hay movimientos con fecha posterior, hasta el último (sin pasar del fin del periodo):
        // así las gráficas suman lo mismo que los totales del periodo, que cuentan también lo programado.
        const horizon = lastDate > today ? lastDate : today;
        const dayTo = period.to !== null && period.to < horizon ? period.to : horizon;
        const cur = dailyCloses(cube, period.from ?? firstDate, dayTo);
        daily = cur.days;
        dailyOpeningMinor = cur.openingMinor;
        if (prev !== null) {
          const p = dailyCloses(cube, prev.from, prev.to);
          previousDaily = { openingMinor: p.openingMinor, balances: p.days.map((x) => ({ date: x.date, balanceMinor: x.balanceMinor })) };
        }
      }

      const allAccounts = ctx.accounts.map((a) => withBalance(a, stats.get(a.id)));
      const isEmpty = cube.length === 0;
      const backup = backupState(ctx.settings, isEmpty, clock);
      const periodChangeMinor = minorOf(
        curTotals.inMinor -
          curTotals.outMinor +
          curTotals.transfersInMinor -
          curTotals.transfersOutMinor +
          curTotals.openingsMinor,
      );
      return {
        currency: ctx.workspace.currency,
        today,
        isEmpty,
        balance: { totalMinor: allAccounts.reduce((s, a) => minorOf(s + a.balanceMinor), 0), periodChangeMinor },
        period: { ...period, totals: curTotals },
        previousPeriod: prev
          ? { from: prev.from, to: prev.to, label: resolvePeriod(prev, clock).label, totals: prevTotals }
          : null,
        flow: flowKeys.map((key) => {
          const t = flowByMonth.get(key) ?? emptyTotals();
          return { key, label: monthLabel(key), inMinor: t.inMinor, outMinor: t.outMinor, netMinor: t.netMinor, count: t.count };
        }),
        series: { unit: seriesUnit, keys: seriesKeys, totalMinor: totalSeries, byAccount: byAccountSeries },
        daily,
        dailyOpeningMinor,
        previousDaily,
        accounts: allAccounts.filter((a) => a.archivedAt === null),
        breakdown: {
          groupBy: breakdownBy,
          field: breakdownField ? { id: breakdownField.id, label: breakdownField.label } : null,
          measure,
          groups: breakdownKeys.map((k) => {
            const meta = dim.meta(k);
            return {
              key: k,
              label: meta.label,
              color: meta.color,
              inactive: meta.inactive,
              current: stat(cur.get(k)),
              previous: prev ? stat(old.get(k)) : null,
            };
          }),
        },
        top,
        attention: {
          negativeAccounts: allAccounts.filter((a) => a.isNegative && a.archivedAt === null),
          unbalancedBatches: ctx.unbalanced,
          possibleDuplicates: { count: dupItems.length, days: DASHBOARD_DUPLICATE_DAYS, items: dupItems.slice(0, 20) },
          backup,
        },
        recent,
        warnings,
      };
    });
  }

  return {
    listTransactions,
    listByDay,
    totals: async (workspaceId, filter) => queryTotals(driver, workspaceId, checkFilter(filter), clock),
    balances,
    balanceSeries,
    summarize,
    home,
    dashboard,
  };
}

/** Dimensión del reparto del panel: la pedida (validada) o categoría → primera lista → cuenta. */
function pickBreakdown(requested: GroupBy | undefined, fields: Field[], warnings: Warning[]): GroupBy {
  if (requested !== undefined) {
    const shape = parseViewRecipe({ v: 1, kind: 'summary', filter: {}, groupBy: requested, measure: 'both', chart: 'table' });
    if (!shape.ok || shape.value.kind !== 'summary') throw new DomainError('invalid_recipe', { path: 'breakdown' });
    const checked = validateRecipe(shape.value, fields);
    warnings.push(...checked.warnings);
    return checked.recipe.groupBy;
  }
  const lists = fields.filter((f) => f.type === 'list' && f.active);
  const cat = lists.find((f) => f.role === 'category') ?? lists[0];
  return cat ? { by: 'field', fieldId: cat.id } : { by: 'account' };
}

