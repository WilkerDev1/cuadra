/** Minúsculas y sin tildes, para buscar en listas cortas de la interfaz. */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
