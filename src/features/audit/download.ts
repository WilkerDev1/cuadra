// Descarga de un CSV desde el navegador, y nombre de archivo sin caracteres problemáticos.
import { saveTextFile } from '../../app/data/download';

/** «Historial-Colmado-La-Esquina-2026-11-27.csv» */
export function fileName(...parts: readonly string[]): string {
  const clean = parts
    .map((p) =>
      p
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}-]+/gu, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((p) => p !== '');
  return `${clean.join('-').slice(0, 80) || 'historial'}.csv`;
}

export function downloadCsv(content: string, filename: string): void {
  void saveTextFile(content, filename, 'text/csv;charset=utf-8');
}
