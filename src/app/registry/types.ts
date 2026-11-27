// Registro de features (ARCHITECTURE.md 5.2). Añadir una feature NO toca el shell: basta con exportar `feature`
// desde `src/features/<x>/index.ts`; `collect.ts` la descubre con `import.meta.glob`.
//
// ───────────────────────────── Cómo se registra una feature ─────────────────────────────
//
//   // src/features/capture/index.ts   (liviano: nada de importar pantallas; solo descriptores y `lazy`)
//   import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Rows3, BookOpen } from 'lucide-react';
//   import type { FeatureModule } from '../../app/registry/types';
//
//   export const feature: FeatureModule = {
//     id: 'capture',
//
//     // Rutas. `scope: 'workspace'` cuelga de /e/:wsId; `scope: 'root'` de /. `path: ''` = ruta índice del scope
//     // (la feature `home` reclama `''` en `workspace`; `workspaces` reclama `''` en `root`).
//     // `presentation: 'sheet'` → el SHELL pone el contenedor (hoja inferior en móvil, hoja lateral en
//     // tableta/escritorio, inspector fijo ≥ 1280 px), el botón Cerrar y el título (`titleKey`); el componente solo
//     // dibuja el cuerpo. Dentro puede usar `useSheet()` para cerrar o avisar de «cambios sin guardar».
//     routes: [
//       { path: 'nuevo', scope: 'workspace', presentation: 'sheet', titleKey: 'capture.new.title',
//         lazy: () => import('./routes/QuickEntry') },                // el módulo exporta `Component`
//       { path: 'captura', scope: 'workspace', titleKey: 'capture.table.title',
//         lazy: () => import('./routes/TableCapture') },
//     ],
//
//     // Navegación. `placement`: primary = barra inferior/riel/barra lateral (en móvil caben 2 + «Más»),
//     // more = solo en la página «Más» y en la barra lateral, settings = pie de la barra lateral.
//     // `group` ordena la página «Más» y la barra lateral por bloques; `goKey` es la `g` + letra del atajo.
//     nav: [
//       { id: 'capture', scope: 'workspace', to: 'captura', labelKey: 'capture.nav', icon: Rows3,
//         placement: 'more', group: 'book', order: 40, goKey: 'r' },
//     ],
//
//     // Botón «Anotar». `shortcut` es la tecla de una letra (solo fuera de campos).
//     quickActions: [
//       { id: 'in', labelKey: 'capture.in', icon: ArrowDownLeft, tone: 'in', to: 'nuevo?tipo=entrada', order: 1, shortcut: 'e' },
//       { id: 'out', labelKey: 'capture.out', icon: ArrowUpRight, tone: 'out', to: 'nuevo?tipo=salida', order: 2, shortcut: 's' },
//       { id: 'xfer', labelKey: 'capture.transfer', icon: ArrowLeftRight, tone: 'neutral', to: 'transferencia', order: 3, shortcut: 't' },
//     ],
//
//     // Tarjetas del inicio (las pinta la feature `home` en el orden de `home.cards`).
//     homeCards: [
//       { id: 'balance', titleKey: 'home.balance', order: 1, size: 'full', defaultVisible: true,
//         lazy: () => import('./cards/Balance') },                     // exporta `Component({ workspaceId })`
//     ],
//
//     // Secciones de Ajustes (índice de /e/:wsId/ajustes y página «Más»).
//     settingsSections: [
//       { id: 'fields', scope: 'workspace', labelKey: 'settings.fields', icon: BookOpen, to: 'ajustes/campos', order: 10 },
//     ],
//
//     // Pantalla de bloqueo a pantalla completa (solo UNA feature la define: `auth`). El shell la muestra cuando
//     // `cuadra.auth.status()` dice `enabled && locked`; mientras ninguna la registre, nunca se bloquea nada.
//     lockScreen: { lazy: () => import('./routes/LockScreen') },       // exporta `Component(props: LockScreenProps)`
//   };
//
// Contenido del inspector SIN ruta (por ejemplo, seleccionar una fila): usa `<InspectorPanel>` de
// `app/registry/inspector` (portal al inspector fijo ≥ 1280 px, hoja lateral o inferior en el resto).
//
// Reglas: ids únicos en todo el registro; `shortcut` y `goKey` únicos; las features no se importan entre sí.
import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Id } from '../../core';

/** `workspace` → montado bajo `/e/:wsId`. */
export type Scope = 'root' | 'workspace';

export interface FeatureRoute {
  /** Relativo al scope: `cuentas/:accountId`. Cadena vacía = ruta índice. */
  path: string;
  scope: Scope;
  /** El módulo exporta `Component` (convención de React Router `lazy`). */
  lazy: () => Promise<{ Component: ComponentType }>;
  /**
   * `page` (por defecto): ocupa el área de contenido. `sheet`: hoja inferior en móvil, hoja lateral en tableta y
   * escritorio e inspector fijo en pantallas amplias; la página anterior queda detrás. Solo en `scope: 'workspace'`.
   */
  presentation?: 'page' | 'sheet';
  /** Clave i18n del título: encabezado de la hoja y título del documento. */
  titleKey?: string;
}

/** Bloques de la página «Más» y de la barra lateral (DESIGN §10.15). */
export type NavGroup = 'book' | 'config' | 'app';

export interface NavEntry {
  id: string;
  scope: Scope;
  /** Relativo al scope (`''` = inicio del espacio). */
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /**
   * `primary`: barra inferior (las 2 primeras por `order`; la tercera es «Más»), riel y barra lateral.
   * `more`: página «Más» y barra lateral. `settings`: pie de la barra lateral y «Más».
   */
  placement: 'primary' | 'more' | 'settings';
  /** Bloque dentro de «Más» y de la barra lateral. Por defecto `book`. */
  group?: NavGroup;
  order: number;
  /** Tecla tras `g` para ir aquí: `g` y luego `i`/`m`/`c`/`r` (DESIGN §8.3). */
  goKey?: string;
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
  /** Una letra, fuera de campos de texto: `e` entrada, `s` salida, `t` transferencia, `r` ráfaga. */
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

/** Lo que recibe la pantalla de bloqueo. Desbloquear/bloquear van por `useAuth()` de `app/data/hooks`. */
export interface LockScreenProps {
  /** `true` mientras el servicio de autenticación comprueba o resuelve un desbloqueo. */
  busy: boolean;
}

/** Punto de extensión de la Ola 3: la feature de autenticación aporta la pantalla de bloqueo a pantalla completa. */
export interface LockScreenDef {
  lazy: () => Promise<{ Component: ComponentType<LockScreenProps> }>;
}

export interface FeatureModule {
  id: string;
  routes?: FeatureRoute[];
  nav?: NavEntry[];
  quickActions?: QuickAction[];
  homeCards?: HomeCardDef[];
  settingsSections?: SettingsSectionDef[];
  /** Solo una feature debería registrarla; el shell usa la primera por orden de id. */
  lockScreen?: LockScreenDef;
  /** Feature desactivable por espacio en el futuro. */
  flag?: string;
}
