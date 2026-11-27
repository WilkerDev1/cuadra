// Cifrado y contraseñas del núcleo (PLAN.md: "Inicio de sesión"; guía modern-web-guidance
// security/client-side-encryption). Solo WebCrypto global (crypto.subtle) y TextEncoder: corre igual en
// navegador y en Node, sin node:*.
//
// - encryptText/decryptText: AES-256-GCM con clave derivada de la contraseña por PBKDF2-SHA256. Sal (16 B)
//   e IV (12 B) aleatorios en cada cifrado; nunca se reutiliza un par (iv, clave). La cabecera del sobre
//   (formato, versión, kdf, iteraciones, sal) va como datos adicionales autenticados (AAD): si alguien la
//   toca, el descifrado falla igual que si tocara el texto cifrado.
// - hashPassword/verifyPassword: PBKDF2-SHA256 con sal propia; comparación en tiempo constante.
// - generateRecoveryKey: 24 símbolos Crockford base32 en 6 grupos de 4, el último es un dígito de control
//   Luhn mod 32 (detecta cualquier símbolo mal copiado y casi todas las transposiciones contiguas).
//
// crypto.subtle solo existe en contextos seguros (https, localhost, Tauri). Servida por http://ip-lan no hay:
// isCryptoAvailable() lo dice y las funciones lanzan DomainError('crypto_unavailable').
import { DomainError, type ErrorCode } from './errors';

// ── Códigos de error ─────────────────────────────────────────────────────────────────
/** Códigos que lanza este módulo (todos en ERROR_CODES). */
export type CryptoErrorCode = Extract<ErrorCode, 'wrong_password' | 'crypto_unavailable' | 'backup_invalid'>;

// ── Parámetros ───────────────────────────────────────────────────────────────────────

/** Iteraciones PBKDF2-SHA256 por defecto (recomendación OWASP 2023 para SHA-256). */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
/** Cotas que se aceptan al leer un sobre o un hash: evitan un archivo con iteraciones absurdas (DoS). */
export const MIN_PBKDF2_ITERATIONS = 1_000;
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
const HASH_BITS = 256;
/** AES-GCM añade 16 bytes de etiqueta: un texto cifrado más corto no puede ser válido. */
const GCM_TAG_BYTES = 16;

export interface EncryptedEnvelope {
  format: 'cuadra-encrypted';
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 (texto cifrado + etiqueta GCM)
}

export interface PasswordHash {
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  hash: string; // base64, 32 bytes
}

export interface CryptoOptions {
  /** Iteraciones PBKDF2. Por defecto DEFAULT_PBKDF2_ITERATIONS; en pruebas, bajas (p. ej. 1000). */
  iterations?: number;
}

// ── Disponibilidad ───────────────────────────────────────────────────────────────────

/** ¿Hay WebCrypto con subtle? Falso en http:// que no sea localhost (contexto no seguro). */
export function isCryptoAvailable(): boolean {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return typeof c?.subtle?.importKey === 'function' && typeof c.getRandomValues === 'function';
}

function subtle(): SubtleCrypto {
  if (!isCryptoAvailable()) throw new DomainError('crypto_unavailable');
  return globalThis.crypto.subtle;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  if (!isCryptoAvailable()) throw new DomainError('crypto_unavailable');
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

// ── base64 ───────────────────────────────────────────────────────────────────────────

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Bytes → base64 estándar (con relleno). btoa trabaja con cadenas binarias: se arma por trozos. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 estándar → bytes. Lanza RangeError si el texto no es base64 canónico. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (!BASE64_RE.test(text)) throw new RangeError('base64 inválido');
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function isBase64(x: unknown): x is string {
  return typeof x === 'string' && BASE64_RE.test(x);
}

// ── Utilidades ───────────────────────────────────────────────────────────────────────

/** Comparación en tiempo constante (para longitudes iguales; la longitud no es secreta aquí). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const encoder = new TextEncoder();

/** NFC: la misma contraseña escrita con otro teclado (á compuesta o no) da los mismos bytes. */
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(password.normalize('NFC'));
}

function checkIterations(iterations: number): number {
  if (!Number.isSafeInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new RangeError(`iteraciones PBKDF2 fuera de rango: ${String(iterations)}`);
  }
  return iterations;
}

function validIterations(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= MIN_PBKDF2_ITERATIONS && x <= MAX_PBKDF2_ITERATIONS;
}

async function pbkdf2Base(password: string): Promise<CryptoKey> {
  return subtle().importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function deriveAesKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await pbkdf2Base(password);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveHashBits(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const base = await pbkdf2Base(password);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, HASH_BITS);
  return new Uint8Array(bits);
}

/** Cabecera autenticada: todo lo del sobre salvo iv y data (el iv ya entra en GCM por sí mismo). */
function envelopeAad(e: Pick<EncryptedEnvelope, 'format' | 'v' | 'kdf' | 'iterations' | 'salt'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${e.format}|${String(e.v)}|${e.kdf}|${String(e.iterations)}|${e.salt}`);
}

// ── Sobre cifrado ────────────────────────────────────────────────────────────────────

/** ¿Tiene la forma de un sobre de Cuadra? No comprueba que descifre. */
export function isEncryptedEnvelope(x: unknown): x is EncryptedEnvelope {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  return (
    e['format'] === 'cuadra-encrypted' &&
    e['v'] === 1 &&
    e['kdf'] === 'PBKDF2-SHA256' &&
    validIterations(e['iterations']) &&
    isBase64(e['salt']) &&
    isBase64(e['iv']) &&
    isBase64(e['data'])
  );
}

/** AES-256-GCM con clave PBKDF2-SHA256 de la contraseña; sal e IV aleatorios en cada llamada. */
export async function encryptText(
  password: string,
  plaintext: string,
  opts: CryptoOptions = {},
): Promise<EncryptedEnvelope> {
  const iterations = checkIterations(opts.iterations ?? DEFAULT_PBKDF2_ITERATIONS);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = {
    format: 'cuadra-encrypted',
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
  } as const;
  const key = await deriveAesKey(password, salt, iterations);
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: envelopeAad(header) },
    key,
    encoder.encode(plaintext),
  );
  return { ...header, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

/**
 * Descifra un sobre. Lanza DomainError('wrong_password') si no descifra: contraseña incorrecta o sobre
 * manipulado son indistinguibles en AES-GCM (y no conviene distinguirlos). Lanza
 * DomainError('backup_invalid') si el objeto ni siquiera tiene la forma de un sobre.
 */
export async function decryptText(password: string, envelope: EncryptedEnvelope): Promise<string> {
  if (!isEncryptedEnvelope(envelope)) throw new DomainError('backup_invalid', { reason: 'envelope_shape' });
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.data);
  if (salt.length < SALT_BYTES || iv.length !== IV_BYTES || data.length < GCM_TAG_BYTES) {
    throw new DomainError('backup_invalid', { reason: 'envelope_shape' });
  }
  const key = await deriveAesKey(password, salt, envelope.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: envelopeAad(envelope) }, key, data);
  } catch {
    throw new DomainError('wrong_password');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new DomainError('backup_invalid', { reason: 'not_utf8' });
  }
}

// ── Hash de contraseña ───────────────────────────────────────────────────────────────

export function isPasswordHash(x: unknown): x is PasswordHash {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const h = x as Record<string, unknown>;
  return h['kdf'] === 'PBKDF2-SHA256' && validIterations(h['iterations']) && isBase64(h['salt']) && isBase64(h['hash']);
}

/** PBKDF2-SHA256 con sal aleatoria. Se guarda el resultado; nunca la contraseña. */
export async function hashPassword(password: string, opts: CryptoOptions = {}): Promise<PasswordHash> {
  const iterations = checkIterations(opts.iterations ?? DEFAULT_PBKDF2_ITERATIONS);
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveHashBits(password, salt, iterations);
  return { kdf: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt), hash: bytesToBase64(hash) };
}

/** ¿Corresponde la contraseña al hash? Falso (no lanza) si el hash guardado está mal formado. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const expected = base64ToBytes(stored.hash);
  const actual = await deriveHashBits(password, base64ToBytes(stored.salt), stored.iterations);
  return constantTimeEqual(actual, expected);
}

// ── Clave de recuperación ────────────────────────────────────────────────────────────

/** Crockford base32: sin I, L, O ni U para que no se confundan al copiar a mano. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_GROUPS = 6;
const RECOVERY_GROUP_LEN = 4;
/** 23 símbolos aleatorios (115 bits) + 1 de control. */
const RECOVERY_LEN = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;

/** Luhn mod N (N = 32) sobre los valores de los símbolos: devuelve el valor del símbolo de control. */
function luhnCheckValue(values: readonly number[]): number {
  const n = RECOVERY_ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    let addend = factor * (values[i] ?? 0);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / n) + (addend % n);
    sum += addend;
  }
  return (n - (sum % n)) % n;
}

function formatRecovery(symbols: string): string {
  const groups: string[] = [];
  for (let i = 0; i < symbols.length; i += RECOVERY_GROUP_LEN) groups.push(symbols.slice(i, i + RECOVERY_GROUP_LEN));
  return groups.join('-');
}

/** Clave legible tipo 'K7Q2-M9XD-4H8T-B3NW-P6RZ-1F5C'. Se muestra una sola vez. */
export function generateRecoveryKey(): string {
  // Rechazo por módulo innecesario: 256 es múltiplo de 32, así que byte & 31 es uniforme.
  const bytes = randomBytes(RECOVERY_LEN - 1);
  const values = Array.from(bytes, (b) => b & 31);
  values.push(luhnCheckValue(values));
  return formatRecovery(values.map((v) => RECOVERY_ALPHABET[v]).join(''));
}

/**
 * Normaliza lo que el usuario escribe: mayúsculas, sin espacios ni guiones, y los equívocos de Crockford
 * (O→0, I/L→1). Devuelve la clave con su formato de grupos o null si no tiene 24 símbolos válidos o el
 * dígito de control no cuadra.
 */
export function normalizeRecoveryKey(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (compact.length !== RECOVERY_LEN) return null;
  const values: number[] = [];
  for (const ch of compact) {
    const v = RECOVERY_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  const check = values.pop();
  if (check !== luhnCheckValue(values)) return null;
  return formatRecovery(compact);
}

/** ¿Es una clave de recuperación bien formada (incluido el dígito de control)? */
export function isValidRecoveryKey(input: string): boolean {
  return normalizeRecoveryKey(input) !== null;
}
