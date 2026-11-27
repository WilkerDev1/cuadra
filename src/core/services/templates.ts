// Plantillas (ARCHITECTURE.md 3.5, PLAN 2 "módulo de plantillas"). Una plantilla crea un espacio completo
// (cuentas, campos, opciones, vistas y saldos iniciales) en UNA transacción con UNA acción template_apply.
// Además: validar e importar un archivo de plantilla externo y "guardar este espacio como plantilla".
//
// Los archivos y su validador viven en src/templates/schema.ts (lo único de templates que core importa).
import {
  BUNDLED_TEMPLATES,
  labelKey,
  previewTemplate,
  serializeTemplate,
  slugKey,
  TEMPLATE_FIXED_COLUMNS,
  TEMPLATE_FORMAT,
  TEMPLATE_FORMAT_VERSION,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_LIMITS,
  templateFileName,
  uniqueKey,
  validateTemplateFile,
  parseTemplateJson,
  type TemplateAccount,
  type TemplateField,
  type TemplateFile,
  type TemplateIssue,
  type TemplateOption,
  type TemplatePreview,
  type TemplateValidation,
  type TemplateView,
} from '../../templates/schema';
import { DomainError, isDomainError } from '../errors';
import type { SqlExecutor } from '../ports';
import { resolveTemplateRecipe, type TemplateKeyMap } from '../recipes';
import {
  insertSql,
  recordValues,
  selectColumns,
  toWorkspace,
  type AccountRecord,
  type FieldOptionRecord,
  type FieldRecord,
  type SavedViewRecord,
} from '../sql/rows';
import type { Currency, FieldCondition, GroupBy, Id, Mutation, ViewRecipe, Workspace } from '../types';
import { mutate, readTx, type CoreDeps, type UowCtx } from '../uow';
import { insertAccountTx, insertOpeningTx, validateOpening, type OpeningInput } from './accounts';
import { insertFieldTx } from './fields';
import { insertWorkspaceTx, normalizeCurrency, requireWorkspace, workspaceSnapshot } from './workspaces';

export type {
  TemplateAccount,
  TemplateField,
  TemplateFile,
  TemplateIssue,
  TemplateOption,
  TemplatePreview,
  TemplateValidation,
  TemplateView,
} from '../../templates/schema';

/** Una plantilla empaquetada (por id) o un archivo ya leído (importado o exportado). */
export type TemplateSource = string | TemplateFile;

export interface ApplyTemplateInput {
  name: string;
  ownerName?: string;
  /** Moneda del espacio. Si falta, la sugerida por la plantilla o DOP. */
  currency?: Currency;
  openingBalances?: Record<string /* account key */, OpeningInput>;
  /** Tinta del espacio; por defecto la de la plantilla. */
  color?: string;
  /** Espacios de datos de ejemplo (demo.seed). */
  isDemo?: boolean;
}

export interface AppliedTemplate {
  workspace: Workspace;
  /** Claves de la plantilla → ids creados (demo e importación los usan para traducir referencias). */
  keyMap: TemplateKeyMap;
  openingIds: Record<string /* account key */, Id>;
}

export interface ExportTemplateOptions {
  id?: string;
  name?: string;
  description?: string;
}

export interface TemplatesService {
  list(): TemplateFile[]; // síncrono: son datos empaquetados
  /** Plantilla empaquetada por id ('not_found' si no existe). */
  get(templateId: string): TemplateFile;
  preview(template: TemplateSource): TemplatePreview; // lo que se va a crear (Frappe Books)
  apply(template: TemplateSource, input: ApplyTemplateInput): Promise<Mutation<Workspace>>;
  /** Igual que apply, devolviendo además el mapa de claves → ids (para demo e importación). */
  applyWithKeys(template: TemplateSource, input: ApplyTemplateInput): Promise<Mutation<AppliedTemplate>>;
  /** Valida un archivo externo: forma, claves y recetas (según core/recipes). No escribe nada. */
  validate(input: unknown): TemplateValidation;
  /** Texto de un archivo .cuadra-plantilla.json → plantilla validada. */
  parse(json: string): TemplateValidation;
  /** "Guardar este espacio como plantilla": estructura sin movimientos ni saldos. */
  exportFromWorkspace(workspaceId: Id, opts?: ExportTemplateOptions): Promise<TemplateFile>;
  /** Plantilla → texto y nombre de archivo para descargar. */
  serialize(file: TemplateFile): { json: string; fileName: string };
}

// ── Validación completa (forma + recetas) ─────────────────────────────────────────────

/** Mapa clave → clave: comprueba una receta de plantilla con el resolvedor real sin BD. */
function identityKeyMap(file: TemplateFile): TemplateKeyMap {
  const map: TemplateKeyMap = { accounts: {}, fields: {}, options: {} };
  for (const a of file.accounts) map.accounts[a.key] = a.key;
  for (const f of file.fields) {
    map.fields[f.key] = f.key;
    for (const o of f.options ?? []) map.options[`${f.key}.${o.key}`] = o.key;
  }
  return map;
}

function recipePath(viewIndex: number, error: unknown): string {
  const raw = isDomainError(error) && typeof error.details?.['path'] === 'string' ? error.details['path'] : '$';
  return `views[${viewIndex}].recipe${raw.replace(/^\$/, '')}`;
}

export function validateTemplate(input: unknown): TemplateValidation {
  const shape = validateTemplateFile(input);
  if (!shape.ok) return shape;
  const keyMap = identityKeyMap(shape.value);
  const issues: TemplateIssue[] = [];
  shape.value.views.forEach((view, i) => {
    try {
      const recipe = resolveTemplateRecipe(view.recipe, keyMap);
      if (recipe.kind !== view.kind) {
        issues.push({ path: `views[${i}].recipe.kind`, message: `La receta no es del tipo de la vista «${view.name}».` });
      }
    } catch (error) {
      issues.push({
        path: recipePath(i, error),
        message: `La vista «${view.name}» tiene una receta que Cuadra no entiende; revisa ese valor.`,
      });
    }
  });
  return issues.length > 0 ? { ok: false, issues } : shape;
}

function assertValid(input: unknown): TemplateFile {
  const result = validateTemplate(input);
  if (result.ok) return result.value;
  const recipeOnly = result.issues.every((i) => /^views\[\d+\]\.recipe/.test(i.path));
  // Si solo fallan recetas de vistas, invalid_recipe; si falla la forma del archivo, template_invalid.
  // Las incidencias (ruta + mensaje en español) van en details.issues.
  throw new DomainError(recipeOnly ? 'invalid_recipe' : 'template_invalid', { issues: result.issues });
}

// ── Aplicar ──────────────────────────────────────────────────────────────────────────

interface ApplyResult {
  workspaceId: Id;
  keyMap: TemplateKeyMap;
  openingIds: Record<string, Id>;
  counts: { accounts: number; fields: number; options: number; views: number; openings: number };
}

async function writeTemplateTx(
  ctx: UowCtx,
  file: TemplateFile,
  input: ApplyTemplateInput & { workspaceId: Id; currency: Currency },
): Promise<ApplyResult> {
  const ws = await insertWorkspaceTx(ctx, {
    id: input.workspaceId,
    name: input.name,
    currency: input.currency,
    color: input.color ?? file.color ?? null,
    templateId: file.id,
    isDemo: input.isDemo ?? false,
    ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
  });
  const keyMap: TemplateKeyMap = { accounts: {}, fields: {}, options: {} };
  let optionCount = 0;

  for (const [i, a] of file.accounts.entries()) {
    const account = await insertAccountTx(ctx, {
      workspaceId: ws.id,
      name: a.name,
      type: a.type,
      color: a.color ?? null,
      icon: a.icon ?? null,
      sortOrder: i,
    });
    keyMap.accounts[a.key] = account.id;
  }

  for (const f of file.fields) {
    const field = await insertFieldTx(ctx, {
      workspaceId: ws.id,
      key: f.key,
      label: f.label,
      type: f.type,
      role: f.role ?? null,
      appliesTo: f.appliesTo ?? 'both',
      showInList: f.showInList ?? false,
      options: (f.options ?? []).map((o) => ({
        key: o.key,
        label: o.label,
        color: o.color ?? null,
        appliesTo: o.appliesTo ?? 'both',
      })),
    });
    keyMap.fields[f.key] = field.id;
    for (const o of field.options) {
      if (o.key !== null) keyMap.options[`${f.key}.${o.key}`] = o.id;
    }
    optionCount += field.options.length;
  }

  const now = ctx.clock.now().toISOString();
  const orderByKind = new Map<string, number>();
  const views: SavedViewRecord[] = file.views.map((v) => {
    const recipe = resolveTemplateRecipe(v.recipe, keyMap);
    const order = orderByKind.get(v.kind) ?? 0;
    orderByKind.set(v.kind, order + 1);
    return {
      id: ctx.ids.next(),
      workspace_id: ws.id,
      kind: v.kind,
      name: v.name,
      recipe: JSON.stringify(recipe),
      recipe_version: recipe.v,
      pinned: v.pinned ? 1 : 0,
      sort_order: order,
      source: 'template',
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
  });
  if (views.length > 0) {
    await ctx.tx.runMany(
      insertSql('saved_views'),
      views.map((r) => recordValues('saved_views', r)),
    );
  }

  const openingIds: Record<string, Id> = {};
  for (const [key, opening] of Object.entries(input.openingBalances ?? {})) {
    if (opening.amountMinor === 0) continue;
    const accountId = keyMap.accounts[key];
    if (accountId === undefined) throw new DomainError('not_found', { entity: 'account', key });
    openingIds[key] = await insertOpeningTx(ctx, { workspaceId: ws.id, accountId, opening });
  }

  const counts = {
    accounts: file.accounts.length,
    fields: file.fields.length,
    options: optionCount,
    views: views.length,
    openings: Object.keys(openingIds).length,
  };
  await ctx.audit.record(ctx.tx, {
    workspaceId: ws.id,
    action: 'template_apply',
    entityType: 'workspace',
    entityId: ws.id,
    accountId: null,
    batchId: null,
    message: 'audit.template.apply',
    params: { templateId: file.id, templateName: file.name, templateVersion: file.version, name: ws.name, ...counts },
    changes: [{ entityId: ws.id, path: '*', new: workspaceSnapshot(ws) }],
  });
  ctx.touch('workspaces', 'accounts', 'fields');
  if (optionCount > 0) ctx.touch('field_options');
  if (views.length > 0) ctx.touch('saved_views');
  if (counts.openings > 0) ctx.touch('transactions');
  return { workspaceId: ws.id, keyMap, openingIds, counts };
}

// ── Exportar un espacio como plantilla ───────────────────────────────────────────────

const ID_LIKE = /^[a-z][a-z0-9_-]{0,39}$/;
const COLOR_OK = /^(tint-[1-8]|#[0-9a-fA-F]{6})$/;
const ICON_OK = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const clip = (s: string, max: number = TEMPLATE_LIMITS.text) => (s.length > max ? s.slice(0, max).trim() : s);

interface ReverseMap {
  accounts: Map<Id, string>;
  fields: Map<Id, string>;
  options: Map<Id, string>; // id → clave corta de la opción
}

/** Traduce una receta de ids a claves. null = la vista usa algo que no viaja (se omite). */
function recipeToKeys(recipe: ViewRecipe, rev: ReverseMap): ViewRecipe | null {
  const copy = structuredClone(recipe) as ViewRecipe;
  const filter = copy.filter;
  delete filter.batchId; // un lote es de este espacio
  if (filter.accountIds !== undefined && filter.accountIds.length > 0) {
    const keys = filter.accountIds.map((id) => rev.accounts.get(id));
    if (keys.some((k) => k === undefined)) return null;
    filter.accountIds = keys as string[];
  }
  if (filter.fields !== undefined) {
    const conds: FieldCondition[] = [];
    for (const c of filter.fields) {
      const fieldKey = rev.fields.get(c.fieldId);
      if (fieldKey === undefined) return null;
      if (c.op === 'any_of') {
        const optionKeys = c.optionIds.map((id) => rev.options.get(id));
        if (optionKeys.some((k) => k === undefined)) return null;
        conds.push({ ...c, fieldId: fieldKey, optionIds: optionKeys as string[] });
      } else {
        conds.push({ ...c, fieldId: fieldKey });
      }
    }
    filter.fields = conds;
  }
  const mapGroup = (g: GroupBy): GroupBy | null => {
    if (g.by !== 'field') return g;
    const key = rev.fields.get(g.fieldId);
    return key === undefined ? null : { by: 'field', fieldId: key };
  };
  const fixed = new Set<string>(TEMPLATE_FIXED_COLUMNS);
  const mapColumns = (cols: string[]) =>
    cols.flatMap((c) => {
      const key = rev.fields.get(c);
      if (key !== undefined) return [key];
      return fixed.has(c) ? [c] : [];
    });
  switch (copy.kind) {
    case 'filter':
      if (copy.columns !== undefined) copy.columns = mapColumns(copy.columns);
      return copy;
    case 'summary': {
      const groupBy = mapGroup(copy.groupBy);
      if (groupBy === null) return null;
      copy.groupBy = groupBy;
      if (copy.split !== undefined) {
        const split = mapGroup(copy.split);
        if (split === null) delete copy.split;
        else copy.split = split;
      }
      return copy;
    }
    case 'report':
      copy.groupByFieldIds = copy.groupByFieldIds.flatMap((id) => {
        const key = rev.fields.get(id);
        return key === undefined ? [] : [key];
      });
      copy.columns = mapColumns(copy.columns);
      return copy;
  }
}

async function buildExport(tx: SqlExecutor, workspaceId: Id, opts: ExportTemplateOptions): Promise<TemplateFile> {
  const ws = toWorkspace(await requireWorkspace(tx, workspaceId));
  const accountRows = await tx.all<AccountRecord>(
    `SELECT ${selectColumns('accounts')} FROM accounts WHERE workspace_id = ? AND archived_at IS NULL
     ORDER BY sort_order, created_at, id`,
    [workspaceId],
  );
  const fieldRows = await tx.all<FieldRecord>(
    `SELECT ${selectColumns('fields')} FROM fields WHERE workspace_id = ? AND deactivated_at IS NULL
     ORDER BY sort_order, created_at, id`,
    [workspaceId],
  );
  const optionRows = await tx.all<FieldOptionRecord>(
    `SELECT ${selectColumns('field_options', 'o')} FROM field_options o JOIN fields f ON f.id = o.field_id
     WHERE f.workspace_id = ? AND f.deactivated_at IS NULL AND o.deactivated_at IS NULL
     ORDER BY o.sort_order, o.created_at, o.id`,
    [workspaceId],
  );
  const viewRows = await tx.all<SavedViewRecord>(
    `SELECT ${selectColumns('saved_views')} FROM saved_views WHERE workspace_id = ? AND deleted_at IS NULL
     ORDER BY CASE kind WHEN 'filter' THEN 0 WHEN 'summary' THEN 1 ELSE 2 END, sort_order, created_at, id`,
    [workspaceId],
  );

  const rev: ReverseMap = { accounts: new Map(), fields: new Map(), options: new Map() };

  const accountKeys = new Set<string>();
  const accounts: TemplateAccount[] = accountRows.slice(0, TEMPLATE_LIMITS.accounts).map((r) => {
    const key = uniqueKey(slugKey(r.name, 'cuenta'), accountKeys);
    accountKeys.add(key);
    rev.accounts.set(r.id, key);
    const a: TemplateAccount = { key, name: clip(r.name), type: r.type as TemplateAccount['type'] };
    if (r.color !== null && COLOR_OK.test(r.color)) a.color = r.color;
    if (r.icon !== null && ICON_OK.test(r.icon)) a.icon = r.icon;
    return a;
  });

  const fieldKeys = new Set<string>();
  const fields: TemplateField[] = fieldRows.slice(0, TEMPLATE_LIMITS.fields).map((r) => {
    const base = TEMPLATE_KEY_PATTERN.test(r.key) && r.key.length <= 40 ? r.key : slugKey(r.label, 'campo');
    const key = uniqueKey(base, fieldKeys);
    fieldKeys.add(key);
    rev.fields.set(r.id, key);
    const f: TemplateField = { key, label: clip(r.label), type: r.type as TemplateField['type'] };
    if (r.role !== null) f.role = r.role as NonNullable<TemplateField['role']>;
    if (r.applies_to !== 'both') f.appliesTo = r.applies_to as NonNullable<TemplateField['appliesTo']>;
    if (r.show_in_list === 1) f.showInList = true;
    if (r.type === 'list') {
      const optionKeys = new Set<string>();
      const seenLabels = new Set<string>();
      f.options = optionRows
        .filter((o) => o.field_id === r.id)
        .filter((o) => {
          const lk = labelKey(o.label);
          if (seenLabels.has(lk)) return false;
          seenLabels.add(lk);
          return true;
        })
        .map((o) => {
          const candidate = o.key !== null && TEMPLATE_KEY_PATTERN.test(o.key) && o.key.length <= 40 ? o.key : slugKey(o.label, 'opcion');
          const optionKey = uniqueKey(candidate, optionKeys);
          optionKeys.add(optionKey);
          rev.options.set(o.id, optionKey);
          const option: TemplateOption = { key: optionKey, label: clip(o.label) };
          if (o.color !== null && COLOR_OK.test(o.color)) option.color = o.color;
          if (o.applies_to !== 'both') option.appliesTo = o.applies_to as NonNullable<TemplateOption['appliesTo']>;
          return option;
        });
    }
    return f;
  });

  const viewKeys = new Set<string>();
  const views: TemplateView[] = [];
  for (const r of viewRows) {
    if (views.length >= TEMPLATE_LIMITS.views) break;
    let recipe: ViewRecipe;
    try {
      recipe = JSON.parse(r.recipe) as ViewRecipe;
    } catch {
      continue;
    }
    const mapped = recipeToKeys(recipe, rev);
    if (mapped === null) continue;
    const key = uniqueKey(slugKey(r.name, 'vista'), viewKeys);
    viewKeys.add(key);
    const view: TemplateView = { key, name: clip(r.name), kind: r.kind as TemplateView['kind'], recipe: mapped };
    if (r.pinned === 1) view.pinned = true;
    views.push(view);
  }

  const idSource = opts.id ?? opts.name ?? ws.name;
  const slug = slugKey(idSource, 'plantilla').replace(/_+/g, '_');
  const file: TemplateFile = {
    format: TEMPLATE_FORMAT,
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id: ID_LIKE.test(slug) ? slug : 'plantilla',
    version: 1,
    name: clip((opts.name ?? ws.name).trim() || ws.name),
    description: clip(opts.description ?? `Plantilla creada a partir del espacio «${ws.name}».`, TEMPLATE_LIMITS.description),
    currency: ws.currency,
    accounts,
    fields,
    views,
  };
  if (ws.color !== null && COLOR_OK.test(ws.color)) file.color = ws.color;

  // Defensa: una vista que aun así no valide se deja fuera en lugar de estropear el archivo entero.
  let result = validateTemplate(file);
  if (!result.ok) {
    const badViews = new Set(
      result.issues.flatMap((i) => {
        const m = /^views\[(\d+)\]/.exec(i.path);
        return m ? [Number(m[1])] : [];
      }),
    );
    file.views = file.views.filter((_, i) => !badViews.has(i));
    result = validateTemplate(file);
  }
  if (!result.ok) throw new DomainError('template_invalid', { issues: result.issues });
  return result.value;
}

// ── Servicio ─────────────────────────────────────────────────────────────────────────

export function createTemplatesService(deps: CoreDeps): TemplatesService {
  const bundled = (): TemplateFile[] => BUNDLED_TEMPLATES.map((t) => structuredClone(t));

  const get = (templateId: string): TemplateFile => {
    const found = BUNDLED_TEMPLATES.find((t) => t.id === templateId);
    if (found === undefined) throw new DomainError('not_found', { entity: 'template', id: templateId });
    return structuredClone(found);
  };

  const resolve = (source: TemplateSource): TemplateFile => (typeof source === 'string' ? get(source) : assertValid(source));

  const applyWithKeys: TemplatesService['applyWithKeys'] = async (source, input) => {
    const file = resolve(source);
    const currency = normalizeCurrency(input.currency ?? file.currency ?? { code: 'DOP', minorDigits: 2 });
    const accountKeys = new Set(file.accounts.map((a) => a.key));
    for (const [key, opening] of Object.entries(input.openingBalances ?? {})) {
      if (!accountKeys.has(key)) throw new DomainError('not_found', { entity: 'account', key, templateId: file.id });
      validateOpening(opening);
    }
    const workspaceId = deps.ids.next();
    return mutate(deps, workspaceId, 'template.apply', async (ctx) => {
      const r = await writeTemplateTx(ctx, file, { ...input, workspaceId, currency });
      const ws = toWorkspace(await requireWorkspace(ctx.tx, r.workspaceId));
      return { workspace: ws, keyMap: r.keyMap, openingIds: r.openingIds };
    });
  };

  return {
    list: bundled,
    get,
    preview: (source) => previewTemplate(resolve(source)),
    applyWithKeys,
    async apply(source, input) {
      const result = await applyWithKeys(source, input);
      return { value: result.value.workspace, warnings: result.warnings, auditActionId: result.auditActionId };
    },
    validate: (input) => validateTemplate(input),
    parse(json) {
      const parsed = parseTemplateJson(json);
      return parsed.ok ? validateTemplate(parsed.value) : parsed;
    },
    exportFromWorkspace: (workspaceId, opts = {}) => readTx(deps, (tx) => buildExport(tx, workspaceId, opts)),
    serialize: (file) => ({ json: serializeTemplate(file), fileName: templateFileName(file) }),
  };
}
