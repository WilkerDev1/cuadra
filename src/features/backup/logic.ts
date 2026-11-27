// Lógica pura de Respaldo: antigüedad del último respaldo, tamaños, validación de la contraseña y recorte de una
// plantilla antes de descargarla. Sin DOM ni React: se prueba en logic.test.ts.
import type { TemplateFile } from '../../core';

// ── Antigüedad del respaldo ────────────────────────────────────────────────────────────

export type BackupAge =
  | { kind: 'never'; overdue: true }
  | { kind: 'today' | 'days' | 'weeks' | 'months'; n: number; days: number; overdue: boolean };

const DAY_MS = 86_400_000;

/** Días enteros de calendario entre dos instantes (según la fecha local de cada uno). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** «Hace 3 días»: unidad y cantidad, y si ya pasó el recordatorio (`reminderDays` días o más). */
export function backupAge(lastVerifiedAt: string | null, now: Date, reminderDays: number): BackupAge {
  if (lastVerifiedAt === null) return { kind: 'never', overdue: true };
  const at = new Date(lastVerifiedAt);
  if (Number.isNaN(at.getTime())) return { kind: 'never', overdue: true };
  const days = Math.max(0, calendarDaysBetween(at, now));
  const overdue = days >= reminderDays;
  if (days === 0) return { kind: 'today', n: 0, days, overdue };
  if (days < 14) return { kind: 'days', n: days, days, overdue };
  if (days < 60) return { kind: 'weeks', n: Math.floor(days / 7), days, overdue };
  return { kind: 'months', n: Math.floor(days / 30), days, overdue };
}

/** Fecha local `YYYY-MM-DD` de un instante ISO (null si no se puede leer). */
export function localIsoDate(timestamp: string): string | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Tamaños ────────────────────────────────────────────────────────────────────────────

/** `1.2 MB` con el separador del locale. */
export function formatBytes(bytes: number, locale = 'es-DO'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${units[unit]}`;
}

// ── Contraseña del respaldo ────────────────────────────────────────────────────────────

export const MIN_BACKUP_PASSWORD = 8;

export type PasswordProblem = 'tooShort' | 'mismatch' | null;

/** Dos campos: el primero se valida al salir de él, el segundo al enviar. Vacío = sin problema (aún). */
export function passwordProblem(password: string, repeat: string, opts: { checkRepeat: boolean }): PasswordProblem {
  if (password.length < MIN_BACKUP_PASSWORD) return 'tooShort';
  if (opts.checkRepeat && password !== repeat) return 'mismatch';
  return null;
}

// ── Archivo elegido ────────────────────────────────────────────────────────────────────

/** Primer fallo legible de un archivo que no es texto razonable (binario, enorme). */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;

// ── Plantilla: qué incluir ─────────────────────────────────────────────────────────────

export interface TemplateInclude {
  accounts: boolean;
  fields: boolean;
  views: boolean;
}

/** Las vistas guardadas apuntan a cuentas y campos por clave: sin ellos la plantilla quedaría inválida. */
export function viewsAvailable(include: Pick<TemplateInclude, 'accounts' | 'fields'>): boolean {
  return include.accounts && include.fields;
}

export function normalizeInclude(include: TemplateInclude): TemplateInclude {
  return { ...include, views: include.views && viewsAvailable(include) };
}

export interface TemplateMeta {
  name: string;
  description: string;
}

/** Recorta una plantilla exportada a lo que la persona eligió y le pone nombre y descripción propios. */
export function pruneTemplate(file: TemplateFile, include: TemplateInclude, meta: TemplateMeta): TemplateFile {
  const inc = normalizeInclude(include);
  const name = meta.name.trim();
  return {
    ...file,
    name: name === '' ? file.name : name,
    description: meta.description.trim(),
    accounts: inc.accounts ? file.accounts : [],
    fields: inc.fields ? file.fields : [],
    views: inc.views ? file.views : [],
  };
}

export function includeCount(include: TemplateInclude): number {
  const inc = normalizeInclude(include);
  return Number(inc.accounts) + Number(inc.fields) + Number(inc.views);
}
