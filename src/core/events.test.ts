import { describe, expect, it, vi } from 'vitest';
import { createEventBus, type ChangeEvent } from './events';

const event: ChangeEvent = { workspaceId: 'ws', tables: ['transactions', 'audit_log'], reason: 'tx.create' };

describe('EventBus', () => {
  it('entrega a todos los oyentes y permite darse de baja', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.subscribe(a);
    bus.subscribe(b);
    expect(bus.size).toBe(2);
    bus.emit(event);
    offA();
    bus.emit(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenLastCalledWith(event);
    offA(); // idempotente
    expect(bus.size).toBe(1);
  });

  it('un oyente que lanza no impide que los demás reciban el evento', () => {
    const onListenerError = vi.fn();
    const bus = createEventBus({ onListenerError });
    const after = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(after);
    bus.emit(event);
    expect(after).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledOnce();
  });

  it('darse de baja durante la emisión no salta a otros oyentes', () => {
    const bus = createEventBus();
    const second = vi.fn();
    const off = bus.subscribe(() => off());
    bus.subscribe(second);
    bus.emit(event);
    expect(second).toHaveBeenCalledOnce();
  });

  it('el evento entregado es inmutable', () => {
    const bus = createEventBus();
    let got: ChangeEvent | undefined;
    bus.subscribe((e) => {
      got = e;
    });
    bus.emit(event);
    expect(Object.isFrozen(got)).toBe(true);
    expect(Object.isFrozen(got?.tables)).toBe(true);
  });
});
