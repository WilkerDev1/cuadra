// Filtro de movimientos ⇄ query string (ARCHITECTURE.md 5.3). Es el ÚNICO codificador: Movimientos lo lee y lo
// escribe, e Inicio, Resumen, Informes o cualquier otra pantalla lo usan para enlazar allí (`movementsHref`).
//
//   /e/:wsId/movimientos?periodo=<p>&cuenta=<id>[,<id>…]&f=<base64url(JSON)>&vista=<viewId>
//
//   periodo  un preset (`this_month`, `last_month`, `this_year`, `all`, …: PERIOD_PRESETS del núcleo) o un rango
//            `AAAA-MM-DD..AAAA-MM-DD` (cualquiera de los dos lados puede faltar: `..2026-11-30`).
//   cuenta   uno o varios ids de cuenta separados por comas.
//   f        un `TxFilter` (o parte de él) en JSON UTF-8 codificado en base64url sin relleno. Puede traer
//            cualquier criterio (kinds, amount, text, status, batchId, fields, e incluso period/accountIds).
//   vista    id de una vista guardada de tipo filtro: se abre y se reescribe como los parámetros de arriba.
//
// Precedencia: valores por defecto < `f` < `periodo`/`cuenta`. Un `f` o un `periodo` mal formados se ignoran
// (no rompen la pantalla). Sin `periodo` ni `f.period`, el periodo es el de por defecto de la pantalla
// (`this_month` en Movimientos).
import { parseViewRecipe, PERIOD_PRESETS, type DateRange, type Id, type PeriodPreset, type TxFilter } from '../../core';

export const PARAM = { period: 'periodo', account: 'cuenta', filter: 'f', view: 'vista' } as const;

// ── base64url de texto UTF-8 ─────────────────────────────────────────────────────────

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(value: string): string | null {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ── Periodo ──────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeriodParam(value: string | null): DateRange | null {
  if (value === null || value === '') return null;
  if ((PERIOD_PRESETS as readonly string[]).includes(value)) return { preset: value as PeriodPreset };
  const m = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(value);
  if (m === null) return null;
  const [, from, to] = m;
  if (from === undefined && to === undefined) return null;
  if (from !== undefined && to !== undefined && from > to) return null;
  const range: { from?: string; to?: string } = {};
  if (from !== undefined && ISO.test(from)) range.from = from;
  if (to !== undefined && ISO.test(to)) range.to = to;
  return checkFilter({ period: range }) === null ? null : range;
}

export function formatPeriodParam(range: DateRange): string {
  if ('preset' in range) return range.preset;
  return `${range.from ?? ''}..${range.to ?? ''}`;
}

// ── Filtro ───────────────────────────────────────────────────────────────────────────

/** Valida la forma con el mismo verificador de recetas del núcleo. `null` si no es un TxFilter válido. */
export function checkFilter(value: unknown): TxFilter | null {
  const r = parseViewRecipe({ v: 1, kind: 'filter', filter: value });
  return r.ok && r.value.kind === 'filter' ? r.value.filter : null;
}

/**
 * Quita lo vacío y lo que vale por defecto, para comparar filtros y para escribir la URL corta.
 * `defaultPeriod` se conserva solo si difiere del de la pantalla cuando `dropDefaultPeriod` es true.
 */
export function normalizeFilter(filter: TxFilter): TxFilter {
  const out: TxFilter = {};
  if (filter.period !== undefined) out.period = 'preset' in filter.period ? { preset: filter.period.preset } : pickRange(filter.period);
  if (filter.accountIds !== undefined && filter.accountIds.length > 0) out.accountIds = [...new Set(filter.accountIds)].sort();
  if (filter.kinds !== undefined && filter.kinds.length > 0) out.kinds = [...new Set(filter.kinds)].sort();
  if (filter.amount !== undefined && (filter.amount.min !== undefined || filter.amount.max !== undefined)) {
    out.amount = {
      ...(filter.amount.min === undefined ? {} : { min: filter.amount.min }),
      ...(filter.amount.max === undefined ? {} : { max: filter.amount.max }),
    };
  }
  const text = filter.text?.trim() ?? '';
  if (text !== '') out.text = text;
  if (filter.status !== undefined && filter.status !== 'active') out.status = filter.status;
  if (filter.batchId !== undefined) out.batchId = filter.batchId;
  if (filter.fields !== undefined && filter.fields.length > 0) {
    out.fields = [...filter.fields].sort((a, b) => (a.fieldId < b.fieldId ? -1 : a.fieldId > b.fieldId ? 1 : 0));
  }
  return out;
}

function pickRange(r: { from?: string; to?: string }): { from?: string; to?: string } {
  return { ...(r.from === undefined ? {} : { from: r.from }), ...(r.to === undefined ? {} : { to: r.to }) };
}

// ── Filtro suelto ⇄ base64url ────────────────────────────────────────────────────────

/** Cualquier TxFilter → parámetro `f` (base64url del JSON normalizado). */
export function encodeTxFilter(filter: TxFilter): string {
  return encodeBase64Url(JSON.stringify(normalizeFilter(filter)));
}

/** Parámetro `f` → TxFilter con forma válida (la comprueba el núcleo), o `null`. */
export function decodeTxFilter(value: string | null): TxFilter | null {
  if (value === null || value === '') return null;
  const text = decodeBase64Url(value);
  if (text === null) return null;
  try {
    return checkFilter(JSON.parse(text));
  } catch {
    return null;
  }
}

export function sameFilter(a: TxFilter, b: TxFilter): boolean {
  return JSON.stringify(normalizeFilter(a)) === JSON.stringify(normalizeFilter(b));
}

export interface LedgerUrlState {
  filter: TxFilter;
  /** Id de vista pedido con `vista=` (la pantalla lo resuelve y reescribe la URL). */
  viewId: string | null;
  /** Algún parámetro venía mal formado y se ignoró. */
  invalid: boolean;
}

/** Lee la query string. `defaults.period` se usa si ni `periodo` ni `f.period` lo dan. */
export function readLedgerSearch(search: URLSearchParams, defaults: { period: DateRange }): LedgerUrlState {
  let invalid = false;
  let base: TxFilter = {};
  const raw = search.get(PARAM.filter);
  if (raw !== null && raw !== '') {
    const text = decodeBase64Url(raw);
    let parsed: unknown = null;
    try {
      parsed = text === null ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    const checked = checkFilter(parsed);
    if (checked === null) invalid = true;
    else base = checked;
  }
  const periodRaw = search.get(PARAM.period);
  const period = parsePeriodParam(periodRaw);
  if (periodRaw !== null && periodRaw !== '' && period === null) invalid = true;
  const accountRaw = search.get(PARAM.account);
  const accountIds = accountRaw === null ? [] : accountRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');

  const filter: TxFilter = { ...base, period: period ?? base.period ?? defaults.period };
  if (accountIds.length > 0) filter.accountIds = accountIds;
  const viewId = search.get(PARAM.view);
  return { filter: normalizeFilter(filter), viewId: viewId === '' ? null : viewId, invalid };
}

/**
 * Escribe el filtro en la query string. Conserva los parámetros ajenos de `keep` (p. ej. de otras pantallas) y
 * quita `vista`. `fixedAccountId`: pantalla de una cuenta (la cuenta va en la ruta, no en `cuenta`).
 */
export function writeLedgerSearch(
  filter: TxFilter,
  opts: { defaultPeriod: DateRange; fixedAccountId?: Id; keep?: URLSearchParams },
): URLSearchParams {
  const out = new URLSearchParams(opts.keep);
  for (const k of Object.values(PARAM)) out.delete(k);
  const n = normalizeFilter(filter);
  const { period, accountIds, ...rest } = n;
  if (period !== undefined && JSON.stringify(period) !== JSON.stringify(normalizeFilter({ period: opts.defaultPeriod }).period)) {
    out.set(PARAM.period, formatPeriodParam(period));
  }
  const accounts = (accountIds ?? []).filter((id) => id !== opts.fixedAccountId);
  if (accounts.length > 0 && opts.fixedAccountId === undefined) out.set(PARAM.account, accounts.join(','));
  if (Object.keys(rest).length > 0) out.set(PARAM.filter, encodeBase64Url(JSON.stringify(rest)));
  return out;
}

/** Enlace a Movimientos con un filtro. Es el que deben usar todas las pantallas. */
export function movementsHref(wsId: Id, filter: TxFilter, defaultPeriod: DateRange = { preset: 'this_month' }): string {
  const qs = writeLedgerSearch(filter, { defaultPeriod }).toString();
  return `/e/${wsId}/movimientos${qs === '' ? '' : `?${qs}`}`;
}
