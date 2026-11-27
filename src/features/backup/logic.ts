// Lógica pura de Respaldo: antigüedad del último respaldo, tamaños, cifrado con la sesión y recorte de una
// plantilla antes de descargarla. Sin DOM ni React: se prueba en logic.test.ts.
import { DomainError, isDomainError, isEncryptedEnvelope, type EncryptedEnvelope, type TemplateFile } from '../../core';

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

// ── Cifrado con la contraseña de la sesión ─────────────────────────────────────────────

/** Lo que hace falta para cifrar y descifrar con la contraseña de inicio de sesión (`cuadra.auth`). */
export interface SessionCrypto {
  encrypt(plaintext: string): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
}

export interface PreparedBackup {
  name: string;
  text: string;
  bytes: number;
  encrypted: boolean;
}

const NAME_DATE = /(\d{4}-\d{2}-\d{2})\.cuadra\.json$/;

/**
 * Nombre de un respaldo cifrado: genérico, sin el nombre del espacio, para que el nombre del cliente no quede a la
 * vista en la carpeta, el adjunto o la nube aunque el contenido vaya cifrado.
 */
export function encryptedBackupName(suggestedName: string, fallbackDate: string): string {
  const date = NAME_DATE.exec(suggestedName)?.[1] ?? fallbackDate;
  return `cuadra-respaldo-${date}.cuadra.json`;
}

/**
 * Sella un respaldo ya exportado (en claro y verificado por el núcleo): sin `crypto` sale tal cual; con `crypto` se
 * cifra con la contraseña de la sesión y se comprueba que se vuelve a abrir igual antes de entregarlo.
 */
export async function sealBackup(
  out: { text: string; suggestedName: string; bytes: number },
  crypto: SessionCrypto | null,
  fallbackDate: string,
): Promise<PreparedBackup> {
  if (crypto === null) return { name: out.suggestedName, text: out.text, bytes: out.bytes, encrypted: false };
  const envelope = await crypto.encrypt(out.text);
  if ((await crypto.decrypt(envelope)) !== out.text) throw new DomainError('backup_invalid', { reason: 'verify' });
  const text = JSON.stringify(envelope);
  return { name: encryptedBackupName(out.suggestedName, fallbackDate), text, bytes: new TextEncoder().encode(text).length, encrypted: true };
}

export type OpenedBackup =
  /** Texto que entiende `backup.inspect`: el original si no venía cifrado, o el descifrado con la sesión. */
  | { kind: 'open'; text: string; encrypted: boolean }
  /** Cifrado con otra contraseña (o sin sesión con la que probar): hay que pedirla. */
  | { kind: 'needsPassword'; triedSession: boolean };

/** Abre un archivo de respaldo: si viene cifrado, prueba primero la contraseña de la sesión. */
export async function openBackupText(text: string, crypto: SessionCrypto | null): Promise<OpenedBackup> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'open', text, encrypted: false }; // que el núcleo diga qué le pasa
  }
  if (!isEncryptedEnvelope(raw)) return { kind: 'open', text, encrypted: false };
  if (crypto === null) return { kind: 'needsPassword', triedSession: false };
  try {
    return { kind: 'open', text: await crypto.decrypt(raw), encrypted: true };
  } catch (error) {
    if (isDomainError(error) && error.code === 'wrong_password') return { kind: 'needsPassword', triedSession: true };
    throw error;
  }
}

/**
 * «Último respaldo» tras restaurar: la marca viaja dentro del archivo y la restauración la sobrescribe con la de
 * otro momento (u otro equipo). Se queda la más reciente entre la local de antes y la fecha del propio archivo.
 */
export function lastVerifiedAfterRestore(previousLocal: string | null, fileCreatedAt: string): string | null {
  const ms = (v: string | null) => (v === null ? Number.NaN : new Date(v).getTime());
  const a = ms(previousLocal);
  const b = ms(fileCreatedAt);
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  if (Number.isNaN(b) || a >= b) return previousLocal;
  return fileCreatedAt;
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
