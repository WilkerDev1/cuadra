// Descarga de un texto como archivo (respaldo de un espacio antes de eliminarlo).
import { saveTextFile } from '../../app/data/download';
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  void saveTextFile(text, fileName, mime);
}
