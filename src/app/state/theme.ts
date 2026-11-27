// Tema claro/oscuro/sistema. `data-theme` fuerza un tema (tokens.css lo respeta); sin atributo se sigue al sistema.
// El color de la barra del navegador (`theme-color`) acompaña a la elección manual.
import type { ThemeChoice } from './uiStore';

export const THEME_COLOR = { light: '#f4f7ef', dark: '#0f1d15' } as const;
const META_ID = 'cuadra-theme-color';

export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | null {
  return choice === 'system' ? null : choice;
}

/** Siguiente en el ciclo del botón compacto: sistema → claro → oscuro → sistema. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system';
}

export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement;
  const attr = themeAttribute(choice);
  if (attr === null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', attr);

  let meta = doc.getElementById(META_ID) as HTMLMetaElement | null;
  if (attr === null) {
    meta?.remove();
    return;
  }
  if (meta === null) {
    meta = doc.createElement('meta');
    meta.id = META_ID;
    meta.name = 'theme-color';
    doc.head.append(meta);
  }
  meta.content = THEME_COLOR[attr];
}
