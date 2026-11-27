// Guardar y leer archivos en el navegador: `showSaveFilePicker` si existe (Chromium) y, si no, un enlace de
// descarga. Todo con detección de capacidades; nada de esto toca el núcleo.

export type SaveResult = 'saved' | 'cancelled';

interface SaveHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (opts: { suggestedName: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveHandle>;

function savePicker(): SavePicker | undefined {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === 'function' ? (picker as SavePicker) : undefined;
}

export function hasSavePicker(): boolean {
  return savePicker() !== undefined;
}

/** Descarga con un enlace temporal; el navegador decide la carpeta. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface SaveOptions {
  name: string;
  text: string;
  /** Descripción que muestra el selector de archivos. */
  description: string;
  mime?: string;
  extension?: string;
}

/**
 * Guarda un texto. Con `showSaveFilePicker` la persona elige dónde; si cancela, devuelve `cancelled` y no se
 * marca nada como guardado. Si el selector falla por otro motivo (iframe, permisos), cae al enlace de descarga.
 */
export async function saveTextFile({ name, text, description, mime = 'application/json', extension = '.json' }: SaveOptions): Promise<SaveResult> {
  const blob = new Blob([text], { type: mime });
  const picker = savePicker();
  if (picker !== undefined) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description, accept: { [mime]: [extension] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Cualquier otro fallo del selector: se intenta la descarga normal.
    }
  }
  downloadBlob(blob, name);
  return 'saved';
}

/** Lee un archivo de texto elegido por la persona. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}

/** Compartir como archivo si el navegador lo permite (Web Share con archivos). */
export function canShareFile(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    return typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
