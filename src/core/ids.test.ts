import { describe, expect, it } from 'vitest';
import { createUuidV7Gen, defaultIdGen, isUuidV7, SeqIdGen, uuidv7, uuidV7Time } from './ids';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ids', () => {
  it('uuidv7 es monótono dentro del mismo milisegundo y tiene formato v7', () => {
    const fixedMs = Date.UTC(2026, 5, 15, 12, 0, 0);
    const gen = createUuidV7Gen({ now: () => fixedMs });
    const ids = Array.from({ length: 5000 }, () => gen.next());
    for (const id of ids) {
      expect(id).toMatch(V7);
      expect(isUuidV7(id)).toBe(true);
    }
    for (let i = 1; i < ids.length; i++) expect((ids[i] as string) > (ids[i - 1] as string)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(uuidV7Time(ids[0] as string)).toBe(fixedMs);
  });

  it('sigue siendo monótono si el reloj retrocede', () => {
    let ms = Date.UTC(2026, 5, 15);
    const gen = createUuidV7Gen({ now: () => ms });
    const a = gen.next();
    ms -= 10_000;
    const b = gen.next();
    expect(b > a).toBe(true);
  });

  it('uuidv7() y defaultIdGen usan el reloj del sistema', () => {
    const before = Date.now();
    const id = uuidv7();
    const other = defaultIdGen.next();
    expect(id).toMatch(V7);
    expect(other).toMatch(V7);
    expect(uuidV7Time(id)).toBeGreaterThanOrEqual(before - 1);
    expect(isUuidV7('not-an-id')).toBe(false);
  });

  it('SeqIdGen es determinista para la misma semilla y reloj', () => {
    const clock = { now: () => new Date('2026-06-15T12:00:00Z') };
    const a = new SeqIdGen({ seed: 7, clock });
    const b = new SeqIdGen({ seed: 7, clock });
    const xs = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xs);
    expect(xs[0]).toMatch(V7);
    expect(xs[1]! > xs[0]!).toBe(true);
    expect(new SeqIdGen({ seed: 8, clock }).next()).not.toBe(xs[0]);
    expect(a.count).toBe(3);
  });
});
