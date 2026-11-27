import { CommandPalette } from './CommandPalette';
import { ShortcutHelp } from './ShortcutHelp';
import { ShortcutsHost } from './ShortcutsHost';
import { ToastHost } from './ToastHost';

/** Lo que comparten todas las pantallas con y sin espacio: avisos, atajos, paleta y ayuda de atajos. */
export function ShellChrome() {
  return (
    <>
      <ShortcutsHost />
      <CommandPalette />
      <ShortcutHelp />
      <ToastHost />
    </>
  );
}
