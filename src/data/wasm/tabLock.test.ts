// Dos "pestañas" en el mismo proceso: Node 26 trae navigator.locks y BroadcastChannel reales.
import { afterEach, describe, expect, it } from 'vitest';
import { acquireTabLock, type TabLockHandle } from './tabLock';

const handles: TabLockHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.release();
});

let counter = 0;
const uniqueName = () => `cuadra-test-${process.pid}-${++counter}`;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('tabLock', () => {
  it('la primera pestaña obtiene el candado sin esperar', async () => {
    const handle = await acquireTabLock({ name: uniqueName() });
    handles.push(handle);
    expect(handle).toMatchObject({ supported: true, held: true });
  });

  it('sin Web Locks se abre igualmente, marcando supported=false', async () => {
    const handle = await acquireTabLock({ name: uniqueName(), locks: null });
    expect(handle).toMatchObject({ supported: false, held: false });
  });

  it('la segunda pestaña queda bloqueada y entra sola cuando la primera se cierra', async () => {
    const name = uniqueName();
    const first = await acquireTabLock({ name });
    let blocked = false;
    const second = acquireTabLock({
      name,
      onBlocked: () => {
        blocked = true;
      },
    });
    await flush();
    expect(blocked).toBe(true);
    first.release();
    const handle = await second;
    handles.push(handle);
    expect(handle.held).toBe(true);
    expect(first.held).toBe(false);
  });

  it('"Usar aquí": la dueña cierra su base ANTES de soltar el candado', async () => {
    const name = uniqueName();
    const log: string[] = [];
    const first = await acquireTabLock({
      name,
      onReleaseRequested: async () => {
        log.push('first:closing');
        await flush();
        log.push('first:closed');
      },
    });
    const second = acquireTabLock({
      name,
      onBlocked: (takeOver) => {
        log.push('second:blocked');
        takeOver();
      },
    });
    const handle = await second;
    handles.push(handle);
    log.push('second:acquired');
    expect(log).toEqual(['second:blocked', 'first:closing', 'first:closed', 'second:acquired']);
    expect(first.held).toBe(false);
    expect(handle.held).toBe(true);
  });
});
