// Lógica pura de la bienvenida (sin React ni DOM): pasos, monedas, resumen de plantillas, saldos iniciales,
// entrada del servicio y progreso de los datos de ejemplo. Las pruebas viven en logic.test.ts.
import type { AccountType, ApplyTemplateInput, Currency, DemoPhase, Direction, IsoDate, Minor, TemplateIssue, TemplatePreview } from '../../core';

// ── Pasos ───────────────────────────────────────────────────────────────────────────────

export type Step = 'inicio' | 'plantilla' | 'saldos';

/** Primera vez: bienvenida, plantilla y saldos. «Nuevo espacio» (ya hay espacios): salta la bienvenida. */
export function stepsFor(hasWorkspaces: boolean): Step[] {
  return hasWorkspaces ? ['plantilla', 'saldos'] : ['inicio', 'plantilla', 'saldos'];
}

/** Paso pedido en la URL (`?paso=`) o el primero del recorrido si falta o no es válido. */
export function resolveStep(param: string | null, hasWorkspaces: boolean): Step {
  const steps = stepsFor(hasWorkspaces);
  const found = steps.find((s) => s === param);
  return found ?? steps[0]!;
}

/** Sin plantilla elegida no se puede pasar a los saldos. */
export function guardStep(step: Step, hasTemplate: boolean): Step {
  return step === 'saldos' && !hasTemplate ? 'plantilla' : step;
}

export function stepPosition(step: Step, hasWorkspaces: boolean): { n: number; total: number } {
  const steps = stepsFor(hasWorkspaces);
  return { n: Math.max(1, steps.indexOf(step) + 1), total: steps.length };
}

export function nextStep(step: Step, hasWorkspaces: boolean): Step | null {
  const steps = stepsFor(hasWorkspaces);
  return steps[steps.indexOf(step) + 1] ?? null;
}

export function previousStep(step: Step, hasWorkspaces: boolean): Step | null {
  const steps = stepsFor(hasWorkspaces);
  const i = steps.indexOf(step);
  return i > 0 ? (steps[i - 1] ?? null) : null;
}

// ── Nombre y moneda ─────────────────────────────────────────────────────────────────────

export const NAME_MAX = 80;

export type NameProblem = 'empty' | 'too_long';

export function nameProblem(name: string): NameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > NAME_MAX) return 'too_long';
  return null;
}

export interface CurrencyOption extends Currency {
  symbol: string;
  name: string;
}

/** Monedas que se ofrecen al crear un espacio (todas con 2 decimales). La primera es la de por defecto. */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'DOP', minorDigits: 2, symbol: 'RD$', name: 'Peso dominicano' },
  { code: 'USD', minorDigits: 2, symbol: 'US$', name: 'Dólar estadounidense' },
  { code: 'EUR', minorDigits: 2, symbol: '€', name: 'Euro' },
  { code: 'GBP', minorDigits: 2, symbol: '£', name: 'Libra esterlina' },
  { code: 'CAD', minorDigits: 2, symbol: 'CA$', name: 'Dólar canadiense' },
  { code: 'MXN', minorDigits: 2, symbol: 'MX$', name: 'Peso mexicano' },
  { code: 'COP', minorDigits: 2, symbol: 'COL$', name: 'Peso colombiano' },
  { code: 'BRL', minorDigits: 2, symbol: 'R$', name: 'Real brasileño' },
];

export const DEFAULT_CURRENCY_CODE = 'DOP';

export function currencyByCode(code: string): CurrencyOption {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;
}

/** Texto de una opción del selector: «RD$ · Peso dominicano (DOP)». */
export function currencyLabel(c: CurrencyOption): string {
  return `${c.symbol} · ${c.name} (${c.code})`;
}

// ── Resumen de una plantilla ────────────────────────────────────────────────────────────

export interface TemplateSummary {
  accounts: number;
  categories: number;
  /** Campos distintos de la categoría. */
  otherFields: number;
  views: number;
}

export function categoryOptions(preview: TemplatePreview): string[] {
  return preview.fields.find((f) => f.role === 'category')?.options ?? [];
}

export function summarizeTemplate(preview: TemplatePreview): TemplateSummary {
  const hasCategory = preview.fields.some((f) => f.role === 'category');
  return {
    accounts: preview.accounts.length,
    categories: categoryOptions(preview).length,
    otherFields: preview.fields.length - (hasCategory ? 1 : 0),
    views: preview.views.length,
  };
}

/** Parte visible de una lista larga de chips y cuántos quedan fuera. */
export function splitChips<T>(items: readonly T[], max: number): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: [...items], more: 0 };
  return { shown: items.slice(0, max), more: items.length - max };
}

// ── Plantilla importada de un archivo ───────────────────────────────────────────────────

export const MAX_TEMPLATE_BYTES = 1_000_000;

export function templateFileProblem(file: { name: string; size: number }): 'too_big' | 'not_json' | null {
  if (file.size > MAX_TEMPLATE_BYTES) return 'too_big';
  if (!/\.json$/i.test(file.name)) return 'not_json';
  return null;
}

/** Las primeras incidencias de un archivo inválido, listas para mostrar, y cuántas quedaron fuera. */
export function describeIssues(issues: readonly TemplateIssue[], max = 3): { lines: string[]; more: number } {
  const { shown, more } = splitChips(issues, max);
  return { lines: shown.map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`)), more };
}

// ── Saldos iniciales ────────────────────────────────────────────────────────────────────

export interface OpeningEntry {
  amountMinor: Minor;
  direction: Direction;
}
export type OpeningMap = Readonly<Record<string, OpeningEntry>>;

/** Una tarjeta se empieza debiendo; el resto, con dinero a favor. */
export function defaultDirection(type: AccountType): Direction {
  return type === 'card' ? 'out' : 'in';
}

/** Copia del mapa con el saldo de la cuenta puesto o, con `null` o monto 0, quitado. */
export function withOpening(map: OpeningMap, key: string, entry: OpeningEntry | null): OpeningMap {
  const next: Record<string, OpeningEntry> = { ...map };
  if (entry === null || entry.amountMinor <= 0) delete next[key];
  else next[key] = entry;
  return next;
}

/** Suma con signo (lo que se debe resta). */
export function openingTotal(map: OpeningMap): Minor {
  let total = 0;
  for (const e of Object.values(map)) total += e.direction === 'in' ? e.amountMinor : -e.amountMinor;
  return total;
}

/** Monto en unidad menor como expresión canónica del teclado (`1000.5`): para abrir el teclado con el saldo ya puesto. */
export function minorToExpression(minor: Minor, minorDigits: number): string {
  if (minor <= 0) return '';
  const digits = String(minor).padStart(minorDigits + 1, '0');
  const int = digits.slice(0, digits.length - minorDigits);
  const frac = minorDigits === 0 ? '' : digits.slice(digits.length - minorDigits).replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
}

export function hasOpenings(map: OpeningMap): boolean {
  return Object.keys(map).length > 0;
}

export interface CreateDraft {
  name: string;
  currencyCode: string;
  openings: OpeningMap;
}

/** Entrada de `templates.apply`. Solo pasan los saldos de cuentas que existen en la plantilla y con monto > 0. */
export function buildApplyInput(draft: CreateDraft, accountKeys: readonly string[], today: IsoDate): ApplyTemplateInput {
  const currency = currencyByCode(draft.currencyCode);
  const openingBalances: NonNullable<ApplyTemplateInput['openingBalances']> = {};
  for (const key of accountKeys) {
    const e = draft.openings[key];
    if (e !== undefined && e.amountMinor > 0) openingBalances[key] = { amountMinor: e.amountMinor, direction: e.direction, date: today };
  }
  return {
    name: draft.name.trim(),
    currency: { code: currency.code, minorDigits: currency.minorDigits, symbol: currency.symbol },
    openingBalances,
  };
}

// ── Datos de ejemplo ────────────────────────────────────────────────────────────────────

export type { DemoPhase } from '../../core';

/** Lo que usa la barra de progreso de `demo.seedAll({ onProgress })`. */
export interface DemoProgressLike {
  profile: string;
  phase: DemoPhase;
  fraction: number;
}

/** Porcentaje entero 0–100 de una fracción 0–1 (el 100 solo cuando de verdad terminó). */
export function demoPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(100, Math.max(0, Math.floor(fraction * 100)));
}

/** El progreso nunca retrocede aunque lleguen avisos desordenados. */
export function advanceProgress(previous: number, next: number): number {
  return Math.max(previous, demoPercent(next));
}
