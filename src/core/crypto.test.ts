import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  decryptText,
  encryptText,
  generateRecoveryKey,
  hashPassword,
  isCryptoAvailable,
  isEncryptedEnvelope,
  isPasswordHash,
  isValidRecoveryKey,
  MIN_PBKDF2_ITERATIONS,
  normalizeRecoveryKey,
  verifyPassword,
  type EncryptedEnvelope,
} from './crypto';
import { DomainError } from './errors';

const FAST = { iterations: MIN_PBKDF2_ITERATIONS };

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

/** Cambia un carácter base64 por otro distinto, manteniendo el texto como base64 válido. */
function flipBase64Char(text: string, index: number): string {
  const ch = text[index] === 'A' ? 'B' : 'A';
  return text.slice(0, index) + ch + text.slice(index + 1);
}

describe('crypto: base64', () => {
  it('ida y vuelta con todos los bytes y entradas largas', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('rechaza texto que no es base64', () => {
    expect(() => base64ToBytes('no es base64!')).toThrow(RangeError);
    expect(() => base64ToBytes('abc')).toThrow(RangeError);
  });

  it('comparación en tiempo constante', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('crypto: sobre cifrado (AES-256-GCM + PBKDF2-SHA256)', () => {
  it('WebCrypto está disponible en el entorno de pruebas', () => {
    expect(isCryptoAvailable()).toBe(true);
  });

  it('ida y vuelta conserva el texto exacto (unicode y JSON grande)', async () => {
    const text = JSON.stringify({ nombre: 'Colmado La Esquiña ñ €', filas: Array.from({ length: 2000 }, (_, i) => i) });
    const env = await encryptText('clave segura', text, FAST);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env).toMatchObject({ format: 'cuadra-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iterations: FAST.iterations });
    expect(base64ToBytes(env.salt).length).toBe(16);
    expect(base64ToBytes(env.iv).length).toBe(12);
    expect(env.data).not.toContain('Colmado');
    await expect(decryptText('clave segura', env)).resolves.toBe(text);
  });

  it('sal e IV nuevos en cada cifrado', async () => {
    const a = await encryptText('pw-12345', 'hola', FAST);
    const b = await encryptText('pw-12345', 'hola', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('el sobre sobrevive a JSON.stringify/parse', async () => {
    const env = await encryptText('pw-12345', 'respaldo', FAST);
    const parsed: unknown = JSON.parse(JSON.stringify(env));
    expect(isEncryptedEnvelope(parsed)).toBe(true);
    await expect(decryptText('pw-12345', parsed as EncryptedEnvelope)).resolves.toBe('respaldo');
  });

  it('normaliza la contraseña a NFC (á compuesta y descompuesta)', async () => {
    const env = await encryptText('canción', 'x', FAST);
    await expect(decryptText('canción', env)).resolves.toBe('x');
  });

  it('contraseña incorrecta → wrong_password', async () => {
    const env = await encryptText('correcta', 'secreto', FAST);
    await expectCode(decryptText('incorrecta', env), 'wrong_password');
    await expectCode(decryptText('', env), 'wrong_password');
  });

  it('sobre manipulado → wrong_password (datos, iv, sal o iteraciones)', async () => {
    const env = await encryptText('pw-12345', 'contenido que importa', FAST);
    await expectCode(decryptText('pw-12345', { ...env, data: flipBase64Char(env.data, 3) }), 'wrong_password');
    await expectCode(decryptText('pw-12345', { ...env, iv: flipBase64Char(env.iv, 0) }), 'wrong_password');
    await expectCode(decryptText('pw-12345', { ...env, salt: flipBase64Char(env.salt, 0) }), 'wrong_password');
    await expectCode(decryptText('pw-12345', { ...env, iterations: env.iterations + 1 }), 'wrong_password');
  });

  it('objeto sin forma de sobre → backup_invalid', async () => {
    const env = await encryptText('pw-12345', 'x', FAST);
    const bad = { ...env, format: 'otro' } as unknown as EncryptedEnvelope;
    await expectCode(decryptText('pw-12345', bad), 'backup_invalid');
    const truncated = { ...env, data: 'AAAA' };
    await expectCode(decryptText('pw-12345', truncated), 'backup_invalid');
    const badIv = { ...env, iv: bytesToBase64(new Uint8Array(8)) };
    await expectCode(decryptText('pw-12345', badIv), 'backup_invalid');
  });

  it('isEncryptedEnvelope distingue sobres de respaldos en claro y basura', async () => {
    const env = await encryptText('pw-12345', 'x', FAST);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(isEncryptedEnvelope({ format: 'cuadra-backup', v: 1 })).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope('cuadra-encrypted')).toBe(false);
    expect(isEncryptedEnvelope([env])).toBe(false);
    expect(isEncryptedEnvelope({ ...env, v: 2 })).toBe(false);
    expect(isEncryptedEnvelope({ ...env, iterations: 10 })).toBe(false);
    expect(isEncryptedEnvelope({ ...env, iterations: 1e12 })).toBe(false);
    expect(isEncryptedEnvelope({ ...env, salt: '***' })).toBe(false);
  });

  it('rechaza iteraciones fuera de rango al cifrar', async () => {
    await expect(encryptText('pw', 'x', { iterations: 10 })).rejects.toThrow(RangeError);
  });

  it('por defecto usa iteraciones altas', async () => {
    const env = await encryptText('pw-12345', 'x');
    expect(env.iterations).toBeGreaterThanOrEqual(600_000);
    await expect(decryptText('pw-12345', env)).resolves.toBe('x');
  });
});

describe('crypto: hash de contraseña', () => {
  it('verifica la correcta y rechaza la incorrecta', async () => {
    const h = await hashPassword('mi contraseña', FAST);
    expect(isPasswordHash(h)).toBe(true);
    expect(h.iterations).toBe(FAST.iterations);
    expect(JSON.stringify(h)).not.toContain('contraseña');
    await expect(verifyPassword('mi contraseña', h)).resolves.toBe(true);
    await expect(verifyPassword('mi contraseñA', h)).resolves.toBe(false);
    await expect(verifyPassword('', h)).resolves.toBe(false);
  });

  it('dos hashes de la misma contraseña tienen sal distinta', async () => {
    const a = await hashPassword('igual', FAST);
    const b = await hashPassword('igual', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('un hash mal formado no verifica (no lanza)', async () => {
    const h = await hashPassword('x', FAST);
    await expect(verifyPassword('x', { ...h, iterations: 1 })).resolves.toBe(false);
    await expect(verifyPassword('x', { ...h, hash: 'basura!' })).resolves.toBe(false);
  });
});

describe('crypto: clave de recuperación', () => {
  it('formato: 6 grupos de 4 símbolos Crockford', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    expect(isValidRecoveryKey(key)).toBe(true);
  });

  it('no se repite', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateRecoveryKey()));
    expect(keys.size).toBe(200);
  });

  it('normaliza minúsculas, espacios y equívocos (O→0, I/L→1)', () => {
    for (let n = 0; n < 50; n++) {
      const key = generateRecoveryKey();
      const typed = ` ${key.toLowerCase().replace(/-/g, ' ')} `;
      expect(normalizeRecoveryKey(typed)).toBe(key);
      const sloppy = key.replace(/0/g, 'o').replace(/1/g, 'l');
      expect(normalizeRecoveryKey(sloppy)).toBe(key);
    }
  });

  it('el dígito de control detecta cualquier símbolo cambiado', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const key = generateRecoveryKey().replace(/-/g, '');
    for (let i = 0; i < key.length; i++) {
      for (const ch of alphabet) {
        if (ch === key[i]) continue;
        const typo = key.slice(0, i) + ch + key.slice(i + 1);
        expect(isValidRecoveryKey(typo)).toBe(false);
      }
    }
  });

  it('el dígito de control detecta transposiciones contiguas casi siempre', () => {
    let swaps = 0;
    let caught = 0;
    for (let n = 0; n < 40; n++) {
      const key = generateRecoveryKey().replace(/-/g, '');
      for (let i = 0; i + 1 < key.length; i++) {
        if (key[i] === key[i + 1]) continue;
        swaps++;
        const swapped = key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2);
        if (!isValidRecoveryKey(swapped)) caught++;
      }
    }
    expect(caught / swaps).toBeGreaterThan(0.95);
  });

  it('rechaza longitudes y símbolos inválidos', () => {
    const key = generateRecoveryKey();
    expect(isValidRecoveryKey(key.slice(0, -1))).toBe(false);
    expect(isValidRecoveryKey(`${key}0`)).toBe(false);
    expect(isValidRecoveryKey(key.replace(/^./, 'U'))).toBe(false);
    expect(isValidRecoveryKey('')).toBe(false);
  });
});
