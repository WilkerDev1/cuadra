// Contenido de la página «Más» (DESIGN §10.15): todo destino que no cabe en la barra inferior, agrupado por bloque.
import { groupNav, splitBottomBar } from '../registry/select';
import type { NavEntry, NavGroup, SettingsSectionDef } from '../registry/types';

export interface MoreInputs {
  /** Entradas primarias del espacio (las dos primeras ya están en la barra inferior). */
  primary: readonly NavEntry[];
  /** Entradas `more` y `settings` del espacio y de la raíz. */
  more: readonly NavEntry[];
  /** Secciones de ajustes del espacio y de la raíz. */
  sections: readonly SettingsSectionDef[];
}

export function buildMoreGroups(input: MoreInputs): Array<{ group: NavGroup; entries: NavEntry[] }> {
  const { overflow } = splitBottomBar(input.primary);
  const entries: NavEntry[] = [...overflow, ...input.more];
  const seen = new Set(entries.map((e) => `${e.scope}:${e.to}`));
  // Las subpáginas de una entrada de ajustes (ajustes/espacio, ajustes/cuentas…) ya se alcanzan desde su índice:
  // listarlas aquí repetía nombres («Cuentas» del libro y «Cuentas» de ajustes).
  const settingsRoots = input.more.filter((e) => e.placement === 'settings' && e.to !== '');
  const underSettings = (s: SettingsSectionDef) => settingsRoots.some((e) => e.scope === s.scope && s.to.startsWith(`${e.to}/`));
  for (const section of input.sections) {
    if (seen.has(`${section.scope}:${section.to}`) || underSettings(section)) continue;
    seen.add(`${section.scope}:${section.to}`);
    entries.push({
      id: `settings:${section.id}`,
      scope: section.scope,
      to: section.to,
      labelKey: section.labelKey,
      icon: section.icon,
      placement: 'settings',
      group: 'config',
      order: section.order,
    });
  }
  // Las entradas `settings` de la navegación pertenecen al bloque de configuración salvo que digan otro.
  return groupNav(entries.map((e) => (e.placement === 'settings' && e.group === undefined ? { ...e, group: 'config' as const } : e)));
}
