// Ids UUIDv7 (RFC 9562): 48 bits de milisegundos + versión + 74 bits que, dentro del mismo milisegundo,
// se incrementan para que los ids salgan estrictamente ordenados (el historial ordena por id).
import type { Clock, IdGen } from './ports';

const RAND_BITS = 74n; // 12 (rand_a) + 62 (rand_b)
const RAND_MAX = (1n << RAND_BITS) - 1n;
/** Al cambiar de milisegundo se deja libre el bit alto para que haya margen de incremento. */
const FRESH_MASK = (1n << (RAND_BITS - 1n)) - 1n;

export interface UuidV7GenOptions {
  /** Milisegundos Unix (por defecto Date.now). */
  now?: () => number;
  /** Rellena el buffer con bytes aleatorios (por defecto crypto.getRandomValues). */
  random?: (bytes: Uint8Array<ArrayBuffer>) => void;
}

function cryptoRandom(bytes: Uint8Array<ArrayBuffer>): void {
  globalThis.crypto.getRandomValues(bytes);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function format(ms: bigint, rand: bigint): string {
  const randA = (rand >> 62n) & 0xfffn;
  const randB = rand & ((1n << 62n) - 1n);
  const hi = (ms << 16n) | (0x7n << 12n) | randA; // 64 bits: tiempo, versión 7, rand_a
  const lo = (0b10n << 62n) | randB; // 64 bits: variante 10, rand_b
  const hex = hi.toString(16).padStart(16, '0') + lo.toString(16).padStart(16, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generador UUIDv7 monótono (también si el reloj retrocede: reutiliza el último milisegundo). */
export function createUuidV7Gen(opts: UuidV7GenOptions = {}): IdGen {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? cryptoRandom;
  const buffer = new Uint8Array(10); // 80 bits ≥ 74
  let lastMs = -1n;
  let lastRand = 0n;
  return {
    next(): string {
      let ms = BigInt(Math.max(0, Math.floor(now())));
      if (ms > lastMs) {
        random(buffer);
        lastRand = bytesToBigInt(buffer) & FRESH_MASK;
        lastMs = ms;
      } else {
        ms = lastMs;
        random(buffer);
        // Incremento aleatorio pequeño (1..2^16) para no revelar el orden exacto de generación.
        lastRand += 1n + (bytesToBigInt(buffer.subarray(0, 2)) & 0xffffn);
        if (lastRand > RAND_MAX) {
          lastMs += 1n;
          ms = lastMs;
          random(buffer);
          lastRand = bytesToBigInt(buffer) & FRESH_MASK;
        }
      }
      return format(ms, lastRand);
    },
  };
}

/** IdGen por defecto de la app: uuidv7 con crypto.getRandomValues. */
export const defaultIdGen: IdGen = createUuidV7Gen();

export function uuidv7(): string {
  return defaultIdGen.next();
}

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && V7_RE.test(value);
}

/** Milisegundos Unix codificados en un uuidv7. */
export function uuidV7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/** PRNG pequeño y determinista (mulberry32) para SeqIdGen. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Ids deterministas para pruebas y datos de ejemplo: uuidv7 válidos y ordenados, con el tiempo del reloj
 * dado (o uno fijo) y los bits aleatorios de una semilla. Misma semilla + mismo reloj → mismos ids.
 */
export class SeqIdGen implements IdGen {
  private readonly gen: IdGen;
  private generated = 0;

  constructor(opts: { seed?: number; clock?: Pick<Clock, 'now'>; startMs?: number } = {}) {
    const rng = mulberry32(opts.seed ?? 1);
    const fixed = opts.startMs ?? Date.UTC(2026, 5, 15, 12, 0, 0);
    const clock = opts.clock;
    this.gen = createUuidV7Gen({
      now: clock ? () => clock.now().getTime() : () => fixed,
      random: (bytes) => {
        for (let i = 0; i < bytes.length; i++) bytes[i] = rng() & 0xff;
      },
    });
  }

  /** Cuántos ids ha entregado. */
  get count(): number {
    return this.generated;
  }

  next(): string {
    this.generated += 1;
    return this.gen.next();
  }
}
