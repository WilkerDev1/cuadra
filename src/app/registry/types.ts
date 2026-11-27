import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Id } from '../../core';

/** `workspace` → montado bajo `/e/:wsId`. */
export type Scope = 'root' | 'workspace';

export interface FeatureRoute {
  /** Relativo al scope: `cuentas/:accountId`. Cadena vacía = ruta índice. */
  path: string;
  scope: Scope;
  lazy: () => Promise<{ Component: ComponentType }>;
  /** `sheet`: hoja inferior en móvil, panel lateral en escritorio. */
  presentation?: 'page' | 'sheet';
  titleKey?: string;
}

export interface NavEntry {
  id: string;
  scope: Scope;
  /** Relativo al scope (`''` = inicio del espacio). */
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** `primary`: barra inferior/lateral (máx. 4). */
  placement: 'primary' | 'more' | 'settings';
  order: number;
}

/** Lo que ofrece el botón «Anotar» (FAB). */
export interface QuickAction {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  tone: 'in' | 'out' | 'neutral';
  /** Relativo al espacio: `nuevo?tipo=entrada`. */
  to: string;
  order: number;
  /** `e` entrada, `s` salida, `t` transferencia. */
  shortcut?: string;
}

export interface HomeCardDef {
  id: string;
  titleKey: string;
  order: number;
  size: 'full' | 'half';
  defaultVisible: boolean;
  lazy: () => Promise<{ Component: ComponentType<{ workspaceId: Id }> }>;
}

export interface SettingsSectionDef {
  id: string;
  scope: Scope;
  labelKey: string;
  icon: LucideIcon;
  to: string;
  order: number;
}

export interface FeatureModule {
  id: string;
  routes?: FeatureRoute[];
  nav?: NavEntry[];
  quickActions?: QuickAction[];
  homeCards?: HomeCardDef[];
  settingsSections?: SettingsSectionDef[];
  /** Feature desactivable por espacio en el futuro. */
  flag?: string;
}
