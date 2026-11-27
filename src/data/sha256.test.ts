import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const nodeSha = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('coincide con vectores conocidos', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('coincide con node:crypto en longitudes de borde y texto con tildes', () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 20000]) {
      const text = 'ñ'.repeat(length % 7) + 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(nodeSha(text));
    }
    expect(sha256Hex('Café · señal')).toBe(nodeSha('Café · señal'));
  });
});
