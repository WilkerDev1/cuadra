// Atajos de teclado del shell (DESIGN §8.3). Lógica pura: recibe un evento aplanado y devuelve qué hacer.
// Las teclas de una letra solo actúan fuera de campos de texto y sin diálogos modales abiertos;
// Ctrl/⌘+K funciona siempre. `j`/`k`/`Enter`/`d`/`a` (filas) los atiende cada pantalla, no el shell.
import { findNavByGoKey, findQuickActionByShortcut } from '../registry/select';
import type { NavEntry, QuickAction } from '../registry/types';

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  /** El foco está en un campo de texto o un elemento editable. */
  typing: boolean;
  /** Hay un `<dialog>` modal abierto (hoja, paleta, confirmación). */
  modalOpen?: boolean;
}

export type ShortcutAction =
  | { type: 'palette' }
  | { type: 'newMenu' }
  | { type: 'help' }
  | { type: 'quick'; action: QuickAction }
  | { type: 'go'; entry: NavEntry };

export interface ShortcutContext {
  quickActions: readonly QuickAction[];
  goEntries: readonly NavEntry[];
  /**
   * Atajos de una sola tecla (letras, «/», «?», «g» + letra). Por defecto activos; quien dicta por voz o pulsa
   * teclas sin querer los apaga en «Más» o en la hoja de atajos (WCAG 2.1.4). Ctrl/⌘+K funciona siempre.
   */
  singleKey?: boolean;
}

export interface ShortcutState {
  /** Marca de tiempo de la `g` pulsada, o null. */
  goAt: number | null;
}

export const INITIAL_SHORTCUT_STATE: ShortcutState = { goAt: null };
/** Tiempo para pulsar la segunda tecla tras `g`. */
export const GO_TIMEOUT_MS = 1500;

export interface ShortcutResult {
  action: ShortcutAction | null;
  state: ShortcutState;
  /** El llamador debe hacer `preventDefault()`. */
  consumed: boolean;
}

const NON_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

export interface TypingTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

/** ¿El foco está donde se escribe texto? Casillas, botones y demás controles no cuentan. */
export function isTypingTarget(target: TypingTargetLike | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT.has((target.type ?? 'text').toLowerCase());
  const role = target.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

const none = (state: ShortcutState, consumed = false): ShortcutResult => ({ action: null, state, consumed });

export function resolveShortcut(
  input: KeyInput,
  ctx: ShortcutContext,
  state: ShortcutState,
  now: number,
): ShortcutResult {
  const cleared: ShortcutState = INITIAL_SHORTCUT_STATE;
  const key = input.key;

  // Ctrl/⌘+K: paleta, incluso escribiendo.
  if ((input.ctrlKey || input.metaKey) && !input.altKey && key.toLowerCase() === 'k') {
    return { action: { type: 'palette' }, state: cleared, consumed: true };
  }
  if (input.ctrlKey || input.metaKey || input.altKey || input.typing || input.modalOpen === true || ctx.singleKey === false) {
    return none(cleared);
  }
  if (input.repeat === true || key.length !== 1) return none(state);

  const lower = key.toLowerCase();

  // Segunda tecla de `g`.
  if (state.goAt !== null && now - state.goAt <= GO_TIMEOUT_MS) {
    const entry = findNavByGoKey(ctx.goEntries, lower);
    if (entry !== undefined) return { action: { type: 'go', entry }, state: cleared, consumed: true };
  }

  if (lower === 'g' && ctx.goEntries.some((e) => e.goKey !== undefined)) {
    return { action: null, state: { goAt: now }, consumed: true };
  }
  if (key === '/') return { action: { type: 'palette' }, state: cleared, consumed: true };
  if (key === '?') return { action: { type: 'help' }, state: cleared, consumed: true };
  if (lower === 'n') return { action: { type: 'newMenu' }, state: cleared, consumed: true };
  const quick = findQuickActionByShortcut(ctx.quickActions, lower);
  if (quick !== undefined) return { action: { type: 'quick', action: quick }, state: cleared, consumed: true };
  return none(cleared);
}

/** Lista para la hoja de atajos («?»): cada fila es una combinación y su etiqueta (clave i18n). */
export interface ShortcutHelpRow {
  keys: string[];
  labelKey: string;
}

export function buildShortcutHelp(ctx: ShortcutContext): ShortcutHelpRow[] {
  const rows: ShortcutHelpRow[] = [
    { keys: ['Ctrl', 'K'], labelKey: 'common.shortcuts.palette' },
    { keys: ['/'], labelKey: 'common.shortcuts.search' },
    { keys: ['N'], labelKey: 'common.shortcuts.new' },
  ];
  for (const action of ctx.quickActions) {
    if (action.shortcut !== undefined) rows.push({ keys: [action.shortcut.toUpperCase()], labelKey: action.labelKey });
  }
  for (const entry of ctx.goEntries) {
    if (entry.goKey !== undefined) rows.push({ keys: ['G', entry.goKey.toUpperCase()], labelKey: entry.labelKey });
  }
  rows.push({ keys: ['?'], labelKey: 'common.shortcuts.help' });
  return rows;
}
