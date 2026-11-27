// Paleta de comandos (Ctrl/⌘+K, DESIGN §8.3). Lógica pura: construye las entradas a partir del registro y de los
// espacios, y las filtra sin tildes ni mayúsculas. El componente solo pinta y ejecuta `run`.
import type { LucideIcon } from 'lucide-react';
import type { Currency, Id, Minor, WorkspaceSummary } from '../../core';
import { normalizeSearch } from '../../core/text';
import type { NavEntry, QuickAction, SettingsSectionDef } from '../registry/types';
import type { ThemeChoice } from '../state/uiStore';
import { resolveTo } from './workspaceLink';

export type PaletteSection = 'actions' | 'go' | 'workspaces' | 'app';

/** Qué hacer al elegirla. Datos, no funciones: así se prueba y no retiene cierres. */
export type PaletteRun =
  | { type: 'navigate'; to: string }
  | { type: 'theme'; value: ThemeChoice }
  | { type: 'lock' }
  | { type: 'help' };

export interface PaletteItem {
  id: string;
  section: PaletteSection;
  /** Ya traducido. */
  label: string;
  /** Texto a la derecha: tecla de atajo, saldo… */
  hint?: string;
  /** Palabras extra que también encuentran la entrada (ya traducidas o fijas). */
  keywords?: string[];
  icon?: LucideIcon;
  tone?: QuickAction['tone'];
  run: PaletteRun;
}

export const SECTION_ORDER: readonly PaletteSection[] = ['actions', 'go', 'workspaces', 'app'];

export interface PaletteSources {
  t: (key: string, params?: Record<string, string | number>) => string;
  wsId: Id | undefined;
  quickActions: readonly QuickAction[];
  /** Navegación del espacio actual (sin repetir) y de la raíz. */
  nav: readonly NavEntry[];
  /** Secciones de ajustes: las que no tengan ya una entrada de navegación con el mismo destino también salen. */
  sections?: readonly SettingsSectionDef[];
  workspaces: readonly WorkspaceSummary[];
  formatMoney: (minor: Minor, currency: Currency) => string;
  authEnabled: boolean;
  theme: ThemeChoice;
}

export function buildPaletteItems(src: PaletteSources): PaletteItem[] {
  const { t, wsId } = src;
  const items: PaletteItem[] = [];

  if (wsId !== undefined) {
    for (const action of src.quickActions) {
      items.push({
        id: `quick:${action.id}`,
        section: 'actions',
        label: t('common.palette.record', { name: t(action.labelKey) }),
        ...(action.shortcut === undefined ? {} : { hint: action.shortcut.toUpperCase() }),
        keywords: [t('common.fab.label'), t(action.labelKey)],
        icon: action.icon,
        tone: action.tone,
        run: { type: 'navigate', to: resolveTo('workspace', action.to, wsId) },
      });
    }
  }

  const seen = new Set<string>();
  const destinations: NavEntry[] = [...src.nav];
  for (const s of src.sections ?? []) {
    destinations.push({ id: `settings:${s.id}`, scope: s.scope, to: s.to, labelKey: s.labelKey, icon: s.icon, placement: 'settings', order: s.order });
  }
  for (const entry of destinations) {
    if (entry.scope === 'workspace' && wsId === undefined) continue;
    const dest = `${entry.scope}:${entry.to}`;
    if (seen.has(dest)) continue;
    seen.add(dest);
    const fromSection = entry.id.startsWith('settings:');
    items.push({
      id: `go:${entry.scope}:${entry.id}`,
      section: 'go',
      label: t(fromSection ? 'common.palette.goToSetting' : 'common.palette.goTo', { name: t(entry.labelKey) }),
      ...(entry.goKey === undefined ? {} : { hint: `G ${entry.goKey.toUpperCase()}` }),
      keywords: [t(entry.labelKey)],
      icon: entry.icon,
      run: { type: 'navigate', to: resolveTo(entry.scope, entry.to, wsId) },
    });
  }

  for (const ws of src.workspaces) {
    if (ws.archivedAt !== null) continue;
    items.push({
      id: `ws:${ws.id}`,
      section: 'workspaces',
      label: ws.name,
      hint: src.formatMoney(ws.balanceMinor, ws.currency),
      keywords: [ws.ownerName, t('common.palette.space')],
      run: { type: 'navigate', to: `/e/${ws.id}` },
    });
  }

  items.push(
    { id: 'app:new-space', section: 'app', label: t('common.palette.newSpace'), keywords: [t('common.palette.space')], run: { type: 'navigate', to: '/bienvenida' } },
    { id: 'app:all-spaces', section: 'app', label: t('common.palette.allSpaces'), keywords: [t('common.palette.space')], run: { type: 'navigate', to: '/' } },
  );
  for (const value of ['system', 'light', 'dark'] as const) {
    if (value === src.theme) continue;
    items.push({
      id: `theme:${value}`,
      section: 'app',
      label: t('common.palette.theme', { name: t(`common.theme.${value}`) }),
      keywords: [t('common.theme.label'), 'tema', 'apariencia'],
      run: { type: 'theme', value },
    });
  }
  items.push({ id: 'app:help', section: 'app', label: t('common.palette.shortcuts'), hint: '?', keywords: ['atajos', 'teclado'], run: { type: 'help' } });
  if (src.authEnabled) {
    items.push({ id: 'app:lock', section: 'app', label: t('common.palette.lock'), keywords: ['bloquear', 'contraseña', 'salir'], run: { type: 'lock' } });
  }
  return items;
}

/** Puntuación: más alta = mejor. 0 = no coincide. Todas las palabras de la búsqueda deben aparecer. */
export function scoreItem(item: PaletteItem, query: string): number {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return 1;
  const label = normalizeSearch(item.label);
  const haystack = `${label} ${normalizeSearch((item.keywords ?? []).join(' '))}`;
  let total = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return 0;
    if (label.startsWith(term)) total += 4;
    else if (label.split(' ').some((w) => w.startsWith(term))) total += 3;
    else if (label.includes(term)) total += 2;
    else total += 1;
  }
  return total;
}

export const MAX_RESULTS = 12;
/** Espacios que se ven en la paleta sin búsqueda. */
export const MAX_IDLE_WORKSPACES = 5;

/** Sin búsqueda: todo agrupado por sección. Con búsqueda: mejor puntuación primero, y a igualdad el orden de sección. */
export function filterPalette(items: readonly PaletteItem[], query: string, limit = MAX_RESULTS): PaletteItem[] {
  const sectionRank = (s: PaletteSection) => SECTION_ORDER.indexOf(s);
  const q = normalizeSearch(query);
  if (q === '') {
    const sorted = [...items].sort((a, b) => sectionRank(a.section) - sectionRank(b.section));
    // Sin búsqueda se muestran todas las acciones y pantallas y pocos espacios; el tema y lo demás sale al buscar.
    let spaces = 0;
    return sorted.filter((i) => {
      if (i.section === 'workspaces') return ++spaces <= MAX_IDLE_WORKSPACES;
      return i.section !== 'app' || i.id === 'app:new-space' || i.id === 'app:help';
    });
  }
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || sectionRank(a.item.section) - sectionRank(b.item.section) || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.item);
}

/** Secuencia visible de secciones, para pintar encabezados: agrupa consecutivos de la misma sección. */
export function groupBySection(items: readonly PaletteItem[]): Array<{ section: PaletteSection; items: PaletteItem[] }> {
  const groups: Array<{ section: PaletteSection; items: PaletteItem[] }> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}
