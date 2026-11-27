import { describe, expect, it } from 'vitest';
import type { NavEntry, QuickAction } from '../registry/types';
import {
  buildShortcutHelp,
  GO_TIMEOUT_MS,
  INITIAL_SHORTCUT_STATE,
  isTypingTarget,
  resolveShortcut,
  type KeyInput,
  type ShortcutContext,
} from './shortcuts';

const icon = (() => null) as unknown as NavEntry['icon'];
const quick = (id: string, shortcut: string): QuickAction => ({ id, labelKey: id, icon, tone: 'in', to: id, order: 1, shortcut });
const nav = (id: string, goKey: string): NavEntry => ({
  id, scope: 'workspace', to: id, labelKey: id, icon, placement: 'primary', order: 1, goKey,
});
const ctx: ShortcutContext = {
  quickActions: [quick('in', 'e'), quick('out', 's'), quick('xfer', 't')],
  goEntries: [nav('inicio', 'i'), nav('mov', 'm'), nav('cuentas', 'c')],
};
const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, typing: false, ...extra,
});
const press = (input: KeyInput, state = INITIAL_SHORTCUT_STATE, now = 1000) => resolveShortcut(input, ctx, state, now);

describe('isTypingTarget', () => {
  it('reconoce campos de texto, áreas y elementos editables', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'combobox' : null) })).toBe(true);
  });
  it('no cuenta casillas, botones ni el cuerpo', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('resolveShortcut', () => {
  it('Ctrl+K y ⌘+K abren la paleta incluso escribiendo', () => {
    expect(press(key('k', { ctrlKey: true, typing: true })).action).toEqual({ type: 'palette' });
    expect(press(key('K', { metaKey: true })).action).toEqual({ type: 'palette' });
    expect(press(key('k', { ctrlKey: true, modalOpen: true })).consumed).toBe(true);
  });
  it('las letras no hacen nada escribiendo en un campo', () => {
    expect(press(key('e', { typing: true }))).toMatchObject({ action: null, consumed: false });
    expect(press(key('/', { typing: true })).action).toBeNull();
  });
  it('ni con un diálogo modal abierto ni con Ctrl/Alt', () => {
    expect(press(key('e', { modalOpen: true })).action).toBeNull();
    expect(press(key('e', { ctrlKey: true })).action).toBeNull();
    expect(press(key('e', { altKey: true })).action).toBeNull();
  });
  it('las letras del registro disparan su acción rápida, con mayúsculas también', () => {
    expect(press(key('e')).action).toMatchObject({ type: 'quick', action: { id: 'in' } });
    expect(press(key('S')).action).toMatchObject({ type: 'quick', action: { id: 'out' } });
    expect(press(key('t')).consumed).toBe(true);
  });
  it('n abre el menú de Anotar, / la paleta y ? la ayuda', () => {
    expect(press(key('n')).action).toEqual({ type: 'newMenu' });
    expect(press(key('/')).action).toEqual({ type: 'palette' });
    expect(press(key('?', { shiftKey: true })).action).toEqual({ type: 'help' });
  });
  it('una letra sin atajo no se consume', () => {
    expect(press(key('x'))).toMatchObject({ action: null, consumed: false });
    expect(press(key('Enter'))).toMatchObject({ action: null, consumed: false });
  });
  it('ignora la repetición de tecla', () => {
    expect(press(key('e', { repeat: true })).action).toBeNull();
  });

  describe('g y luego una letra', () => {
    it('g arma la secuencia y la letra siguiente navega', () => {
      const first = press(key('g'), INITIAL_SHORTCUT_STATE, 1000);
      expect(first).toMatchObject({ action: null, consumed: true, state: { goAt: 1000 } });
      const second = press(key('m'), first.state, 1500);
      expect(second.action).toMatchObject({ type: 'go', entry: { id: 'mov' } });
      expect(second.state).toEqual(INITIAL_SHORTCUT_STATE);
    });
    it('caduca tras GO_TIMEOUT_MS y la letra vale como atajo normal', () => {
      const armed = { goAt: 1000 };
      expect(press(key('m'), armed, 1000 + GO_TIMEOUT_MS + 1).action).toBeNull();
      expect(press(key('e'), armed, 1000 + GO_TIMEOUT_MS + 1).action).toMatchObject({ type: 'quick' });
    });
    it('una letra sin destino cancela la secuencia', () => {
      const armed = press(key('g')).state;
      const next = press(key('z'), armed, 1200);
      expect(next.action).toBeNull();
      expect(next.state).toEqual(INITIAL_SHORTCUT_STATE);
    });
    it('escribir cancela la secuencia', () => {
      const armed = press(key('g')).state;
      expect(press(key('m', { typing: true }), armed, 1100).state).toEqual(INITIAL_SHORTCUT_STATE);
    });
    it('sin entradas con goKey, g no se consume', () => {
      const bare: ShortcutContext = { quickActions: [], goEntries: [] };
      expect(resolveShortcut(key('g'), bare, INITIAL_SHORTCUT_STATE, 0).consumed).toBe(false);
    });
  });
});

describe('buildShortcutHelp', () => {
  it('lista lo fijo, las acciones del registro y los destinos g + letra', () => {
    const rows = buildShortcutHelp(ctx);
    expect(rows[0]).toEqual({ keys: ['Ctrl', 'K'], labelKey: 'common.shortcuts.palette' });
    expect(rows).toContainEqual({ keys: ['E'], labelKey: 'in' });
    expect(rows).toContainEqual({ keys: ['G', 'M'], labelKey: 'mov' });
    expect(rows.at(-1)).toEqual({ keys: ['?'], labelKey: 'common.shortcuts.help' });
  });
});

describe('atajos de una tecla desactivados (WCAG 2.1.4)', () => {
  const off: ShortcutContext = { ...ctx, singleKey: false };
  const pressOff = (input: KeyInput, state = INITIAL_SHORTCUT_STATE, now = 1000) => resolveShortcut(input, off, state, now);
  it('no reacciona a letras, «/», «?» ni «g» + letra', () => {
    for (const k of ['n', 's', 'e', 't', '/', '?', 'g', 'S']) {
      const r = pressOff(key(k));
      expect(r.action).toBeNull();
      expect(r.consumed).toBe(false);
    }
    const g = pressOff(key('g'));
    expect(pressOff(key('i'), g.state, 1200).action).toBeNull();
  });
  it('Ctrl/⌘+K sigue abriendo la paleta', () => {
    expect(pressOff(key('k', { ctrlKey: true })).action).toEqual({ type: 'palette' });
    expect(pressOff(key('k', { metaKey: true })).action).toEqual({ type: 'palette' });
  });
  it('por defecto siguen activos', () => {
    expect(press(key('s')).action?.type).toBe('quick');
  });
});
