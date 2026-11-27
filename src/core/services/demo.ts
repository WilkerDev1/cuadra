// Datos de ejemplo (ARCHITECTURE.md 3.5, 6). El plan determinista sale de src/core/demo; este servicio lo
// escribe SOLO con los servicios públicos del núcleo, para que lotes, importaciones e historial sean
// exactamente los que dejaría una persona usando la app:
//
//   1. templates.applyWithKeys: el espacio is_demo con cuentas, campos, vistas y saldos iniciales.
//   2. Estructura extra: accounts.create, fields.create y fields.addOption.
//   3. Movimientos en orden de fechas: batches.capture para cada tabla de captura (con su total de
//      control), importCsv.fromRows → preview → commit para cada hoja de Excel, y transactions.createMany
//      por bloques semanales (≤ 400 borradores) con el resto.
//   4. La historia: ediciones, anulaciones, restauraciones, lote anulado, fusión, renombre, campo
//      desactivado y cuenta archivada, con su acción de historial real.
//   5. Vistas guardadas extra y, si no había ninguno, un respaldo verificado hace 41 días (vencido).
//
// Todo corre con un reloj guionizado: cada acción queda fechada el día en que ocurre en el plan. Los
// eventos de cambio se acumulan y salen UNO por espacio al terminar (la UI no recalcula a cada bloque);
// el progreso se informa con onProgress. Si algo falla, el espacio se borra entero (workspaces.purge).
import { FixedClock } from '../dates';
import {
  countPlanTransactions,
  DEMO_PROFILES,
  isDemoProfileId,
  planDemo,
  recordedOn,
  type DemoItem,
  type DemoPlan,
  type DemoProfile,
  type DemoProfileId,
  type DemoValue,
  type DemoValues,
} from '../demo';
import { DomainError } from '../errors';
import type { ChangeListener, EventBus, TableName } from '../events';
import { Money } from '../money';
import type { Clock } from '../ports';
import { resolveTemplateRecipe, type TemplateKeyMap } from '../recipes';
import type { Field, FieldType, FieldValue, FieldValues, Id, IsoDate, Mutation, Warning, Workspace } from '../types';
import type { CoreDeps } from '../uow';
import { createAccountsService } from './accounts';
import { createAuditWriter } from './audit';
import { createBatchesService } from './batches';
import { createFieldsService } from './fields';
import { createImportCsvService, type Cell, type ColumnMapping } from './importCsv';
import { createSettingsService } from './settings';
import { createTemplatesService } from './templates';
import { createTransactionsService, type CreateManyDraft } from './transactions';
import { createViewsService } from './views';
import { createWorkspacesService } from './workspaces';

export type { DemoProfile, DemoProfileId } from '../demo';

export interface DemoSeedResult {
  workspace: Workspace;
  /** Filas de `transactions` creadas (saldos iniciales y los dos lados de cada transferencia incluidos). */
  transactions: number;
  /** Lotes creados: tablas de captura, importaciones y bloques de la demo. */
  batches: number;
  /** Pasos de la historia aplicados (ediciones, anulaciones, fusiones…). */
  steps: number;
  /** Vistas guardadas que añadió la demo (además de las de la plantilla). */
  views: number;
}

export type DemoPhase = 'structure' | 'movements' | 'history' | 'done';

export interface DemoProgress {
  profile: DemoProfileId;
  phase: DemoPhase;
  /** Unidades hechas y totales de ESTE perfil (movimientos + pasos de historia + vistas). */
  done: number;
  total: number;
  /** 0–1 de toda la carga (en seedAll, los tres perfiles; en seed, el perfil). Nunca baja. */
  fraction: number;
}

export interface DemoSeedOptions {
  seed?: number;
  months?: number;
  /** Se llama tras cada guardado (bloque, lote, paso): sirve para una barra de progreso. */
  onProgress?: (p: DemoProgress) => void;
}

export interface DemoService {
  profiles(): DemoProfile[];
  /** Plan puro (sin escribir): para la vista previa y las pruebas de determinismo. */
  plan(profile: DemoProfileId, opts?: { seed?: number; months?: number; anchor?: IsoDate }): DemoPlan;
  /** Crea un espacio nuevo is_demo=1 con ~14 meses que terminan en clock.today(). */
  seed(profile: DemoProfileId, opts?: DemoSeedOptions): Promise<Mutation<DemoSeedResult>>;
  /** Los tres perfiles, en orden (colmado, despacho, personal). Si uno falla no queda ninguno. */
  seedAll(opts?: DemoSeedOptions): Promise<Array<Mutation<DemoSeedResult>>>;
}

/** Bloques de movimientos sueltos: uno por semana, como mucho este número de borradores. */
export const DEMO_BLOCK_MAX = 400;

/**
 * Reloj que el servicio mueve paso a paso (fechas del plan); hora local fija dentro del día. Nunca pasa de
 * `limit` (el "ahora" real): lo de hoy que se anotaría "al cerrar la caja" queda un minuto antes de ahora.
 */
class ScriptClock implements Clock {
  private readonly inner = new FixedClock();
  constructor(private readonly limit: Date) {}
  at(date: IsoDate, minutes: number): void {
    this.inner.setToday(date); // mediodía local
    this.inner.advance(minutes * 60_000);
    const cap = this.limit.getTime() - 60_000;
    if (this.inner.now().getTime() > cap) this.inner.set(new Date(cap));
  }
  now(): Date {
    return this.inner.now();
  }
  today(): IsoDate {
    return this.inner.today();
  }
}

/** Bus que no avisa a nadie: junta las tablas tocadas para emitir UN evento al final. */
class BufferBus implements EventBus {
  readonly tables = new Set<TableName>();
  readonly size = 0;
  subscribe(_listener: ChangeListener): () => void {
    return () => undefined;
  }
  emit(e: { tables: readonly TableName[] }): void {
    for (const t of e.tables) this.tables.add(t);
  }
}

const ddmm = (d: IsoDate): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Lunes de la semana de `d` (clave del bloque semanal). */
function weekOf(d: IsoDate): string {
  const date = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Claves del plan → ids, con la forma de las plantillas (opciones como 'campo.opción'). */
interface Keys extends TemplateKeyMap {
  types: Record<string, FieldType>;
}

function lookup(map: Record<string, Id>, key: string, entity: string): Id {
  const id = Object.hasOwn(map, key) ? map[key] : undefined;
  if (id === undefined) throw new DomainError('not_found', { entity, key });
  return id;
}

function fieldValue(keys: Keys, fieldKey: string, v: DemoValue): { fieldId: Id; value: FieldValue } {
  const fieldId = lookup(keys.fields, fieldKey, 'field');
  switch (keys.types[fieldKey]) {
    case 'list':
      return { fieldId, value: { type: 'list', optionId: lookup(keys.options, `${fieldKey}.${String(v)}`, 'option') } };
    case 'number':
      if (typeof v !== 'number') throw new DomainError('field_value_type_mismatch', { field: fieldKey });
      return { fieldId, value: { type: 'number', value: v } };
    case 'date':
      return { fieldId, value: { type: 'date', value: String(v) } };
    case 'bool':
      return { fieldId, value: { type: 'bool', value: v === true } };
    default:
      return { fieldId, value: { type: 'text', value: String(v) } };
  }
}

function toValues(keys: Keys, vs: DemoValues | undefined): FieldValues {
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(vs ?? {})) {
    const { fieldId, value } = fieldValue(keys, k, v);
    out[fieldId] = value;
  }
  return out;
}

const withNotes = <T extends object>(draft: T, notes: string | undefined): T => (notes === undefined ? draft : { ...draft, notes });

function draftOf(keys: Keys, it: Extract<DemoItem, { t: 'tx' | 'transfer' }>): CreateManyDraft {
  if (it.t === 'transfer') {
    return withNotes(
      {
        kind: 'transfer' as const,
        fromAccountId: lookup(keys.accounts, it.from, 'account'),
        toAccountId: lookup(keys.accounts, it.to, 'account'),
        amountMinor: it.amountMinor,
        date: it.date,
        description: it.description,
        values: toValues(keys, it.values),
      },
      it.notes,
    );
  }
  return withNotes(
    {
      accountId: lookup(keys.accounts, it.account, 'account'),
      kind: it.kind,
      amountMinor: it.amountMinor,
      date: it.date,
      description: it.description,
      values: toValues(keys, it.values),
    },
    it.notes,
  );
}

/**
 * Hoja tipo Excel de un estado de cuenta: preámbulo del banco, una fila vacía, cabeceras y una fila por
 * movimiento con Débito/Crédito en texto es-DO ("12,500.00") y una columna por campo con valores.
 */
export function buildStatementSheet(
  it: Extract<DemoItem, { t: 'import' }>,
  fields: readonly Field[],
  currency: Workspace['currency'],
  /** Opción de lista por clave del plan → su id (para escribir la etiqueta actual en la celda). */
  optionId: (fieldKey: string, optionKey: string) => Id,
): { rows: Cell[][]; headers: string[]; fieldColumns: Array<{ field: Field; column: number }>; notesColumn: number | null } {
  const used = new Set(it.rows.flatMap((r) => Object.keys(r.values)));
  const cols = fields.filter((f) => used.has(f.key));
  const hasNotes = it.rows.some((r) => r.notes !== undefined);
  const headers = ['Fecha', 'Descripción', ...(hasNotes ? ['Notas'] : []), 'Débito', 'Crédito', ...cols.map((f) => f.label)];
  const base = hasNotes ? 3 : 2;
  const fmt = (minor: number) => Money.format(minor, { locale: 'es-DO', currency, display: 'none' });
  const cell = (f: Field, v: DemoValue | undefined): Cell => {
    if (v === undefined) return '';
    switch (f.type) {
      case 'list':
        return f.options.find((o) => o.id === optionId(f.key, String(v)))?.label ?? String(v);
      case 'bool':
        return v === true ? 'Sí' : 'No';
      case 'number':
        return typeof v === 'number' ? v : String(v);
      default:
        return String(v);
    }
  };
  const rows: Cell[][] = [...it.preamble.map((line) => [line]), [], headers];
  for (const r of it.rows) {
    rows.push([
      ddmm(r.date),
      r.description,
      ...(hasNotes ? [r.notes ?? ''] : []),
      r.kind === 'expense' ? fmt(r.amountMinor) : '',
      r.kind === 'income' ? fmt(r.amountMinor) : '',
      ...cols.map((f) => cell(f, r.values[f.key])),
    ]);
  }
  return { rows, headers, fieldColumns: cols.map((field, i) => ({ field, column: base + 2 + i })), notesColumn: hasNotes ? 2 : null };
}

export function createDemoService(deps: CoreDeps): DemoService {
  const workspaces = createWorkspacesService(deps);

  const plan: DemoService['plan'] = (profile, opts = {}) =>
    planDemo(profile, {
      anchor: opts.anchor ?? deps.clock.today(),
      ...(opts.seed === undefined ? {} : { seed: opts.seed }),
      ...(opts.months === undefined ? {} : { months: opts.months }),
    });

  const planUnits = (p: DemoPlan): number => countPlanTransactions(p) + p.steps.length + p.views.length;

  async function seedPlan(
    p: DemoPlan,
    report: (phase: DemoPhase, done: number, total: number) => void,
  ): Promise<Mutation<DemoSeedResult>> {
    const info = DEMO_PROFILES.find((x) => x.id === p.profile) as DemoProfile;
    const clock = new ScriptClock(deps.clock.now());
    const bus = new BufferBus();
    const scripted: CoreDeps = { ...deps, clock, events: bus, audit: createAuditWriter({ clock, ids: deps.ids }) };
    const templates = createTemplatesService(scripted);
    const accounts = createAccountsService(scripted);
    const fields = createFieldsService(scripted);
    const transactions = createTransactionsService(scripted);
    const batches = createBatchesService(scripted);
    const importCsv = createImportCsvService(scripted);
    const views = createViewsService(scripted);
    const settings = createSettingsService(scripted);
    const total = planUnits(p);
    let done = 0;

    clock.at(p.start, -4 * 60); // 08:00 del primer día
    const applied = await templates.applyWithKeys(p.templateId, {
      name: p.workspace.name,
      ...(p.workspace.ownerName === undefined ? {} : { ownerName: p.workspace.ownerName }),
      openingBalances: p.openings,
      isDemo: true,
    });
    const ws = applied.value.workspace;
    const workspaceId = ws.id;
    try {
      // ── Estructura extra ──
      const keys: Keys = {
        accounts: { ...applied.value.keyMap.accounts },
        fields: { ...applied.value.keyMap.fields },
        options: { ...applied.value.keyMap.options },
        types: {},
      };
      let transactionCount = Object.keys(p.openings).length;
      for (const a of p.extraAccounts) {
        const created = await accounts.create({ workspaceId, name: a.name, type: a.type, ...(a.icon === undefined ? {} : { icon: a.icon }), ...(a.opening ? { opening: a.opening } : {}) });
        keys.accounts[a.key] = created.value.id;
        if (a.opening) transactionCount += 1;
      }
      for (const f of p.extraFields) {
        const created = await fields.create({
          workspaceId,
          key: f.key,
          label: f.label,
          type: f.type,
          ...(f.appliesTo === undefined ? {} : { appliesTo: f.appliesTo }),
          ...(f.role === undefined ? {} : { role: f.role }),
          ...(f.options === undefined ? {} : { options: f.options.map((o) => ({ label: o.label })) }),
        });
        keys.fields[f.key] = created.value.id;
        for (const o of f.options ?? []) {
          const opt = created.value.options.find((x) => x.label === o.label);
          if (opt === undefined) throw new DomainError('not_found', { entity: 'option', field: f.key, key: o.key });
          keys.options[`${f.key}.${o.key}`] = opt.id;
        }
      }
      for (const [fieldKey, opts] of Object.entries(p.extraOptions)) {
        const fieldId = lookup(keys.fields, fieldKey, 'field');
        for (const o of opts) keys.options[`${fieldKey}.${o.key}`] = (await fields.addOption(fieldId, { label: o.label })).value.id;
      }
      for (const f of await fields.list(workspaceId, { includeInactive: true })) keys.types[f.key] = f.type;
      const optionOf = (fieldKey: string, optionKey: string): Id => lookup(keys.options, `${fieldKey}.${optionKey}`, 'option');
      done = transactionCount;
      report('structure', done, total);

      // ── Movimientos ──
      const refs = new Map<string, Id>();
      let batchCount = 0;
      let block: Array<Extract<DemoItem, { t: 'tx' | 'transfer' }>> = [];
      let blockWeek = '';
      let minute = 0;
      const flush = async () => {
        if (block.length === 0) return;
        const first = block[0]!.date;
        const last = block[block.length - 1]!.date;
        const rows = block.reduce((n, it) => n + (it.t === 'transfer' ? 2 : 1), 0);
        // 20:00 y pico del día en que se anota el bloque (el domingo de su semana, o hoy): la historia del plan
        // empieza después (recordedOn).
        clock.at(recordedOn(block[block.length - 1]!, p.anchor), 8 * 60 + (minute++ % 50));
        const r = await transactions.createMany({
          workspaceId,
          batch: { source: 'demo', accountId: null, label: first === last ? `Anotado el ${ddmm(first)}` : `Anotado del ${ddmm(first)} al ${ddmm(last)}` },
          drafts: block.map((it) => draftOf(keys, it)),
          audit: { action: 'demo_seed', message: 'audit.demo.seed', params: { profile: p.profile, name: info.name, transactions: rows } },
        });
        block.forEach((it, i) => {
          if (it.ref !== undefined) refs.set(it.ref, r.value.ids[i] as Id);
        });
        transactionCount += rows;
        batchCount += 1;
        done += rows;
        block = [];
        report('movements', done, total);
      };

      for (const it of p.items) {
        if (it.t === 'tx' || it.t === 'transfer') {
          const week = weekOf(it.date);
          if (block.length > 0 && (week !== blockWeek || block.length >= DEMO_BLOCK_MAX)) await flush();
          blockWeek = week;
          block.push(it);
          continue;
        }
        const accountId = lookup(keys.accounts, it.account, 'account');
        if (it.t === 'capture') {
          clock.at(it.date, 9 * 60 + (minute++ % 50)); // al cerrar la caja
          const r = await batches.capture({
            workspaceId,
            accountId,
            kind: it.kind,
            date: it.date,
            label: it.label,
            controlTotalMinor: it.controlTotalMinor,
            acceptControlMismatch: it.mismatchNote !== undefined,
            rows: it.rows.map((row) => withNotes({ amount: row.amountMinor, description: row.description, values: toValues(keys, row.values) }, row.notes)),
          });
          if (r.status !== 'saved' || r.rowErrors.length > 0) throw new Error(`demo: la captura «${it.label}» no se guardó (${r.status})`);
          if (it.ref !== undefined) refs.set(it.ref, r.batchId);
        } else {
          clock.at(it.date, 4 * 60 + (minute++ % 50));
          // La hoja se arma con las etiquetas de ESE momento (una opción renombrada después sale con el nombre viejo).
          const sheet = buildStatementSheet(it, await fields.list(workspaceId), ws.currency, optionOf);
          const raw = importCsv.fromRows(sheet.rows);
          const at = (h: string) => sheet.headers.indexOf(h);
          const mapping: ColumnMapping = {
            date: { column: at('Fecha'), format: 'dd/MM/yyyy' },
            amount: { mode: 'split', inColumn: at('Crédito'), outColumn: at('Débito') },
            amountLocale: 'es-DO',
            description: { column: at('Descripción') },
            ...(sheet.notesColumn === null ? {} : { notes: { column: sheet.notesColumn } }),
            fields: Object.fromEntries(sheet.fieldColumns.map((c) => [c.field.id, { column: c.column }])),
            createMissingOptions: false,
          };
          const inMinor = Money.sum(it.rows.filter((r) => r.kind === 'income').map((r) => r.amountMinor));
          const outMinor = Money.sum(it.rows.filter((r) => r.kind === 'expense').map((r) => r.amountMinor));
          const preview = await importCsv.preview(workspaceId, accountId, raw, mapping, { fileTotalInMinor: inMinor, fileTotalOutMinor: outMinor });
          const include = preview.rows.filter((r) => r.draft !== null && r.status !== 'error' && r.status !== 'opening_suspect').map((r) => r.index);
          if (include.length !== it.rows.length || preview.fileTotalDifference.inMinor !== 0 || preview.fileTotalDifference.outMinor !== 0) {
            const issues = preview.rows.filter((r) => r.status === 'error').slice(0, 3).map((r) => r.issues.join('+'));
            throw new Error(`demo: «${it.fileName}» se leyó con ${include.length} de ${it.rows.length} filas (${issues.join(', ')})`);
          }
          const committed = await importCsv.commit(workspaceId, accountId, preview, { include, fileName: it.fileName, mapping });
          if (it.ref !== undefined) refs.set(it.ref, committed.value.batchId);
        }
        transactionCount += it.rows.length;
        batchCount += 1;
        done += it.rows.length;
        report('movements', done, total);
      }
      await flush();

      // ── Historia ──
      const ref = (r: string): Id => {
        const id = refs.get(r);
        if (id === undefined) throw new DomainError('not_found', { entity: 'demo_ref', ref: r, workspaceId });
        return id;
      };
      let n = 0;
      for (const s of p.steps) {
        clock.at(s.at, 3 * 60 + (n % 120)); // por la tarde
        switch (s.t) {
          case 'edit': {
            const patchValues: Record<Id, FieldValue | null> = {};
            for (const [k, v] of Object.entries(s.patch.values ?? {})) {
              if (v === null) patchValues[lookup(keys.fields, k, 'field')] = null;
              else {
                const fv = fieldValue(keys, k, v);
                patchValues[fv.fieldId] = fv.value;
              }
            }
            await transactions.update(ref(s.ref), {
              ...(s.patch.amountMinor === undefined ? {} : { amountMinor: s.patch.amountMinor }),
              ...(s.patch.description === undefined ? {} : { description: s.patch.description }),
              ...(s.patch.notes === undefined ? {} : { notes: s.patch.notes }),
              ...(s.patch.date === undefined ? {} : { date: s.patch.date }),
              ...(s.patch.values === undefined ? {} : { values: patchValues }),
            });
            break;
          }
          case 'void':
            await transactions.void(ref(s.ref), s.reason);
            break;
          case 'restore':
            await transactions.restore(ref(s.ref));
            break;
          case 'void_batch':
            await batches.void(ref(s.ref), s.reason);
            break;
          case 'rename_option':
            await fields.updateOption(lookup(keys.options, `${s.field}.${s.option}`, 'option'), { label: s.label });
            break;
          case 'merge_options':
            await fields.mergeOptions(lookup(keys.options, `${s.field}.${s.source}`, 'option'), lookup(keys.options, `${s.field}.${s.target}`, 'option'));
            break;
          case 'deactivate_field':
            await fields.deactivate(lookup(keys.fields, s.field, 'field'));
            break;
          case 'archive_account':
            await accounts.archive(lookup(keys.accounts, s.account, 'account'));
            break;
        }
        n += 1;
        done += 1;
        report('history', done, total);
      }

      // ── Vistas guardadas extra y respaldo vencido ──
      clock.at(p.anchor, -2 * 60);
      for (const v of p.views) {
        await views.save({ workspaceId, name: v.name, recipe: resolveTemplateRecipe(v.recipe, keys), ...(v.pinned === undefined ? {} : { pinned: v.pinned }) });
        done += 1;
      }
      if ((await settings.get('backup.lastVerifiedAt')) === null) {
        const at = new Date(clock.now().getTime() - p.backupVerifiedDaysAgo * 86_400_000).toISOString();
        await settings.set('backup.lastVerifiedAt', at);
      }

      const workspace = await workspaces.get(workspaceId);
      // Avisos: el saldo negativo FINAL de cada cuenta (cada bloque avisaría de lo intermedio).
      const warnings: Warning[] = (await createAccountsService(deps).list(workspaceId, { includeArchived: true }))
        .filter((a) => a.isNegative)
        .map((a) => ({ code: 'negative_balance', accountId: a.id, balanceAfterMinor: a.balanceMinor }));
      deps.events.emit({ workspaceId, tables: [...bus.tables], reason: 'demo.seed' });
      report('done', total, total);
      return {
        value: { workspace, transactions: transactionCount, batches: batchCount, steps: n, views: p.views.length },
        warnings,
        auditActionId: applied.auditActionId,
      };
    } catch (error) {
      await workspaces.purge(workspaceId, ws.name).catch(() => undefined);
      throw error;
    }
  }

  async function seedMany(profiles: readonly DemoProfileId[], opts: DemoSeedOptions): Promise<Array<Mutation<DemoSeedResult>>> {
    for (const profile of profiles) if (!isDemoProfileId(profile)) throw new DomainError('not_found', { entity: 'demo_profile', profile });
    const plans = profiles.map((profile) => plan(profile, opts));
    const grand = plans.reduce((s, p) => s + planUnits(p), 0);
    const out: Array<Mutation<DemoSeedResult>> = [];
    let before = 0;
    let last = 0;
    try {
      for (const p of plans) {
        const base = before;
        out.push(
          await seedPlan(p, (phase, done, total) => {
            last = Math.max(last, Math.min(1, (base + done) / grand));
            opts.onProgress?.({ profile: p.profile, phase, done, total, fraction: last });
          }),
        );
        before += planUnits(p);
      }
    } catch (error) {
      for (const r of out) await workspaces.purge(r.value.workspace.id, r.value.workspace.name).catch(() => undefined);
      throw error;
    }
    return out;
  }

  return {
    profiles: () => DEMO_PROFILES.map((x) => ({ ...x })),
    plan,
    async seed(profile, opts = {}) {
      const [r] = await seedMany([profile], opts);
      return r as Mutation<DemoSeedResult>;
    },
    seedAll: (opts = {}) => seedMany(DEMO_PROFILES.map((p) => p.id), opts),
  };
}
