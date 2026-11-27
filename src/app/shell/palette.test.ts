import { describe, expect, it } from 'vitest';
import type { WorkspaceSummary } from '../../core';
import { t as translate } from '../../i18n';
import type { NavEntry, QuickAction } from '../registry/types';
import { buildPaletteItems, filterPalette, groupBySection, scoreItem, type PaletteSources } from './palette';

const icon = (() => null) as unknown as NavEntry['icon'];
const dop = { code: 'DOP', minorDigits: 2 as const, symbol: 'RD$' };
const ws = (id: string, name: string, balanceMinor: number, extra: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id,
  name,
  ownerName: '',
  templateId: null,
  currency: dop,
  logoDataUrl: null,
  color: null,
  sortOrder: 0,
  isDemo: false,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  balanceMinor,
  accountCount: 1,
  lastMovementDate: null,
  ...extra,
});
const quickActions: QuickAction[] = [
  { id: 'in', labelKey: 'x.in', icon, tone: 'in', to: 'nuevo?tipo=entrada', order: 1, shortcut: 'e' },
];
const nav: NavEntry[] = [
  { id: 'inicio', scope: 'workspace', to: '', labelKey: 'x.inicio', icon, placement: 'primary', order: 1, goKey: 'i' },
  { id: 'resumen', scope: 'workspace', to: 'resumen', labelKey: 'x.resumen', icon, placement: 'more', order: 2 },
  { id: 'respaldo', scope: 'root', to: 'respaldo', labelKey: 'x.respaldo', icon, placement: 'more', order: 3 },
];
const labels: Record<string, string> = { 'x.in': 'Entrada', 'x.inicio': 'Inicio', 'x.resumen': 'Resumen', 'x.respaldo': 'Respaldo' };
const sources = (extra: Partial<PaletteSources> = {}): PaletteSources => ({
  t: (key, params) => labels[key] ?? translate(key, params),
  wsId: 'w1',
  quickActions,
  nav,
  workspaces: [
    ws('w1', 'Colmado La Esquina', 1250050),
    ws('w2', 'Estudio Creativo Brisa', 0),
    ws('w3', 'Viejo', 0, { archivedAt: '2026-01-01T00:00:00Z' }),
  ],
  formatMoney: (minor) => `RD$${(minor / 100).toFixed(2)}`,
  authEnabled: false,
  theme: 'system',
  ...extra,
});

describe('buildPaletteItems', () => {
  const items = buildPaletteItems(sources());
  const byId = (id: string) => items.find((i) => i.id === id);

  it('crea acciones rápidas hacia la ruta del espacio actual', () => {
    expect(byId('quick:in')?.run).toEqual({ type: 'navigate', to: '/e/w1/nuevo?tipo=entrada' });
    expect(byId('quick:in')?.hint).toBe('E');
  });
  it('crea destinos de navegación del espacio y de la raíz', () => {
    expect(byId('go:workspace:resumen')?.run).toEqual({ type: 'navigate', to: '/e/w1/resumen' });
    expect(byId('go:root:respaldo')?.run).toEqual({ type: 'navigate', to: '/respaldo' });
    expect(byId('go:workspace:inicio')?.hint).toBe('G I');
  });
  it('añade las secciones de ajustes que no tienen ya una entrada con el mismo destino', () => {
    const icon = (() => null) as never;
    const items = buildPaletteItems(
      sources({
        sections: [
          { id: 'views', scope: 'workspace', labelKey: 'Vistas', icon, to: 'ajustes/vistas', order: 1 },
          { id: 'dup', scope: 'root', labelKey: 'Respaldo', icon, to: 'respaldo', order: 2 },
        ],
      }),
    );
    expect(items.find((i) => i.id === 'go:workspace:settings:views')?.run).toEqual({ type: 'navigate', to: '/e/w1/ajustes/vistas' });
    expect(items.filter((i) => i.run.type === 'navigate' && i.run.to === '/respaldo')).toHaveLength(1);
  });
  it('lista los espacios activos con su saldo y omite los archivados', () => {
    expect(byId('ws:w1')).toMatchObject({ label: 'Colmado La Esquina', hint: 'RD$12500.50', run: { type: 'navigate', to: '/e/w1' } });
    expect(byId('ws:w3')).toBeUndefined();
  });
  it('sin espacio abierto no ofrece acciones ni destinos del espacio', () => {
    const rootOnly = buildPaletteItems(sources({ wsId: undefined }));
    expect(rootOnly.some((i) => i.id.startsWith('quick:') || i.id.startsWith('go:workspace'))).toBe(false);
    expect(rootOnly.some((i) => i.id === 'go:root:respaldo')).toBe(true);
  });
  it('ofrece los otros temas pero no el activo, y Bloquear solo con autenticación', () => {
    expect(byId('theme:system')).toBeUndefined();
    expect(byId('theme:dark')?.run).toEqual({ type: 'theme', value: 'dark' });
    expect(byId('app:lock')).toBeUndefined();
    expect(buildPaletteItems(sources({ authEnabled: true })).some((i) => i.id === 'app:lock')).toBe(true);
  });
});

describe('filtrado', () => {
  const items = buildPaletteItems(sources({ authEnabled: true }));
  it('sin búsqueda agrupa por sección: acciones, destinos y espacios primero', () => {
    const shown = filterPalette(items, '');
    const sections = groupBySection(shown).map((g) => g.section);
    expect(sections.slice(0, 3)).toEqual(['actions', 'go', 'workspaces']);
    expect(shown.some((i) => i.id === 'theme:dark')).toBe(false);
  });
  it('ignora tildes y mayúsculas', () => {
    expect(filterPalette(items, 'ESTUDIO creativo').map((i) => i.id)).toEqual(['ws:w2']);
    expect(filterPalette(items, 'contrasena').map((i) => i.id)).toEqual(['app:lock']);
  });
  it('todas las palabras deben aparecer', () => {
    expect(filterPalette(items, 'colmado zzz')).toEqual([]);
  });
  it('encuentra por palabras clave (buscar «anotar» halla las acciones rápidas)', () => {
    expect(filterPalette(items, 'anotar').map((i) => i.id)).toContain('quick:in');
  });
  it('ordena por mejor coincidencia: el inicio de la etiqueta gana', () => {
    const list = [
      { id: 'a', section: 'go' as const, label: 'Ir a Resumen de cuentas', run: { type: 'help' as const } },
      { id: 'b', section: 'go' as const, label: 'Cuentas', run: { type: 'help' as const } },
    ];
    expect(filterPalette(list, 'cuentas').map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('limita los resultados', () => {
    const many = Array.from({ length: 30 }, (_, n) => ({
      id: `i${n}`,
      section: 'go' as const,
      label: `Cuenta ${n}`,
      run: { type: 'help' as const },
    }));
    expect(filterPalette(many, 'cuenta', 5)).toHaveLength(5);
  });
  it('scoreItem es 0 si no coincide', () => {
    expect(scoreItem(items[0]!, 'qqqqq')).toBe(0);
  });
});
