import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthService, Cuadra } from '../../core';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { attachIdleLock, getAuthService } from './auth';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

/** Ventana mínima: eventos, visibilidad y temporizador controlables. */
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const docListeners = new Map<string, Set<() => void>>();
  let tick: (() => void) | null = null;
  const add = (map: Map<string, Set<() => void>>) => (name: string, fn: () => void) => {
    const set = map.get(name) ?? new Set();
    set.add(fn);
    map.set(name, set);
  };
  const remove = (map: Map<string, Set<() => void>>) => (name: string, fn: () => void) => map.get(name)?.delete(fn);
  const document = { visibilityState: 'visible', addEventListener: add(docListeners), removeEventListener: remove(docListeners) };
  const win = {
    document,
    addEventListener: add(listeners),
    removeEventListener: remove(listeners),
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  };
  return {
    win: win as unknown as Window,
    fire: (name: string) => listeners.get(name)?.forEach((fn) => fn()),
    fireDoc: (name: string) => docListeners.get(name)?.forEach((fn) => fn()),
    tick: () => tick?.(),
    hasTimer: () => tick !== null,
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe('sesión local en la interfaz', () => {
  it('getAuthService devuelve el servicio real de la fachada', async () => {
    h = await createTestCuadra();
    const auth = getAuthService(h.cuadra);
    expect(auth).toBe(h.cuadra.auth);
    expect(await auth.status()).toMatchObject({ enabled: false, locked: false });
  });

  it('attachIdleLock aplaza con la actividad, comprueba con el temporizador y al volver a la pestaña', () => {
    const auth = { touch: vi.fn(), checkIdle: vi.fn(() => false) } as unknown as AuthService;
    const w = fakeWindow();
    const detach = attachIdleLock(auth, { target: w.win });
    w.fire('pointerdown');
    w.fire('keydown');
    expect(auth.touch).toHaveBeenCalledTimes(2);
    w.tick();
    expect(auth.checkIdle).toHaveBeenCalledTimes(1);
    w.fireDoc('visibilitychange');
    expect(auth.checkIdle).toHaveBeenCalledTimes(2);
    detach();
    expect(w.hasTimer()).toBe(false);
    expect(w.count()).toBe(0);
  });

  it('con el servicio real, la inactividad bloquea una sesión abierta', async () => {
    h = await createTestCuadra();
    const auth = h.cuadra.auth;
    await auth.setup({ profileName: 'Ana', password: 'una-clave-larga' });
    await auth.setAutoLock(1);
    expect((await auth.status()).locked).toBe(false);
    const w = fakeWindow();
    const detach = attachIdleLock(auth, { target: w.win });
    h.clock.advance(2 * 60_000);
    w.tick();
    expect(auth.snapshot()?.locked).toBe(true);
    detach();
  });

  it('sin ventana (Node) no engancha nada', () => {
    const cuadra = { auth: { touch: vi.fn(), checkIdle: vi.fn() } } as unknown as Cuadra;
    expect(() => attachIdleLock(cuadra.auth)()).not.toThrow();
  });
});
