// Informes (ARCHITECTURE.md 3.5, identidad I-5): resumido, detallado y personalizado sobre el mismo motor
// de consultas. Un informe es un ReportDocument autocontenido (trae cuentas y campos para pintarse y
// exportarse sin más consultas).
//
// Identidad del estado, por cuenta y total (I-5):
//   saldo inicial del periodo + saldos iniciales en el periodo + entradas − salidas
//     + transferencias entrantes − transferencias salientes = saldo final
// El saldo final se calcula en SQL de forma independiente (suma con signo de todo lo activo hasta `to`),
// así que la identidad se comprueba, no se asume. Con filtros (cuenta, categoría, texto…) el estado es el de
// los movimientos que cumplen el filtro: antes del periodo (saldo inicial) y dentro (líneas).
import { addDays, fromIsoDate } from '../dates';
import { DomainError } from '../errors';
import type { SqlExecutor, SqlValue } from '../ports';
import { describeFilter, isFiltered, parseViewRecipe, resolvePeriod, validateRecipe } from '../recipes';
import { compileFilter } from '../sql/filter';
import { COLUMNS, toAuditEntry, type AuditChangeRecord, type AuditLogRecord } from '../sql/rows';
import type {
  Account,
  AuditEntry,
  Currency,
  DateRange,
  Field,
  Id,
  IsoDate,
  Minor,
  StatementLine,
  SummaryGroup,
  Timestamp,
  TransactionRow,
  TxFilter,
  ViewRecipe,
  Warning,
} from '../types';
import { readTx, type CoreDeps } from '../uow';
import {
  buildDimension,
  checkFilter,
  loadContext,
  minorOf,
  orderFor,
  queryGroups,
  selectRows,
  signedSql,
  singleAccountOf,
  withoutPeriod,
  withStatus,
  type WsContext,
} from './queries';

export type { StatementLine } from '../types';

export type ReportRecipe = Extract<ViewRecipe, { kind: 'report' }>;

export interface ReportDocument {
  meta: {
    workspaceName: string;
    ownerName: string;
    logoDataUrl: string | null;
    currency: Currency;
    period: { from: IsoDate | null; to: IsoDate | null; label: string };
    generatedAt: Timestamp;
    form: 'summary' | 'detailed' | 'custom';
    filtered: boolean;
    filterDescription: string[];
    warnings: Warning[];
    includeVoided: boolean;
  };
  statement: StatementLine;
  byAccount: Array<{ account: Account } & StatementLine>;
  byField: Array<{ field: Field; groups: SummaryGroup[] }>;
  transfers: Array<{ date: IsoDate; fromAccountId: Id; toAccountId: Id; amountMinor: Minor; description: string }>;
  movements: TransactionRow[] | null; // detallado
  voided: TransactionRow[] | null; // si includeVoided
  audit: AuditEntry[] | null;
  signature: boolean;
  /** Añadido por 2C: la receta ya revisada con la que se armó (secciones, columnas, campos). */
  recipe: ReportRecipe;
  /** Añadido por 2C: todas las cuentas del espacio (nombres de contrapartidas y transferencias). */
  accounts: Account[];
  /** Añadido por 2C: todos los campos del espacio con sus opciones (columnas y etiquetas). */
  fields: Field[];
}

export interface ReportsService {
  build(workspaceId: Id, recipe: ReportRecipe): Promise<ReportDocument>;
  /** Recetas listas: resumido y detallado (10.1). */
  preset(form: 'summary' | 'detailed', period: DateRange): ReportRecipe;
}

const SUMMARY_SECTIONS: ReportRecipe['sections'] = ['header', 'statement', 'by_account', 'by_field', 'transfers'];
const DETAILED_SECTIONS: ReportRecipe['sections'] = [...SUMMARY_SECTIONS, 'movements'];

export function emptyStatement(): StatementLine {
  return {
    periodOpeningMinor: 0,
    openingsInPeriodMinor: 0,
    inMinor: 0,
    outMinor: 0,
    transfersInMinor: 0,
    transfersOutMinor: 0,
    closingMinor: 0,
  };
}

/** Suma de líneas (para el total del estado). */
export function addStatement(a: StatementLine, b: StatementLine): StatementLine {
  return {
    periodOpeningMinor: minorOf(a.periodOpeningMinor + b.periodOpeningMinor),
    openingsInPeriodMinor: minorOf(a.openingsInPeriodMinor + b.openingsInPeriodMinor),
    inMinor: minorOf(a.inMinor + b.inMinor),
    outMinor: minorOf(a.outMinor + b.outMinor),
    transfersInMinor: minorOf(a.transfersInMinor + b.transfersInMinor),
    transfersOutMinor: minorOf(a.transfersOutMinor + b.transfersOutMinor),
    closingMinor: minorOf(a.closingMinor + b.closingMinor),
  };
}

/** ¿Cuadra la línea? (I-5) */
export function statementBalances(s: StatementLine): boolean {
  return (
    s.periodOpeningMinor + s.openingsInPeriodMinor + s.inMinor - s.outMinor + s.transfersInMinor - s.transfersOutMinor ===
    s.closingMinor
  );
}

function checkReportRecipe(recipe: unknown): ReportRecipe {
  const parsed = parseViewRecipe(recipe);
  if (!parsed.ok) throw new DomainError('invalid_recipe', { path: parsed.error });
  if (parsed.value.kind !== 'report') throw new DomainError('invalid_recipe', { path: '$.kind' });
  return parsed.value;
}

/** Campos por los que agrupar cuando la receta no dice ninguno: listas activas con rol de dimensión. */
function defaultGroupFields(fields: Field[]): Id[] {
  return fields
    .filter((f) => f.type === 'list' && f.active && (f.role === 'category' || f.role === 'fund' || f.role === 'cost_center'))
    .map((f) => f.id);
}

export function createReportsService(deps: CoreDeps): ReportsService {
  const { clock } = deps;

  async function statementByAccount(
    exec: SqlExecutor,
    workspaceId: Id,
    filter: TxFilter,
    period: { from: IsoDate | null; to: IsoDate | null },
  ): Promise<Map<Id, StatementLine>> {
    const compiled = compileFilter(withStatus(withoutPeriod(filter), 'active'), { workspaceId, clock });
    const params: Record<string, SqlValue> = { ...compiled.params };
    let before = '0';
    let inPeriod = '1';
    if (period.from !== null) {
      params['rfrom'] = period.from;
      before = 't.date < :rfrom';
      inPeriod = 't.date >= :rfrom';
    }
    let upTo = '';
    if (period.to !== null) {
      params['rto'] = period.to;
      upTo = ' AND t.date <= :rto';
    }
    const s = signedSql('t');
    const rows = await exec.all(
      `SELECT t.account_id AS a,
         SUM(CASE WHEN ${before} THEN ${s} ELSE 0 END) AS before_minor,
         SUM(CASE WHEN ${inPeriod} AND t.kind = 'opening' THEN ${s} ELSE 0 END) AS openings_minor,
         SUM(CASE WHEN ${inPeriod} AND t.kind = 'income' THEN t.amount_minor ELSE 0 END) AS in_minor,
         SUM(CASE WHEN ${inPeriod} AND t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS out_minor,
         SUM(CASE WHEN ${inPeriod} AND t.kind = 'transfer' AND t.direction = 'in' THEN t.amount_minor ELSE 0 END) AS tin_minor,
         SUM(CASE WHEN ${inPeriod} AND t.kind = 'transfer' AND t.direction = 'out' THEN t.amount_minor ELSE 0 END) AS tout_minor,
         SUM(${s}) AS closing_minor
       FROM transactions t WHERE ${compiled.where}${upTo}
       GROUP BY t.account_id`,
      params,
    );
    const out = new Map<Id, StatementLine>();
    for (const r of rows) {
      out.set(String(r['a']), {
        periodOpeningMinor: minorOf(r['before_minor']),
        openingsInPeriodMinor: minorOf(r['openings_minor']),
        inMinor: minorOf(r['in_minor']),
        outMinor: minorOf(r['out_minor']),
        transfersInMinor: minorOf(r['tin_minor']),
        transfersOutMinor: minorOf(r['tout_minor']),
        closingMinor: minorOf(r['closing_minor']),
      });
    }
    return out;
  }

  async function transfersOf(exec: SqlExecutor, workspaceId: Id, filter: TxFilter): Promise<ReportDocument['transfers']> {
    const compiled = compileFilter(withStatus(filter, 'active'), { workspaceId, clock });
    const rows = await exec.all(
      `SELECT o.date AS date, o.account_id AS f, i.account_id AS tt, o.amount_minor AS amt, o.description AS d
       FROM transactions o
       JOIN transactions i ON i.transfer_group_id = o.transfer_group_id AND i.direction = 'in'
       WHERE o.workspace_id = :rws AND o.kind = 'transfer' AND o.direction = 'out' AND o.status = 'active'
         AND o.transfer_group_id IN (
           SELECT t.transfer_group_id FROM transactions t
           WHERE ${compiled.where} AND t.kind = 'transfer' AND t.transfer_group_id IS NOT NULL)
       ORDER BY o.date, o.recorded_at, o.id`,
      { ...compiled.params, rws: workspaceId },
    );
    return rows.map((r) => ({
      date: String(r['date']),
      fromAccountId: String(r['f']),
      toAccountId: String(r['tt']),
      amountMinor: minorOf(r['amt']),
      description: String(r['d']),
    }));
  }

  async function auditOf(
    exec: SqlExecutor,
    workspaceId: Id,
    period: { from: IsoDate | null; to: IsoDate | null },
    accountIds: Id[] | undefined,
  ): Promise<AuditEntry[]> {
    // Las marcas son UTC; el periodo es de calendario local: [medianoche local de from, de to + 1).
    const params: Record<string, SqlValue> = { aws: workspaceId };
    const conds = ['l.workspace_id = :aws'];
    if (period.from !== null) {
      params['afrom'] = fromIsoDate(period.from).toISOString();
      conds.push('l.at >= :afrom');
    }
    if (period.to !== null) {
      params['ato'] = fromIsoDate(addDays(period.to, 1)).toISOString();
      conds.push('l.at < :ato');
    }
    if (accountIds && accountIds.length > 0) {
      conds.push(
        `l.account_id IN (${accountIds
          .map((id, i) => {
            params[`aa${i}`] = id;
            return `:aa${i}`;
          })
          .join(', ')})`,
      );
    }
    const changeCols = COLUMNS.audit_log_changes.map((c) => `'${c}', c.${c}`).join(', ');
    const rows = await exec.all<AuditLogRecord & { changes_json: string }>(
      `SELECT l.*,
         (SELECT json_group_array(json_object(${changeCols})) FROM audit_log_changes c WHERE c.action_id = l.id) AS changes_json
       FROM audit_log l WHERE ${conds.join(' AND ')} ORDER BY l.at, l.id`,
      params,
    );
    return rows.map((r) => toAuditEntry(r, JSON.parse(r.changes_json) as AuditChangeRecord[]));
  }

  async function build(workspaceId: Id, input: ReportRecipe): Promise<ReportDocument> {
    const shaped = checkReportRecipe(input);
    return readTx(deps, async (tx) => {
      const ctx: WsContext = await loadContext(tx, workspaceId);
      const { recipe, warnings } = validateRecipe(shaped, ctx.fields);
      const filter = checkFilter(recipe.filter);
      const range = resolvePeriod(filter.period, clock);
      const sections = new Set(recipe.sections);
      const accountFilter = (filter.accountIds ?? []).filter((id) => ctx.accounts.some((a) => a.id === id));

      // Estado por cuenta y total.
      const lines = await statementByAccount(tx, workspaceId, filter, range);
      const nonZero = (l: StatementLine | undefined) =>
        l !== undefined && Object.values(l).some((v) => v !== 0);
      // Con filtro de cuentas, solo esas (aunque ninguna sea de este espacio); si no, las no archivadas y las
      // archivadas que tengan algo en el informe.
      const byAccountFilter = (filter.accountIds?.length ?? 0) > 0;
      const shown = ctx.accounts.filter((a) =>
        byAccountFilter ? accountFilter.includes(a.id) : a.archivedAt === null || nonZero(lines.get(a.id)),
      );
      const byAccount = shown.map((account) => ({ account, ...(lines.get(account.id) ?? emptyStatement()) }));
      // El total suma TODAS las líneas, también las de cuentas que no se muestran (no puede haberlas con
      // valores: una cuenta sin mostrar tiene la línea en cero).
      let statement = emptyStatement();
      for (const line of lines.values()) statement = addStatement(statement, line);

      // Reparto por campos (solo entradas/salidas activas del periodo).
      const byField: ReportDocument['byField'] = [];
      if (sections.has('by_field')) {
        const ids = recipe.groupByFieldIds.length > 0 ? recipe.groupByFieldIds : defaultGroupFields(ctx.fields);
        const dimCtx = { accounts: ctx.accounts, fields: ctx.fields, range, locale: deps.locale };
        for (const fieldId of ids) {
          const field = ctx.fields.find((f) => f.id === fieldId);
          if (field === undefined) continue;
          const first = buildDimension({ by: 'field', fieldId }, dimCtx, 'g1');
          byField.push({ field, groups: await queryGroups(tx, { workspaceId, filter, clock, first }) });
        }
      }

      const transfers = sections.has('transfers') ? await transfersOf(tx, workspaceId, filter) : [];

      // Movimientos (detallado) y anulados aparte: en orden cronológico; saldo corrido si es una cuenta.
      const single = singleAccountOf(filter);
      const order = orderFor({ by: 'date', dir: 'asc' }, single !== null);
      const rowsFor = async (status: 'active' | 'voided') => {
        const compiled = compileFilter(withStatus(filter, status), { workspaceId, clock });
        return selectRows(tx, { ...compiled, order, runningAccountId: single });
      };
      const movements = recipe.form === 'detailed' || sections.has('movements') ? await rowsFor('active') : null;
      const voided = recipe.includeVoided ? await rowsFor('voided') : null;
      const audit = sections.has('audit') ? await auditOf(tx, workspaceId, range, filter.accountIds) : null;

      const ws = ctx.workspace;
      return {
        meta: {
          workspaceName: ws.name,
          ownerName: ws.ownerName,
          logoDataUrl: ws.logoDataUrl,
          currency: ws.currency,
          period: range,
          generatedAt: clock.now().toISOString(),
          form: recipe.form,
          filtered: isFiltered(filter),
          filterDescription: describeFilter(filter, {
            fields: ctx.fields,
            accounts: ctx.accounts,
            currency: ws.currency,
            locale: deps.locale,
          }),
          warnings,
          includeVoided: recipe.includeVoided,
        },
        statement,
        byAccount,
        byField,
        transfers,
        movements,
        voided,
        audit,
        signature: recipe.signature || sections.has('signature'),
        recipe,
        accounts: ctx.accounts,
        fields: ctx.fields,
      };
    });
  }

  function preset(form: 'summary' | 'detailed', period: DateRange): ReportRecipe {
    if (form !== 'summary' && form !== 'detailed') throw new DomainError('invalid_recipe', { path: '$.form' });
    const filter = checkFilter({ period });
    return {
      v: 1,
      kind: 'report',
      form,
      filter,
      sections: [...(form === 'summary' ? SUMMARY_SECTIONS : DETAILED_SECTIONS)],
      groupByFieldIds: [],
      columns: [],
      includeVoided: false,
      signature: false,
    };
  }

  return { build, preset };
}
