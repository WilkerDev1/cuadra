// Descarga de archivos generados (respaldo, CSV, XLSX, plantilla, clave de recuperación). Un solo sitio para
// todas las features: en el navegador, enlace `download` con una URL `blob:`; en Tauri, el diálogo nativo
// «Guardar como» que el arranque registra con `setNativeSaver` (app/data no importa `data/**`).

export type NativeSaver = (suggestedName: string, data: Uint8Array) => Promise<string | null>;

let native: NativeSaver | null = null;

/** Lo llama el arranque cuando el adaptador es Tauri. */
export function setNativeSaver(saver: NativeSaver | null): void {
  native = saver;
}

export type SaveOutcome = 'saved' | 'cancelled';

/**
 * Entrega `blob` como archivo `name`. En el navegador siempre resuelve 'saved' (la descarga la gestiona el
 * navegador); en Tauri, 'cancelled' si la persona cierra el diálogo sin guardar.
 */
export async function saveFile(blob: Blob, name: string): Promise<SaveOutcome> {
  if (native !== null) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return (await native(name, bytes)) === null ? 'cancelled' : 'saved';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo tick puede cortar la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** Igual que `saveFile` con texto. */
export function saveTextFile(text: string, name: string, mime = 'text/plain;charset=utf-8'): Promise<SaveOutcome> {
  return saveFile(new Blob([text], { type: mime }), name);
}
