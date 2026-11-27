import { describe, expect, it } from 'vitest';
import { Mutex } from './mutex';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('Mutex', () => {
  it('ejecuta las tareas de una en una y en orden', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([mutex.run(task('a')), mutex.run(task('b')), mutex.run(task('c'))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(mutex.pending).toBe(0);
  });

  it('un fallo no bloquea la cola y solo lo recibe su llamador', async () => {
    const mutex = new Mutex();
    const failing = mutex.run(async () => {
      throw new Error('boom');
    });
    const syncThrow = mutex.run(() => {
      throw new Error('sync');
    });
    const next = mutex.run(() => 42);
    await expect(failing).rejects.toThrow('boom');
    await expect(syncThrow).rejects.toThrow('sync');
    await expect(next).resolves.toBe(42);
  });
});
