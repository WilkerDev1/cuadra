// Plantillas de espacio (ARCHITECTURE.md 3.5, PLAN 2): archivo JSON versionado + validador con errores
// legibles. Una plantilla es SOLO estructura (cuentas, campos, opciones y vistas guardadas): nunca trae
// movimientos ni ids de la BD. Todo se referencia por claves estables ('categoria', 'categoria.ventas').
//
// Capa: src/templates solo importa tipos de core/types (regla 1.3). La comprobación profunda de recetas
// (parseViewRecipe/resolveTemplateRecipe) la hace el servicio del núcleo; aquí se valida la forma, las
// claves y que cada referencia de una receta exista en la propia plantilla.
import type { AccountType, AppliesTo, Currency, FieldRole, FieldType, ViewRecipe } from '../core/types';

export const TEMPLATE_FORMAT = 'cuadra-template' as const;
/** Versión de la forma del archivo. Un archivo con versión mayor lo hizo un Cuadra más nuevo. */
export const TEMPLATE_FORMAT_VERSION = 1 as const;

export interface TemplateAccount {
  key: string;
  name: string;
  type: AccountType;
  color?: string;
  icon?: string;
}

export interface TemplateOption {
  key: string;
  label: string;
  color?: string;
  appliesTo?: AppliesTo;
}

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  role?: FieldRole;
  appliesTo?: AppliesTo;
  showInList?: boolean;
  /** Solo en campos de tipo 'list'. */
  options?: TemplateOption[];
}

/**
 * Receta con claves de plantilla en lugar de ids: misma forma que ViewRecipe, pero `accountIds` lleva
 * claves de cuenta, `fieldId`/`groupByFieldIds`/`columns` claves de campo y `optionIds` claves de opción
 * ('ventas' o 'categoria.ventas'). Las columnas que no son campos son fijas (TEMPLATE_FIXED_COLUMNS).
 */
export type TemplateRecipe = ViewRecipe;

export interface TemplateView {
  key: string;
  name: string;
  kind: ViewRecipe['kind'];
  pinned?: boolean;
  recipe: TemplateRecipe;
}

export interface TemplateFile {
  format: typeof TEMPLATE_FORMAT;
  formatVersion: number;
  /** 'negocio', 'despacho', 'organizacion', 'personal', 'blanco' o el de una plantilla propia. */
  id: string;
  /** Versión del contenido de esta plantilla (sube cuando cambian sus cuentas, campos o vistas). */
  version: number;
  name: string;
  description: string;
  /** Tinta del lomo en la pantalla de plantillas ('tint-1'…'tint-8'). */
  color?: string;
  /** Moneda sugerida; el usuario la confirma al crear el espacio. */
  currency?: Currency;
  accounts: TemplateAccount[];
  fields: TemplateField[];
  views: TemplateView[];
}

/** Lo que se va a crear (pantalla de plantilla antes de confirmar). */
export interface TemplatePreview {
  templateId: string;
  name: string;
  description: string;
  color: string | null;
  currency: Currency | null;
  accounts: Array<{ key: string; name: string; type: AccountType }>;
  fields: Array<{ key: string; label: string; type: FieldType; role: FieldRole | null; options: string[] }>;
  views: Array<{ key: string; name: string; kind: ViewRecipe['kind'] }>;
}

export interface TemplateIssue {
  /** Ruta dentro del archivo: 'accounts[1].key', 'views[0].recipe.filter.fields[0].fieldId'. */
  path: string;
  /** Mensaje en español para la persona que importa el archivo. */
  message: string;
}

export type TemplateValidation = { ok: true; value: TemplateFile } | { ok: false; issues: TemplateIssue[] };

/** Columnas fijas que una receta puede pedir además de los campos. */
export const TEMPLATE_FIXED_COLUMNS = [
  'date',
  'seq',
  'kind',
  'account',
  'description',
  'notes',
  'amount',
  'running',
  'status',
] as const;

export const TEMPLATE_LIMITS = {
  accounts: 50,
  fields: 50,
  options: 300,
  views: 60,
  text: 120,
  description: 500,
} as const;

// ── Catálogos ───────────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: readonly AccountType[] = ['cash', 'bank', 'card', 'savings', 'wallet', 'other'];
const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'date', 'list', 'bool'];
const FIELD_ROLES: readonly FieldRole[] = [
  'category',
  'contact',
  'fund',
  'cost_center',
  'payment_method',
  'reference',
  'reconciled',
];
const APPLIES: readonly AppliesTo[] = ['both', 'in', 'out'];
const VIEW_KINDS: readonly ViewRecipe['kind'][] = ['filter', 'summary', 'report'];
const OPS_BY_TYPE: Record<FieldType, readonly string[]> = {
  list: ['any_of', 'empty', 'not_empty'],
  bool: ['is', 'empty', 'not_empty'],
  text: ['contains', 'empty', 'not_empty'],
  number: ['between', 'empty', 'not_empty'],
  date: ['date_between', 'empty', 'not_empty'],
};

const TYPE_NAMES: Record<FieldType, string> = {
  text: 'texto',
  number: 'número',
  date: 'fecha',
  list: 'lista',
  bool: 'sí/no',
};

/** Misma regla que el CHECK de fields.key en 001_init.sql. */
export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
const COLOR_PATTERN = /^(tint-[1-8]|#[0-9a-fA-F]{6})$/;
const ICON_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

// ── Ayudas ──────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const has = (o: Obj, k: string) => Object.hasOwn(o, k) && o[k] !== undefined;

/** Etiqueta comparable: minúsculas, sin tildes ni espacios sobrantes ("Café " = "cafe"). */
export function labelKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Fecha de factura" → "fecha_de_factura" (clave válida para fields.key). */
export function slugKey(label: string, fallback = 'campo'): string {
  const slug = labelKey(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (slug === '') return fallback;
  return /^[a-z]/.test(slug) ? slug : `${fallback}_${slug}`;
}

/** Primera clave libre: 'ventas', 'ventas_2', 'ventas_3'… */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

class Issues {
  readonly list: TemplateIssue[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
}

function text(
  o: Obj,
  key: string,
  path: string,
  issues: Issues,
  what: string,
  opts: { optional?: boolean; max?: number; allowEmpty?: boolean } = {},
): string | undefined {
  const p = path === '' ? key : `${path}.${key}`;
  if (!has(o, key)) {
    if (!opts.optional) issues.add(p, `Falta ${what}.`);
    return undefined;
  }
  const v = o[key];
  if (typeof v !== 'string') {
    issues.add(p, `${capitalize(what)} debe ser un texto.`);
    return undefined;
  }
  const trimmed = v.trim();
  if (trimmed === '' && !opts.allowEmpty) {
    issues.add(p, `${capitalize(what)} no puede quedar vacío.`);
    return undefined;
  }
  const max = opts.max ?? TEMPLATE_LIMITS.text;
  if (trimmed.length > max) {
    issues.add(p, `${capitalize(what)} es demasiado largo (máximo ${max} caracteres).`);
    return undefined;
  }
  return trimmed;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function enumValue<T extends string>(
  o: Obj,
  key: string,
  path: string,
  allowed: readonly T[],
  issues: Issues,
  what: string,
  optional = false,
): T | undefined {
  const p = `${path}.${key}`;
  if (!has(o, key)) {
    if (!optional) issues.add(p, `Falta ${what}.`);
    return undefined;
  }
  const v = o[key];
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  issues.add(p, `${capitalize(what)} «${String(v)}» no es válido. Valores posibles: ${allowed.join(', ')}.`);
  return undefined;
}

function keyValue(o: Obj, path: string, issues: Issues, taken: Set<string>, what: string): string | undefined {
  const p = `${path}.key`;
  const v = o['key'];
  if (typeof v !== 'string' || !TEMPLATE_KEY_PATTERN.test(v) || v.length > 40) {
    issues.add(
      p,
      `La clave de ${what} debe empezar por una letra minúscula y llevar solo minúsculas, números y guiones bajos (por ejemplo «caja_chica»).`,
    );
    return undefined;
  }
  if (taken.has(v)) {
    issues.add(p, `La clave «${v}» está repetida en ${what}s: cada una debe ser única.`);
    return undefined;
  }
  taken.add(v);
  return v;
}

function optionalColor(o: Obj, path: string, issues: Issues): string | undefined {
  if (!has(o, 'color')) return undefined;
  const v = o['color'];
  if (typeof v === 'string' && COLOR_PATTERN.test(v)) return v;
  issues.add(`${path}.color`, 'El color debe ser una tinta de Cuadra («tint-1» a «tint-8») o un color «#rrggbb».');
  return undefined;
}

function optionalBool(o: Obj, key: string, path: string, issues: Issues): boolean | undefined {
  if (!has(o, key)) return undefined;
  if (typeof o[key] === 'boolean') return o[key];
  issues.add(`${path}.${key}`, `«${key}» debe ser true o false.`);
  return undefined;
}

// ── Secciones ───────────────────────────────────────────────────────────────────────

function validateCurrency(x: unknown, issues: Issues): Currency | undefined {
  if (!isObj(x)) {
    issues.add('currency', 'La moneda debe ser un objeto con «code» y «minorDigits».');
    return undefined;
  }
  const code = x['code'];
  const digits = x['minorDigits'];
  let ok = true;
  if (typeof code !== 'string' || !CURRENCY_PATTERN.test(code)) {
    issues.add('currency.code', 'El código de moneda debe tener tres letras mayúsculas (DOP, USD, MXN…).');
    ok = false;
  }
  if (digits !== 0 && digits !== 2 && digits !== 3) {
    issues.add('currency.minorDigits', 'Los decimales de la moneda deben ser 0, 2 o 3.');
    ok = false;
  }
  if (has(x, 'symbol') && (typeof x['symbol'] !== 'string' || x['symbol'].trim() === '' || x['symbol'].length > 8)) {
    issues.add('currency.symbol', 'El símbolo de la moneda debe ser un texto corto (por ejemplo «RD$»).');
    ok = false;
  }
  if (!ok) return undefined;
  const currency: Currency = { code: code as string, minorDigits: digits as 0 | 2 | 3 };
  if (typeof x['symbol'] === 'string') currency.symbol = x['symbol'].trim();
  return currency;
}

function validateAccounts(x: unknown, issues: Issues): TemplateAccount[] {
  if (!Array.isArray(x)) {
    issues.add('accounts', 'Falta la lista de cuentas («accounts»).');
    return [];
  }
  if (x.length === 0) issues.add('accounts', 'La plantilla necesita al menos una cuenta para poder anotar.');
  if (x.length > TEMPLATE_LIMITS.accounts) issues.add('accounts', `Demasiadas cuentas (máximo ${TEMPLATE_LIMITS.accounts}).`);
  const keys = new Set<string>();
  const names = new Set<string>();
  const out: TemplateAccount[] = [];
  x.forEach((raw, i) => {
    const path = `accounts[${i}]`;
    if (!isObj(raw)) {
      issues.add(path, `La cuenta ${i + 1} debe ser un objeto.`);
      return;
    }
    const key = keyValue(raw, path, issues, keys, 'cuenta');
    const name = text(raw, 'name', path, issues, 'el nombre de la cuenta');
    if (name !== undefined) {
      if (names.has(labelKey(name))) issues.add(`${path}.name`, `Hay dos cuentas llamadas «${name}».`);
      names.add(labelKey(name));
    }
    const type = enumValue(raw, 'type', path, ACCOUNT_TYPES, issues, 'el tipo de cuenta');
    const color = optionalColor(raw, path, issues);
    let icon: string | undefined;
    if (has(raw, 'icon')) {
      if (typeof raw['icon'] === 'string' && ICON_PATTERN.test(raw['icon'])) icon = raw['icon'];
      else issues.add(`${path}.icon`, 'El icono debe ser un nombre de icono (por ejemplo «Wallet»).');
    }
    if (key === undefined || name === undefined || type === undefined) return;
    const account: TemplateAccount = { key, name, type };
    if (color !== undefined) account.color = color;
    if (icon !== undefined) account.icon = icon;
    out.push(account);
  });
  return out;
}

function validateFields(x: unknown, issues: Issues): TemplateField[] {
  if (!Array.isArray(x)) {
    issues.add('fields', 'Falta la lista de campos («fields»); puede estar vacía.');
    return [];
  }
  if (x.length > TEMPLATE_LIMITS.fields) issues.add('fields', `Demasiados campos (máximo ${TEMPLATE_LIMITS.fields}).`);
  const keys = new Set<string>();
  const labels = new Set<string>();
  let optionCount = 0;
  const out: TemplateField[] = [];
  x.forEach((raw, i) => {
    const path = `fields[${i}]`;
    if (!isObj(raw)) {
      issues.add(path, `El campo ${i + 1} debe ser un objeto.`);
      return;
    }
    const key = keyValue(raw, path, issues, keys, 'campo');
    const label = text(raw, 'label', path, issues, 'el nombre del campo');
    if (label !== undefined) {
      if (labels.has(labelKey(label))) issues.add(`${path}.label`, `Hay dos campos llamados «${label}».`);
      labels.add(labelKey(label));
    }
    const type = enumValue(raw, 'type', path, FIELD_TYPES, issues, 'el tipo de campo');
    const role = enumValue(raw, 'role', path, FIELD_ROLES, issues, 'el papel del campo', true);
    const appliesTo = enumValue(raw, 'appliesTo', path, APPLIES, issues, '«appliesTo»', true);
    const showInList = optionalBool(raw, 'showInList', path, issues);
    let options: TemplateOption[] | undefined;
    if (has(raw, 'options')) {
      if (type !== undefined && type !== 'list') {
        issues.add(
          `${path}.options`,
          `Solo los campos de tipo lista llevan opciones; «${label ?? key ?? ''}» es de tipo ${TYPE_NAMES[type]}.`,
        );
      } else {
        options = validateOptions(raw['options'], `${path}.options`, issues);
        optionCount += options.length;
      }
    }
    if (key === undefined || label === undefined || type === undefined) return;
    const field: TemplateField = { key, label, type };
    if (role !== undefined) field.role = role;
    if (appliesTo !== undefined) field.appliesTo = appliesTo;
    if (showInList !== undefined) field.showInList = showInList;
    if (type === 'list') field.options = options ?? [];
    out.push(field);
  });
  if (optionCount > TEMPLATE_LIMITS.options) issues.add('fields', `Demasiadas opciones (máximo ${TEMPLATE_LIMITS.options}).`);
  return out;
}

function validateOptions(x: unknown, path: string, issues: Issues): TemplateOption[] {
  if (!Array.isArray(x)) {
    issues.add(path, 'Las opciones deben ser una lista.');
    return [];
  }
  const keys = new Set<string>();
  const labels = new Set<string>();
  const out: TemplateOption[] = [];
  x.forEach((raw, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(raw)) {
      issues.add(p, `La opción ${i + 1} debe ser un objeto.`);
      return;
    }
    const key = keyValue(raw, p, issues, keys, 'opción');
    const label = text(raw, 'label', p, issues, 'el nombre de la opción');
    let labelOk = label !== undefined;
    if (label !== undefined) {
      if (labels.has(labelKey(label))) {
        issues.add(`${p}.label`, `La opción «${label}» está repetida (no se distinguen mayúsculas ni tildes).`);
        labelOk = false;
      }
      labels.add(labelKey(label));
    }
    const color = optionalColor(raw, p, issues);
    const appliesTo = enumValue(raw, 'appliesTo', p, APPLIES, issues, '«appliesTo»', true);
    if (key === undefined || label === undefined || !labelOk) return;
    const option: TemplateOption = { key, label };
    if (color !== undefined) option.color = color;
    if (appliesTo !== undefined) option.appliesTo = appliesTo;
    out.push(option);
  });
  return out;
}

interface RefContext {
  accounts: ReadonlySet<string>;
  fields: ReadonlyMap<string, TemplateField>;
}

function checkRecipeRefs(recipe: Obj, path: string, ctx: RefContext, issues: Issues): void {
  const filter = recipe['filter'];
  if (isObj(filter)) {
    const accountIds = filter['accountIds'];
    if (Array.isArray(accountIds)) {
      accountIds.forEach((k, i) => {
        if (typeof k !== 'string' || !ctx.accounts.has(k)) {
          issues.add(`${path}.filter.accountIds[${i}]`, `La vista usa la cuenta «${String(k)}», que no está en la plantilla.`);
        }
      });
    }
    const conds = filter['fields'];
    if (Array.isArray(conds)) {
      conds.forEach((c, i) => {
        const p = `${path}.filter.fields[${i}]`;
        if (!isObj(c)) {
          issues.add(p, 'Cada condición de campo debe ser un objeto.');
          return;
        }
        const field = typeof c['fieldId'] === 'string' ? ctx.fields.get(c['fieldId']) : undefined;
        if (field === undefined) {
          issues.add(`${p}.fieldId`, `La vista filtra por el campo «${String(c['fieldId'])}», que no está en la plantilla.`);
          return;
        }
        if (typeof c['op'] !== 'string' || !OPS_BY_TYPE[field.type].includes(c['op'])) {
          issues.add(
            `${p}.op`,
            `El campo «${field.label}» es de tipo ${TYPE_NAMES[field.type]} y no admite la condición «${String(c['op'])}».`,
          );
          return;
        }
        if (c['op'] === 'any_of' && Array.isArray(c['optionIds'])) {
          const optionKeys = new Set((field.options ?? []).map((o) => o.key));
          c['optionIds'].forEach((o, j) => {
            const k = typeof o === 'string' && o.startsWith(`${field.key}.`) ? o.slice(field.key.length + 1) : o;
            if (typeof k !== 'string' || !optionKeys.has(k)) {
              issues.add(`${p}.optionIds[${j}]`, `La opción «${String(o)}» no existe en el campo «${field.label}».`);
            }
          });
        }
      });
    }
  }
  for (const g of ['groupBy', 'split'] as const) {
    const group = recipe[g];
    if (isObj(group) && group['by'] === 'field') {
      const field = typeof group['fieldId'] === 'string' ? ctx.fields.get(group['fieldId']) : undefined;
      if (field === undefined) {
        issues.add(`${path}.${g}.fieldId`, `La vista agrupa por el campo «${String(group['fieldId'])}», que no está en la plantilla.`);
      } else if (field.type === 'number') {
        issues.add(`${path}.${g}.fieldId`, `No se puede agrupar por «${field.label}» porque es un campo numérico.`);
      }
    }
  }
  const groupByFieldIds = recipe['groupByFieldIds'];
  if (Array.isArray(groupByFieldIds)) {
    groupByFieldIds.forEach((k, i) => {
      if (typeof k !== 'string' || !ctx.fields.has(k)) {
        issues.add(`${path}.groupByFieldIds[${i}]`, `El informe agrupa por el campo «${String(k)}», que no está en la plantilla.`);
      }
    });
  }
  const columns = recipe['columns'];
  if (Array.isArray(columns)) {
    columns.forEach((k, i) => {
      if (typeof k !== 'string' || !(ctx.fields.has(k) || (TEMPLATE_FIXED_COLUMNS as readonly string[]).includes(k))) {
        issues.add(
          `${path}.columns[${i}]`,
          `La columna «${String(k)}» no es un campo de la plantilla ni una columna fija (${TEMPLATE_FIXED_COLUMNS.join(', ')}).`,
        );
      }
    });
  }
}

function validateViews(x: unknown, ctx: RefContext, issues: Issues): TemplateView[] {
  if (!Array.isArray(x)) {
    issues.add('views', 'Falta la lista de vistas guardadas («views»); puede estar vacía.');
    return [];
  }
  if (x.length > TEMPLATE_LIMITS.views) issues.add('views', `Demasiadas vistas (máximo ${TEMPLATE_LIMITS.views}).`);
  const keys = new Set<string>();
  const out: TemplateView[] = [];
  x.forEach((raw, i) => {
    const path = `views[${i}]`;
    if (!isObj(raw)) {
      issues.add(path, `La vista ${i + 1} debe ser un objeto.`);
      return;
    }
    const before = issues.list.length;
    const key = keyValue(raw, path, issues, keys, 'vista');
    const name = text(raw, 'name', path, issues, 'el nombre de la vista');
    const kind = enumValue(raw, 'kind', path, VIEW_KINDS, issues, 'el tipo de vista');
    const pinned = optionalBool(raw, 'pinned', path, issues);
    const recipe = raw['recipe'];
    if (!isObj(recipe)) {
      issues.add(`${path}.recipe`, 'Falta la receta de la vista («recipe»).');
      return;
    }
    if (recipe['v'] !== 1) issues.add(`${path}.recipe.v`, 'La receta debe ser de la versión 1 («v»: 1).');
    if (kind !== undefined && recipe['kind'] !== kind) {
      issues.add(`${path}.recipe.kind`, `La receta es de tipo «${String(recipe['kind'])}» pero la vista dice «${kind}».`);
    }
    if (!isObj(recipe['filter'])) issues.add(`${path}.recipe.filter`, 'La receta necesita un filtro («filter»), aunque sea vacío.');
    checkRecipeRefs(recipe, `${path}.recipe`, ctx, issues);
    if (issues.list.length > before || key === undefined || name === undefined || kind === undefined) return;
    const view: TemplateView = { key, name, kind, recipe: structuredClone(recipe) as unknown as TemplateRecipe };
    if (pinned !== undefined) view.pinned = pinned;
    out.push(view);
  });
  return out;
}

// ── API ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprueba un archivo de plantilla (empaquetado o importado) y devuelve una copia limpia, sin
 * propiedades desconocidas. Los errores llevan ruta y mensaje en español; se informan todos a la vez.
 */
export function validateTemplateFile(input: unknown): TemplateValidation {
  const issues = new Issues();
  if (!isObj(input)) {
    return { ok: false, issues: [{ path: '$', message: 'El archivo no es una plantilla de Cuadra (se esperaba un objeto JSON).' }] };
  }
  if (input['format'] !== TEMPLATE_FORMAT) {
    issues.add('format', `El archivo no es una plantilla de Cuadra («format» debe ser «${TEMPLATE_FORMAT}»).`);
    return { ok: false, issues: issues.list };
  }
  const formatVersion = input['formatVersion'];
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    issues.add('formatVersion', 'Falta la versión del formato («formatVersion»).');
    return { ok: false, issues: issues.list };
  }
  if (formatVersion > TEMPLATE_FORMAT_VERSION) {
    issues.add('formatVersion', 'La plantilla se hizo con una versión más nueva de Cuadra. Actualiza Cuadra para abrirla.');
    return { ok: false, issues: issues.list };
  }

  const idRaw = input['id'];
  const id = typeof idRaw === 'string' && ID_PATTERN.test(idRaw) ? idRaw : undefined;
  if (id === undefined) {
    issues.add('id', 'El identificador («id») debe ir en minúsculas, sin espacios ni tildes (por ejemplo «mi_negocio»).');
  }
  const version = input['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    issues.add('version', 'La versión de la plantilla («version») debe ser un número entero desde 1.');
  }
  const name = text(input, 'name', '', issues, 'el nombre de la plantilla');
  const description = text(input, 'description', '', issues, 'la descripción', {
    max: TEMPLATE_LIMITS.description,
    allowEmpty: true,
  });
  const color = optionalColor(input, '$', issues);
  const currency = has(input, 'currency') ? validateCurrency(input['currency'], issues) : undefined;
  const accounts = validateAccounts(input['accounts'], issues);
  const fields = validateFields(input['fields'], issues);
  const ctx: RefContext = {
    accounts: new Set(accounts.map((a) => a.key)),
    fields: new Map(fields.map((f) => [f.key, f])),
  };
  const views = validateViews(input['views'], ctx, issues);

  // Las rutas de la raíz no llevan prefijo ('name', no '$.name').
  for (const issue of issues.list) issue.path = issue.path.replace(/^\$\./, '');
  if (issues.list.length > 0 || id === undefined || name === undefined || description === undefined) {
    return { ok: false, issues: issues.list };
  }
  const file: TemplateFile = {
    format: TEMPLATE_FORMAT,
    formatVersion,
    id,
    version: version as number,
    name,
    description,
    accounts,
    fields,
    views,
  };
  if (color !== undefined) file.color = color;
  if (currency !== undefined) file.currency = currency;
  return { ok: true, value: file };
}

/** Texto de un archivo .cuadra-plantilla.json → plantilla validada. */
export function parseTemplateJson(json: string): TemplateValidation {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, issues: [{ path: '$', message: 'El archivo no es JSON válido; puede estar dañado o incompleto.' }] };
  }
  return validateTemplateFile(value);
}

/** Plantilla → texto para descargar (claves en orden estable, sangría de dos espacios). */
export function serializeTemplate(file: TemplateFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Nombre de archivo sugerido al exportar. */
export function templateFileName(file: Pick<TemplateFile, 'id'>): string {
  return `${file.id}.cuadra-plantilla.json`;
}

/** Vista previa de lo que crea una plantilla (sin BD). */
export function previewTemplate(file: TemplateFile): TemplatePreview {
  return {
    templateId: file.id,
    name: file.name,
    description: file.description,
    color: file.color ?? null,
    currency: file.currency ?? null,
    accounts: file.accounts.map((a) => ({ key: a.key, name: a.name, type: a.type })),
    fields: file.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      role: f.role ?? null,
      options: (f.options ?? []).map((o) => o.label),
    })),
    views: file.views.map((v) => ({ key: v.key, name: v.name, kind: v.kind })),
  };
}

// ── Plantillas empaquetadas ─────────────────────────────────────────────────────────
// Viven aquí (y no en index.ts) porque core solo puede importar templates/schema (regla 1.3).

const BUNDLED_ORDER = ['negocio', 'despacho', 'organizacion', 'personal', 'blanco'];

function loadBundled(): TemplateFile[] {
  const modules = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });
  const files: TemplateFile[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const result = validateTemplateFile(raw);
    if (!result.ok) {
      const first = result.issues[0];
      throw new Error(`plantilla empaquetada inválida ${path}: ${first?.path ?? ''} ${first?.message ?? ''}`);
    }
    files.push(result.value);
  }
  const rank = (id: string) => {
    const i = BUNDLED_ORDER.indexOf(id);
    return i === -1 ? BUNDLED_ORDER.length : i;
  };
  return files.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** Plantillas que vienen con Cuadra, validadas y en el orden de la pantalla de plantillas. */
export const BUNDLED_TEMPLATES: readonly TemplateFile[] = Object.freeze(loadBundled());
